import { endSession, error, json, readBody, readSession, startAccount } from "./accounts.mjs";
import { defaultDuration, walkTiming } from "./walk-time.mjs";

const utf8 = new TextEncoder();
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const now = () => new Date().toISOString();
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function maskedPoint(latitude, longitude, walkId, key) {
  const digest = new DataView(await crypto.subtle.sign("HMAC", key, utf8.encode(walkId)));
  const angle = digest.getUint32(0) / 2 ** 32 * 2 * Math.PI;
  const distance = 270 + digest.getUint32(4) / 2 ** 32 * 190;
  return {
    latitude: latitude + Math.cos(angle) * distance / 111000,
    longitude: longitude + Math.sin(angle) * distance / (111000 * Math.cos(latitude * Math.PI / 180)),
  };
}

function accountProfile(db, accountId) {
  return db.prepare(`
    SELECT id, dog_name AS dog, owner_name AS owner, breed, size, energy, emoji, birth_year AS birth
    FROM profiles WHERE account_id = ?
  `).bind(accountId).first();
}

async function saveProfile(db, account, data) {
  const dog = clean(data?.dog, 30), owner = clean(data?.owner, 30), breed = clean(data?.breed, 45);
  const size = clean(data?.size, 16), energy = clean(data?.energy, 16), emoji = clean(data?.emoji, 8), birth = Number(data?.birth);
  if (!dog || !owner || !breed || !size || !energy || !emoji || !Number.isInteger(birth) || birth < 1995 || birth > new Date().getFullYear()) {
    return error("Completa tutti i dati del profilo.");
  }
  const timestamp = now();
  await db.prepare(`
    INSERT INTO profiles (id, account_id, write_token, dog_name, owner_name, breed, birth_year, size, energy, emoji, created_at, updated_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET dog_name=excluded.dog_name, owner_name=excluded.owner_name,
      breed=excluded.breed, birth_year=excluded.birth_year, size=excluded.size, energy=excluded.energy,
      emoji=excluded.emoji, updated_at=excluded.updated_at
  `).bind(crypto.randomUUID(), account.id, dog, owner, breed, birth, size, energy, emoji, timestamp, timestamp).run();
  return json({ profile: await accountProfile(db, account.id) });
}

async function listWalks(env, profileId) {
  const currentTime = nowSeconds();
  const [walksResult, requestsResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT w.id, w.host_profile_id, w.title, w.city, w.area_label, w.latitude, w.longitude, w.day, w.time, w.max_participants, w.duration_minutes, w.ends_at,
        p.dog_name, p.breed, p.size, p.emoji, j.status AS request_status, j.details_released
      FROM walks w JOIN profiles p ON p.id = w.host_profile_id
      LEFT JOIN join_requests j ON j.walk_id = w.id AND j.profile_id = ?
      WHERE w.status = 'open' AND w.ends_at > ? AND p.account_id IS NOT NULL ORDER BY w.day, w.time
    `).bind(profileId, currentTime),
    env.DB.prepare(`
      SELECT j.id, j.walk_id, j.status, j.details_released, w.title, p.dog_name, p.emoji
      FROM join_requests j JOIN walks w ON w.id = j.walk_id JOIN profiles p ON p.id = j.profile_id
      WHERE w.host_profile_id = ? AND w.status = 'open' AND w.ends_at > ? AND p.account_id IS NOT NULL
        AND j.status IN ('pending','accepted') ORDER BY j.created_at DESC
    `).bind(profileId, currentTime),
  ]);
  const maskKey = await crypto.subtle.importKey("raw", utf8.encode(env.LOCATION_MASK_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const walks = await Promise.all(walksResult.results.map(async (walk) => {
    const host = walk.host_profile_id === profileId;
    const accepted = walk.request_status === "accepted";
    const reveal = host || (accepted && Number(walk.details_released) === 1);
    const point = reveal
      ? { latitude: walk.latitude, longitude: walk.longitude }
      : await maskedPoint(walk.latitude, walk.longitude, walk.id, maskKey);
    return {
      id: walk.id, title: walk.title, city: walk.city, day: walk.day, time: walk.time,
      duration_minutes: walk.duration_minutes, ends_at: walk.ends_at,
      max_participants: walk.max_participants, dog_name: walk.dog_name, breed: walk.breed, size: walk.size, emoji: walk.emoji,
      request_status: walk.request_status, is_host: host, reveal_exact: reveal,
      area_label: reveal ? walk.area_label : walk.city + " · zona approssimata", ...point,
    };
  }));
  return json({ walks, requests: requestsResult.results });
}

async function archiveWalks(db, profileId, filter) {
  const filters = {
    created: "w.host_profile_id = ?",
    requests: "j.profile_id = ? AND j.status != 'accepted'",
    attended: "j.profile_id = ? AND j.status = 'accepted'",
  };
  const condition = Object.hasOwn(filters, filter) && filters[filter];
  if (!condition) return error("Scegli un filtro dell’archivio.");
  const result = await db.prepare(`
    SELECT w.id, w.title, w.city, w.day, w.time, w.duration_minutes, w.ends_at, w.status,
      p.dog_name, p.emoji, j.status AS request_status,
      w.host_profile_id = ? AS is_host,
      w.status = 'open' AND (w.host_profile_id = ? OR j.status = 'accepted') AS can_chat
    FROM walks w JOIN profiles p ON p.id = w.host_profile_id
    LEFT JOIN join_requests j ON j.walk_id = w.id AND j.profile_id = ?
    WHERE (w.status = 'cancelled' OR (w.status = 'open' AND w.ends_at <= ?)) AND ${condition}
    ORDER BY w.ends_at DESC, w.id
  `).bind(profileId, profileId, profileId, nowSeconds(), profileId).all();
  return json({ walks: result.results });
}

async function createWalk(db, profileId, data) {
  const title = clean(data?.title, 55), city = clean(data?.city, 40), area = clean(data?.area_label, 140);
  const day = clean(data?.day, 12), time = clean(data?.time, 8);
  const max = Math.min(3, Math.max(1, Math.trunc(Number(data?.max)) || 1));
  const latitude = data?.latitude, longitude = data?.longitude;
  // Cached clients from before the duration field use the migration default.
  const duration = data?.duration_minutes === undefined ? defaultDuration : data.duration_minutes;
  const timing = walkTiming(day, time, duration);
  if (!timing || timing.startsAt < Math.floor(nowSeconds() / 60) * 60) {
    return error("Scegli una partenza valida (ora italiana) e una durata da 5 a 1440 minuti.");
  }
  if (!title || !city || !area
    || !Number.isFinite(latitude) || Math.abs(latitude) >= 89 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return error("Controlla i dati della passeggiata.");
  }
  await db.prepare(`
    INSERT INTO walks (id, host_profile_id, host_token, title, city, area_label, latitude, longitude, day, time, max_participants, created_at, duration_minutes, ends_at)
    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), profileId, title, city, area, latitude, longitude, day, time, max, now(), duration, timing.endsAt).run();
  return json({ ok: true }, 201);
}

async function joinWalk(db, profileId, walkId) {
  const joined = await db.prepare(`
    INSERT INTO join_requests (id, walk_id, profile_id, created_at)
    SELECT ?, w.id, ?, ? FROM walks w JOIN profiles p ON p.id = w.host_profile_id
    WHERE w.id = ? AND w.status = 'open' AND w.host_profile_id != ? AND p.account_id IS NOT NULL AND w.ends_at > ?
    ON CONFLICT(walk_id, profile_id) DO NOTHING
  `).bind(crypto.randomUUID(), profileId, now(), walkId, profileId, nowSeconds()).run();
  return joined.meta.changes ? json({ ok: true }, 201) : error("La richiesta è già stata inviata o la passeggiata non è disponibile.", 409);
}

async function updateJoin(db, profileId, walkId, requestId, reveal) {
  const result = await db.prepare(reveal ? `
    UPDATE join_requests SET details_released = 1
    WHERE id = ? AND walk_id = ? AND status = 'accepted'
      AND EXISTS (SELECT 1 FROM walks WHERE id = ? AND host_profile_id = ? AND status = 'open' AND ends_at > ?)
  ` : `
    UPDATE join_requests SET status = 'accepted'
    WHERE id = ? AND walk_id = ? AND status = 'pending'
      AND EXISTS (
        SELECT 1 FROM walks w WHERE w.id = ? AND w.host_profile_id = ? AND w.status = 'open' AND w.ends_at > ?
        AND (SELECT COUNT(*) FROM join_requests j WHERE j.walk_id = w.id AND j.status = 'accepted') < w.max_participants
      )
  `).bind(requestId, walkId, walkId, profileId, nowSeconds()).run();
  return result.meta.changes ? json({ ok: true }) : error("Questa richiesta non è disponibile o la passeggiata è al completo.", 409);
}

async function cancelWalk(db, profileId, walkId) {
  const result = await db.prepare("UPDATE walks SET status = 'cancelled' WHERE id = ? AND host_profile_id = ? AND status = 'open' AND ends_at > ?").bind(walkId, profileId, nowSeconds()).run();
  return result.meta.changes ? json({ ok: true }) : error("Passeggiata non annullabile.", 403);
}

async function deleteArchivedWalk(db, profileId, walkId) {
  const ownerCondition = "id = ? AND host_profile_id = ? AND (status = 'cancelled' OR ends_at <= ?)";
  const params = [walkId, profileId, nowSeconds()];
  const removeChildren = table => db.prepare(
    "DELETE FROM " + table + " WHERE walk_id IN (SELECT id FROM walks WHERE " + ownerCondition + ")",
  ).bind(...params);
  const results = await db.batch([
    removeChildren("messages"),
    removeChildren("join_requests"),
    db.prepare("DELETE FROM walks WHERE " + ownerCondition).bind(...params),
  ]);
  return results[2].meta.changes ? json({ ok: true }) : error("Solo l’organizzatore può eliminare una passeggiata archiviata.", 403);
}

function chatWalk(db, walkId, profileId) {
  return db.prepare(`
    SELECT w.ends_at FROM walks w WHERE w.id = ? AND w.status = 'open'
      AND (w.host_profile_id = ? OR EXISTS (
        SELECT 1 FROM join_requests j WHERE j.walk_id = w.id AND j.profile_id = ? AND j.status = 'accepted'
      ))
  `).bind(walkId, profileId, profileId).first();
}

async function readMessages(db, walkId, profileId) {
  const walk = await chatWalk(db, walkId, profileId);
  if (!walk) return error("La chat non è disponibile.", 403);
  const rows = await db.prepare(`
    SELECT m.id, m.body, m.created_at, p.dog_name, p.emoji
    FROM messages m JOIN profiles p ON p.id = m.sender_profile_id
    WHERE m.walk_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 100
  `).bind(walkId).all();
  return json({ messages: rows.results.reverse(), read_only: walk.ends_at <= nowSeconds() });
}

async function sendMessage(db, walkId, profileId, data) {
  const message = clean(data?.text, 500);
  if (!message) return error("Scrivi un messaggio.");
  const result = await db.prepare(`
    INSERT INTO messages (id, walk_id, sender_profile_id, body, created_at)
    SELECT ?, w.id, ?, ?, ? FROM walks w WHERE w.id = ? AND w.status = 'open' AND w.ends_at > ?
      AND (w.host_profile_id = ? OR EXISTS (
        SELECT 1 FROM join_requests j WHERE j.walk_id = w.id AND j.profile_id = ? AND j.status = 'accepted'
      ))
  `).bind(crypto.randomUUID(), profileId, message, now(), walkId, nowSeconds(), profileId, profileId).run();
  return result.meta.changes ? json({ ok: true }, 201) : error("La chat è archiviata o non è disponibile.", 403);
}

async function handle(request, env, url) {
  if (!env.DB || !env.LOCATION_MASK_KEY) return error("Archivio online non disponibile.", 503);
  const endpoint = request.method + " " + url.pathname;
  if (endpoint === "POST /api/auth/register") return startAccount(request, env, true);
  if (endpoint === "POST /api/auth/login") return startAccount(request, env, false);

  const db = env.DB;
  const account = await readSession(request, db);
  if (!account) return error("Accedi al tuo account per continuare.", 401);
  if (endpoint === "POST /api/auth/logout") return endSession(db, account);
  if (endpoint === "GET /api/auth/me") return json({ username: account.username, profile: await accountProfile(db, account.id) });
  if (endpoint === "POST /api/profile") return saveProfile(db, account, await readBody(request));

  const profileId = account.profileId;
  if (!profileId) return error("Crea il profilo del tuo cane per continuare.", 403);
  if (endpoint === "GET /api/walks") return listWalks(env, profileId);
  if (endpoint === "GET /api/walks/archive") return archiveWalks(db, profileId, url.searchParams.get("filter"));
  if (endpoint === "GET /api/messages") return readMessages(db, clean(url.searchParams.get("walk_id"), 60), profileId);

  const data = request.method === "POST" ? await readBody(request) : null;
  const walkId = clean(data?.walk_id, 60);
  const requestId = clean(data?.request_id, 60);
  switch (endpoint) {
    case "POST /api/walk": return createWalk(db, profileId, data);
    case "POST /api/join": return joinWalk(db, profileId, walkId);
    case "POST /api/requests/action": return updateJoin(db, profileId, walkId, requestId, false);
    case "POST /api/reveal": return updateJoin(db, profileId, walkId, requestId, true);
    case "POST /api/cancel": return cancelWalk(db, profileId, walkId);
    case "POST /api/walks/delete": return deleteArchivedWalk(db, profileId, walkId);
    case "POST /api/messages": return sendMessage(db, walkId, profileId, data);
    default: return error("Risorsa non trovata.", 404);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.PAGES_ORIGIN) return error("Origine non autorizzata.", 403);
    const cors = new Headers({ Vary: "Origin" });
    if (origin) cors.set("Access-Control-Allow-Origin", origin);
    if (request.method === "OPTIONS") {
      cors.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      cors.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return new Response(null, { status: 204, headers: cors });
    }
    const url = new URL(request.url);
    let response;
    try {
      response = await handle(request, env, url);
    } catch {
      console.error(JSON.stringify({ event: "api_error", path: url.pathname, method: request.method }));
      response = error("Servizio temporaneamente non disponibile.", 500);
    }
    for (const [name, value] of cors) response.headers.set(name, value);
    return response;
  },
};
