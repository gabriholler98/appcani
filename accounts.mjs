const encoder = new TextEncoder();
const usernamePattern = /^[a-z0-9._-]{3,24}$/;
const proofPattern = /^[a-f0-9]{64}$/;
const sessionLifetime = 30 * 24 * 60 * 60;

export function json(value, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export async function readBody(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(text + decoder.decode());
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const hex = (buffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

async function makePepperKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function derivePasswordKey(proof, salt) {
  // The browser performs the main 600,000-round KDF before the request.
  const input = await crypto.subtle.importKey("raw", encoder.encode(proof), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 10000 }, input, 256);
}

function limitAttempt(db, key, now, seconds) {
  const window = Math.floor(now / seconds) * seconds;
  return db.prepare(`
    INSERT INTO auth_attempts (attempt_key, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT (attempt_key) DO UPDATE SET
      attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING attempts
  `).bind(key, window);
}

async function allowAttempt(request, db, pepper, username, registering, now) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = hex(await crypto.subtle.sign("HMAC", pepper, encoder.encode("rate-limit:" + ip)));
  const statements = registering
    ? [limitAttempt(db, "register:" + ipKey, now, 3600)]
    : [limitAttempt(db, "login:" + ipKey, now, 600), limitAttempt(db, "username:" + username, now, 600)];
  const results = await db.batch(statements);
  return registering
    ? results[0].results[0].attempts <= 8
    : results[0].results[0].attempts <= 40 && results[1].results[0].attempts <= 8;
}

async function tokenHash(token) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

async function newSession(db, accountId, now) {
  const token = randomHex(32);
  const hash = await tokenHash(token);
  const store = db.prepare("INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)").bind(hash, accountId, now + sessionLifetime);
  await db.batch([
    store,
    db.prepare("DELETE FROM account_sessions WHERE rowid IN (SELECT rowid FROM account_sessions WHERE expires_at <= ? LIMIT 50)").bind(now),
    db.prepare("DELETE FROM auth_attempts WHERE rowid IN (SELECT rowid FROM auth_attempts WHERE window_start < ? LIMIT 50)").bind(now - 86400),
  ]);
  return token;
}

export async function startAccount(request, env, registering) {
  const data = await readBody(request);
  const rawName = typeof data?.username === "string" ? data.username : "";
  const username = rawName.trim().toLowerCase();
  const proof = data?.proof;
  if (!usernamePattern.test(username) || typeof proof !== "string" || !proofPattern.test(proof)) {
    return error("Controlla nome utente e password.");
  }
  if (!env.PASSWORD_PEPPER) return error("Accesso temporaneamente non disponibile.", 503);
  const pepper = await makePepperKey(env.PASSWORD_PEPPER);
  const db = env.DB;
  const now = nowSeconds();
  if (!await allowAttempt(request, db, pepper, username, registering, now)) {
    return error("Troppi tentativi. Riprova tra qualche minuto.", 429);
  }

  let accountId;
  if (registering) {
    accountId = crypto.randomUUID();
    const salt = randomHex(16);
    const hash = hex(await crypto.subtle.sign("HMAC", pepper, await derivePasswordKey(proof, salt)));
    const token = randomHex(32);
    const storedToken = await tokenHash(token);
    const results = await db.batch([
      db.prepare("INSERT INTO accounts (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING")
        .bind(accountId, username, salt, hash, now),
      db.prepare("INSERT INTO account_sessions (token_hash, account_id, expires_at) SELECT ?, id, ? FROM accounts WHERE id = ?")
        .bind(storedToken, now + sessionLifetime, accountId),
    ]);
    if (!results[0].meta.changes) return error("Questo nome utente è già in uso.", 409);
    return json({ token, username }, 201);
  }

  const account = await db.prepare("SELECT id, password_salt, password_hash FROM accounts WHERE username = ?").bind(username).first();
  const passwordKey = await derivePasswordKey(proof, account?.password_salt ?? "00000000000000000000000000000000");
  const expected = Uint8Array.from((account?.password_hash ?? "0".repeat(64)).match(/../g), pair => Number.parseInt(pair, 16));
  const valid = await crypto.subtle.verify("HMAC", pepper, expected, passwordKey);
  if (!valid || !account) return error("Nome utente o password non corretti.", 401);
  return json({ token: await newSession(db, account.id, now), username });
}

export async function readSession(request, db) {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const hash = await tokenHash(token);
  const account = await db.prepare(`
    SELECT a.id, a.username, p.id AS profileId
    FROM account_sessions s JOIN accounts a ON a.id = s.account_id
    LEFT JOIN profiles p ON p.account_id = a.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(hash, nowSeconds()).first();
  return account ? { ...account, sessionHash: hash } : null;
}

export async function endSession(db, account) {
  await db.prepare("DELETE FROM account_sessions WHERE token_hash = ?").bind(account.sessionHash).run();
  return json({ ok: true });
}
