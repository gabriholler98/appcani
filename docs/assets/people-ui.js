import { announce,byId,busy,button,element,fill,row,status,sexSymbol } from "./ui.js?v=8";
import { appendDogAvatar,avatarFor,populateDogAvatarPicker,renderDogAvatar } from "./dog-avatars.js?v=8";
import {setupPhotoEditor} from "./photo-editor.js?v=8";

const dogFields=["name","breed","birth","size","energy","emoji","notes","sex"];
const ownerFields=["owner","age_group","gender","visibility"];

export function setupPeople({api,current,setProfile,saveFirst,openReport,connectionsChanged}) {
  const dogForm=byId("dogForm");
  const dogDialog=byId("dogDialog");
  const ownerForm=byId("ownerForm");
  const ownerDialog=byId("ownerDialog");
  const personDialog=byId("personDialog");
  const photoPreview=byId("photoPreview");
  const photoUrls=new Set();
  const photos=new Map();
  const editor=setupPhotoEditor();
  populateDogAvatarPicker(byId("dogAvatarPicker"));
  let generation=0;
  let editing=null;
  let draftPhoto=null;
  let photoPick=0;
  let personRequest=0;
  let peopleRequest=0;
  let searchRequest=0;
  let friendTab="friends";
  let connectionsData={relationships:[],blocked:[]};

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
    const avatar=element("div","","dog-photo");
    renderDogAvatar(avatar,dog.emoji);
    avatar.setAttribute("aria-hidden","true");
    const details=element("div");
    details.append(element("h3",[dog.name,sexSymbol(dog.sex)].filter(Boolean).join(" ")),element("p",dog.breed+" · "+dog.size.toLowerCase(),"muted"));
    head.append(avatar,details);
    card.append(head,element("p",dog.birth+" · Energia: "+dog.energy.toLowerCase(),"muted"));
    if (dog.notes) card.append(element("p",dog.notes,"card-description"));
    if(dog.sex)card.append(element("p",dog.sex==="male"?"♂ Maschio":"♀ Femmina","muted"));
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
    if(!profile.dogs.length)byId("dogList").append(element("p","L’account amministratore può organizzare passeggiate senza cani.","muted"));
  }

  function openDog(dog=null,setup=false,knownOwner="") {
    editing=dog?.id??null;
    draftPhoto=null;
    editor.clear();
    dogForm.reset();
    if (dog) fill(dogForm,dog,dogFields);
    const selected=avatarFor(dog?.emoji) ? dog.emoji : "avatar:meticcio";
    dogForm.querySelector(`input[name="emoji"][value="${selected}"]`).checked=true;
    byId("dogHeading").textContent=dog?"Modifica cane":"Aggiungi un cane";
    const name=dogForm.elements.owner;
    byId("setupOwner").hidden=!setup;
    name.required=setup;
    name.value=knownOwner;
    byId("removePhoto").hidden=!dog?.photo;
    status(byId("photoStatus"));
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
    editor.clear();
    photoPick+=1;
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
      const result=await editor.choose(file);
      if (pick!==photoPick || !dogDialog.open) return;
      draftPhoto=result;
      photoPreview.hidden=true;
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
      const photo=await editor.blob();
      let profile,id=editing;
      if (dogForm.elements.owner.required) {
        profile=await saveFirst({owner:dogForm.elements.owner.value,firstDog:data});
        id=profile.dogs[0].id;
      } else {
        ({profile,dog_id:id}=await api("/api/profile/dogs",{data:{...data,id}}));
      }
      editing=id;
      if (id && photo) {
        try {
          status(byId("photoStatus"),"Caricamento foto…");
          await api("/api/profile/photo?id="+encodeURIComponent(id),{method:"POST",body:photo});
          photos.delete(id);
          profile.dogs.find(dog=>dog.id===id).photo=Boolean(photo);
        } catch (failure) {
          setProfile(profile);
          dogForm.elements.owner.required=false;
          status(error,"Cane salvato, foto da completare. "+failure.message+" Premi Salva cane per riprovare.");
          status(byId("photoStatus"));
          return;
        }
      }
      setProfile(profile);
      dogDialog.close();
      announce("Cane salvato.");
    },failure=>status(error,failure.message));
  };
  byId("removePhoto").onclick=event=>{
    const dog=current()?.dogs.find(dog=>dog.id===editing);
    if(!dog||!confirm("Eliminare la foto e usare l’illustrazione scelta?"))return;
    const error=dogForm.querySelector(".form-error");
    status(error);
    void busy(event.currentTarget,async()=>{
      await api("/api/profile/photo?id="+encodeURIComponent(dog.id),{method:"DELETE"});
      photos.delete(dog.id);
      dog.photo=false;
      editor.clear();
      photoPreview.hidden=true;
      event.target.hidden=true;
      setProfile(current());
      status(byId("photoStatus"),"Foto rimossa. Viene usata l’illustrazione scelta.");
    },failure=>status(error,failure.message+" Riprova con Rimuovi foto."));
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
      connectionsData=result;
      renderConnections();
    } catch (failure) { if (request===peopleRequest) announce(failure.message); }
  }
  function renderConnections() {
      const result=connectionsData;
      byId("friendSearch").hidden=friendTab!=="search";
      byId("friendListHeading").textContent=({friends:"I tuoi amici",received:"Richieste ricevute",sent:"Richieste inviate",search:"Trova persone e cani"})[friendTab];
      const list=byId("connectionsList");
      list.hidden=friendTab==="search";
      document.querySelectorAll("[data-friends]").forEach(node=>node.setAttribute("aria-pressed",String(node.dataset.friends===friendTab)));
      const selected=result.relationships.filter(item=>friendTab==="friends"?item.state==="friends":
        item.state==="pending"&&(friendTab==="received"?item.sender_id!==current().id:item.sender_id===current().id));
      const count=result.relationships.filter(item=>item.state==="pending"&&item.sender_id!==current().id).length;
      byId("friendsBadge").textContent=String(count);byId("friendsBadge").hidden=count===0;
      const cards=selected.map(profile=>{
        const card=element("article","","card");
        const actions=row(button("Vedi profilo",()=>openPerson(profile.id)));
        if(profile.state==="pending") {
          if(profile.sender_id!==current().id)actions.append(button("Accetta",control=>busy(control,()=>connection(profile.id,"accept")),"primary"));
          actions.append(button(profile.sender_id===current().id?"Annulla richiesta":"Rifiuta",control=>busy(control,()=>connection(profile.id,"remove"))));
        }
        card.append(element("h3",profile.owner),element("p",profile.state==="friends"?"Amici":profile.sender_id===current().id?"Richiesta inviata":"Richiesta ricevuta","muted"),actions);
        return card;
      });
      for (const profile of friendTab==="friends"?result.blocked:[]) {
        const card=element("article","","card");
        card.append(element("h3",profile.owner),element("p","Bloccato","muted"),row(button("Sblocca",control=>busy(control,
          ()=>connection(profile.id,"unblock")))));
        cards.push(card);
      }
      list.replaceChildren(...(cards.length?cards:[element("p",friendTab==="friends"?"Non hai ancora amici. Usa Cerca persone e cani per inviare una richiesta.":"Non ci sono richieste in questa sezione.","empty")]));
  }
  document.querySelectorAll("[data-friends]").forEach(node=>{node.onclick=()=>{friendTab=node.dataset.friends;renderConnections();};});
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
          const title=element("h3",item.name?[item.name,sexSymbol(item.sex)].filter(Boolean).join(" "):item.owner);
          if (item.name && appendDogAvatar(title,item.emoji)) title.prepend(document.createTextNode(" "));
          else if (item.name) title.prepend(document.createTextNode((item.emoji??"🐕")+" "));
          card.append(title);
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
    openDog,openPerson,renderProfile,refreshConnections,photoUrl,
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
