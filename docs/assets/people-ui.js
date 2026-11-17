import { announce,byId,busy,button,element,fill,row,status } from "./ui.js";

const dogFields=["name","breed","birth","size","energy","emoji","notes"];
const ownerFields=["owner","age_group","gender","visibility"];

async function resizePhoto(file) {
  if (!file?.size || file.size>20*1024*1024) throw new Error("Scegli un’immagine di massimo 20 MB.");
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();
    image.src=url;
    await image.decode().catch(()=>{throw new Error("Immagine non leggibile. Prova con una foto JPEG o PNG.");});
    const side=Math.min(image.naturalWidth,image.naturalHeight);
    const canvas=document.createElement("canvas");
    canvas.width=canvas.height=Math.min(side,384);
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="white";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,canvas.width,canvas.height);
    for (const quality of [.82,.7,.55,.4]) {
      const result=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
      if (result?.size<=80*1024) return result;
    }
    throw new Error("La foto è troppo grande anche dopo la compressione.");
  } finally { URL.revokeObjectURL(url); }
}

export function setupPeople({api,current,setProfile,saveFirst,openReport,connectionsChanged}) {
  const dogForm=byId("dogForm");
  const dogDialog=byId("dogDialog");
  const ownerForm=byId("ownerForm");
  const ownerDialog=byId("ownerDialog");
  const personDialog=byId("personDialog");
  const photoPreview=byId("photoPreview");
  const photoUrls=new Set();
  const photos=new Map();
  let generation=0;
  let editing=null;
  let draftPhoto=null;
  let draftUrl="";
  let photoPick=0;
  let personRequest=0;
  let peopleRequest=0;
  let searchRequest=0;

  function rememberUrl(blob) {
    const url=URL.createObjectURL(blob);
    photoUrls.add(url);
    return url;
  }

  function photoUrl(id) {
    if (!photos.has(id)) {
      const version=generation;
      const promise=api("/api/profile/photo?id="+encodeURIComponent(id),{blob:true})
        .then(blob=>version===generation ? rememberUrl(blob) : "")
        .catch(()=>{ if (photos.get(id)===promise) photos.delete(id); return ""; });
      photos.set(id,promise);
    }
    return photos.get(id);
  }

  function dogCard(dog,mine) {
    const card=element("article","","card");
    const head=element("div","","dog-head");
    const avatar=element("div",dog.emoji,"dog-photo");
    avatar.setAttribute("aria-hidden","true");
    const details=element("div");
    details.append(element("h3",dog.name),element("p",dog.breed+" · "+dog.size.toLowerCase(),"muted"));
    head.append(avatar,details);
    card.append(head,element("p",dog.birth+" · Energia: "+dog.energy.toLowerCase(),"muted"));
    if (dog.notes) card.append(element("p",dog.notes,"card-description"));
    if (dog.photo) void photoUrl(dog.id).then(url=>{
      if (!url || !avatar.isConnected) return;
      const image=element("img");
      image.src=url;
      image.alt="";
      avatar.replaceChildren(image);
    });
    if (mine) card.append(row(button("Modifica",()=>openDog(dog)),button("Rimuovi",control=>{
      if (!confirm("Rimuovere "+dog.name+" dal tuo profilo?")) return;
      return busy(control,async()=>{
        const {profile}=await api("/api/profile/dogs/remove",{data:{id:dog.id}});
        photos.delete(dog.id);
        setProfile(profile);
        announce("Cane rimosso.");
      });
    },"text-button")));
    return card;
  }

  function renderProfile() {
    const profile=current();
    if (!profile) return;
    byId("ownerTitle").textContent=profile.owner;
    byId("dogList").replaceChildren(...profile.dogs.map(dog=>dogCard(dog,true)));
  }

  function openDog(dog=null,setup=false,knownOwner="") {
    editing=dog?.id??null;
    draftPhoto=null;
    dogForm.reset();
    if (dog) fill(dogForm,dog,dogFields);
    byId("dogHeading").textContent=dog?"Modifica cane":"Aggiungi un cane";
    const name=dogForm.elements.owner;
    byId("setupOwner").hidden=!setup;
    name.required=setup;
    name.value=knownOwner;
    byId("removePhoto").hidden=!dog?.photo;
    dogForm.querySelector("button:not([type])").disabled=false;
    photoPreview.hidden=true;
    status(dogForm.querySelector(".form-error"));
    dogDialog.showModal();
    if (dog?.photo) void photoUrl(dog.id).then(url=>{
      if (!url || !dogDialog.open || editing!==dog.id || draftPhoto) return;
      photoPreview.src=url;
      photoPreview.hidden=false;
    });
  }
  dogDialog.onclose=()=>{
    photoPick+=1;
    if (draftUrl) URL.revokeObjectURL(draftUrl);
    draftUrl="";
    draftPhoto=null;
    photoPreview.removeAttribute("src");
  };
  dogForm.elements.photo.onchange=async event=>{
    const pick=++photoPick;
    const file=event.target.files[0];
    if (!file) return;
    const error=dogForm.querySelector(".form-error");
    const save=dogForm.querySelector("button[type=submit],button:not([type])");
    save.disabled=true;
    status(error);
    try {
      const result=await resizePhoto(file);
      if (pick!==photoPick || !dogDialog.open) return;
      if (draftUrl) URL.revokeObjectURL(draftUrl);
      draftPhoto=result;
      draftUrl=URL.createObjectURL(result);
      dogForm.elements.removePhoto.checked=false;
      photoPreview.src=draftUrl;
      photoPreview.hidden=false;
    } catch (failure) {
      if (pick===photoPick) status(error,failure.message);
    } finally { if (pick===photoPick) save.disabled=false; }
  };
  dogForm.onsubmit=event=>{
    event.preventDefault();
    const error=dogForm.querySelector(".form-error");
    status(error);
    void busy(event.submitter,async()=>{
      const data=Object.fromEntries(dogFields.map(key=>[key,dogForm.elements[key].value]));
      const photo=draftPhoto;
      const remove=dogForm.elements.removePhoto.checked;
      let profile,id=editing;
      if (dogForm.elements.owner.required) {
        profile=await saveFirst({owner:dogForm.elements.owner.value,firstDog:data});
        id=profile.dogs[0].id;
      } else {
        ({profile,dog_id:id}=await api("/api/profile/dogs",{data:{...data,id}}));
      }
      if (id && (photo||remove)) {
        try {
          await api("/api/profile/photo?id="+encodeURIComponent(id),{method:photo?"POST":"DELETE",body:photo||undefined});
          photos.delete(id);
          profile.dogs.find(dog=>dog.id===id).photo=Boolean(photo);
        } catch (failure) {
          announce("Cane salvato. "+failure.message);
          setProfile(profile);
          dogDialog.close();
          return;
        }
      }
      setProfile(profile);
      dogDialog.close();
      announce("Cane salvato.");
    },failure=>status(error,failure.message));
  };
  byId("addDog").onclick=()=>openDog();
  byId("editOwner").onclick=()=>{
    fill(ownerForm,current(),ownerFields);
    status(ownerForm.querySelector(".form-error"));
    ownerDialog.showModal();
  };
  ownerForm.onsubmit=event=>{
    event.preventDefault();
    const message=ownerForm.querySelector(".form-error");
    status(message);
    void busy(event.submitter,async()=>{
      const {profile}=await api("/api/profile/owner",{data:Object.fromEntries(new FormData(ownerForm))});
      setProfile(profile);
      ownerDialog.close();
      announce("Profilo aggiornato.");
    },failure=>status(message,failure.message));
  };

  async function connection(id,action) {
    await api("/api/people/relationship",{data:{target_id:id,action}});
    connectionsChanged();
    void refreshConnections();
  }

  async function openPerson(id) {
    if (id===current()?.id) {
      announce("Trovi i tuoi dati nella sezione Profilo.");
      return;
    }
    const request=++personRequest;
    if (!personDialog.open) personDialog.showModal();
    const target=byId("personCard");
    target.replaceChildren(element("p","Caricamento…","muted"));
    try {
      const {profile}=await api("/api/people/profile?id="+encodeURIComponent(id));
      if (!personDialog.open || request!==personRequest) return;
      byId("personHeading").textContent=profile.owner;
      const metadata=[profile.age_group,profile.gender].filter(Boolean).join(" · ");
      const refresh=action=>control=>busy(control,async()=>{
        await connection(id,action);
        if (action==="block") {
          personDialog.close();
          announce("Profilo bloccato.");
        } else await openPerson(id);
      });
      const relationship=profile.relationship==="friends";
      const pending=profile.relationship==="pending";
      const incoming=pending && profile.sender_id!==current().id;
      const controls=row();
      if (!pending && !relationship) controls.append(button("Aggiungi agli amici",refresh("request"),"primary"));
      if (incoming) controls.append(button("Accetta amicizia",refresh("accept"),"primary"));
      if (pending || relationship) controls.append(button(relationship?"Rimuovi dagli amici":incoming?"Rifiuta":"Annulla richiesta",refresh("remove")));
      controls.append(button("Blocca",control=>{
        if (confirm("Bloccare questo profilo?")) return refresh("block")(control);
      }),button("Segnala",()=>openReport("profile",id),"text-button"));
      const cards=element("div","","cards");
      cards.append(...profile.dogs.map(dog=>dogCard(dog,false)));
      target.replaceChildren(...(metadata?[element("p",metadata,"muted")]:[]),
        element("p",relationship?"Amici":pending?(incoming?"Richiesta ricevuta":"Richiesta inviata"):"","muted"),
        element("h3","Cani"),cards,controls);
    } catch (failure) {
      if (request===personRequest && personDialog.open) target.replaceChildren(element("p",failure.message,"form-error"));
    }
  }

  async function refreshConnections() {
    const request=++peopleRequest;
    try {
      const result=await api("/api/people/connections");
      if (request!==peopleRequest || byId("peoplePage").hidden) return;
      const list=byId("connectionsList");
      const cards=result.relationships.map(profile=>{
        const card=element("article","","card");
        card.append(element("h3",profile.owner),element("p",profile.state==="friends"?"Amici":profile.sender_id===current().id?
          "Richiesta inviata":"Richiesta ricevuta","muted"),row(button("Vedi profilo",()=>openPerson(profile.id))));
        return card;
      });
      for (const profile of result.blocked) {
        const card=element("article","","card");
        card.append(element("h3",profile.owner),element("p","Bloccato","muted"),row(button("Sblocca",control=>busy(control,
          ()=>connection(profile.id,"unblock")))));
        cards.push(card);
      }
      list.replaceChildren(...(cards.length?cards:[element("p","Non hai ancora amici o richieste.","empty")]));
    } catch (failure) { if (request===peopleRequest) announce(failure.message); }
  }
  const search=byId("searchPeople");
  search.onsubmit=event=>{
    event.preventDefault();
    const request=++searchRequest;
    const message=byId("peopleStatus");
    status(message,"Ricerca…");
    void busy(event.submitter,async()=>{
      const results=await api("/api/people?q="+encodeURIComponent(search.elements.q.value.trim()));
      if (request!==searchRequest) return;
      const target=byId("searchResults");
      target.replaceChildren();
      for (const [label,items] of [["Proprietari",results.owners],["Cani",results.dogs]]) {
        if (!items.length) continue;
        target.append(element("h3",label));
        const group=element("div","","cards");
        for (const item of items) {
          const card=element("article","","card");
          card.append(element("h3",item.name?item.emoji+" "+item.name:item.owner));
          if (item.name) card.append(element("p",item.breed+" · "+item.owner,"muted"));
          card.append(row(button(item.name?"Vedi proprietario":"Vedi profilo",()=>openPerson(item.profile_id??item.id))));
          group.append(card);
        }
        target.append(group);
      }
      status(message,results.owners.length||results.dogs.length?"":"Nessun risultato.");
    },failure=>status(message,failure.message));
  };
  return {
    openDog,openPerson,renderProfile,refreshConnections,
    reset() {
      generation+=1;
      personRequest+=1;
      peopleRequest+=1;
      searchRequest+=1;
      for (const url of photoUrls) URL.revokeObjectURL(url);
      photoUrls.clear();
      photos.clear();
      ["dogList","personCard","connectionsList","searchResults"].forEach(id=>byId(id).replaceChildren());
      search.reset();
      status(byId("peopleStatus"));
    },
  };
}
