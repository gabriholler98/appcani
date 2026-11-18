import {deleteAccount,error,json,matchesPassword} from "./accounts.mjs";
import {accountProfile,clean,dogFields,nowSeconds,syncLeadDog} from "./profiles.mjs";
import {deliverPush} from "./notifications.mjs";
import {walkTiming} from "./walk-time.mjs";
import {publicPoint} from "./geo.mjs";

export function auditEntry(db,admin,action,target,reason,before) {
  return db.prepare("INSERT INTO admin_audit(admin_id,action,target_id,reason,before_data,created_at) VALUES(?,?,?,?,?,?)")
    .bind(admin.id,action,target,reason,JSON.stringify(before),nowSeconds());
}

export function accountNotice(db,accountId,kind,title,details="",reference="") {
  return db.prepare("INSERT INTO account_notices(account_id,kind,title,details,reference_id,created_at) VALUES(?,?,?,?,?,?)")
    .bind(accountId,kind,title,details,reference,nowSeconds());
}

export async function adminRead(db,query) {
  const section=query.get("section")??"reports";
  const offset=Math.max(0,Math.min(100000,Number(query.get("offset"))||0));
  let statement;
  if(section==="reports") {
    const state=["new","reviewing","resolved","dismissed"].includes(query.get("state"))?query.get("state"):"new";
    statement=db.prepare(`SELECT r.*,p.owner_name AS reporter FROM reports r LEFT JOIN profiles p ON p.id=r.reporter_id
      WHERE state=? ORDER BY r.created_at DESC,r.id LIMIT 31 OFFSET ?`).bind(state,offset);
  } else if(section==="users") {
    statement=db.prepare(`SELECT a.id,a.username,a.role,a.suspended_until,p.id AS profile_id,p.owner_name AS owner,
      (SELECT count(*) FROM dogs d WHERE d.profile_id=p.id AND d.archived=0) AS dogs
      FROM accounts a LEFT JOIN profiles p ON p.account_id=a.id
      WHERE instr(lower(a.username||' '||coalesce(p.owner_name,'')),lower(?))>0 ORDER BY a.created_at DESC,a.id LIMIT 31 OFFSET ?`)
      .bind(clean(query.get("q"),40),offset);
  } else if(section==="walks") {
    statement=db.prepare(`SELECT w.id,w.title,w.city,w.day,w.time,w.status,p.owner_name AS owner,p.account_id
      FROM walks w JOIN profiles p ON p.id=w.host_profile_id
      WHERE instr(lower(w.title||' '||w.city),lower(?))>0 ORDER BY w.created_at DESC,w.id LIMIT 31 OFFSET ?`)
      .bind(clean(query.get("q"),40),offset);
  } else if(section==="audit") {
    statement=db.prepare(`SELECT id,action,target_id,reason,before_data,created_at FROM admin_audit
      ORDER BY id DESC LIMIT 31 OFFSET ?`).bind(offset);
  } else return error("Sezione non disponibile.");
  const {results}=await statement.all();
  return json({items:results.slice(0,30),more:results.length>30});
}

export async function adminPerson(db,id) {
  const account=await db.prepare("SELECT id,username,role,suspended_until FROM accounts WHERE id=?").bind(id).first();
  return account?json({account,profile:await accountProfile(db,id)}):error("Account non disponibile.",404);
}

export async function adminWalk(db,id) {
  const walk=await db.prepare("SELECT * FROM walks WHERE id=?").bind(id).first();
  return walk?json({walk}):error("Passeggiata non disponibile.",404);
}

export async function adminAction(env,ctx,admin,data) {
  const db=env.DB;
  const action=clean(data?.action,30),target=clean(data?.target_id,60),reason=clean(data?.reason,500);
  if(!target||!reason)return error("Indica il destinatario e il motivo dell’intervento.");
  const edits=[];
  let before,recipient;
  if(action==="report") {
    before=await db.prepare("SELECT * FROM reports WHERE id=?").bind(target).first();
    if(!before)return error("Segnalazione non disponibile.",404);
    if(!["new","reviewing","resolved","dismissed"].includes(data.state))return error("Stato non valido.");
    edits.push(db.prepare("UPDATE reports SET state=?,response=?,updated_at=? WHERE id=?").bind(data.state,reason,nowSeconds(),target));
    recipient=(await db.prepare("SELECT account_id FROM profiles WHERE id=?").bind(before.reporter_id??"").first())?.account_id;
    if(recipient)edits.push(accountNotice(db,recipient,"report","Segnalazione aggiornata",
      "Stato: "+data.state+" · "+reason,target));
  } else if(action==="message-remove") {
    before=await db.prepare("SELECT id,walk_id,sender_profile_id,body,created_at FROM messages WHERE id=?").bind(target).first();
    if(!before)return error("Messaggio non disponibile.",404);
    edits.push(db.prepare("UPDATE messages SET body='[Messaggio rimosso dall’amministrazione]' WHERE id=?").bind(target));
    recipient=(await db.prepare("SELECT account_id FROM profiles WHERE id=?").bind(before.sender_profile_id).first())?.account_id;
  } else if(["walk-cancel","walk-delete","walk-edit"].includes(action)) {
    before=await db.prepare("SELECT * FROM walks WHERE id=?").bind(target).first();
    if(!before)return error("Passeggiata non disponibile.",404);
    const {results:members}=await db.prepare(`SELECT account_id FROM profiles WHERE id=?
      UNION SELECT p.account_id FROM join_requests j JOIN profiles p ON p.id=j.profile_id
      WHERE j.walk_id=? AND j.status IN ('pending','accepted')`).bind(before.host_profile_id,target).all();
    if(action==="walk-edit") {
      const title=clean(data.title,55),description=clean(data.description,500);
      if(!title)return error("Inserisci il titolo.");
      const day=clean(data.day,12),time=clean(data.time,8);
      const timing=walkTiming(day,time,Number(data.duration_minutes));
      const max=Number(data.max_participants),latitude=Number(data.latitude),longitude=Number(data.longitude);
      const city=clean(data.city,40),area=clean(data.area_label,140);
      const count=await db.prepare(`SELECT json_array_length(dogs_json)+coalesce(
        (SELECT sum(json_array_length(dogs_json)) FROM join_requests WHERE walk_id=? AND status='accepted'),0) AS total
        FROM walks WHERE id=?`).bind(target,target).first();
      if(!timing||!Number.isInteger(max)||max<count.total||max>24||max<1||!city||!area
        ||!Number.isFinite(latitude)||Math.abs(latitude)>=85||!Number.isFinite(longitude)||Math.abs(longitude)>180)return error("Controlla data, luogo e capienza confermata.");
      if(data.revision!==before.revision)return error("La passeggiata è cambiata. Riapri la scheda.",409);
      const point=await publicPoint(latitude,longitude,env.LOCATION_MASK_KEY);
      edits.push(db.prepare(`UPDATE walks SET title=?,description=?,day=?,time=?,duration_minutes=?,starts_at=?,ends_at=?,
        max_participants=?,city=?,area_label=?,latitude=?,longitude=?,public_latitude=?,public_longitude=?,revision=revision+1 WHERE id=?`)
        .bind(title,description,day,time,Number(data.duration_minutes),timing.startsAt,timing.endsAt,max,city,area,latitude,longitude,point.latitude,point.longitude,target));
    } else if(action==="walk-cancel")edits.push(db.prepare("UPDATE walks SET status='cancelled' WHERE id=?").bind(target));
    else {
      if(!await matchesPassword(env,admin,data.proof))return error("Password amministratore non corretta.",403);
      edits.push(db.prepare("DELETE FROM messages WHERE walk_id=?").bind(target),
        db.prepare("DELETE FROM join_requests WHERE walk_id=?").bind(target),db.prepare("DELETE FROM walks WHERE id=?").bind(target));
    }
    for(const member of members)if(member.account_id)edits.push(accountNotice(db,member.account_id,"admin","Intervento su una passeggiata",before.title+" · "+reason,target));
  } else {
    const account=await db.prepare("SELECT a.id,a.username,a.role,a.suspended_until,p.id AS profileId FROM accounts a LEFT JOIN profiles p ON p.account_id=a.id WHERE a.id=?").bind(target).first();
    if(!account)return error("Account non disponibile.",404);
    if(account.role==="admin"&&account.id!==admin.id)return error("L’account amministratore è protetto.",403);
    recipient=target;
    const profile=await accountProfile(db,target);
    before={account,profile};
    if(action==="warn") {
      // The official notice below records and delivers this intervention.
    } else if(action==="owner-edit") {
      if(!profile)return error("Profilo non disponibile.",404);
      const owner=clean(data.owner,30),age=clean(data.age_group,20),gender=clean(data.gender,20);
      if(!owner||!["","18–24","25–34","35–44","45–54","55–64","65+"].includes(age)||!["","Donna","Uomo","Altro"].includes(gender))return error("Dati non validi.");
      edits.push(db.prepare("UPDATE profiles SET owner_name=?,age_group=?,gender=? WHERE account_id=?").bind(owner,age,gender,target));
    } else if(action==="dog-edit"||action==="photo-remove") {
      const dog=profile?.dogs.find(dog=>dog.id===data.dog_id);
      if(!dog)return error("Cane non disponibile.",404);
      if(action==="photo-remove")edits.push(db.prepare("DELETE FROM dog_photos WHERE dog_id=?").bind(dog.id));
      else {
        const fields=dogFields(data);
        if(!fields)return error("Dati del cane non validi.");
        edits.push(db.prepare("UPDATE dogs SET name=?,breed=?,birth=?,size=?,energy=?,emoji=?,notes=?,sex=? WHERE id=? AND profile_id=?")
          .bind(...fields,dog.id,account.profileId),syncLeadDog(db,target));
      }
    } else if(action==="suspend"||action==="resume") {
      if(target===admin.id)return error("Non puoi sospendere il tuo account amministratore.",403);
      const days=Number(data.days);
      if(action==="suspend"&&![1,7,30,3650].includes(days))return error("Durata non valida.");
      edits.push(db.prepare("UPDATE accounts SET suspended_until=? WHERE id=?").bind(action==="resume"?0:nowSeconds()+days*86400,target));
      if(action==="suspend")edits.push(db.prepare(`INSERT INTO account_notices(account_id,kind,title,details,reference_id,created_at)
        SELECT DISTINCT p.account_id,'admin','Passeggiata annullata dall’amministrazione',?,w.id,?
        FROM walks w JOIN join_requests j ON j.walk_id=w.id JOIN profiles p ON p.id=j.profile_id
        WHERE w.host_profile_id=? AND w.status='open' AND w.ends_at>? AND j.status IN ('pending','accepted') AND p.account_id IS NOT NULL`)
        .bind(reason,nowSeconds(),account.profileId??"",nowSeconds()),
        db.prepare("DELETE FROM account_sessions WHERE account_id=?").bind(target),
        db.prepare("DELETE FROM push_devices WHERE account_id=?").bind(target),
        db.prepare("UPDATE walks SET status='cancelled' WHERE host_profile_id=? AND status='open' AND ends_at>?").bind(account.profileId??"",nowSeconds()),
        db.prepare("UPDATE join_requests SET status='withdrawn',details_released=0 WHERE profile_id=? AND status IN ('pending','accepted') AND walk_id IN (SELECT id FROM walks WHERE status='open' AND ends_at>?)").bind(account.profileId??"",nowSeconds()));
    } else if(action==="account-delete") {
      if(target===admin.id)return error("L’account amministratore è protetto.",403);
      if(!await matchesPassword(env,admin,data.proof))return error("Password amministratore non corretta.",403);
      const p=account.profileId??"";
      edits.push(db.prepare("DELETE FROM messages WHERE sender_profile_id=? OR walk_id IN(SELECT id FROM walks WHERE host_profile_id=?)").bind(p,p),
        db.prepare("DELETE FROM join_requests WHERE profile_id=? OR walk_id IN(SELECT id FROM walks WHERE host_profile_id=?)").bind(p,p),
        db.prepare("DELETE FROM walks WHERE host_profile_id=?").bind(p),
        db.prepare("DELETE FROM profiles WHERE account_id=?").bind(target),db.prepare("DELETE FROM accounts WHERE id=?").bind(target));
      recipient=null;
    } else return error("Azione non disponibile.");
  }
  if(recipient&&action!=="report")edits.push(accountNotice(db,recipient,"admin","Avviso dall’amministrazione",reason));
  edits.push(auditEntry(db,admin,action,target,reason,before));
  await db.batch(edits);
  if(ctx&&recipient)ctx.waitUntil(deliverPush(env,[recipient]).catch(()=>{}));
  return json({ok:true});
}
