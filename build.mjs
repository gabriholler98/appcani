import { mkdir, writeFile } from "node:fs/promises";
import { page } from "./worker.mjs";

function replace(source, target, value) {
  if (!source.includes(target)) throw new Error("Elemento dell'interfaccia mancante: " + target);
  return source.replace(target, () => value);
}

const api = `function api(path,opt){
  var base=window.INSIEME_API_ORIGIN;
  if(!base)return Promise.reject(Error('Il servizio condiviso è in configurazione'));
  var options=Object.assign({},opt,{credentials:'omit',referrerPolicy:'no-referrer'});
  options.headers=new Headers(opt&&opt.headers);
  if(profile&&(!opt||!opt.method||opt.method==='GET')){
    options.headers.set('Authorization','Bearer '+profile.token);
    options.headers.set('X-Profile-Id',profile.id);
  }
  return fetch(new URL(path,base),options).then(function(r){
    return r.json().then(function(j){
      if(!r.ok)throw Error(j.error||'Qualcosa non ha funzionato');
      return j;
    });
  });
}`;

let html = replace(page, "<title>", '<script src="./config.js"></script><title>');
html = replace(html, /function api\(path,opt\)[\s\S]*?(?=function updateProfile)/.exec(html)?.[0] ?? "<api non trovata>", api);
html = replace(html, "'/api/walks'+viewer()", "'/api/walks'");
html = replace(html, "+'&profile_id='+encodeURIComponent(profile.id)+'&token='+encodeURIComponent(profile.token)", "");
html = replace(html, "function viewer(){return profile?('?profile_id='+encodeURIComponent(profile.id)+'&token='+encodeURIComponent(profile.token)):''}", "");
html = html.replaceAll("insieme-shared-profile", "insieme-pages-profile-v1");
html = replace(html, "<style>", "<style>#serviceStatus{padding:12px;border-radius:12px;background:#ffe0d1;color:#213d36}");
html = replace(html, '<main class="main">', '<main class="main"><p id="serviceStatus" role="status" hidden></p>');
html = replace(html, "updateProfile();load();", `updateProfile();
if(window.INSIEME_API_ORIGIN){
  load();
}else{
  var serviceStatus=document.getElementById('serviceStatus');
  serviceStatus.textContent='Il servizio condiviso è in configurazione. Passeggiate, profili e chat saranno disponibili dopo l’attivazione.';
  serviceStatus.hidden=false;
  document.getElementById('editProfile').disabled=true;
  document.getElementById('openWalk').disabled=true;
}`);
html = replace(html, "setInterval(load,20000)", "if(window.INSIEME_API_ORIGIN)setInterval(load,20000)");

await mkdir(new URL("./docs/", import.meta.url), { recursive: true });
await writeFile(new URL("./docs/index.html", import.meta.url), html);
