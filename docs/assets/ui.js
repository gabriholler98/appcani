export const byId = id => document.getElementById(id);

export function element(tag,text="",className="") {
  const node=document.createElement(tag);
  node.textContent=text;
  if (className) node.className=className;
  return node;
}

export function button(text,action,className="secondary") {
  const node=element("button",text,className);
  node.type="button";
  node.onclick=event=>action(event.currentTarget);
  return node;
}

export function status(node,message="") {
  node.textContent=message;
  node.hidden=!message;
}

export function row(...children) {
  const node=element("div","","actions");
  node.append(...children);
  return node;
}

export function announce(message) {
  const toast=byId("toast");
  status(toast,message);
  clearTimeout(announce.timer);
  announce.timer=setTimeout(()=>status(toast),3400);
}

export async function busy(control,action,onError=error=>announce(error.message)) {
  if (control.disabled) return;
  control.disabled=true;
  try { return await action(); }
  catch (failure) { onError(failure); }
  finally { control.disabled=false; }
}

export const dateFormat = new Intl.DateTimeFormat("it-IT",{weekday:"short",day:"numeric",month:"short",timeZone:"Europe/Rome"});
export const timeFormat = new Intl.DateTimeFormat("it-IT",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
export function schedule(walk) {
  const minutes=walk.duration_minutes;
  const duration=[Math.floor(minutes/60)&&Math.floor(minutes/60)+" h",minutes%60&&minutes%60+" min"].filter(Boolean).join(" ");
  return dateFormat.format(new Date(walk.day+"T12:00:00Z"))+" · "+walk.time+" · "+duration;
}

export const dogNames = dogs => (dogs??[]).map(dog=>dog.name).join(", ");
export const slots = number => number===1 ? "1 posto libero" : number>1 ? number+" posti liberi" : "Al completo";

export function dogChoices(target,dogs,selected=[]) {
  target.replaceChildren(...dogs.map(dog=>{
    const label=element("label","","check");
    const input=element("input");
    input.type="checkbox";
    input.name="dog_ids";
    input.value=dog.id;
    input.checked=selected.includes(dog.id);
    label.append(input,document.createTextNode(dog.emoji+" "+dog.name+" · "+dog.size));
    return label;
  }));
}

export function fill(form,data,fields) {
  for (const field of fields) form.elements[field].value=data[field]??"";
}
