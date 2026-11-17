import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { page } from "./layout.mjs";

function replace(source, target, value) {
  if (!source.includes(target)) throw new Error("Elemento dell'interfaccia mancante: " + target);
  return source.replace(target, () => value);
}

const siteUrl = "https://gabriholler98.github.io/appcani/";
const lightLogo = "assets/dogs-in-giro-logo-light.png?v=2";
const lightThumbnail = "assets/dogs-in-giro-miniatura-light.png?v=2";
const config = await readFile(new URL("./docs/config.js", import.meta.url), "utf8");
const apiUrl = new URL(config.match(/INSIEME_API_ORIGIN\s*=\s*"([^"]+)"/)?.[1] ?? "");
const brandHead = `
<script src="./config.js"></script>
<title>Dogs in Giro · Passeggiate tra cani</title>
<meta name="description" content="Organizza passeggiate tra cani in Trentino-Alto Adige.">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f8f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101a16" media="(prefers-color-scheme: dark)">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://nominatim.openstreetmap.org ${apiUrl.origin}; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta property="og:type" content="website">
<meta property="og:title" content="Dogs in Giro">
<meta property="og:description" content="Organizza passeggiate tra cani in Trentino-Alto Adige.">
<meta property="og:url" content="${siteUrl}">
<meta property="og:image" content="${siteUrl}${lightThumbnail}">
<meta property="og:image:alt" content="Una zampa dentro un segnaposto verde">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" href="./${lightThumbnail}">
<link rel="icon" type="image/png" href="./assets/dogs-in-giro-miniatura.png" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="./${lightThumbnail}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&amp;display=swap">
`;
const brandMarkup = `<picture class="brand">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/dogs-in-giro-logo.png">
  <img src="./${lightLogo}" width="2148" height="732" alt="Dogs in Giro">
</picture>`;
let html = replace(page, "<title>Insieme · passeggiate tra cani</title>", brandHead);
html = replace(html, '</head>', '<link rel="stylesheet" href="./assets/brand.css?v=2">\n</head>');
html = replace(html, '<div class="brand"><b>🐕🐶</b>insieme</div>', brandMarkup);
const accountTemplate = await readFile(new URL("./account-layout.html", import.meta.url), "utf8");
const accountMarkup = replace(accountTemplate, "<!-- brand -->", brandMarkup);
html = replace(html, '<body><div class="app">', `<body>${accountMarkup}<div class="app" id="appView" hidden>`);
html = replace(html, '<p class="tag">Passeggiate che iniziano dal cane.</p>', '<div class="account-bar"><span id="currentUser"></span><button type="button" class="outline" data-logout>Esci</button></div>');
html = replace(html, '<section class="requests" id="requestBox">', '<button class="outline archive-entry" type="button" id="openArchive">Le mie passeggiate</button><section class="requests" id="requestBox">');
html = replace(html, '<input name="time" type="time" required value="18:00"></label>', '<input name="time" type="time" required value="18:00"></label><label>Durata prevista (minuti)<input name="duration_minutes" type="number" min="5" max="1440" step="1" value="60" required inputmode="numeric"></label>');
html = replace(html, 'Sarà visibile agli amici che aprono questo stesso link.', 'Il nome, la razza e la taglia del cane compaiono sulle passeggiate che pubblichi.');
html = replace(html, 'max="2026"', 'max="' + new Date().getFullYear() + '"');
html = replace(html, '</body>', '<script type="module" src="./assets/app.js"></script>\n</body>');

await mkdir(new URL("./docs/", import.meta.url), { recursive: true });
await writeFile(new URL("./docs/index.html", import.meta.url), html);
