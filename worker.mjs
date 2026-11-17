import {
  changePassword, deleteAccount, endSession, error, json, newRecoveryCodes,
  readBody, readSession, recoverAccount, signOutDevices, startAccount,
} from "./accounts.mjs";
import {
  accountProfile, changeConnection, clean, connections, findPeople, removeDog,
  saveDog, savePushPreferences, setupProfile, updateOwner, viewProfile,
} from "./profiles.mjs";
import {
  archiveWalks, cancelWalk, changeRequest, deleteArchivedWalk, joinWalk, listWalks,
  readMessages, reportContent, saveWalk, sendMessage, walkDetails,
} from "./walks.mjs";
import { changeDevice, forgetLogoutDevice, listNotifications, markNotificationsRead, pushSettings, testDevice, unreadQuery } from "./notifications.mjs";
import { dogPhoto } from "./photos.mjs";
import { listPasskeys,loginOptions,registerOptions,registerPasskey,removePasskey,verifyPasskey } from "./passkeys.mjs";

async function handle(request,env,url,ctx) {
  if (!env.DB || !env.LOCATION_MASK_KEY || !env.PASSWORD_PEPPER) return error("Archivio online non disponibile.",503);
  const endpoint=request.method+" "+url.pathname;
  if (endpoint==="POST /api/auth/register") return startAccount(request,env,true);
  if (endpoint==="POST /api/auth/login") return startAccount(request,env,false);
  if (endpoint==="POST /api/auth/recovery-name") return recoverAccount(request,env,true);
  if (endpoint==="POST /api/auth/recover") return recoverAccount(request,env,false);
  if (endpoint==="POST /api/auth/passkeys/login-options") return loginOptions(request,env);
  if (endpoint==="POST /api/auth/passkeys/login") return verifyPasskey(env,await readBody(request));

  const db=env.DB;
  const account=await readSession(request,db);
  if (!account) return error("Accedi al tuo account per continuare.",401);
  if (endpoint==="POST /api/auth/logout") {
    await forgetLogoutDevice(db,account,await readBody(request));
    return endSession(db,account);
  }
  if (endpoint==="GET /api/auth/me") return json({username:account.username,profile:await accountProfile(db,account.id)});
  if (endpoint==="POST /api/auth/recovery-codes") return newRecoveryCodes(env,account,await readBody(request));
  if (endpoint==="POST /api/auth/password") return changePassword(env,account,await readBody(request));
  if (endpoint==="POST /api/auth/logout-all") return signOutDevices(db,account);
  if (endpoint==="POST /api/auth/delete") return deleteAccount(env,account,await readBody(request));
  if (endpoint==="GET /api/auth/passkeys") return listPasskeys(db,account);
  if (endpoint==="POST /api/auth/passkeys/register-options") return registerOptions(env,account,await readBody(request));
  if (endpoint==="POST /api/auth/passkeys/register") return registerPasskey(env,account,await readBody(request));
  if (endpoint==="POST /api/auth/passkeys/remove") return removePasskey(env,account,await readBody(request));
  if (endpoint==="POST /api/profile") return setupProfile(db,account,await readBody(request));

  const viewer=account.profileId;
  const q=url.searchParams;
  if (viewer) {
    if (endpoint==="POST /api/profile/owner") return updateOwner(db,account,await readBody(request));
    if (endpoint==="POST /api/profile/dogs") return saveDog(db,account,await readBody(request));
    if (endpoint==="POST /api/profile/dogs/remove") return removeDog(db,account,clean((await readBody(request))?.id,60));
  }
  if (!account.hasDog) return error("Aggiungi almeno un cane al tuo profilo per continuare.",403);
  if (url.pathname==="/api/profile/photo" && ["GET","POST","DELETE"].includes(request.method)) return dogPhoto(db,viewer,clean(q.get("id"),60),request);
  switch (endpoint) {
    case "GET /api/walks": return listWalks(env,account,q);
    case "GET /api/walks/details": return walkDetails(db,viewer,clean(q.get("id"),60));
    case "GET /api/walks/archive": return archiveWalks(db,viewer,q.get("filter"));
    case "GET /api/messages": return readMessages(db,viewer,clean(q.get("walk_id"),60),q);
    case "GET /api/notifications": return q.get("count")==="1"?json(await unreadQuery(db,account.id).first()):listNotifications(db,account.id);
    case "GET /api/notifications/push-settings": return pushSettings(env);
    case "GET /api/people": return findPeople(db,viewer,q.get("q"));
    case "GET /api/people/profile": return viewProfile(db,viewer,clean(q.get("id"),60));
    case "GET /api/people/connections": return connections(db,viewer);
  }
  const data=request.method==="POST"?await readBody(request):null;
  const walkId=clean(data?.walk_id,60);
  const requestId=clean(data?.request_id,60);
  switch (endpoint) {
    case "POST /api/walk": return saveWalk(env,ctx,viewer,data,"");
    case "POST /api/walks/edit": return walkId ? saveWalk(env,ctx,viewer,data,walkId) : error("Passeggiata non valida.");
    case "POST /api/join": return joinWalk(env,ctx,viewer,walkId,data);
    case "POST /api/requests/action": return changeRequest(env,ctx,viewer,walkId,requestId,"accept");
    case "POST /api/requests/reject": return changeRequest(env,ctx,viewer,walkId,requestId,"reject");
    case "POST /api/requests/withdraw": return changeRequest(env,ctx,viewer,walkId,"","withdraw");
    case "POST /api/reveal": return changeRequest(env,ctx,viewer,walkId,requestId,"reveal");
    case "POST /api/cancel": return cancelWalk(env,ctx,viewer,walkId);
    case "POST /api/walks/delete": return deleteArchivedWalk(db,viewer,walkId);
    case "POST /api/messages": return sendMessage(env,ctx,viewer,walkId,data);
    case "POST /api/notifications/read": return markNotificationsRead(db,account.id,data);
    case "POST /api/notifications/preferences": return savePushPreferences(db,account,data);
    case "POST /api/notifications/device/check": return changeDevice(env,account,data,"check");
    case "POST /api/notifications/device/enable": return changeDevice(env,account,data,"enable");
    case "POST /api/notifications/device/disable": return changeDevice(env,account,data,"disable");
    case "POST /api/notifications/device/test": return testDevice(env,account,data);
    case "POST /api/people/relationship": return changeConnection(db,viewer,clean(data?.target_id,60),data?.action);
    case "POST /api/reports": return reportContent(db,viewer,data);
    default: return error("Risorsa non trovata.",404);
  }
}

export default {
  async fetch(request,env,ctx) {
    const origin=request.headers.get("Origin");
    if (origin && origin!==env.PAGES_ORIGIN) return error("Origine non autorizzata.",403);
    const cors=new Headers({Vary:"Origin"});
    if (origin) cors.set("Access-Control-Allow-Origin",origin);
    if (request.method==="OPTIONS") {
      cors.set("Access-Control-Allow-Methods","GET, POST, DELETE, OPTIONS");
      cors.set("Access-Control-Allow-Headers","Content-Type, Authorization");
      cors.set("Access-Control-Max-Age","600");
      return new Response(null,{status:204,headers:cors});
    }
    const url=new URL(request.url);
    let response;
    try {
      response=await handle(request,env,url,ctx);
    } catch (failure) {
      console.error(JSON.stringify({event:"api_error",path:url.pathname,method:request.method,type:failure.name}));
      response=error("Servizio temporaneamente non disponibile.",500);
    }
    for (const [name,value] of cors) response.headers.set(name,value);
    return response;
  },
};
