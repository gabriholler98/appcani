import { error, json } from "./accounts.mjs";
import { canViewProfile } from "./profiles.mjs";

const limit = 80 * 1024;

async function readImage(request) {
  if (request.headers.get("Content-Type")!=="image/jpeg" || !request.body) return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(limit);
  let length=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      if (length+value.length>limit) {
        await reader.cancel();
        return null;
      }
      bytes.set(value,length);
      length+=value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (length<64 || bytes[0]!==255 || bytes[1]!==216 || bytes[length-2]!==255 || bytes[length-1]!==217) return null;
  // Omit application metadata and comments before the image scan. The browser supplies a baseline JPEG.
  const safe = new Uint8Array(length);
  safe.set(bytes.subarray(0,2));
  let cursor=2, offset=2, sized=false;
  while (cursor+4<length && bytes[cursor]===255) {
    const marker=bytes[cursor+1];
    const span=bytes[cursor+2]*256+bytes[cursor+3];
    const next=cursor+span+2;
    if (span<2 || next>=length) return null;
    if (marker===192) {
      const height=bytes[cursor+5]*256+bytes[cursor+6];
      const width=bytes[cursor+7]*256+bytes[cursor+8];
      if (span<8 || !height || !width || height>512 || width>512) return null;
      sized=true;
    }
    if (marker===218) {
      if (!sized) return null;
      for (let index=next; index<length-2; index+=1) {
        if (bytes[index]!==255) continue;
        const escaped=bytes[++index];
        if (escaped!==0 && (escaped<208 || escaped>215)) return null;
      }
      safe.set(bytes.subarray(cursor,length),offset);
      return safe.slice(0,offset+length-cursor);
    }
    if ((marker<224 || marker>239) && marker!==254) {
      safe.set(bytes.subarray(cursor,next),offset);
      offset+=next-cursor;
    }
    cursor=next;
  }
  return null;
}

export async function dogPhoto(db,viewer,id,request) {
  const dog=await db.prepare("SELECT profile_id FROM dogs WHERE id=? AND archived=0").bind(id).first();
  if (!dog) return error("Cane non disponibile.",404);
  if (request.method==="GET") {
    if (dog.profile_id!==viewer && !await canViewProfile(db,viewer,dog.profile_id)) return error("Foto non disponibile.",404);
    const photo=await db.prepare("SELECT image FROM dog_photos WHERE dog_id=?").bind(id).first();
    return photo ? new Response(new Uint8Array(photo.image),{headers:{"Content-Type":"image/jpeg","X-Content-Type-Options":"nosniff","Cache-Control":"no-store"}})
      : error("Foto non disponibile.",404);
  }
  if (dog.profile_id!==viewer) return error("Puoi modificare solo il tuo cane.",403);
  if (request.method==="DELETE") {
    await db.prepare("DELETE FROM dog_photos WHERE dog_id=?").bind(id).run();
    return json({ok:true});
  }
  const image=await readImage(request);
  if (!image) return error("Carica una foto JPEG di massimo 512 pixel e 80 KB.");
  const saved=await db.prepare(`INSERT INTO dog_photos(dog_id,image)
    SELECT id,? FROM dogs WHERE id=? AND profile_id=? AND archived=0
    ON CONFLICT(dog_id) DO UPDATE SET image=excluded.image`).bind(image.buffer,id,viewer).run();
  return saved.meta.changes ? json({ok:true}) : error("Cane non disponibile.",404);
}
