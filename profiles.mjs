import { error, json } from "./accounts.mjs";

export const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const friendship = (a, b) =>
  `r.first_id=min(${a},${b}) AND r.second_id=max(${a},${b}) AND r.state='friends'`;
export const blocked = (a, b) =>
  `EXISTS (SELECT 1 FROM blocks b WHERE (b.owner_id=${a} AND b.target_id=${b}) OR (b.owner_id=${b} AND b.target_id=${a}))`;

const sizes = ["Piccola", "Media", "Grande"];
const energies = ["Tranquilla", "Media", "Alta"];
const emojis = ["🐕", "🐶", "🐩", "🦮"];
const avatarIds = new Set(["meticcio","labrador-retriever","golden-retriever","pastore-tedesco","chihuahua","barboncino","jack-russell-terrier","bulldog-francese","beagle","bassotto","maltese","border-collie","cocker-spaniel-inglese","yorkshire-terrier","cane-corso","pastore-australiano","carlino","shih-tzu","boxer","rottweiler","pinscher-nano","setter-inglese","volpino-italiano","lagotto-romagnolo","husky-siberiano"]);
const demographics = {
  age: ["", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"],
  gender: ["", "Donna", "Uomo", "Altro"],
  visibility: ["friends", "members", "private"],
};
const notificationKinds = ["join","accepted","cancelled","chat","changed","withdrawn","rejected","friend_request","friend_accepted"];

export function dogFields(data) {
  const name = clean(data?.name ?? data?.dog, 30);
  const breed = clean(data?.breed, 45);
  const size = data?.size;
  const energy = data?.energy;
  const emoji = data?.emoji ?? "🐕";
  const birth = Number(data?.birth);
  const sex=data?.sex??"";
  if(!["","male","female"].includes(sex))return null;
  if (!name || !breed || !sizes.includes(size) || !energies.includes(energy) || !(emojis.includes(emoji)||(typeof emoji==="string"&&emoji.startsWith("avatar:")&&avatarIds.has(emoji.slice(7))))
      || !Number.isInteger(birth) || birth < 1995 || birth > new Date().getFullYear()) return null;
  return [name, breed, birth, size, energy, emoji, clean(data?.notes, 300),sex];
}

const profileSummary = `id,dog_name AS dog,owner_name AS owner,breed,size,energy,emoji,birth_year AS birth,
  age_group,gender,visibility,push_muted`;

export async function accountProfile(db, accountId) {
  const profile = await db.prepare(`SELECT ${profileSummary} FROM profiles WHERE account_id=?`).bind(accountId).first();
  if (!profile) return null;
  return { ...profile, dogs: await memberDogs(db, profile.id), push_muted: JSON.parse(profile.push_muted) };
}

async function memberDogs(db, profileId) {
  const { results } = await db.prepare(`
    SELECT d.id,d.name,d.breed,d.birth,d.size,d.energy,d.emoji,d.notes,d.sex, (f.dog_id IS NOT NULL) AS photo
    FROM dogs d LEFT JOIN dog_photos f ON f.dog_id=d.id WHERE d.profile_id=? AND d.archived=0
    ORDER BY d.id!=d.profile_id, d.name COLLATE NOCASE, d.id
  `).bind(profileId).all();
  return results;
}

export async function setupProfile(db, account, data) {
  const dog = dogFields(data?.firstDog ?? data);
  const owner = clean(data?.owner, 30);
  if (!dog || !owner) return error("Inserisci il tuo nome e i dati del primo cane.");
  const id = account.profileId ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const edits = [
    db.prepare(`
      INSERT INTO profiles (id,account_id,write_token,dog_name,owner_name,breed,birth_year,size,energy,emoji,created_at,updated_at)
      VALUES (?,?,'',?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET owner_name=excluded.owner_name,updated_at=excluded.updated_at
    `).bind(id, account.id, dog[0], owner, ...dog.slice(1,6), timestamp, timestamp),
    db.prepare(`
      INSERT INTO dogs (id,profile_id,name,breed,birth,size,energy,emoji,notes,sex)
      SELECT COALESCE(?,p.id),p.id,?,?,?,?,?,?,?,? FROM profiles p WHERE p.account_id=?
        AND NOT EXISTS (SELECT 1 FROM dogs d WHERE d.profile_id=p.id AND d.archived=0)
      ON CONFLICT(id) DO UPDATE SET archived=0,name=excluded.name,breed=excluded.breed,birth=excluded.birth,
        size=excluded.size,energy=excluded.energy,emoji=excluded.emoji,notes=excluded.notes,sex=excluded.sex
    `).bind(account.profileId?crypto.randomUUID():null,...dog,account.id),
  ];
  if (account.profileId && !data?.firstDog) {
    edits.push(db.prepare(`
      UPDATE dogs SET name=?,breed=?,birth=?,size=?,energy=?,emoji=?,notes=?,sex=?
      WHERE id=? AND profile_id=? AND archived=0
    `).bind(...dog, id, id));
  }
  edits.push(syncLeadDog(db, account.id));
  await db.batch(edits);
  return json({ profile: await accountProfile(db, account.id) });
}

export async function updateOwner(db, account, data) {
  const owner = clean(data?.owner, 30);
  const age = data?.age_group ?? "";
  const gender = data?.gender ?? "";
  const visibility = data?.visibility ?? "friends";
  if (!owner || !demographics.age.includes(age) || !demographics.gender.includes(gender) || !demographics.visibility.includes(visibility)) {
    return error("Controlla i dati del proprietario.");
  }
  await db.prepare("UPDATE profiles SET owner_name=?,age_group=?,gender=?,visibility=? WHERE account_id=?")
    .bind(owner,age,gender,visibility,account.id).run();
  return json({ profile: await accountProfile(db, account.id) });
}

export function syncLeadDog(db, accountId) {
  return db.prepare(`
    UPDATE profiles SET (dog_name,breed,birth_year,size,energy,emoji) = (
      SELECT name,breed,birth,size,energy,emoji FROM dogs
      WHERE profile_id=profiles.id AND archived=0 ORDER BY id!=profile_id, name COLLATE NOCASE,id LIMIT 1
    ) WHERE account_id=? AND EXISTS(SELECT 1 FROM dogs WHERE profile_id=profiles.id AND archived=0)
  `).bind(accountId);
}

export async function saveDog(db, account, data) {
  const fields = dogFields(data);
  const id = clean(data?.id, 60);
  const savedId = id || crypto.randomUUID();
  if (!fields) return error("Controlla i dati del cane.");
  const edit = id
    ? db.prepare("UPDATE dogs SET name=?,breed=?,birth=?,size=?,energy=?,emoji=?,notes=?,sex=? WHERE id=? AND profile_id=? AND archived=0")
      .bind(...fields,id,account.profileId)
    : db.prepare(`INSERT INTO dogs (id,profile_id,name,breed,birth,size,energy,emoji,notes,sex)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM dogs WHERE profile_id=? AND archived=0)<12`)
      .bind(savedId,account.profileId,...fields,account.profileId);
  const [saved] = await db.batch([edit,syncLeadDog(db,account.id)]);
  return saved.meta.changes ? json({ dog_id:savedId,profile:await accountProfile(db,account.id) }) : error("Cane non disponibile o limite di 12 cani raggiunto.",409);
}

export async function removeDog(db, account, id) {
  const time = nowSeconds();
  const [removed] = await db.batch([
    db.prepare(`
      UPDATE dogs SET archived=1 WHERE id=? AND profile_id=? AND archived=0
      AND NOT EXISTS (
        SELECT 1 FROM walks w,json_each(w.dogs_json) dog
        WHERE w.host_profile_id=dogs.profile_id AND w.status='open' AND w.ends_at>? AND json_extract(dog.value,'$.id')=dogs.id
      ) AND NOT EXISTS (
        SELECT 1 FROM join_requests j JOIN walks w ON w.id=j.walk_id,json_each(j.dogs_json) dog
        WHERE j.profile_id=dogs.profile_id AND j.status IN ('pending','accepted') AND w.status='open'
          AND w.ends_at>? AND json_extract(dog.value,'$.id')=dogs.id
      )
    `).bind(id,account.profileId,time,time),
    db.prepare("DELETE FROM dog_photos WHERE dog_id=? AND EXISTS(SELECT 1 FROM dogs WHERE id=? AND profile_id=? AND archived=1)")
      .bind(id,id,account.profileId),
    syncLeadDog(db,account.id),
  ]);
  return removed.meta.changes ? json({ profile: await accountProfile(db,account.id) })
    : error("Ritira la richiesta, rinuncia o aggiorna le passeggiate future con questo cane prima di rimuoverlo.",409);
}

export async function canViewProfile(db, viewer, target) {
  return db.prepare(`
    WITH person AS (SELECT ? AS viewer,? AS target)
    SELECT p.id,p.owner_name AS owner,p.age_group,p.gender,p.visibility,
      r.state AS relationship,r.sender_id,
      (p.id=person.viewer OR p.visibility='members' OR (p.visibility='friends' AND r.state='friends')) AS show_personal
    FROM person JOIN profiles p ON p.id=person.target AND p.account_id IS NOT NULL
    LEFT JOIN relationships r ON r.first_id=min(person.viewer,p.id) AND r.second_id=max(person.viewer,p.id)
    WHERE NOT ${blocked("person.viewer","p.id")}
  `).bind(viewer,target).first();
}

export async function viewProfile(db, viewer, target) {
  const row = await canViewProfile(db,viewer,target);
  if (!row) return error("Profilo non disponibile.",404);
  const { show_personal, age_group, gender, ...profile } = row;
  return json({ profile: { ...profile, age_group: show_personal ? age_group : "", gender: show_personal ? gender : "", dogs: await memberDogs(db,target) } });
}

export async function findPeople(db, viewer, raw) {
  const query = clean(raw,40);
  if (query.length<2) return json({ owners:[],dogs:[] });
  const pattern = "%" + query.replaceAll("\\","\\\\").replaceAll("%","\\%").replaceAll("_","\\_") + "%";
  const visible = `p.account_id IS NOT NULL AND p.id!=person.viewer AND NOT ${blocked("person.viewer","p.id")}
    AND EXISTS(SELECT 1 FROM dogs d WHERE d.profile_id=p.id AND d.archived=0)`;
  const [owners,dogs] = await db.batch([
    db.prepare(`WITH person AS (SELECT ? AS viewer) SELECT p.id,p.owner_name AS owner
      FROM person,profiles p WHERE ${visible} AND p.owner_name LIKE ? ESCAPE '\\' ORDER BY p.owner_name LIMIT 25`).bind(viewer,pattern),
    db.prepare(`WITH person AS (SELECT ? AS viewer) SELECT p.id AS profile_id,p.owner_name AS owner,d.id,d.name,d.emoji,d.breed,d.sex
      FROM person,profiles p JOIN dogs d ON d.profile_id=p.id AND d.archived=0
      WHERE ${visible} AND d.name LIKE ? ESCAPE '\\' ORDER BY d.name LIMIT 25`).bind(viewer,pattern),
  ]);
  return json({ owners:owners.results,dogs:dogs.results });
}

export async function connections(db, viewer) {
  const [friends,hidden] = await db.batch([
    db.prepare(`
      SELECT p.id,p.owner_name AS owner,r.state,r.sender_id FROM relationships r
      JOIN profiles p ON p.id=CASE WHEN r.first_id=? THEN r.second_id ELSE r.first_id END
      WHERE r.first_id=? OR r.second_id=? ORDER BY p.owner_name
    `).bind(viewer,viewer,viewer),
    db.prepare("SELECT p.id,p.owner_name AS owner FROM blocks b JOIN profiles p ON p.id=b.target_id WHERE b.owner_id=? ORDER BY p.owner_name").bind(viewer),
  ]);
  return json({ relationships:friends.results,blocked:hidden.results });
}

export async function changeConnection(db, viewer, target, action) {
  if (!target || target===viewer) return error("Profilo non valido.");
  const first = viewer<target ? viewer : target;
  const second = viewer<target ? target : viewer;
  const remove = db.prepare("DELETE FROM relationships WHERE first_id=? AND second_id=?").bind(first,second);
  if (action==="unblock") {
    await db.prepare("DELETE FROM blocks WHERE owner_id=? AND target_id=?").bind(viewer,target).run();
    return json({ ok:true });
  }
  if (action==="remove") {
    await remove.run();
    return json({ ok:true });
  }
  if (!await canViewProfile(db,viewer,target)) return error("Profilo non disponibile.",404);
  if (action==="block") {
    await db.batch([db.prepare("INSERT OR IGNORE INTO blocks(owner_id,target_id) VALUES (?,?)").bind(viewer,target),remove,
      db.prepare(`WITH people AS (SELECT ? AS viewer,? AS target)
        UPDATE join_requests SET status='withdrawn',details_released=0
        WHERE status IN ('pending','accepted') AND EXISTS (
          SELECT 1 FROM people,walks w WHERE w.id=join_requests.walk_id AND w.status='open' AND w.ends_at>?
          AND ((w.host_profile_id=viewer AND join_requests.profile_id=target) OR
            (w.host_profile_id=target AND join_requests.profile_id=viewer))
        )`).bind(viewer,target,nowSeconds()),
    ]);
    return json({ ok:true });
  }
  const allowed = `NOT ${blocked("person.viewer","person.target")}`;
  if (action==="request") {
    await db.batch([db.prepare(`WITH person AS (SELECT ? AS viewer,? AS target)
      INSERT INTO relationships(first_id,second_id,sender_id,state)
      SELECT min(viewer,target),max(viewer,target),viewer,'pending' FROM person WHERE ${allowed}
      ON CONFLICT(first_id,second_id) DO NOTHING`).bind(viewer,target),
      db.prepare(`INSERT INTO account_notices(account_id,kind,title,details,reference_id,created_at)
        SELECT account_id,'friend_request','Richiesta di amicizia',coalesce((SELECT owner_name FROM profiles WHERE id=?),''),?,?
        FROM profiles WHERE id=? AND changes()>0`).bind(viewer,viewer,nowSeconds(),target)]);
    return json({ ok:true });
  }
  if (action==="accept") {
    const [result] = await db.batch([db.prepare(`UPDATE relationships SET state='friends'
      WHERE first_id=? AND second_id=? AND sender_id=? AND state='pending'`).bind(first,second,target),
      db.prepare(`INSERT INTO account_notices(account_id,kind,title,details,reference_id,created_at)
        SELECT account_id,'friend_accepted','Amicizia accettata',coalesce((SELECT owner_name FROM profiles WHERE id=?),''),?,?
        FROM profiles WHERE id=? AND changes()>0`).bind(viewer,viewer,nowSeconds(),target)]);
    return result.meta.changes ? json({ ok:true }) : error("Richiesta non disponibile.",409);
  }
  return error("Azione non disponibile.");
}

export async function savePushPreferences(db, account, data) {
  if (!Array.isArray(data?.muted) || data.muted.some(kind=>!notificationKinds.includes(kind))) return error("Preferenze non valide.");
  const muted = [...new Set(data.muted)];
  await db.prepare("UPDATE profiles SET push_muted=? WHERE account_id=?").bind(JSON.stringify(muted),account.id).run();
  return json({ muted });
}
