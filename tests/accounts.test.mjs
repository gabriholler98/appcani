import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { passwordProof } from "../docs/assets/account-client.js";
import worker from "../worker.mjs";
import { deliverPush } from "../notifications.mjs";
import { walkTiming } from "../walk-time.mjs";

const origin = "https://gabriholler98.github.io";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_shared_walks", "0001_chat_and_reveal", "0002_accounts", "0003_walk_archive", "0004_notifications"]) {
    sqlite.exec(readFileSync(new URL("../drizzle/" + migration + ".sql", import.meta.url), "utf8"));
  }
  const db = {
    prepare(query) {
      const stmt = sqlite.prepare(query);
      return { bind(...args) {
        const all = () => ({ results: stmt.all(...args) });
        const run = () => ({ meta: stmt.run(...args) });
        return {
          first: () => stmt.get(...args) ?? null,
          all,
          run,
          batch: stmt.columns().length ? all : run,
        };
      } };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(statement => statement.batch());
        sqlite.exec("COMMIT");
        return results;
      } catch (failure) {
        sqlite.exec("ROLLBACK");
        throw failure;
      }
    },
  };
  return { sqlite, db };
}

test("account required, data follows the account and chat stays private", async () => {
  const { sqlite, db } = database();
  const env = { DB: db, LOCATION_MASK_KEY: "test-location", PASSWORD_PEPPER: "test-pepper", PAGES_ORIGIN: origin };
  async function call(path, { method, token, data, status = 200, source = origin } = {}) {
    const headers = { Origin: source, "CF-Connecting-IP": "192.0.2.51" };
    if (token) headers.Authorization = "Bearer " + token;
    if (data) headers["Content-Type"] = "application/json";
    const response = await worker.fetch(new Request("https://test.invalid/api/" + path, {
      headers, method: method ?? (data ? "POST" : "GET"), body: data ? JSON.stringify(data) : undefined,
    }), env);
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  }

  const profile = { dog: "Luna", owner: "Marta", breed: "Mix", size: "Media", energy: "Media", emoji: "🐕", birth: 2020 };
  const username = "walker.one";
  const proof = await passwordProof(username, "una-password-per-il-test");
  await call("walks", { status: 401 });
  await call("walks/archive?filter=created", { status: 401 });
  await call("profile", { data: profile, status: 401 });
  const { token: host } = await call("auth/register", { data: { username, proof }, status: 201 });
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  env.VAPID_PRIVATE_JWK = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
  await call("auth/register", { data: { username: "WALKER.ONE", proof }, status: 409 });
  await call("walks", { token: host, status: 403 });
  assert.equal((await call("auth/me", { token: host })).profile, null);
  const hostProfile = (await call("profile", { token: host, data: profile })).profile;
  const databaseProfile = sqlite.prepare("SELECT write_token, account_id FROM profiles WHERE id = ?").get(hostProfile.id);
  assert.equal(databaseProfile.write_token, "");
  const account = sqlite.prepare("SELECT password_hash, password_salt FROM accounts WHERE id = ?").get(databaseProfile.account_id);
  const device = { endpoint: "https://fcm.googleapis.com/fcm/send/local-test-only" };
  await call("notifications/device/enable", { token: host, data: { endpoint: "https://invalid.example/" }, status: 400 });
  await call("notifications/device/enable", { token: host, data: device });
  const { key } = await call("notifications/push-settings", { token: host });
  assert.equal(Buffer.from(key, "base64url").length, 65);
  const deliveries = [];
  await deliverPush(env, [databaseProfile.account_id], async (url, options) => {
    deliveries.push({ url, options });
    return new Response(null, { status: 410 });
  });
  assert.equal(deliveries.length, 1);
  const [{ url, options }] = deliveries;
  assert.equal(url, device.endpoint);
  assert.equal(options.redirect, "manual");
  assert.equal(options.method, "POST");
  assert.equal(options.body, undefined);
  const [jwt, publicKey] = options.headers.Authorization.slice("vapid t=".length).split(", k=");
  assert.equal(publicKey, key);
  const [header, claims, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(claims, "base64url")).aud, "https://fcm.googleapis.com");
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
    Buffer.from(signature, "base64url"), new TextEncoder().encode(header + "." + claims)));
  assert.equal((await call("notifications/device/check", { token: host, data: device })).enabled, false);
  await call("notifications/device/enable", { token: host, data: device });
  assert.notEqual(account.password_hash, proof);
  assert.equal(account.password_salt.length, 32);
  assert.equal(sqlite.prepare("SELECT count(*) AS total FROM account_sessions WHERE token_hash = ?").get(host).total, 0);

  const { token: secondDevice } = await call("auth/login", { data: { username, proof } });
  assert.notEqual(secondDevice, host);
  assert.deepEqual((await call("auth/me", { token: secondDevice })).profile, hostProfile);
  await call("auth/login", { data: { username, proof: "0".repeat(64) }, status: 401 });
  const walkInput = {
    title: "Parco", city: "Trento", area_label: "Punto di ritrovo",
    day: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    time: "10:00", max: 1, latitude: 46.07, longitude: 11.12, duration_minutes: 90,
  };
  await call("walk", { token: host, status: 400, data: { ...walkInput, duration_minutes: 0 } });
  await call("walk", { token: host, status: 201, data: walkInput });
  const [walk] = (await call("walks", { token: secondDevice })).walks;
  assert.equal(walk.is_host, true);
  assert.equal(walk.area_label, "Punto di ritrovo");
  assert.equal(walk.duration_minutes, 90);
  assert.equal(walk.ends_at, walkTiming(walkInput.day, "10:00", 90).endsAt);
  assert.deepEqual((await call("walks/archive?filter=created", { token: host })).walks, []);
  const nameGuest = "walker.two";
  const { token: guest } = await call("auth/register", { data: { username: nameGuest, proof: await passwordProof(nameGuest, "password-differente") }, status: 201 });
  await call("profile", { token: guest, data: { ...profile, dog: "Bruno", id: hostProfile.id } });
  assert.equal((await call("notifications/device/check", { token: guest, data: device })).enabled, false);
  assert.notEqual((await call("auth/me", { token: guest })).profile.id, hostProfile.id);
  assert.notEqual((await call("walks", { token: guest })).walks[0].latitude, walk.latitude);
  await call("join", { token: guest, data: { walk_id: walk.id }, status: 201 });
  assert.equal((await call("walks", { token: host })).unread_notifications, 1);
  assert.equal((await call("notifications", { token: guest })).unread, 0);
  const hostInbox = await call("notifications", { token: host });
  assert.equal(hostInbox.items[0].kind, "join");
  await call("notifications/read", { token: guest, data: { through: hostInbox.items[0].id } });
  assert.equal((await call("notifications", { token: host })).unread, 1);
  assert.equal((await call("notifications/read", { token: host, data: { through: hostInbox.items[0].id } })).unread, 0);
  await call("messages?walk_id=" + walk.id, { token: guest, status: 403 });
  const [pending] = (await call("walks", { token: secondDevice })).requests;
  const data = { walk_id: walk.id, request_id: pending.id };
  await call("requests/action", { token: guest, data, status: 409 });
  await call("requests/action", { token: secondDevice, data });
  assert.equal((await call("walks", { token: guest })).walks[0].reveal_exact, false);
  await call("messages", { token: guest, data: { walk_id: walk.id, text: "Ciao!" }, status: 201 });
  assert.equal((await call("messages?walk_id=" + walk.id, { token: secondDevice })).messages[0].body, "Ciao!");
  assert.equal((await call("notifications", { token: guest })).items[0].kind, "accepted");
  assert.equal((await call("notifications", { token: host })).items[0].kind, "chat");
  await call("messages", { token: guest, data: { walk_id: walk.id, text: "Ci vediamo." }, status: 201 });
  assert.equal((await call("notifications", { token: secondDevice })).unread, 1);
  await call("reveal", { token: host, data });
  assert.equal((await call("walks", { token: guest })).walks[0].area_label, "Punto di ritrovo");
  const waitingName = "walker.three";
  const { token: waiting } = await call("auth/register", {
    data: { username: waitingName, proof: await passwordProof(waitingName, "another-password") }, status: 201,
  });
  await call("profile", { token: waiting, data: { ...profile, dog: "Tito" } });
  await call("join", { token: waiting, data: { walk_id: walk.id }, status: 201 });
  await call("walks/delete", { token: host, data, status: 403 });
  sqlite.prepare("UPDATE walks SET ends_at = ? WHERE id = ?").run(Math.floor(Date.now() / 1000), walk.id);
  assert.deepEqual((await call("walks", { token: guest })).walks, []);
  assert.deepEqual((await call("walks", { token: host })).requests, []);
  const archivedByHost = (await call("walks/archive?filter=created", { token: host })).walks;
  assert.equal(archivedByHost[0].id, walk.id);
  assert.equal(archivedByHost[0].can_chat, 1);
  const archivedByGuest = (await call("walks/archive?filter=attended", { token: guest })).walks;
  assert.equal(archivedByGuest[0].id, walk.id);
  assert.ok(!("area_label" in archivedByGuest[0]));
  assert.equal((await call("walks/archive?filter=requests", { token: waiting })).walks[0].request_status, "pending");
  assert.deepEqual((await call("walks/archive?filter=attended", { token: waiting })).walks, []);
  assert.equal((await call("messages?walk_id=" + walk.id, { token: guest })).read_only, true);
  await call("messages", { token: guest, data: { walk_id: walk.id, text: "A presto" }, status: 403 });
  await call("messages?walk_id=" + walk.id, { token: waiting, status: 403 });
  await call("walks/delete", { token: guest, data, status: 403 });
  await call("walks/delete", { token: host, data });
  assert.deepEqual((await call("walks/archive?filter=attended", { token: guest })).walks, []);
  await call("messages?walk_id=" + walk.id, { token: guest, status: 403 });
  for (const table of ["walks", "messages", "join_requests", "notifications"]) {
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS total FROM " + table).get().total, 0);
  }
  await call("auth/logout", { token: host, method: "POST" });
  assert.equal((await call("notifications/device/check", { token: secondDevice, data: device })).enabled, false);
  await call("auth/me", { token: host, status: 401 });
  await call("walk", { token: secondDevice, status: 201, data: walkInput });
  const [cancelled] = (await call("walks", { token: secondDevice })).walks;
  await call("join", { token: guest, data: { walk_id: cancelled.id }, status: 201 });
  await call("cancel", { token: secondDevice, data: { walk_id: cancelled.id } });
  assert.equal((await call("notifications", { token: guest })).items[0].kind, "cancelled");
  assert.deepEqual((await call("walks", { token: guest })).walks, []);
  assert.equal((await call("walks/archive?filter=created", { token: secondDevice })).walks[0].status, "cancelled");
  await call("auth/me", { token: guest, source: "https://untrusted.invalid", status: 403 });
  for (let i = 0; i < 6; i += 1) await call("auth/login", { data: { username, proof: "0".repeat(64) }, status: 401 });
  await call("auth/login", { data: { username, proof }, status: 429 });
  sqlite.close();
});

test("walk length uses elapsed minutes and the Italian time zone", () => {
  assert.deepEqual(walkTiming("2026-11-17", "18:00", 90), {
    startsAt: Date.parse("2026-11-17T17:00:00Z") / 1000,
    endsAt: Date.parse("2026-11-17T18:30:00Z") / 1000,
  });
  assert.equal(walkTiming("2026-07-17", "18:00", 60).endsAt, Date.parse("2026-07-17T17:00:00Z") / 1000);
  assert.equal(walkTiming("2026-03-29", "02:30", 60), null);
  assert.equal(walkTiming("2026-02-30", "11:00", 60), null);
  assert.equal(walkTiming("2026-10-25", "02:30", 60).startsAt, Date.parse("2026-10-25T00:30:00Z") / 1000);
});
