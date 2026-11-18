import { setupAccounts } from "./account-client.js?v=8";
import { currentPushEndpoint, setupNotifications } from "./notification-client.js?v=8";
import { setupPeople } from "./people-ui.js?v=8";
import { setupChat } from "./chat.js?v=8";
import { announce,byId,busy,button,dogChoices,dogNames,element,fill,row,schedule,slots,status,sexSymbol } from "./ui.js?v=8";
import { appendDogAvatar } from "./dog-avatars.js?v=8";
import {setupLocation} from "./location-ui.js?v=8";
import {setupAdmin} from "./admin-ui.js?v=8";
import {setupScreenNavigation} from "./screen-navigation.js?v=8";

const app=byId("appView");
const filtersForm=byId("mapFilters");
const walkForm=byId("walkForm");
const joinForm=byId("joinForm");
const detailsDialog=byId("detailsDialog");
const summaryDialog=byId("summaryDialog");
const sections={explore:"Esplora",plans:"Passeggiate",people:"Amici",profile:"Profilo",admin:"Amministrazione"};
const requestLabels={pending:"In attesa",accepted:"Confermata",withdrawn:"Ritirata",rejected:"Rifiutata"};
const coordinates=[46.43,11.25];
const tileUrl="https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const zoneRadius=500;
let profile=null, page="explore", plan="scheduled", archive="created", mapView=true;
let filters=new URLSearchParams();
let nearby=null, filterVersion=0;
let loadId=0,detailId=0,quiet=0, refreshTimer,walkSignature="";
let map,markers,meetingMap,meetingMarker,place,editing,summary,joinTarget,reportTarget;
let addressId=0;
let role="member",accountUsername="";
let displayedWalks=[];

const accounts=setupAccounts({
  openProfile:known=>people.openDog(null,true,known?.owner??""),
  showApp,closeApp,currentPushEndpoint,announce,
});
const api=accounts.api;
const screenNavigation=setupScreenNavigation(next=>{
  if(profile&&Object.hasOwn(sections,next)&&(next!=="admin"||role==="admin"))navigate(next,{focus:false,record:false});
});
const administration=setupAdmin({api,username:()=>accountUsername});
const searchLocation=setupLocation(area=>{
  nearby=area;
  walkSignature="";
  displayedWalks=[];
  byId("mapPanel").hidden=!area||!mapView;
  if(area&&map)map.setView([area.lat,area.lon],area.radius<=5?12:10);
  if(profile&&page==="explore")void loadPage(true);
});
const people=setupPeople({
  api,current:()=>profile,setProfile:accounts.setProfile,
  saveFirst:async data=>(await api("/api/profile",{data})).profile,
  openReport,connectionsChanged:()=>{if(page==="explore")void loadPage(true);},
});
const chat=setupChat(api,openReport);
const notifications=setupNotifications(api,{
  openItem:item=>{
    if(["friend_request","friend_accepted"].includes(item.kind))return navigate("people");
    if(item.kind==="report")return role==="admin"?navigate("admin"):byId("openMyReports").click();
    if(item.kind==="admin")return;
    return item.kind==="join"||item.kind==="withdrawn"?navigate("plans",{plan:"received"}):openDetails(item.walk_id,item.kind==="chat");
  },
  preferences:()=>profile?.push_muted??[],
  setPreferences:muted=>{if(profile)profile.push_muted=muted;},
});

function showApp(data,username,accountRole) {
  const first=!profile;
  profile=data;
  role=accountRole??role;accountUsername=username;
  byId("openAdmin").hidden=role!=="admin";
  byId("addDog").hidden=role==="admin";
  app.hidden=false;
  byId("currentUser").textContent="@"+username;
  if (first) {searchLocation.restore(profile.id);navigate("explore",{focus:false});}
  else if (page==="profile") people.renderProfile();
  const url=new URL(location.href);
  if (url.searchParams.get("avvisi")==="1") {
    url.searchParams.delete("avvisi");
    history.replaceState(history.state,"",url);
    notifications.open();
  }
}

function closeApp() {
  profile=null;
  app.hidden=true;
  loadId+=1;
  detailId+=1;
  clearTimeout(refreshTimer);
  for(const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  people.reset();
  screenNavigation.reset();
  searchLocation.reset();administration.reset();role="member";accountUsername="";
  notifications.reset();
  filters=new URLSearchParams();
  nearby=null;
  filterVersion+=1;
  filtersForm.reset();
  filtersForm.hidden=true;
  byId("toggleFilters").setAttribute("aria-expanded","false");
  byId("toggleFilters").textContent="Filtri";
  walkSignature="";
  ["walks","plansList","walkDetails","walkSummary"].forEach(id=>byId(id).replaceChildren());
  status(byId("exploreStatus"));
  status(byId("plansStatus"));
  byId("requestBadge").hidden=true;
  markers?.clearLayers();
}

function navigate(next,{focus=true,plan:nextPlan,record=true}={}) {
  if(record&&next!==page)screenNavigation.page(next);
  page=next;
  if (nextPlan) plan=nextPlan;
  for(const id of Object.keys(sections)) byId(id+"Page").hidden=id!==page;
  document.querySelectorAll("[data-page]").forEach(button=>{
    if(button.dataset.page===page) button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  });
  const title=byId("pageHeading");
  title.textContent=sections[page];
  if (focus) {
    title.focus({preventScroll:true});
    window.scrollTo(0,0);
  }
  if (next==="profile") people.renderProfile();
  if (next==="people") void people.refreshConnections();
  if(next==="admin")void administration.refresh();
  if (next==="explore") updateMapView();
  if (next==="plans") updatePlanControls();
  quiet=0;
  void loadPage(true);
}
byId("openAdmin").onclick=()=>navigate("admin");
document.querySelectorAll("[data-page]").forEach(control=>{control.onclick=()=>navigate(control.dataset.page);});
document.querySelectorAll("[data-close]").forEach(control=>{control.onclick=()=>byId(control.dataset.close).close();});

function renderMap() {
  if (map || !window.L || !mapView || byId("explorePage").hidden) return;
  map=window.L.map("map",{zoomControl:false,scrollWheelZoom:false})
    .setView(nearby?[nearby.lat,nearby.lon]:coordinates,nearby?(nearby.radius<=5?12:10):window.matchMedia("(max-width: 830px)").matches?8:9);
  const updateZoneSymbols=()=>{
    byId("map").classList.toggle("zone-overview",map.getZoom()<13);
    if(markers)drawMapWalks(displayedWalks);
  };
  map.on("zoomend",updateZoneSymbols);
  updateZoneSymbols();
  window.L.control.zoom({position:"topright"}).addTo(map);
  window.L.tileLayer(tileUrl,{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  markers=window.L.layerGroup().addTo(map);
  walkSignature="";
}

function updateMapView() {
  const navigable=window.L || document.readyState!=="complete";
  byId("mapView").disabled=!navigable;
  const show=mapView && navigable && Boolean(nearby);
  byId("mapPanel").hidden=!show;
  byId("mapView").setAttribute("aria-pressed",String(Boolean(show)));
  byId("listView").setAttribute("aria-pressed",String(!show));
  renderMap();
  map?.invalidateSize({pan:false});
}
byId("mapView").onclick=()=>{mapView=true;updateMapView();void loadPage(true);};
byId("listView").onclick=()=>{mapView=false;updateMapView();};
window.addEventListener("load",()=>{if(profile && page==="explore"){updateMapView();void loadPage(true);}});

byId("toggleFilters").onclick=()=>{
  filtersForm.hidden=!filtersForm.hidden;
  byId("toggleFilters").setAttribute("aria-expanded",String(!filtersForm.hidden));
};
filtersForm.onsubmit=event=>{
  event.preventDefault();
  const version=++filterVersion;
  const feedback=byId("filterLocationStatus");
  status(feedback);
  void busy(event.submitter,async()=>{
    const data=new FormData(filtersForm);
    const next=new URLSearchParams();
    for (const key of ["day","before","size"]) {
      const value=data.get(key).trim();
      if(value) next.set(key,value);
    }
    if (next.has("day") && next.has("before") && next.get("day")>next.get("before")) throw new Error("La data finale dev’essere successiva o uguale alla data iniziale.");
    if(data.has("full"))next.set("full","1");
    if(byId("onlyFriends").checked)next.set("friends","1");
    if (version!==filterVersion || !profile) return;
    filters=next;
    filtersForm.hidden=true;
    byId("toggleFilters").setAttribute("aria-expanded","false");
    const count=filters.size;
    byId("toggleFilters").textContent=count?"Filtri ("+count+")":"Filtri";
    void loadPage(true);
  },failure=>{if(version===filterVersion)status(feedback,failure.message);});
};
filtersForm.onreset=()=>{
  filterVersion+=1;
  filters=new URLSearchParams();
  if(byId("onlyFriends").checked)filters.set("friends","1");
  status(byId("filterLocationStatus"));
  byId("toggleFilters").textContent="Filtri";
  void loadPage(true);
};
byId("onlyFriends").onchange=event=>{
  if(event.target.checked)filters.set("friends","1");else filters.delete("friends");
  void loadPage(true);
};

function updatePlanControls() {
  document.querySelectorAll("[data-plan]").forEach(item=>item.setAttribute("aria-pressed",String(item.dataset.plan===plan)));
  document.querySelectorAll("[data-archive]").forEach(item=>item.setAttribute("aria-pressed",String(item.dataset.archive===archive)));
  byId("archiveFilters").hidden=plan!=="archive";
}
document.querySelectorAll("[data-plan]").forEach(item=>{item.onclick=()=>{
  plan=item.dataset.plan;updatePlanControls();byId("plansList").replaceChildren();void loadPage(true);
};});
document.querySelectorAll("[data-archive]").forEach(item=>{item.onclick=()=>{
  archive=item.dataset.archive;updatePlanControls();byId("plansList").replaceChildren();void loadPage(true);
};});

function isLive(walk) {
  return walk.status==="open" && walk.ends_at>Date.now()/1000;
}
function eventBadge(walk) {
  if (walk.status==="cancelled") return "Annullata";
  if (!isLive(walk)) return requestLabels[walk.request_status]??"Conclusa";
  if (walk.is_host) return "Organizzi tu";
  return requestLabels[walk.request_status]??slots(walk.available_places);
}

function walkCard(walk) {
  const card=element("article","","card");
  const meta=element("p",schedule(walk),"meta");
  const description=[walk.city,dogNames(walk.dogs)].filter(Boolean).join(" · ");
  card.append(element("h3",walk.title),meta,element("p",description,"muted"));
  const pills=element("div","","row");
  pills.append(element("span",eventBadge(walk),"pill"));
  if (isLive(walk) && (walk.is_host || walk.request_status==="pending" || walk.request_status==="accepted")) {
    pills.append(element("span",slots(walk.available_places),"pill"));
  }
  card.append(pills);
  const controls=row(button("Vedi dettagli",()=>openDetails(walk.id)));
  if(walk.can_chat||(walk.status==="open"&&(walk.is_host||walk.request_status==="accepted")))controls.append(button("Apri chat",()=>chat.open(walk)));
  if(walk.request_status==="pending")card.append(element("p","Attendi la conferma dell’organizzatore.","muted"));
  if(walk.request_status==="accepted")card.append(element("p","Partecipazione confermata. Trovi il ritrovo e i partecipanti nei dettagli.","muted"));
  if (walk.is_host && !isLive(walk)) controls.append(button("Elimina",control=>{
    if (confirm("Eliminare la passeggiata, le richieste e la chat anche dall’archivio dei partecipanti?")) {
      return mutate(control,"/api/walks/delete",{walk_id:walk.id},"Passeggiata eliminata.");
    }
  },"text-button"));
  card.append(controls);
  return card;
}

function showExplore(events) {
  const walks=events;
  const signature=JSON.stringify(walks);
  if (signature===walkSignature && byId("walks").childElementCount) return false;
  walkSignature=signature;
  byId("walks").replaceChildren(...(walks.length?walks.map(walkCard):[
    element("p",filters.size||nearby?"Nessuna passeggiata corrisponde ai filtri.":"Nessuna passeggiata disponibile. Puoi organizzarne una con Crea.","empty"),
  ]));
  status(byId("exploreStatus"),walks.length===1?"1 passeggiata":walks.length+" passeggiate");
  displayedWalks=walks;
  drawMapWalks(walks);
  return true;
}

function drawMapWalks(walks) {
  if(!markers)return;
  markers.clearLayers();
  const L=window.L;
  const cells=new Map();
  for(const walk of walks) {
    const point=[walk.public_latitude??walk.latitude,walk.public_longitude??walk.longitude];
    if(!point.every(Number.isFinite))continue;
    const pixel=map.project(point,map.getZoom());
    const key=Math.floor(pixel.x/64)+":"+Math.floor(pixel.y/64);
    if(!cells.has(key))cells.set(key,[]);
    cells.get(key).push(walk);
  }
  const grouped=new Set();
  for(const group of cells.values()) {
    if(group.length<2)continue;
    const points=group.map(walk=>[walk.public_latitude??walk.latitude,walk.public_longitude??walk.longitude]);
    const center=L.latLngBounds(points).getCenter();
    const popup=element("div","","map-popup map-cluster-list");
    popup.append(element("strong",group.length+" passeggiate in questa zona"));
    for(const walk of group) {
      grouped.add(walk.id);
      L.circle([walk.public_latitude??walk.latitude,walk.public_longitude??walk.longitude],
        {radius:zoneRadius,color:"#075b43",weight:2,fillOpacity:.12,interactive:false}).addTo(markers);
      popup.append(button(walk.title+" · "+schedule(walk),()=>openDetails(walk.id)));
    }
    popup.append(button("Ingrandisci zona",()=>{
      map.closePopup();map.setView(center,Math.min(17,map.getZoom()+2));
    }));
    const count=element("span",String(group.length),"map-cluster");
    L.marker(center,{title:group.length+" passeggiate",alt:group.length+" passeggiate",
      icon:L.divIcon({className:"map-pin",html:count,iconSize:[38,38],iconAnchor:[19,19]})}).addTo(markers).bindPopup(popup);
  }
  for(const walk of walks) {
    if(grouped.has(walk.id))continue;
    const point=[walk.public_latitude??walk.latitude,walk.public_longitude??walk.longitude];
    if (!point.every(Number.isFinite)) continue;
    const zone=L.circle(point,{radius:zoneRadius,color:"#075b43",weight:3,dashArray:"5 4",
      fillColor:"#2dbc85",fillOpacity:.24,interactive:false}).addTo(markers);
    const icon=element("span","","map-dog");
    if (!appendDogAvatar(icon,walk.emoji)) icon.textContent=walk.emoji??"🐕";
    if(!walk.dogs.length) {
      const administrationIcon=element("img");administrationIcon.src="./assets/dogs-in-giro-miniatura-light.png?v=2";administrationIcon.alt="";
      icon.replaceChildren(administrationIcon);
    }
    const lead=walk.dogs[0];
    const sex=sexSymbol(lead?.sex);
    if(sex) {
      const symbol=element("span",sex,"map-dog-sex");
      symbol.setAttribute("aria-label",lead.sex==="male"?"Maschio":"Femmina");icon.append(symbol);
    }
    if(lead?.photo)void people.photoUrl(lead.id).then(url=>{
      if(!url||!icon.isConnected)return;
      const image=element("img");image.src=url;image.alt="";
      const badges=[...icon.querySelectorAll(".map-dog-count,.map-dog-sex")];
      icon.replaceChildren(image,...badges);
    });
    if(walk.dogs.length>1) {
      const badge=element("b","+"+(walk.dogs.length-1),"map-dog-count");
      icon.append(badge);
    }
    const popup=element("div","","map-popup");
    popup.append(element("strong",walk.title),element("p",schedule(walk)),element("p",slots(walk.available_places)),
      button("Inquadra zona di 500 m",()=>{
        map.closePopup();
        map.fitBounds(zone.getBounds(),{padding:[30,30],maxZoom:16});
      }),
      button("Vedi dettagli",()=>openDetails(walk.id)));
    const label=walk.title+" · zona approssimativa";
    L.marker(point,{title:label,alt:label,
      icon:L.divIcon({className:"map-pin",html:icon,iconSize:[35,35],iconAnchor:[17,17]})}).addTo(markers).bindPopup(popup);
  }
}

function requestCard(request) {
  const card=element("article","","card");
  card.append(element("h3",request.owner),element("p",request.title,"meta"),element("p",dogNames(request.dogs),"muted"));
  const actions=row(button("Vedi profilo",()=>people.openPerson(request.profile_id)));
  const data={walk_id:request.walk_id,request_id:request.id};
  if (request.status==="pending") {
    const accept=button("Accetta",control=>mutate(control,"/api/requests/action",data,"Richiesta accettata."),"primary");
    accept.disabled=request.available_places<request.dogs.length;
    card.append(element("p",accept.disabled?"Posti insufficienti":slots(request.available_places),"muted"));
    actions.append(accept,button("Rifiuta",control=>mutate(control,"/api/requests/reject",data,"Richiesta rifiutata.")));
  } else if (!request.details_released) {
    actions.append(button("Condividi indirizzo",control=>{
      if (confirm("Condividere il punto di ritrovo esatto con questa persona?")) {
        return mutate(control,"/api/reveal",data,"Indirizzo condiviso.");
      }
    }));
  } else card.append(element("p","Indirizzo condiviso","muted"));
  actions.append(button("Passeggiata",()=>openDetails(request.walk_id)));
  card.append(actions);
  return card;
}

function drawPlans(walks,requests) {
  const root=byId("plansList");
  const list=plan==="received"?requests.map(requestCard):
    walks.filter(walk=>plan==="archive" || (plan==="sent"?Boolean(walk.request_status):walk.is_host||walk.request_status==="accepted")).map(walkCard);
  root.replaceChildren(...(list.length?list:[element("p","Nessuna passeggiata in questa sezione.","empty")]));
  status(byId("plansStatus"));
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (profile && !document.hidden) refreshTimer=setTimeout(()=>void loadPage(),quiet>=2?75000:40000);
}

async function loadPage(force=false) {
  clearTimeout(refreshTimer);
  if (!profile || document.hidden) return;
  if(page==="explore"&&!nearby) {
    byId("walks").replaceChildren();
    markers?.clearLayers();status(byId("exploreStatus"));
    scheduleRefresh();return;
  }
  const id=++loadId;
  const current=page, currentPlan=plan;
  const query=new URLSearchParams(filters);
  if(nearby){query.set("lat",nearby.lat);query.set("lon",nearby.lon);query.set("radius",nearby.radius);}
  const endpoint=current==="explore"?"/api/walks?"+query:current==="plans"?
    currentPlan==="archive"?"/api/walks/archive?filter="+archive:"/api/walks?view=mine":"/api/notifications?count=1";
  if (force && current==="plans") status(byId("plansStatus"),"Caricamento…");
  try {
    const result=await api(endpoint);
    if (id!==loadId) return;
    const unread=result.unread_notifications??result.unread;
    notifications.updateUnread(unread);
    if(Number.isInteger(result.friend_requests)){
      byId("friendsBadge").textContent=String(result.friend_requests);
      byId("friendsBadge").hidden=result.friend_requests===0;
    }
    if (result.requests) {
      const pending=result.requests.filter(item=>item.status==="pending").length;
      byId("requestBadge").textContent=String(pending);
      byId("requestBadge").hidden=pending===0;
    }
    if (current==="explore") {
      if (showExplore(result.walks)) quiet=0; else quiet+=1;
      if(result.more)status(byId("exploreStatus"),"Prime 100 passeggiate · restringi il raggio o le date per affinare i risultati.");
    } else if (current==="plans" && currentPlan===plan) {
      const signature=JSON.stringify([plan,archive,result.walks,result.requests]);
      if (force || byId("plansList").dataset.signature!==signature) {
        drawPlans(result.walks,result.requests??[]);
        byId("plansList").dataset.signature=signature;
        quiet=0;
      } else quiet+=1;
    } else quiet+=1;
  } catch (failure) {
    if (id!==loadId) return;
    if (current==="plans") status(byId("plansStatus"),failure.message);
    else if (current==="explore") status(byId("exploreStatus"),failure.message);
  } finally { if (id===loadId) scheduleRefresh(); }
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden) clearTimeout(refreshTimer);
  else void loadPage();
});

function mutate(control,endpoint,data,message,after) {
  return busy(control,async()=>{
    await api(endpoint,{data});
    announce(message);
    await after?.();
    await loadPage(true);
  });
}

async function openDetails(id,openChat=false) {
  if (!id || !profile) return;
  const token=++detailId;
  if (!detailsDialog.open) detailsDialog.showModal();
  byId("detailHeading").textContent="Passeggiata";
  const body=byId("walkDetails");
  body.replaceChildren(element("p","Caricamento…","muted"));
  try {
    const {walk,participants}=await api("/api/walks/details?id="+encodeURIComponent(id));
    if (token!==detailId || !detailsDialog.open) return;
    byId("detailHeading").textContent=walk.title;
    const known=walk.is_host || walk.request_status==="accepted";
    const live=isLive(walk);
    if (openChat && known && walk.status==="open") {
      detailsDialog.close();
      chat.open(walk);
      return;
    }
    body.replaceChildren(element("p",schedule(walk),"meta"),element("p",walk.area_label,"muted"),
      element("p",live?slots(walk.available_places)+" · Capienza "+walk.max_participants+" cani":eventBadge(walk),"muted"));
    if (walk.reveal_exact && Number.isFinite(walk.latitude) && Number.isFinite(walk.longitude)) {
      const directions=element("a","Apri il punto di ritrovo sulla mappa","secondary meeting-link");
      const location=new URL("https://www.openstreetmap.org/");
      location.searchParams.set("mlat",walk.latitude);
      location.searchParams.set("mlon",walk.longitude);
      location.hash="map=17/"+walk.latitude+"/"+walk.longitude;
      directions.href=location.href;
      directions.target="_blank";
      directions.rel="noopener noreferrer";
      body.append(directions);
    }
    if (walk.description) body.append(element("p",walk.description,"card-description"));
    if (participants.length) {
      body.append(element("h3","Partecipanti"));
      for(const item of participants) {
        const participant=element("article","","card");
        participant.append(element("h3",item.owner+(item.host?" · Organizza": "")),
          element("p",dogNames(item.dogs),"muted"));
        if (item.profile_id!==profile.id) participant.append(row(button("Vedi profilo",()=>people.openPerson(item.profile_id))));
        body.append(participant);
      }
    } else {
      body.append(row(button("Profilo di "+walk.host_name,()=>people.openPerson(walk.host_profile_id))));
    }
    const actions=row();
    if (known && walk.status==="open") actions.append(button("Apri chat",()=>chat.open(walk)));
    if (walk.is_host && live) {
      if (walk.starts_at>Date.now()/1000) actions.append(button("Modifica",()=>openWalkForm(walk),"primary"));
      actions.append(button("Annulla passeggiata",control=>{
        if(confirm("Annullare questa passeggiata e avvisare i partecipanti?"))return mutate(control,"/api/cancel",
          {walk_id:id},"Passeggiata annullata.",()=>detailsDialog.close());
      },"danger"));
    } else if (live && ["pending","accepted"].includes(walk.request_status)) {
      actions.append(button(walk.request_status==="pending"?"Ritira richiesta":"Rinuncia",control=>{
        if(confirm("Ritirare la partecipazione a questa passeggiata?"))return mutate(control,"/api/requests/withdraw",
          {walk_id:id},"Partecipazione ritirata.",()=>openDetails(id));
      }));
    } else if (live && walk.available_places>0 && walk.request_status!=="rejected") {
      actions.append(button("Chiedi di unirti",()=>openJoin(walk),"primary"));
    }
    if (!walk.is_host) actions.append(button("Segnala",()=>openReport("walk",id),"text-button"));
    if (actions.childElementCount) body.append(actions);
  } catch (failure) {
    if (token===detailId && detailsDialog.open) body.replaceChildren(element("p",failure.message,"form-error"));
  }
}

function openJoin(walk) {
  joinTarget=walk;
  const dogs=profile.dogs;
  dogChoices(byId("joinDogs"),dogs,dogs.length===1?[dogs[0].id]:[]);
  byId("joinCapacity").textContent=slots(walk.available_places);
  status(joinForm.querySelector(".form-error"));
  byId("joinDialog").showModal();
}
joinForm.onsubmit=event=>{
  event.preventDefault();
  const message=joinForm.querySelector(".form-error");
  status(message);
  const dog_ids=new FormData(joinForm).getAll("dog_ids");
  const current=joinTarget;
  if (!dog_ids.length) return status(message,"Scegli almeno un cane.");
  if (dog_ids.length>current.available_places) return status(message,"I cani selezionati superano i posti disponibili.");
  void busy(event.submitter,async()=>{
    await api("/api/join",{data:{walk_id:current.id,dog_ids}});
    byId("joinDialog").close();
    announce("Richiesta inviata.");
    await openDetails(current.id);
    await loadPage(true);
  },failure=>status(message,failure.message));
};

function localDay() {
  return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function openWalkForm(walk=null) {
  editing=walk;
  summary=null;
  addressId+=1;
  walkForm.reset();
  walkForm.elements.day.min=localDay();
  walkForm.elements.day.value=localDay();
  const dogs=profile.dogs;
  dogChoices(byId("hostDogs"),dogs,walk?walk.dogs.map(dog=>dog.id):dogs.length?[dogs[0].id]:[]);
  byId("hostDogs").closest("fieldset").hidden=role==="admin"&&!dogs.length;
  if (walk) {
    fill(walkForm,{...walk,max:walk.max_participants,address:walk.exact_area},["title","day","time","duration_minutes","max","description","address"]);
  }
  byId("walkHeading").textContent=walk?"Modifica passeggiata":"Crea una passeggiata";
  status(walkForm.querySelector(".form-error"));
  byId("walkDialog").showModal();
  showPlace(walk?{area_label:walk.exact_area,city:walk.city,latitude:walk.latitude,longitude:walk.longitude}:null);
}
byId("openWalk").onclick=()=>openWalkForm();
function showPlace(point) {
  place=point;
  status(byId("addressResult"),point?point.area_label+" · "+point.city:"");
  const box=byId("meetingMap");
  box.hidden=!point || !window.L;
  if (box.hidden) return;
  const L=window.L;
  if (!meetingMap) {
    meetingMap=L.map(box,{scrollWheelZoom:false,dragging:false}).setView([point.latitude,point.longitude],15);
    L.tileLayer(tileUrl,{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(meetingMap);
  }
  const center=[point.latitude,point.longitude];
  meetingMarker?.remove();
  meetingMarker=L.circleMarker(center,{radius:8,color:"#075b43",fillOpacity:.8}).addTo(meetingMap);
  meetingMap.invalidateSize({pan:false});
  meetingMap.setView(center,15);
}
walkForm.elements.popular.onchange=()=>{
  addressId+=1;
  const input=walkForm.elements.popular.value;
  if(!input) return showPlace(null);
  const [area_label,city,latitude,longitude]=input.split("|");
  walkForm.elements.address.value="";
  showPlace({area_label,city,latitude:Number(latitude),longitude:Number(longitude)});
};
walkForm.elements.address.oninput=()=>{
  addressId+=1;
  walkForm.elements.popular.value="";
  showPlace(null);
};
byId("findAddress").onclick=control=>void busy(control.currentTarget,async()=>{
  const query=walkForm.elements.address.value.trim();
  const request=++addressId;
  if(!query) throw new Error("Inserisci un luogo o un indirizzo.");
  status(byId("addressResult"),"Ricerca in corso…");
  const params=new URLSearchParams({format:"jsonv2",limit:"1",countrycodes:"it",addressdetails:"1",q:query});
  const response=await fetch("https://nominatim.openstreetmap.org/search?"+params,{signal:AbortSignal.timeout(12000)});
  const [found]=response.ok?await response.json():[];
  if (request!==addressId || !byId("walkDialog").open) return;
  if (!found) throw new Error("Indirizzo non trovato. Prova ad aggiungere il comune.");
  const address=found.address??{};
  const city=address.city??address.town??address.village??address.municipality;
  if(!city) throw new Error("Comune non trovato. Inseriscilo nella ricerca.");
  walkForm.elements.popular.value="";
  showPlace({area_label:found.display_name.slice(0,140),city:city.slice(0,40),latitude:Number(found.lat),longitude:Number(found.lon)});
},failure=>{status(byId("addressResult"),failure.message);});

walkForm.onsubmit=event=>{
  event.preventDefault();
  const data=new FormData(walkForm);
  const dog_ids=data.getAll("dog_ids");
  const message=walkForm.querySelector(".form-error");
  if(!dog_ids.length&&role!=="admin") return status(message,"Seleziona almeno un cane.");
  if(Number(data.get("max"))<dog_ids.length) return status(message,"La capienza deve includere tutti i tuoi cani selezionati.");
  if(!place) return status(message,"Scegli un luogo suggerito o conferma un indirizzo.");
  status(message);
  summary={
    title:data.get("title"),day:data.get("day"),time:data.get("time"),
    duration_minutes:Number(data.get("duration_minutes")),max:Number(data.get("max")),
    description:data.get("description"),dog_ids,...place,
    ...(editing?{walk_id:editing.id,revision:editing.revision}:{}),
  };
  byId("walkSummary").replaceChildren(element("h3",summary.title),element("p",schedule(summary),"meta"),
    element("p",summary.area_label+" · "+summary.city),element("p","Capienza totale: "+summary.max+" cani"),
    element("p","Porti: "+dogNames(profile.dogs.filter(dog=>dog_ids.includes(dog.id)))));
  byId("confirmWalk").textContent=editing?"Salva modifiche":"Pubblica";
  status(byId("summaryError"));
  summaryDialog.showModal();
};
byId("confirmWalk").onclick=event=>void busy(event.currentTarget,async()=>{
  const edited=Boolean(editing);
  const {id}=await api(edited?"/api/walks/edit":"/api/walk",{data:summary});
  summaryDialog.close();
  byId("walkDialog").close();
  announce(edited?"Passeggiata aggiornata.":"Passeggiata pubblicata.");
  if (detailsDialog.open) await openDetails(id);
  else navigate("plans",{plan:"scheduled"});
  await loadPage(true);
},failure=>status(byId("summaryError"),failure.message));

const reportForm=byId("reportForm");
function openReport(kind,id) {
  reportTarget={kind,id};
  reportForm.reset();
  status(reportForm.querySelector(".form-error"));
  byId("reportDialog").showModal();
}
reportForm.onsubmit=event=>{
  event.preventDefault();
  void busy(event.submitter,async()=>{
    await api("/api/reports",{data:{...reportTarget,reason:reportForm.elements.reason.value}});
    byId("reportDialog").close();
    announce("Segnalazione registrata.");
  },failure=>status(reportForm.querySelector(".form-error"),failure.message));
};

void accounts.restore();
