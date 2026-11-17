import { error, json } from "./accounts.mjs";
import { blocked, clean, friendship, nowSeconds } from "./profiles.mjs";
import { defaultDuration, walkTiming } from "./walk-time.mjs";
import { commitNotification, unreadQuery } from "./notifications.mjs";

const utf8 = new TextEncoder();
const timestamp = () => new Date().toISOString();
const hostCount = "json_array_length(w.dogs_json)";
const guestCount = `COALESCE((SELECT sum(json_array_length(joined.dogs_json)) FROM join_requests joined
  WHERE joined.walk_id=w.id AND joined.status='accepted'),0)`;
const spaces = `(w.max_participants-${hostCount}-${guestCount})`;
const bookings = ["accepted","pending"];
const notBlocked = (a,b) => "NOT " + blocked(a,b);

async function maskedPoint(walk, key) {
  const digest = new DataView(await crypto.subtle.sign("HMAC", key, utf8.encode(walk.id + ":" + walk.latitude + ":" + walk.longitude)));
  const angle = digest.getUint32(0) / 2 ** 32 * 2 * Math.PI;
  const distance = 290 + digest.getUint32(4) / 2 ** 32 * 140;
  const lat = walk.latitude * Math.PI / 180;
  const lon = walk.longitude * Math.PI / 180;
  const arc = distance / 6371000;
  const targetLat = Math.asin(Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(angle));
  const targetLon = lon + Math.atan2(Math.sin(angle) * Math.sin(arc) * Math.cos(lat), Math.cos(arc) - Math.sin(lat) * Math.sin(targetLat));
  return { latitude: targetLat * 180 / Math.PI, longitude: (targetLon * 180 / Math.PI + 540) % 360 - 180 };
}

function viewWalk(walk, viewer) {
  const host = walk.host_profile_id===viewer;
  const accepted = walk.request_status==="accepted";
  const reveal = host || (accepted && Boolean(walk.details_released) && walk.status==="open" && walk.ends_at>nowSeconds());
  const { dogs_json, details_released, latitude, longitude, area_label, ...safe } = walk;
  const dogs = JSON.parse(dogs_json);
  const lead = dogs[0] ?? {};
  return {
    ...safe, dogs, is_host:host, reveal_exact:reveal,
    dog_name:lead.name, breed:lead.breed, size:lead.size, emoji:lead.emoji,
    area_label:reveal ? area_label : safe.city + " · zona approssimativa",
    ...(reveal ? { latitude, longitude } : {}),
    ...(reveal && host ? { exact_area:area_label } : {}),
  };
}

const walkFields = `w.id,w.host_profile_id,w.title,w.city,w.area_label,w.latitude,w.longitude,w.day,w.time,
  w.status,w.max_participants,w.duration_minutes,w.starts_at,w.ends_at,w.description,w.revision,w.dogs_json,
  j.status AS request_status,j.details_released,${spaces} AS available_places`;

export async function listWalks(env, account, query) {
  const now = nowSeconds();
  const own = query.get("view")==="mine";
  const city = clean(query.get("city"),40);
  const day = clean(query.get("day"),10);
  const before = clean(query.get("before"),10);
  const size = clean(query.get("size"),16);
  const inclusive = query.get("full")==="1";
  const friendsOnly = query.get("friends")==="1";
  const [events,requests,unread] = await env.DB.batch([
    env.DB.prepare(`WITH viewer AS (SELECT ? AS id)
      SELECT ${walkFields},p.owner_name AS host_name
      FROM viewer,walks w JOIN profiles p ON p.id=w.host_profile_id AND p.account_id IS NOT NULL
      LEFT JOIN join_requests j ON j.walk_id=w.id AND j.profile_id=viewer.id
      WHERE w.status='open' AND w.ends_at>?
       AND (w.host_profile_id=viewer.id OR ${notBlocked("viewer.id","w.host_profile_id")})
       AND (${own ? "(w.host_profile_id=viewer.id OR j.status IS NOT NULL)" :
         `(? OR ${spaces}>0)
          AND (?=0 OR EXISTS(SELECT 1 FROM relationships r WHERE ${friendship("viewer.id","w.host_profile_id")}))
          AND (?='' OR LOWER(w.city)=LOWER(?)) AND (?='' OR w.day>=?) AND (?='' OR w.day<=?)
          AND (?='' OR EXISTS(SELECT 1 FROM json_each(w.dogs_json) d WHERE json_extract(d.value,'$.size')=?))`})
      ORDER BY w.day,w.time,w.id LIMIT 100
    `).bind(account.profileId,now,...(own?[]:[Number(inclusive),Number(friendsOnly),city,city,day,day,before,before,size,size])),
    env.DB.prepare(`WITH viewer AS (SELECT ? AS id)
      SELECT j.id,j.walk_id,j.status,j.details_released,w.title,p.id AS profile_id,p.owner_name AS owner,
        j.dogs_json,${spaces} AS available_places
      FROM viewer,join_requests j JOIN walks w ON w.id=j.walk_id JOIN profiles p ON p.id=j.profile_id
      WHERE w.host_profile_id=viewer.id AND w.status='open' AND w.ends_at>? AND p.account_id IS NOT NULL
        AND ${notBlocked("viewer.id","p.id")} AND j.status IN ('pending','accepted')
      ORDER BY j.created_at DESC LIMIT 100
    `).bind(account.profileId,now),
    unreadQuery(env.DB,account.id),
  ]);
  const key = own ? null : await crypto.subtle.importKey("raw", utf8.encode(env.LOCATION_MASK_KEY),
    { name:"HMAC",hash:"SHA-256" },false,["sign"]);
  const walks = await Promise.all(events.results.map(async row=>{
    const walk = viewWalk(row,account.profileId);
    if (own) return walk;
    const point = await maskedPoint(row,key);
    if (walk.reveal_exact) {
      return {...walk,public_latitude:point.latitude,public_longitude:point.longitude};
    }
    Object.assign(walk,point);
    return walk;
  }));
  return json({ walks, requests:requests.results.map(({dogs_json,...row})=>{
    const dogs = JSON.parse(dogs_json);
    return {...row,dogs,dog_name:dogs[0]?.name,emoji:dogs[0]?.emoji};
  }), unread_notifications:unread.results[0].unread });
}

async function getWalk(db, viewer, id) {
  return db.prepare(`WITH viewer AS (SELECT ? AS id)
    SELECT ${walkFields},p.owner_name AS host_name
    FROM viewer,walks w JOIN profiles p ON p.id=w.host_profile_id AND p.account_id IS NOT NULL
    LEFT JOIN join_requests j ON j.walk_id=w.id AND j.profile_id=viewer.id
    WHERE w.id=? AND (w.host_profile_id=viewer.id OR (${notBlocked("viewer.id","w.host_profile_id")}
      AND ((w.status='open' AND w.ends_at>?) OR j.status IS NOT NULL)))
  `).bind(viewer,id,nowSeconds()).first();
}

export async function walkDetails(db, viewer, id) {
  const row = await getWalk(db,viewer,id);
  if (!row) return error("Passeggiata non disponibile.",404);
  const walk = viewWalk(row,viewer);
  const participants = [];
  if (walk.is_host || walk.request_status==="accepted") {
    participants.push({ profile_id:walk.host_profile_id,owner:walk.host_name,dogs:walk.dogs,host:true });
    const { results } = await db.prepare(`WITH viewer AS (SELECT ? AS id)
      SELECT j.profile_id,p.owner_name AS owner,j.dogs_json
      FROM viewer,join_requests j JOIN profiles p ON p.id=j.profile_id AND p.account_id IS NOT NULL
      WHERE j.walk_id=? AND j.status='accepted' AND ${notBlocked("viewer.id","j.profile_id")} ORDER BY j.created_at
    `).bind(viewer,id).all();
    participants.push(...results.map(({dogs_json,...participant})=>({...participant,dogs:JSON.parse(dogs_json)})));
  }
  return json({ walk, participants });
}

export async function archiveWalks(db, viewer, filter) {
  const condition = {
    created:"w.host_profile_id=viewer.id",
    requests:"j.profile_id=viewer.id AND j.status!='accepted'",
    attended:"j.profile_id=viewer.id AND j.status='accepted'",
  };
  if (!Object.hasOwn(condition,filter)) return error("Scegli un filtro dell’archivio.");
  const { results } = await db.prepare(`WITH viewer AS (SELECT ? AS id)
    SELECT w.id,w.title,w.city,w.day,w.time,w.duration_minutes,w.ends_at,w.status,w.dogs_json,j.status AS request_status,
      w.host_profile_id=viewer.id AS is_host,
      w.status='open' AND (w.host_profile_id=viewer.id OR j.status='accepted') AS can_chat
    FROM viewer,walks w LEFT JOIN join_requests j ON j.walk_id=w.id AND j.profile_id=viewer.id
    WHERE (w.status='cancelled' OR (w.status='open' AND w.ends_at<=?)) AND ${condition[filter]}
      AND ${notBlocked("viewer.id","w.host_profile_id")}
    ORDER BY w.ends_at DESC,w.id LIMIT 100`
  ).bind(viewer,nowSeconds()).all();
  return json({ walks:results.map(({dogs_json,...row})=>{
    const dogs = JSON.parse(dogs_json);
    return {...row,dogs,dog_name:dogs[0]?.name,emoji:dogs[0]?.emoji};
  }) });
}

async function selectDogs(db, profileId, ids) {
  const explicit = ids!==undefined;
  if (explicit && (!Array.isArray(ids) || !ids.length || ids.length>12 ||
    !ids.every(id=>typeof id==="string" && id.length<=60) || new Set(ids).size!==ids.length)) return null;
  const { results } = await db.prepare(`SELECT id,name,breed,size,emoji FROM dogs
    WHERE profile_id=? AND archived=0 AND (?=0 OR id IN (SELECT value FROM json_each(?)))
    ORDER BY id!=profile_id,name COLLATE NOCASE LIMIT ?`
  ).bind(profileId,Number(explicit),JSON.stringify(ids??[]),explicit?12:1).all();
  return results.length && (!explicit || results.length===ids.length) ? JSON.stringify(results) : null;
}

const validDogs = (roster,owner) => `NOT EXISTS (
  SELECT 1 FROM json_each(${roster}) x WHERE NOT EXISTS (
    SELECT 1 FROM dogs d WHERE d.id=json_extract(x.value,'$.id') AND d.profile_id=${owner} AND d.archived=0))`;

export async function saveWalk(env, ctx, viewer, data, walkId) {
  const title = clean(data?.title,55), city = clean(data?.city,40), area = clean(data?.area_label,140);
  const day = clean(data?.day,12), time = clean(data?.time,8), description = clean(data?.description,500);
  const roster = await selectDogs(env.DB,viewer,data?.dog_ids);
  if (!roster) return error("Seleziona almeno un cane del tuo profilo.");
  const dogCount = JSON.parse(roster).length;
  const legacy = data?.dog_ids===undefined && !walkId;
  const max = legacy ? Math.min(3,Math.max(1,Math.trunc(Number(data?.max))||1))+1 : Number(data?.max);
  const lat=data?.latitude, lng=data?.longitude;
  const duration=data?.duration_minutes===undefined ? defaultDuration : data.duration_minutes;
  const timing=walkTiming(day,time,duration);
  if (!timing || timing.startsAt<Math.floor(nowSeconds()/60)*60) return error("Scegli una partenza futura e una durata da 5 a 1440 minuti.");
  if (!title || !city || !area || !Number.isFinite(lat) || Math.abs(lat)>=89 || !Number.isFinite(lng) || Math.abs(lng)>180 ||
    !Number.isInteger(max) || max<dogCount || max>24) return error("Controlla il luogo e il numero totale di posti.");

  const db=env.DB;
  if (!walkId) {
    const id=crypto.randomUUID();
    const result=await db.prepare(`WITH proposed AS (SELECT ? AS owner,? AS roster)
      INSERT INTO walks(id,host_profile_id,host_token,title,city,area_label,latitude,longitude,day,time,max_participants,
        created_at,duration_minutes,starts_at,ends_at,dogs_json,description)
      SELECT ?,owner,'',?,?,?,?,?,?,?,?,?,?,?,?,roster,? FROM proposed WHERE ${validDogs("roster","owner")}
    `).bind(viewer,roster,id,title,city,area,lat,lng,day,time,max,timestamp(),duration,timing.startsAt,timing.endsAt,description).run();
    return result.meta.changes ? json({id,ok:true},201) : error("I cani selezionati sono cambiati.",409);
  }

  const previous = await getWalk(db,viewer,walkId);
  if (!previous || previous.host_profile_id!==viewer || previous.status!=="open" || previous.starts_at<=nowSeconds()) {
    return error("Solo l’organizzatore può modificare una passeggiata futura.",403);
  }
  if (data.revision!==previous.revision) return error("La passeggiata è cambiata. Riapri i dettagli.",409);
  const newPlace=previous.area_label!==area || previous.latitude!==lat || previous.longitude!==lng || previous.city!==city;
  const changes=[];
  if (previous.day!==day || previous.time!==time) changes.push(previous.day+" "+previous.time+" → "+day+" "+time);
  if (previous.duration_minutes!==duration) changes.push("Durata: "+previous.duration_minutes+" → "+duration+" min");
  if (newPlace) changes.push("Punto di ritrovo aggiornato");
  if (previous.title!==title) changes.push("Titolo aggiornato");
  if (previous.description!==description) changes.push("Descrizione aggiornata");
  if (previous.max_participants!==max) changes.push("Capienza aggiornata");
  if (previous.dogs_json!==roster) changes.push("Cani dell’organizzatore aggiornati");
  if (!changes.length) return json({id:walkId,ok:true});
  const result=await commitNotification(env,ctx,db.prepare(`UPDATE walks AS w SET
    title=?,city=?,area_label=?,latitude=?,longitude=?,day=?,time=?,max_participants=?,duration_minutes=?,
    starts_at=?,ends_at=?,dogs_json=?,description=?,revision=revision+1
    WHERE id=? AND host_profile_id=? AND revision=? AND status='open' AND starts_at>?
      AND ?+${guestCount}<=? AND ${validDogs("?","w.host_profile_id")}`
  ).bind(title,city,area,lat,lng,day,time,max,duration,timing.startsAt,timing.endsAt,roster,description,
    walkId,viewer,previous.revision,nowSeconds(),dogCount,max,roster),"changed",walkId,[walkId],{
      details:changes.join(" · "), actor:viewer,
    });
  return result.meta.changes ? json({id:walkId,ok:true}) : error("Controlla i posti confermati o ricarica la passeggiata.",409);
}

export async function joinWalk(env,ctx,viewer,walkId,data) {
  const db=env.DB;
  const dogs=await selectDogs(db,viewer,data?.dog_ids);
  if (!dogs) return error("Seleziona almeno un cane del tuo profilo.");
  const mutation=db.prepare(`WITH proposed AS (SELECT ? AS owner,? AS roster)
    INSERT INTO join_requests(id,walk_id,profile_id,created_at,dogs_json)
    SELECT ?,w.id,owner,?,roster FROM proposed,walks w JOIN profiles p ON p.id=w.host_profile_id
    WHERE w.id=? AND w.status='open' AND w.ends_at>? AND w.host_profile_id!=owner AND p.account_id IS NOT NULL
      AND ${notBlocked("owner","w.host_profile_id")} AND ${spaces}>=json_array_length(roster) AND ${validDogs("roster","owner")}
    ON CONFLICT(walk_id,profile_id) DO UPDATE SET status='pending',dogs_json=excluded.dogs_json,
      details_released=0,created_at=excluded.created_at
    WHERE join_requests.status='withdrawn'`
  ).bind(viewer,dogs,crypto.randomUUID(),timestamp(),walkId,nowSeconds());
  const result=await commitNotification(env,ctx,mutation,"join",walkId,[walkId]);
  return result.meta.changes ? json({ok:true},201) : error("Posti insufficienti, richiesta già presente o passeggiata non disponibile.",409);
}

export async function changeRequest(env,ctx,viewer,walkId,requestId,action) {
  const db=env.DB;
  const active=`w.id=join_requests.walk_id AND w.status='open' AND w.ends_at>?`;
  const host=`w.host_profile_id=? AND ${notBlocked("w.host_profile_id","join_requests.profile_id")}`;
  const now=nowSeconds();
  let mutation;
  if (action==="withdraw") {
    mutation=db.prepare(`UPDATE join_requests SET status='withdrawn',details_released=0
      WHERE walk_id=? AND profile_id=? AND status IN ('pending','accepted') AND EXISTS (SELECT 1 FROM walks w WHERE ${active})`
    ).bind(walkId,viewer,now);
  } else {
    const change = {
      accept:"status='accepted'",
      reject:"status='rejected'",
      reveal:"details_released=1",
    }[action];
    mutation=db.prepare(`UPDATE join_requests SET ${change}
      WHERE id=? AND walk_id=? AND status=? AND EXISTS (SELECT 1 FROM walks w WHERE ${active} AND ${host}
        ${action==="accept" ? `AND ${spaces}>=json_array_length(join_requests.dogs_json)
        AND ${validDogs("join_requests.dogs_json","join_requests.profile_id")}` : ""})`
    ).bind(requestId,walkId,action==="reveal"?"accepted":"pending",now,viewer);
  }
  const kind={accept:"accepted",reject:"rejected",withdraw:"withdrawn"}[action];
  const result=kind ? await commitNotification(env,ctx,mutation,kind,walkId,
    action==="withdraw" ? [walkId] : [walkId,requestId]) : await mutation.run();
  return result.meta.changes ? json({ok:true}) : error("Richiesta non disponibile o posti insufficienti.",409);
}

export async function cancelWalk(env,ctx,viewer,walkId) {
  const mutation=env.DB.prepare("UPDATE walks SET status='cancelled' WHERE id=? AND host_profile_id=? AND status='open' AND ends_at>?")
    .bind(walkId,viewer,nowSeconds());
  const result=await commitNotification(env,ctx,mutation,"cancelled",walkId,[walkId]);
  return result.meta.changes ? json({ok:true}) : error("Passeggiata non annullabile.",403);
}

export async function deleteArchivedWalk(db,viewer,walkId) {
  const condition="id=? AND host_profile_id=? AND (status='cancelled' OR ends_at<=?)";
  const params=[walkId,viewer,nowSeconds()];
  const [,,removed]=await db.batch([
    db.prepare("DELETE FROM messages WHERE walk_id IN (SELECT id FROM walks WHERE "+condition+")").bind(...params),
    db.prepare("DELETE FROM join_requests WHERE walk_id IN (SELECT id FROM walks WHERE "+condition+")").bind(...params),
    db.prepare("DELETE FROM walks WHERE "+condition).bind(...params),
  ]);
  return removed.meta.changes ? json({ok:true}) : error("Solo l’organizzatore può eliminare una passeggiata archiviata.",403);
}

const canChat = (viewer) => `(w.host_profile_id=${viewer} OR (${notBlocked("w.host_profile_id",viewer)}
  AND EXISTS (SELECT 1 FROM join_requests j WHERE j.walk_id=w.id AND j.profile_id=${viewer} AND j.status='accepted')))`;

export async function readMessages(db,viewer,id,query) {
  const walk=await db.prepare(`WITH person AS (SELECT ? AS viewer) SELECT w.ends_at FROM person,walks w
    WHERE w.id=? AND w.status='open' AND ${canChat("viewer")}`).bind(viewer,id).first();
  if (!walk) return error("La chat non è disponibile.",403);
  const before=Number(query.get("before")),after=Number(query.get("after"));
  const direction=after>0 ? "ASC" : "DESC";
  const {results}=await db.prepare(`WITH person AS (SELECT ? AS viewer)
    SELECT m.rowid AS seq,m.id,m.body,m.created_at,p.id AS profile_id,p.owner_name AS owner,p.dog_name,p.emoji,(p.id=viewer) AS mine
    FROM person,messages m JOIN profiles p ON p.id=m.sender_profile_id WHERE m.walk_id=?
      AND (?=0 OR m.rowid<?) AND (?=0 OR m.rowid>?) AND ${notBlocked("viewer","p.id")}
    ORDER BY m.rowid ${direction} LIMIT 41
  `).bind(viewer,id,before,before,after,after).all();
  const items=results.slice(0,40);
  return json({messages:after>0?items:items.reverse(),more:results.length>40,read_only:walk.ends_at<=nowSeconds()});
}

export async function sendMessage(env,ctx,viewer,id,data) {
  const message=clean(data?.text,500);
  if (!message) return error("Scrivi un messaggio.");
  const mutation=env.DB.prepare(`WITH person AS (SELECT ? AS viewer)
    INSERT INTO messages(id,walk_id,sender_profile_id,body,created_at)
    SELECT ?,w.id,viewer,?,? FROM person,walks w WHERE w.id=? AND w.status='open' AND w.ends_at>?
      AND ${canChat("viewer")}
  `).bind(viewer,crypto.randomUUID(),message,timestamp(),id,nowSeconds());
  const result=await commitNotification(env,ctx,mutation,"chat",id,[id,viewer,id,viewer],{actor:viewer});
  return result.meta.changes ? json({ok:true},201) : error("La chat è archiviata o non è disponibile.",403);
}

export async function reportContent(db,viewer,data) {
  const id=clean(data?.id,60), reason=clean(data?.reason,500), kind=data?.kind;
  if (!id || !reason || !["profile","walk","message"].includes(kind)) return error("Indica il motivo della segnalazione.");
  let visible;
  if (kind==="profile") visible=await db.prepare(`SELECT id FROM profiles WHERE id=? AND account_id IS NOT NULL AND id!=?`).bind(id,viewer).first();
  if (kind==="walk") visible=await getWalk(db,viewer,id);
  if (kind==="message") visible=await db.prepare(`WITH person AS (SELECT ? AS viewer)
    SELECT m.id FROM person,messages m JOIN walks w ON w.id=m.walk_id
    WHERE m.id=? AND m.sender_profile_id!=viewer AND w.status='open' AND ${canChat("viewer")}`).bind(viewer,id).first();
  if (!visible) return error("Contenuto non disponibile.",404);
  await db.prepare("INSERT OR IGNORE INTO reports (id,reporter_id,kind,subject_id,reason,created_at) VALUES (?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),viewer,kind,id,reason,nowSeconds()).run();
  return json({ok:true});
}
