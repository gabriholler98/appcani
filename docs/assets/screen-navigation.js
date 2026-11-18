export function setupScreenNavigation(changePage) {
  let restoring=false;
  const dialogs=[...document.querySelectorAll("dialog")];
  const active=new Set();
  const observer=new MutationObserver(records=>{
    const previous=[...active];
    for(const {target} of records)if(!target.open)active.delete(target.id);
    for(const {target} of records)if(target.open)active.add(target.id);
    const added=[...active].some(id=>!previous.includes(id));
    const removed=previous.some(id=>!active.has(id));
    if(restoring)return;
    if(added) {
      const state={...history.state,panels:[...active]};
      if(removed)history.replaceState(state,"");else history.pushState(state,"");
    } else if(removed&&history.state?.panels?.length)history.back();
  });
  for(const dialog of dialogs)observer.observe(dialog,{attributes:true,attributeFilter:["open"]});
  window.addEventListener("popstate",event=>{
    restoring=true;
    const desired=event.state?.panels??[];
    for(const dialog of dialogs)if(dialog.open&&!desired.includes(dialog.id)){active.delete(dialog.id);dialog.close();}
    // Keep a parent screen open while returning from a nested action.
    const parent=dialogs.find(dialog=>dialog.id===desired.at(-1));
    if(parent&&!parent.open){active.add(parent.id);parent.showModal();}
    if(!desired.length&&event.state?.page)changePage(event.state.page);
    queueMicrotask(()=>{restoring=false;});
  });
  history.replaceState({page:"explore",panels:[]},"");
  return {
    page(value) {
      if(restoring)return;
      history.replaceState({...history.state,scrollY:window.scrollY},"");
      history.pushState({page:value,panels:[]},"");
    },
    reset() {active.clear();history.replaceState({page:"explore",panels:[]},"");},
  };
}
