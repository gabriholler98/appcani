import {byId,button,element,status,busy} from "./ui.js?v=8";

export function setupLocation(onChange) {
  const dialog=byId("locationDialog"),radius=byId("searchRadius");
  const label=byId("chooseLocation"),prompt=byId("locationPrompt");
  let key,selected=null,draft=null,map,marker,generation=0;
  function showDraft(point) {
    draft=point;
    byId("saveLocation").disabled=false;
    if(map) {
      marker?.remove();
      marker=window.L.circleMarker([point.lat,point.lon],{radius:8,color:"#075b43"}).addTo(map);
      map.setView([point.lat,point.lon],12);
    }
  }
  function update() {
    label.textContent=selected?selected.label:"Scegli una zona di ricerca";
    radius.disabled=!selected;
    prompt.hidden=Boolean(selected);
    if(selected) {
      selected.radius=Number(radius.value);
      localStorage.setItem(key,JSON.stringify(selected));
    }
    onChange(selected);
  }
  function open() {
    if(!dialog.open)dialog.showModal();
    status(byId("manualLocationStatus"));
    if(!map&&window.L) {
      map=window.L.map("locationMap",{scrollWheelZoom:false}).setView([46.3,11.2],8);
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
      map.on("click",event=>showDraft({lat:event.latlng.lat,lon:event.latlng.lng,label:"Punto scelto sulla mappa",source:"manual"}));
    }
    map?.invalidateSize();
    if(selected)showDraft({...selected});
    else {draft=null;byId("saveLocation").disabled=true;}
  }
  async function device(control) {
    const version=generation;
    const feedback=dialog.open?byId("manualLocationStatus"):byId("locationStatus");
    status(feedback);
    await busy(control,async()=>{
      if(!navigator.geolocation)throw new Error("Posizione non disponibile. Scegli una zona sulla mappa o cerca un comune.");
      const result=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{timeout:10000,maximumAge:60000}))
        .catch(()=>{throw new Error("Posizione non disponibile. Puoi cercare un comune o scegliere un punto sulla mappa.");});
      if(version!==generation)return;
      selected={lat:result.coords.latitude,lon:result.coords.longitude,label:"La mia posizione",source:"device",radius:Number(radius.value)};
      update();
      dialog.close();
    },failure=>status(feedback,failure.message));
  }
  byId("useDevicePosition").onclick=event=>void device(event.currentTarget);
  byId("refreshDevicePosition").onclick=event=>void device(event.currentTarget);
  byId("chooseLocation").onclick=open;
  byId("useManualPosition").onclick=open;
  radius.onchange=update;
  byId("saveLocation").onclick=()=>{
    if(!draft)return;
    selected=draft;
    update();
    dialog.close();
  };
  const search=byId("locationSearch");
  search.onsubmit=event=>{
    event.preventDefault();
    const version=generation;
    const feedback=byId("manualLocationStatus");
    status(feedback);
    void busy(event.submitter,async()=>{
      const params=new URLSearchParams({q:search.elements.q.value.trim(),format:"jsonv2",limit:"5",countrycodes:"it",addressdetails:"1"});
      const response=await fetch("https://nominatim.openstreetmap.org/search?"+params,{signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error("Ricerca temporaneamente non disponibile. Puoi scegliere un punto sulla mappa.");
      const places=await response.json();
      if(version!==generation||!dialog.open)return;
      byId("locationChoices").replaceChildren(...places.map(place=>button(place.display_name,()=>{
        const a=place.address??{};
        const name=a.city??a.town??a.village??a.municipality??place.name??search.elements.q.value;
        showDraft({lat:Number(place.lat),lon:Number(place.lon),label:name.slice(0,70),source:"manual"});
        status(feedback,"Zona selezionata: "+name);
      })));
      if(!places.length)status(feedback,"Nessun risultato. Prova con un comune o scegli un punto sulla mappa.");
    },failure=>status(feedback,failure.message));
  };
  return {
    restore(profileId) {
      key="dogs-in-giro-area-"+profileId;
      selected=null;
      try {
        const saved=JSON.parse(localStorage.getItem(key));
        if(saved&&Number.isFinite(saved.lat)&&Math.abs(saved.lat)<85&&Number.isFinite(saved.lon)&&Math.abs(saved.lon)<=180
          &&[1,5,10,15,30,50,100].includes(saved.radius))selected=saved;
      }catch{}
      radius.value=String(selected?.radius??15);
      update();
    },
    reset() {
      generation+=1;
      selected=draft=null;
      key=null;
      byId("locationChoices").replaceChildren();
      search.reset();
    },
  };
}
