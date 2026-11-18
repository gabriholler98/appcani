const encoder=new TextEncoder();

export async function publicPoint(latitude,longitude,secret) {
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const data=new DataView(await crypto.subtle.sign("HMAC",key,encoder.encode(latitude.toFixed(5)+":"+longitude.toFixed(5))));
  const angle=data.getUint32(0)/2**32*2*Math.PI;
  const arc=(290+data.getUint32(4)/2**32*140)/6371000;
  const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180;
  const shifted=Math.asin(Math.sin(lat)*Math.cos(arc)+Math.cos(lat)*Math.sin(arc)*Math.cos(angle));
  return {
    latitude:shifted*180/Math.PI,
    longitude:((lon+Math.atan2(Math.sin(angle)*Math.sin(arc)*Math.cos(lat),Math.cos(arc)-Math.sin(lat)*Math.sin(shifted)))*180/Math.PI+540)%360-180,
  };
}

export async function initializePositions(env) {
  const {results}=await env.DB.prepare("SELECT id,latitude,longitude FROM walks WHERE public_latitude IS NULL LIMIT 40").bind().all();
  if (!results.length) return;
  const updates=await Promise.all(results.map(async walk=>{
    const point=await publicPoint(walk.latitude,walk.longitude,env.LOCATION_MASK_KEY);
    return env.DB.prepare("UPDATE walks SET public_latitude=?,public_longitude=? WHERE id=? AND latitude=? AND longitude=? AND public_latitude IS NULL")
      .bind(point.latitude,point.longitude,walk.id,walk.latitude,walk.longitude);
  }));
  await env.DB.batch(updates);
}

export function searchArea(query) {
  const values=["lat","lon","radius"].map(key=>query.get(key));
  if (values.every(value=>value===null)) return null;
  if(values.some(value=>value===null||value===""))return false;
  const [lat,lon,radius]=values.map(Number);
  return Number.isFinite(lat)&&Math.abs(lat)<85&&Number.isFinite(lon)&&Math.abs(lon)<=180
    &&[1,5,10,15,30,50,100].includes(radius) ? {lat,lon,radius} : false;
}

export function distanceSql(area) {
  if(!area)return "0";
  const longitudeKm=111.195*Math.cos(area.lat*Math.PI/180);
  const dx=`min(abs(w.public_longitude-(${area.lon})),360-abs(w.public_longitude-(${area.lon})))*${longitudeKm}`;
  const dy=`(w.public_latitude-(${area.lat}))*111.195`;
  return `((${dx})*(${dx})+(${dy})*(${dy}))`;
}
