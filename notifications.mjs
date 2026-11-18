import { error, json } from "./accounts.mjs";

const encoder = new TextEncoder();
const retention = 30 * 24 * 60 * 60;
const maxDevices = 5;
const maxPushesPerEvent = 25;
const now = () => Math.floor(Date.now() / 1000);

const recipients = {
  join: `SELECT p.account_id FROM walks w JOIN profiles p ON p.id = w.host_profile_id WHERE w.id = ?`,
  accepted: `SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id = j.profile_id WHERE j.walk_id = ? AND j.id = ?`,
  rejected: `SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id = j.profile_id WHERE j.walk_id = ? AND j.id = ?`,
  withdrawn: `SELECT p.account_id FROM walks w JOIN profiles p ON p.id = w.host_profile_id WHERE w.id = ?`,
  changed: `SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id=j.profile_id WHERE j.walk_id=? AND j.status='accepted'`,
  cancelled: `SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id = j.profile_id WHERE j.walk_id = ? AND j.status IN ('pending','accepted')`,
  chat: `
    SELECT p.account_id FROM walks w JOIN profiles p ON p.id = w.host_profile_id WHERE w.id = ? AND p.id != ?
    UNION
    SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id = j.profile_id
    WHERE j.walk_id = ? AND j.status = 'accepted' AND p.id != ?
  `,
};

export async function commitNotification(env, ctx, mutation, kind, walkId, params, {details="",actor=""}={}) {
  const timestamp = now();
  const insert = env.DB.prepare(`
    INSERT INTO notifications (account_id, walk_id, kind, created_at, details)
    SELECT DISTINCT account_id, ?, ?, ?, ? FROM (${recipients[kind]}) AS recipients
    WHERE account_id IS NOT NULL AND changes() > 0
      AND NOT EXISTS (SELECT 1 FROM profiles p JOIN blocks b ON
        (b.owner_id=p.id AND b.target_id=?) OR (b.target_id=p.id AND b.owner_id=?)
        WHERE p.account_id=recipients.account_id)
    ON CONFLICT DO NOTHING RETURNING account_id
  `).bind(walkId, kind, timestamp, details, ...params, actor, actor);
  const prune = env.DB.prepare(`
    DELETE FROM notifications WHERE id IN (
      SELECT id FROM notifications WHERE created_at < ? ORDER BY created_at LIMIT 100
    )
  `).bind(timestamp - retention);
  const [, changed, delivery] = await env.DB.batch([prune, mutation, insert]);
  if (ctx && env.VAPID_PRIVATE_JWK && delivery.results?.length) {
    ctx.waitUntil(deliverPush(env, delivery.results.map(row => row.account_id),fetch,{kind}).catch(() => {
      console.warn(JSON.stringify({ event: "push_delivery_failed" }));
    }));
  }
  return changed;
}

export function unreadQuery(db, accountId) {
  return db.prepare(`SELECT
    (SELECT count(*) FROM notifications WHERE account_id=? AND read_at IS NULL AND created_at>=?)+
    (SELECT count(*) FROM account_notices WHERE account_id=? AND read_at IS NULL AND created_at>=?) AS unread,
    (SELECT count(*) FROM relationships r JOIN profiles p ON p.account_id=?
      WHERE r.state='pending' AND r.sender_id!=p.id AND (r.first_id=p.id OR r.second_id=p.id)) AS friend_requests`)
    .bind(accountId,now()-retention,accountId,now()-retention,accountId);
}

export async function listNotifications(db, accountId) {
  const list = db.prepare(`
    SELECT n.id, n.kind, n.created_at, n.read_at, n.walk_id, n.details, w.title
    FROM notifications n JOIN walks w ON w.id = n.walk_id
    WHERE n.account_id = ? AND n.created_at >= ?
    UNION ALL SELECT 'a:'||id AS id,kind,created_at,read_at,reference_id AS walk_id,details,title
    FROM account_notices WHERE account_id=? AND created_at>=?
    ORDER BY created_at DESC,id DESC LIMIT 30
  `).bind(accountId,now()-retention,accountId,now()-retention);
  const [items, unread] = await db.batch([list, unreadQuery(db, accountId)]);
  return json({ items: items.results, unread: unread.results[0].unread });
}

export async function markNotificationsRead(db, accountId, data) {
  const ids=data?.ids??[data?.id];
  if(Array.isArray(ids)&&ids.length&&ids.length<=30&&ids.every(id=>typeof id==="string"&&/^a:\d+$/.test(id)||Number.isSafeInteger(id)&&id>0)) {
    const legacy=ids.filter(Number.isSafeInteger),accounts=ids.filter(id=>typeof id==="string").map(id=>Number(id.slice(2)));
    await db.batch([
      db.prepare("UPDATE notifications SET read_at=? WHERE account_id=? AND read_at IS NULL AND id IN(SELECT value FROM json_each(?))")
        .bind(now(),accountId,JSON.stringify(legacy)),
      db.prepare("UPDATE account_notices SET read_at=? WHERE account_id=? AND read_at IS NULL AND id IN(SELECT value FROM json_each(?))")
        .bind(now(),accountId,JSON.stringify(accounts)),
    ]);
    return json(await unreadQuery(db,accountId).first());
  }
  const through = data?.through;
  const id = data?.id??through;
  if (!Number.isSafeInteger(id) || id < 1) return error("Avvisi non validi.");
  await db.prepare(`UPDATE notifications SET read_at=? WHERE account_id=? AND read_at IS NULL AND id ${through===undefined?"=":"<="} ?`)
    .bind(now(),accountId,id).run();
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

export async function deliverPush(env, accounts, send = fetch, {kind="",endpoint=""}={}) {
  if (!accounts.length || !env.VAPID_PRIVATE_JWK) return 0;
  const targets = [...new Set(accounts)].slice(0, maxPushesPerEvent);
  const slots = targets.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`
    SELECT d.endpoint,d.updated_at FROM push_devices d JOIN profiles p ON p.account_id=d.account_id
    WHERE d.account_id IN (${slots}) AND (?='' OR d.endpoint=?)
      AND NOT EXISTS(SELECT 1 FROM json_each(p.push_muted) WHERE value=?)
    ORDER BY d.updated_at DESC LIMIT ?
  `).bind(...targets,endpoint,endpoint,kind,maxPushesPerEvent).all();
  if (!results.length) return 0;
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const publicKey = vapidPublicKey(jwk);
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const authorizations = new Map();
  const subject = new URL("/appcani/", env.PAGES_ORIGIN).href;
  const expired = [];
  let accepted = 0;
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
          // Workers supports manual redirects. Never forward a VAPID header to another host.
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(6000),
          headers: { Authorization: await authorizations.get(endpoint.origin), TTL: "900", Topic: "dogs-in-giro" },
        });
        await response.body?.cancel();
        if (response.ok) accepted += 1;
        if (response.status === 404 || response.status === 410) expired.push(device);
        if (!response.ok) {
          console.warn(JSON.stringify({ event: "push_provider_rejected", provider: endpoint.hostname, status: response.status }));
        }
      } catch (failure) {
        console.warn(JSON.stringify({ event: "push_request_failed", provider: endpoint.hostname, error_type: failure.name }));
      }
    }));
  }
  if (expired.length) await env.DB.batch(expired.map(device =>
    env.DB.prepare("DELETE FROM push_devices WHERE endpoint = ? AND updated_at = ?").bind(device.endpoint, device.updated_at)));
  return accepted;
}

export async function testDevice(env, account, data) {
  const endpoint = supportedPushEndpoint(data?.endpoint)?.href;
  if (!endpoint || !env.VAPID_PRIVATE_JWK) return error("Attiva prima le notifiche su questo dispositivo.",409);
  const time = now();
  const updated = await env.DB.prepare(`UPDATE push_devices SET last_test_at=? WHERE account_id=? AND endpoint=? AND last_test_at<=?`)
    .bind(time,account.id,endpoint,time-60).run();
  if (!updated.meta.changes) return error("Controlla che le push siano attive e attendi un minuto prima di riprovare.",429);
  const accepted = await deliverPush(env,[account.id],fetch,{endpoint});
  return accepted ? json({ok:true}) : error("Il servizio push ha rifiutato l’invio. Disattiva e riattiva le notifiche su questo dispositivo.",502);
}
