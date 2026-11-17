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

const siteUrl = "https://gabriholler98.github.io/appcani/";
const brandHead = `
<script src="./config.js"></script>
<title>Dogs in Giro · Passeggiate tra cani</title>
<meta name="description" content="Organizza passeggiate tra cani in Trentino-Alto Adige.">
<meta name="theme-color" content="#07110e">
<meta property="og:type" content="website">
<meta property="og:title" content="Dogs in Giro">
<meta property="og:description" content="Organizza passeggiate tra cani in Trentino-Alto Adige.">
<meta property="og:url" content="${siteUrl}">
<meta property="og:image" content="${siteUrl}assets/dogs-in-giro-miniatura.png">
<meta property="og:image:alt" content="Una zampa dentro un segnaposto verde su fondo nero">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" href="./assets/dogs-in-giro-miniatura.png">
<link rel="apple-touch-icon" href="./assets/dogs-in-giro-miniatura.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&amp;display=swap">
`;
const brandMarkup = '<div class="brand"><img src="./assets/dogs-in-giro-logo.png" width="2148" height="732" alt="Dogs in Giro"></div>';
let html = replace(page, "<title>Insieme · passeggiate tra cani</title>", brandHead);
html = replace(html, '</head>', '<link rel="stylesheet" href="./assets/brand.css">\n</head>');
html = replace(html, '<div class="brand"><b>🐕🐶</b>insieme</div>', brandMarkup);
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
