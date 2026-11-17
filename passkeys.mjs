import { error,json,limitPasskeyOptions,matchesPassword,newSession } from "./accounts.mjs";
import {
  generateAuthenticationOptions,generateRegistrationOptions,verifyAuthenticationResponse,verifyRegistrationResponse,
} from "./webauthn-vendor.mjs";
import { clean,nowSeconds } from "./profiles.mjs";

const utf8=new TextEncoder();
const b64=value=>btoa(String.fromCharCode(...value)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
const bytes=value=>Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),byte=>byte.charCodeAt(0));
const idPattern=/^[A-Za-z0-9_-]{1,1400}$/;
const challengePattern=/^[A-Za-z0-9_-]{43}$/;

function origin(env) {
  const url=new URL(env.PAGES_ORIGIN);
  return {expectedOrigin:url.origin,expectedRPID:url.hostname};
}

async function storeChallenge(db,challenge,purpose,owner) {
  const time=nowSeconds();
  await db.batch([
    db.prepare(`DELETE FROM passkey_challenges WHERE challenge IN
      (SELECT challenge FROM passkey_challenges WHERE expires_at<=? LIMIT 60)`).bind(time),
    db.prepare("INSERT INTO passkey_challenges (challenge,purpose,owner,expires_at) VALUES (?,?,?,?)")
      .bind(challenge,purpose,owner,time+300),
  ]);
}

async function consumeChallenge(db,data,purpose,owner) {
  const challenge=data?.challenge;
  if (typeof challenge!=="string" || !challengePattern.test(challenge) || !data?.response) return null;
  return db.prepare(`DELETE FROM passkey_challenges WHERE challenge=? AND purpose=? AND owner=? AND expires_at>?
    RETURNING challenge`).bind(challenge,purpose,owner,nowSeconds()).first();
}

export async function listPasskeys(db,account) {
  const {results}=await db.prepare("SELECT id,label,created_at FROM passkeys WHERE account_id=? ORDER BY created_at DESC").bind(account.id).all();
  return json({ passkeys:results });
}

export async function registerOptions(env,account,data) {
  if (!await matchesPassword(env,account,data?.proof)) return error("Password attuale non corretta.",403);
  const db=env.DB;
  const {results}=await db.prepare("SELECT id FROM passkeys WHERE account_id=? LIMIT 12").bind(account.id).all();
  if (results.length>=12) return error("Hai già registrato 12 passkey.",409);
  const options=await generateRegistrationOptions({
    rpName:"Dogs in Giro",rpID:origin(env).expectedRPID,userName:account.username,userID:utf8.encode(account.id),
    attestationType:"none",excludeCredentials:results.map(({id})=>({id})),
    authenticatorSelection:{residentKey:"required",userVerification:"required"},
    supportedAlgorithmIDs:[-7],timeout:90000,
  });
  await storeChallenge(db,options.challenge,"register",account.sessionHash);
  return json({options});
}

export async function registerPasskey(env,account,data) {
  const db=env.DB;
  const stored=await consumeChallenge(db,data,"register",account.sessionHash);
  if (!stored) return error("Richiesta scaduta. Ricomincia dalle impostazioni.",409);
  let credential;
  try {
    const result=await verifyRegistrationResponse({
      response:data.response,expectedChallenge:stored.challenge,...origin(env),requireUserVerification:true,
      supportedAlgorithmIDs:[-7],
    });
    if (result.verified && result.registrationInfo.fmt==="none") credential=result.registrationInfo.credential;
  } catch { /* Untrusted authenticator response. */ }
  if (!credential) return error("Non è stato possibile verificare questa passkey.",400);
  const label=clean(data?.label,40)||"Passkey";
  const result=await db.prepare(`INSERT INTO passkeys(id,account_id,public_key,counter,label,created_at)
    SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM passkeys WHERE account_id=?)<12 ON CONFLICT(id) DO NOTHING`)
    .bind(credential.id,account.id,b64(credential.publicKey),credential.counter,label,nowSeconds(),account.id).run();
  return result.meta.changes ? json({ok:true},201) : error("Passkey già registrata o limite raggiunto.",409);
}

export async function removePasskey(env,account,data) {
  if (!await matchesPassword(env,account,data?.proof)) return error("Password attuale non corretta.",403);
  const id=clean(data?.id,1400);
  const result=await env.DB.prepare("DELETE FROM passkeys WHERE id=? AND account_id=?").bind(id,account.id).run();
  return result.meta.changes ? json({ok:true}) : error("Passkey non trovata.",404);
}

export async function loginOptions(request,env) {
  if (!await limitPasskeyOptions(request,env)) return error("Troppi tentativi. Riprova tra qualche minuto.",429);
  const options=await generateAuthenticationOptions({rpID:origin(env).expectedRPID,userVerification:"required",timeout:90000});
  await storeChallenge(env.DB,options.challenge,"login","");
  return json({options});
}

export async function verifyPasskey(env,data) {
  const db=env.DB;
  const stored=await consumeChallenge(db,data,"login","");
  const id=data?.response?.id;
  if (!stored || typeof id!=="string" || !idPattern.test(id)) return error("Passkey non valida o richiesta scaduta.",401);
  const row=await db.prepare(`SELECT a.id AS account_id,a.username,p.public_key,p.counter
    FROM passkeys p JOIN accounts a ON a.id=p.account_id WHERE p.id=?`).bind(id).first();
  const userHandle=data.response.response?.userHandle;
  if (!row || (userHandle && userHandle!==b64(utf8.encode(row.account_id)))) return error("Passkey non riconosciuta.",401);
  let counter;
  try {
    const result=await verifyAuthenticationResponse({
      response:data.response,expectedChallenge:stored.challenge,...origin(env),requireUserVerification:true,
      credential:{id,publicKey:bytes(row.public_key),counter:row.counter},
    });
    if (result.verified) counter=result.authenticationInfo.newCounter;
  } catch { /* Invalid signatures, challenges or user-verification flags. */ }
  if (counter===undefined) return error("Passkey non valida.",401);
  const updated=await db.prepare("UPDATE passkeys SET counter=? WHERE id=? AND account_id=? AND counter=?")
    .bind(counter,id,row.account_id,row.counter).run();
  if (!updated.meta.changes) return error("Passkey modificata. Riprova.",409);
  return json({token:await newSession(db,row.account_id),username:row.username});
}
