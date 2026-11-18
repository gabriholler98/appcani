import { readFile, writeFile } from "node:fs/promises";
import { page } from "./layout.mjs";

const siteUrl = "https://gabriholler98.github.io/appcani/";
const lightLogo = "assets/dogs-in-giro-logo-light.png?v=2";
const icon = "assets/dogs-in-giro-miniatura-light.png?v=2";
const config = await readFile(new URL("./docs/config.js",import.meta.url),"utf8");
const api = new URL(config.match(/INSIEME_API_ORIGIN\s*=\s*"([^"]+)"/)?.[1]??"");
const head = `
  <script src="./config.js"></script>
  <title>Dogs in Giro · Passeggiate tra cani</title>
  <meta name="description" content="Organizza passeggiate tra cani in Trentino-Alto Adige.">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f6f8f2" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121b17" media="(prefers-color-scheme: dark)">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; img-src 'self' blob: data: https://tile.openstreetmap.org https://unpkg.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://nominatim.openstreetmap.org ${api.origin}; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Dogs in Giro">
  <meta property="og:description" content="Organizza passeggiate tra cani in Trentino-Alto Adige.">
  <meta property="og:url" content="${siteUrl}">
  <meta property="og:image" content="${siteUrl}${icon}">
  <meta property="og:image:alt" content="Una zampa dentro un segnaposto verde">
  <meta name="twitter:card" content="summary">
  <link rel="icon" type="image/png" href="./${icon}">
  <link rel="icon" type="image/png" href="./assets/dogs-in-giro-miniatura.png" media="(prefers-color-scheme: dark)">
  <link rel="apple-touch-icon" href="./${icon}">
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&amp;display=swap">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
  <link rel="stylesheet" href="./assets/brand.css?v=11">`;
const brand = `<picture class="brand">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/dogs-in-giro-logo.png">
  <img src="./${lightLogo}" width="2148" height="732" alt="Dogs in Giro">
</picture>`;
const account = await readFile(new URL("./account-layout.html",import.meta.url),"utf8");
const html = page.replace("<!-- head -->",()=>head).replace("<!-- account -->",()=>account)
  .replaceAll("<!-- brand -->",()=>brand).replace("<!-- year -->",String(new Date().getFullYear()));
await writeFile(new URL("./docs/index.html",import.meta.url),html);
