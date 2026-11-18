import { byId,busy,button,element,status,timeFormat } from "./ui.js?v=8";

export function setupChat(api,report) {
  const dialog=byId("chatDialog");
  const log=byId("chatMessages");
  const form=byId("chatForm");
  const older=byId("olderMessages");
  const newer=byId("newMessages");
  const feedback=byId("chatStatus");
  let walk=null;
  let version=0;
  let first=0,last=0;
  let timer;
  let loading=false;
  let quiet=0;

  function scrollDown() {
    log.scrollTop=log.scrollHeight;
    newer.hidden=true;
  }
  newer.onclick=scrollDown;
  log.addEventListener("scroll",()=>{
    if (log.scrollHeight-log.clientHeight-log.scrollTop<32) newer.hidden=true;
  });
  function block(message) {
    const item=element("article","","message"+(message.mine?" mine":""));
    const meta=element("p",(message.mine?"Tu":message.owner??message.dog_name)+" · "+timeFormat.format(new Date(message.created_at)),"muted");
    item.append(meta,element("p",message.body));
    if (!message.mine) item.append(button("Segnala",()=>report("message",message.id),"text-button"));
    return item;
  }
  function schedule() {
    clearTimeout(timer);
    if (walk && dialog.open && !document.hidden && !form.hidden) timer=setTimeout(()=>void load(),quiet>=3?30000:12000);
  }
  async function load(previous=false) {
    if (!walk || loading || document.hidden) return;
    loading=true;
    const openVersion=version;
    const params=new URLSearchParams({walk_id:walk.id});
    if (previous && first) params.set("before",first);
    if (!previous && last) params.set("after",last);
    try {
      const data=await api("/api/messages?"+params);
      if (openVersion!==version || !dialog.open) return;
      form.hidden=data.read_only;
      byId("chatArchived").hidden=!data.read_only;
      const items=data.messages;
      const before=log.scrollHeight;
      const atEnd=before-log.clientHeight-log.scrollTop<40;
      status(feedback,(!items.length&&!last)?"Nessun messaggio.":"");
      if (previous) {
        log.prepend(...items.map(block));
        log.scrollTop+=log.scrollHeight-before;
        older.hidden=!data.more;
      } else if (items.length) {
        log.append(...items.map(block));
        if (atEnd || !last) scrollDown();
        else newer.hidden=false;
      }
      if (!first || previous) {
        if (!previous) older.hidden=!data.more;
        if (items.length) first=items[0].seq;
      }
      if (!previous && items.length) last=items.at(-1).seq;
      if (items.length) quiet=0; else quiet+=1;
    } catch (failure) {
      if (openVersion!==version || !dialog.open) return;
      status(feedback,failure.message);
      if (failure.status===403) { form.hidden=true; older.hidden=true; }
    } finally {
      if (openVersion===version) {
        loading=false;
        schedule();
      }
    }
  }
  older.onclick=()=>void load(true);
  form.onsubmit=event=>{
    event.preventDefault();
    const current=walk;
    if (!current) return;
    void busy(event.submitter,async()=>{
      await api("/api/messages",{data:{walk_id:current.id,text:form.elements.message.value}});
      if (walk!==current) return;
      form.reset();
      await load();
      scrollDown();
    },error=>status(feedback,error.message));
  };
  function reset() {
    version+=1;
    clearTimeout(timer);
    walk=null;
    loading=false;
    first=last=quiet=0;
    log.replaceChildren();
    older.hidden=newer.hidden=true;
    form.reset();
    status(feedback);
  }
  dialog.onclose=reset;
  document.addEventListener("visibilitychange",()=>{
    if (document.hidden) clearTimeout(timer);
    else if (dialog.open) void load();
  });
  return {
    open(event) {
      reset();
      walk=event;
      byId("chatHeading").textContent=event.title;
      form.hidden=event.ends_at<=Date.now()/1000;
      byId("chatArchived").hidden=!form.hidden;
      dialog.showModal();
      void load();
    },
  };
}
