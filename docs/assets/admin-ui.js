import {byId,element,button,row,status,busy,fill,timeFormat} from "./ui.js?v=8";
import {passwordProof} from "./account-client.js?v=8";
import {populateDogAvatarPicker} from "./dog-avatars.js?v=8";

const states={new:"Da esaminare",reviewing:"In gestione",resolved:"Risolta",dismissed:"Archiviata"};
export function setupAdmin({api,username}) {
  const form=byId("adminForm"),dialog=byId("adminDialog"),fields=byId("adminFields");
  let section="reports",offset=0,request=0,intervention=null;
  const search=byId("adminSearch"),list=byId("adminList");
  function input(name,label,value="",type="text",options) {
    const wrap=element("label",label);
    const node=element(options?"select":"input");
    node.name=name;
    if(options)for(const [id,title] of options) {
      const option=element("option",title);option.value=id;node.append(option);
    }
    else {node.type=type;node.maxLength=500;}
    node.value=String(value);
    node.required=true;
    wrap.append(node);fields.append(wrap);return node;
  }
  function edit(action,id,title,data={}) {
    intervention={action,target_id:id,...data};
    form.reset();fields.replaceChildren();status(form.querySelector(".form-error"));
    byId("adminHeading").textContent=title;
    if(action==="report")input("state","Stato",data.state,"text",Object.entries(states));
    if(action==="owner-edit") {
      input("owner","Nome visibile",data.owner);
      input("age_group","Fascia d’età",data.age_group,"text",["","18–24","25–34","35–44","45–54","55–64","65+"].map(x=>[x,x||"Non indicata"]));
      input("gender","Sesso",data.gender,"text",["","Donna","Uomo","Altro"].map(x=>[x,x||"Non indicato"]));
    }
    if(action==="dog-edit") {
      input("name","Nome",data.name);input("breed","Razza",data.breed);input("birth","Anno di nascita",data.birth,"number");
      input("size","Taglia",data.size,"text",["Piccola","Media","Grande"].map(x=>[x,x]));
      input("energy","Energia",data.energy,"text",["Tranquilla","Media","Alta"].map(x=>[x,x]));
      input("sex","Sesso del cane",data.sex??"","text",[["","Da completare"],["male","♂ Maschio"],["female","♀ Femmina"]]);
      input("notes","Note",data.notes).required=false;
      const picker=element("div","","dog-avatar-picker");populateDogAvatarPicker(picker);fields.append(picker);
      const selected=picker.querySelector('input[value="'+data.emoji+'"]')??picker.querySelector("input");selected.checked=true;
    }
    if(action==="suspend")input("days","Durata",7,"text",[[1,"Un giorno"],[7,"Una settimana"],[30,"30 giorni"],[3650,"Fino a riattivazione"]]);
    if(action==="walk-edit") {
      input("title","Titolo",data.title);input("description","Descrizione",data.description??"").required=false;
      input("day","Giorno",data.day,"date");input("time","Ora",data.time,"time");
      input("duration_minutes","Durata in minuti",data.duration_minutes,"number");
      input("max_participants","Capienza totale in cani",data.max_participants,"number");
      input("city","Città",data.city);input("area_label","Punto di ritrovo esatto",data.area_label);
      input("latitude","Latitudine",data.latitude,"number").step="any";input("longitude","Longitudine",data.longitude,"number").step="any";
    }
    if(["walk-delete","account-delete"].includes(action))input("password","La tua password amministratore","","password");
    dialog.showModal();
  }
  async function person(id) {
    const {account,profile}=await api("/api/admin/person?id="+encodeURIComponent(id));
    const content=element("div","","flow");
    content.append(element("h3","@"+account.username));
    if(profile)content.append(row(button("Modifica proprietario",()=>edit("owner-edit",id,"Modifica proprietario",profile))));
    for(const dog of profile?.dogs??[]) {
      const actions=row(button("Modifica "+dog.name,()=>edit("dog-edit",id,"Modifica cane",{...dog,dog_id:dog.id})));
      if(dog.photo)actions.append(button("Rimuovi foto",()=>edit("photo-remove",id,"Rimuovi foto di "+dog.name,{dog_id:dog.id})));
      content.append(actions);
    }
    content.append(row(button("Invia avviso",()=>edit("warn",id,"Avviso a @"+account.username)),
      button(account.suspended_until>Date.now()/1000?"Riattiva account":"Sospendi account",()=>edit(account.suspended_until>Date.now()/1000?"resume":"suspend",id,"Stato di @"+account.username)),
      button("Elimina account",()=>edit("account-delete",id,"Eliminazione definitiva di @"+account.username),"danger")));
    list.replaceChildren(content);
    byId("adminStatus").textContent="Utente selezionato · Aggiorna per tornare all’elenco";
  }
  async function refresh() {
    const id=++request;
    status(byId("adminStatus"),"Caricamento…");
    document.querySelectorAll("[data-admin]").forEach(node=>node.setAttribute("aria-pressed",String(node.dataset.admin===section)));
    byId("adminStateLabel").hidden=section!=="reports";
    try {
      const params=new URLSearchParams({section,offset:String(offset),q:search.elements.q.value,state:search.elements.state.value});
      const {items,more}=await api("/api/admin/list?"+params);
      if(id!==request||byId("adminPage").hidden)return;
      list.replaceChildren();
      for(const item of items) {
        const card=element("article","","card");
        if(section==="reports") {
          card.append(element("h3",states[item.state]+" · "+item.kind),element("p",item.reason),element("p","Ricevuta "+timeFormat.format(new Date(item.created_at*1000)),"muted"));
          const snapshot=element("details"),summary=element("summary","Contenuto e contesto");
          snapshot.append(summary,element("pre",item.snapshot||"Segnalazione precedente all’introduzione della copia del contenuto."));
          card.append(snapshot,row(button("Gestisci",()=>edit("report",item.id,"Gestisci segnalazione",{state:item.state}))));
          if(item.kind==="message")card.append(row(button("Rimuovi messaggio",()=>edit("message-remove",item.subject_id,"Rimozione messaggio"))));
        } else if(section==="users") {
          card.append(element("h3","@"+item.username),element("p",item.owner??"Profilo da completare","muted"),
            element("p",item.role==="admin"?"Amministratore":item.suspended_until>Date.now()/1000?"Sospeso":"Attivo","pill"),
            row(button("Gestisci utente",control=>busy(control,()=>person(item.id)))));
        } else if(section==="walks") {
          card.append(element("h3",item.title),element("p",item.city+" · "+item.day+" "+item.time+" · "+item.owner,"muted"),
            row(button("Modifica",control=>busy(control,async()=>{
              const {walk}=await api("/api/admin/walk?id="+encodeURIComponent(item.id));
              edit("walk-edit",item.id,"Modifica passeggiata",walk);
            })),
              button("Annulla",()=>edit("walk-cancel",item.id,"Annullamento passeggiata")),
              button("Elimina",()=>edit("walk-delete",item.id,"Eliminazione definitiva"),"danger")));
        } else {
          const details=element("details");details.append(element("summary","Dati prima dell’intervento"),element("pre",item.before_data));
          card.append(element("h3",item.action),element("p",item.reason),element("p",timeFormat.format(new Date(item.created_at*1000)),"muted"),details);
        }
        list.append(card);
      }
      if(!items.length)list.append(element("p","Nessun risultato.","empty"));
      byId("adminNext").hidden=!more;byId("adminPrevious").hidden=offset===0;
      status(byId("adminStatus"));
    }catch(error){if(id===request)status(byId("adminStatus"),error.message);}
  }
  document.querySelectorAll("[data-admin]").forEach(node=>{node.onclick=()=>{section=node.dataset.admin;offset=0;void refresh();};});
  search.onsubmit=event=>{event.preventDefault();offset=0;void refresh();};
  byId("adminNext").onclick=()=>{offset+=30;void refresh();};
  byId("adminPrevious").onclick=()=>{offset=Math.max(0,offset-30);void refresh();};
  form.onsubmit=event=>{
    event.preventDefault();
    if(!intervention)return;
    const data={...intervention,...Object.fromEntries(new FormData(form))};
    if(["walk-delete","account-delete"].includes(data.action)&&!confirm("Confermi l’eliminazione definitiva?"))return;
    void busy(event.submitter,async()=>{
      if(data.password){data.proof=await passwordProof(username(),data.password);delete data.password;}
      await api("/api/admin/action",{data});
      dialog.close();await refresh();
    },error=>status(form.querySelector(".form-error"),error.message));
  };
  byId("openMyReports").onclick=async()=>{
    const reportDialog=byId("myReportsDialog");
    reportDialog.showModal();
    const root=byId("myReportsList");root.replaceChildren(element("p","Caricamento…"));
    try{
      const {reports}=await api("/api/reports/mine");
      if(!reportDialog.open)return;
      root.replaceChildren(...reports.map(item=>{
        const card=element("article","","card");
        card.append(element("h3",states[item.state]),element("p",timeFormat.format(new Date(item.created_at*1000)),"muted"));
        if(item.response)card.append(element("p",item.response));return card;
      }));
      if(!reports.length)root.append(element("p","Non hai inviato segnalazioni.","empty"));
    }catch(error){root.replaceChildren(element("p",error.message,"form-error"));}
  };
  return {refresh,reset(){request+=1;list.replaceChildren();fields.replaceChildren();section="reports";offset=0;}};
}
