import { error, json } from "./accounts.mjs";

const encoder = new TextEncoder();
const retention = 30 * 24 * 60 * 60;
const maxDevices = 5;
const maxPushesPerEvent = 25;
const now = () => Math.floor(Date.now() / 1000);

const recipients = {
  join: `SELECT p.account_id FROM walks w JOIN profiles p ON p.id = w.host_profile_id WHERE w.id = ?`,
  accepted: `SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id = j.profile_id WHERE j.walk_id = ? AND j.id = ?`,
  cancelled: `SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id = j.profile_id WHERE j.walk_id = ?`,
  chat: `
    SELECT p.account_id FROM walks w JOIN profiles p ON p.id = w.host_profile_id WHERE w.id = ? AND p.id != ?
    UNION
    SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id = j.profile_id
    WHERE j.walk_id = ? AND j.status = 'accepted' AND p.id != ?
  `,
};

export async function commitNotification(env, ctx, mutation, kind, walkId, ...params) {
  const timestamp = now();
  const insert = env.DB.prepare(`
    INSERT INTO notifications (account_id, walk_id, kind, created_at)
    SELECT DISTINCT account_id, ?, ?, ? FROM (${recipients[kind]})
    WHERE account_id IS NOT NULL AND changes() > 0
    ON CONFLICT DO NOTHING RETURNING account_id
  `).bind(walkId, kind, timestamp, ...params);
  const prune = env.DB.prepare(`
    DELETE FROM notifications WHERE id IN (
      SELECT id FROM notifications WHERE created_at < ? ORDER BY created_at LIMIT 100
    )
  `).bind(timestamp - retention);
  const [, changed, delivery] = await env.DB.batch([prune, mutation, insert]);
  if (ctx && env.VAPID_PRIVATE_JWK && delivery.results?.length) {
    ctx.waitUntil(deliverPush(env, delivery.results.map(row => row.account_id)).catch(() => {
      console.warn(JSON.stringify({ event: "push_delivery_failed" }));
    }));
  }
  return changed;
}

export function unreadQuery(db, accountId) {
  return db.prepare("SELECT count(*) AS unread FROM notifications WHERE account_id = ? AND read_at IS NULL AND created_at >= ?")
    .bind(accountId, now() - retention);
}

export async function listNotifications(db, accountId) {
  const list = db.prepare(`
    SELECT n.id, n.kind, n.created_at, n.read_at, w.title
    FROM notifications n JOIN walks w ON w.id = n.walk_id
    WHERE n.account_id = ? AND n.created_at >= ? ORDER BY n.id DESC LIMIT 30
  `).bind(accountId, now() - retention);
  const [items, unread] = await db.batch([list, unreadQuery(db, accountId)]);
  return json({ items: items.results, unread: unread.results[0].unread });
}

export async function markNotificationsRead(db, accountId, data) {
  const through = data?.through;
  if (!Number.isSafeInteger(through) || through < 1) return error("Avvisi non validi.");
  await db.prepare(`UPDATE notifications SET read_at = ? WHERE account_id = ? AND read_at IS NULL AND id <= ?`)
    .bind(now(), accountId, through).run();
  const count = await unreadQuery(db, accountId).first();
  return json({ unread: count.unread });
}

export function supportedPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const allowed = host === "fcm.googleapis.com" || host === "fcmregistrations.googleapis.com"
      || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com")
      || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com")
      || host.endsWith(".wns.windows.com");
    return url.protocol === "https:" && allowed && !url.port && !url.username && !url.password && !url.hash
      ? url : null;
  } catch {
    return null;
  }
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
}

function vapidPublicKey(jwk) {
  return base64url(new Uint8Array([4, ...decode(jwk.x), ...decode(jwk.y)]));
}

export function pushSettings(env) {
  return json({ key: env.VAPID_PRIVATE_JWK ? vapidPublicKey(JSON.parse(env.VAPID_PRIVATE_JWK)) : null });
}

export async function changeDevice(env, account, data, action) {
  const endpoint = supportedPushEndpoint(data?.endpoint)?.href;
  if (!endpoint) return error("Questo servizio di notifiche non è supportato.");
  const db = env.DB;
  if (action === "check") {
    const exists = await db.prepare("SELECT 1 FROM push_devices WHERE endpoint = ? AND account_id = ?").bind(endpoint, account.id).first();
    return json({ enabled: Boolean(exists) });
  }
  if (action === "disable") {
    await db.prepare("DELETE FROM push_devices WHERE endpoint = ? AND account_id = ?").bind(endpoint, account.id).run();
    return json({ enabled: false });
  }
  if (!env.VAPID_PRIVATE_JWK) return error("Notifiche push temporaneamente non disponibili.", 503);
  const r = await db.prepare(`
    INSERT INTO push_devices (endpoint, account_id, session_hash, updated_at)
    SELECT ?, ?, ?, ? WHERE
      (SELECT count(*) FROM push_devices WHERE account_id = ? AND endpoint != ?) < ?
    ON CONFLICT(endpoint) DO UPDATE SET account_id = excluded.account_id,
      session_hash = excluded.session_hash, updated_at = excluded.updated_at
  `).bind(endpoint, account.id, account.sessionHash, Date.now(), account.id, endpoint, maxDevices).run();
  return r.meta.changes ? json({ enabled: true }) : error("Hai già attivato le notifiche su cinque dispositivi.", 409);
}

export async function forgetLogoutDevice(db, account, data) {
  const endpoint = supportedPushEndpoint(data?.endpoint)?.href ?? "";
  return db.prepare("DELETE FROM push_devices WHERE account_id = ? AND (session_hash = ? OR endpoint = ?)")
    .bind(account.id, account.sessionHash, endpoint).run();
}

async function signVapid(privateKey, publicKey, origin, subject) {
  const header = base64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64url(encoder.encode(JSON.stringify({ aud: origin, exp: now() + 3600, sub: subject })));
  const input = header + "." + claims;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoder.encode(input));
  return "vapid t=" + input + "." + base64url(new Uint8Array(signature)) + ", k=" + publicKey;
}

export async function deliverPush(env, accounts, send = fetch) {
  if (!accounts.length) return;
  const targets = [...new Set(accounts)].slice(0, maxPushesPerEvent);
  const slots = targets.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`
    SELECT endpoint, updated_at FROM push_devices WHERE account_id IN (${slots})
    ORDER BY updated_at DESC LIMIT ?
  `).bind(...targets, maxPushesPerEvent).all();
  if (!results.length) return;
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const publicKey = vapidPublicKey(jwk);
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const authorizations = new Map();
  const subject = new URL("/appcani/", env.PAGES_ORIGIN).href;
  const expired = [];
  let failures = 0;
  // Keep external connections below the Workers per-invocation concurrency limit.
  for (let i = 0; i < results.length; i += 5) {
    await Promise.all(results.slice(i, i + 5).map(async device => {
      const endpoint = supportedPushEndpoint(device.endpoint);
      if (!endpoint) return;
      try {
        if (!authorizations.has(endpoint.origin)) {
          authorizations.set(endpoint.origin, signVapid(privateKey, publicKey, endpoint.origin, subject));
        }
        const response = await send(endpoint.href, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(6000),
          headers: { Authorization: await authorizations.get(endpoint.origin), TTL: "900", Topic: "dogs-in-giro" },
        });
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410) expired.push(device);
        else if (!response.ok) failures += 1;
      } catch {
        failures += 1;
      }
    }));
  }
  if (expired.length) await env.DB.batch(expired.map(device =>
    env.DB.prepare("DELETE FROM push_devices WHERE endpoint = ? AND updated_at = ?").bind(device.endpoint, device.updated_at)));
  if (failures) console.warn(JSON.stringify({ event: "push_provider_rejected", count: failures }));
}
