import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { passwordProof } from "../docs/assets/account-client.js";
import worker from "../worker.mjs";

const origin = "https://gabriholler98.github.io";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_shared_walks", "0001_chat_and_reveal", "0002_accounts"]) {
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
  await call("profile", { data: profile, status: 401 });
  const { token: host } = await call("auth/register", { data: { username, proof }, status: 201 });
  await call("auth/register", { data: { username: "WALKER.ONE", proof }, status: 409 });
  await call("walks", { token: host, status: 403 });
  assert.equal((await call("auth/me", { token: host })).profile, null);
  const hostProfile = (await call("profile", { token: host, data: profile })).profile;
  const databaseProfile = sqlite.prepare("SELECT write_token, account_id FROM profiles WHERE id = ?").get(hostProfile.id);
  assert.equal(databaseProfile.write_token, "");
  const account = sqlite.prepare("SELECT password_hash, password_salt FROM accounts WHERE id = ?").get(databaseProfile.account_id);
  assert.notEqual(account.password_hash, proof);
  assert.equal(account.password_salt.length, 32);
  assert.equal(sqlite.prepare("SELECT count(*) AS total FROM account_sessions WHERE token_hash = ?").get(host).total, 0);

  const { token: secondDevice } = await call("auth/login", { data: { username, proof } });
  assert.notEqual(secondDevice, host);
  assert.deepEqual((await call("auth/me", { token: secondDevice })).profile, hostProfile);
  await call("auth/login", { data: { username, proof: "0".repeat(64) }, status: 401 });
  await call("walk", { token: host, status: 201, data: {
    title: "Parco", city: "Trento", area_label: "Punto di ritrovo", day: "2026-12-01",
    time: "10:00", max: 1, latitude: 46.07, longitude: 11.12,
  } });
  const [walk] = (await call("walks", { token: secondDevice })).walks;
  assert.equal(walk.is_host, true);
  assert.equal(walk.area_label, "Punto di ritrovo");
  const nameGuest = "walker.two";
  const { token: guest } = await call("auth/register", { data: { username: nameGuest, proof: await passwordProof(nameGuest, "password-differente") }, status: 201 });
  await call("profile", { token: guest, data: { ...profile, dog: "Bruno", id: hostProfile.id } });
  assert.notEqual((await call("auth/me", { token: guest })).profile.id, hostProfile.id);
  assert.notEqual((await call("walks", { token: guest })).walks[0].latitude, walk.latitude);
  await call("join", { token: guest, data: { walk_id: walk.id }, status: 201 });
  await call("messages?walk_id=" + walk.id, { token: guest, status: 403 });
  const [pending] = (await call("walks", { token: secondDevice })).requests;
  const data = { walk_id: walk.id, request_id: pending.id };
  await call("requests/action", { token: guest, data, status: 409 });
  await call("requests/action", { token: secondDevice, data });
  assert.equal((await call("walks", { token: guest })).walks[0].reveal_exact, false);
  await call("messages", { token: guest, data: { walk_id: walk.id, text: "Ciao!" }, status: 201 });
  assert.equal((await call("messages?walk_id=" + walk.id, { token: secondDevice })).messages[0].body, "Ciao!");
  await call("reveal", { token: host, data });
  assert.equal((await call("walks", { token: guest })).walks[0].area_label, "Punto di ritrovo");
  await call("auth/logout", { token: host, method: "POST" });
  await call("auth/me", { token: host, status: 401 });
  await call("cancel", { token: secondDevice, data });
  assert.deepEqual((await call("walks", { token: guest })).walks, []);
  await call("auth/me", { token: guest, source: "https://untrusted.invalid", status: 403 });
  for (let i = 0; i < 6; i += 1) await call("auth/login", { data: { username, proof: "0".repeat(64) }, status: 401 });
  await call("auth/login", { data: { username, proof }, status: 429 });
  sqlite.close();
});
