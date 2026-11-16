# Insieme Trento

App per organizzare passeggiate tra cani in Trentino-Alto Adige. Il sito è pensato per telefono e PC.

## Pubblicazione

L'interfaccia statica vive in `docs/` ed è pronta per GitHub Pages dal ramo `main`. Le API per profili, passeggiate, richieste e chat sono in `worker.mjs` e usano Cloudflare Workers e D1. Il database parte vuoto.

1. Accedi a Cloudflare con Wrangler e crea un database: `npx wrangler d1 create appcani`.
2. Copia `wrangler.example.toml` in `wrangler.toml` e inserisci l'ID del nuovo database. Per un dominio personalizzato aggiorna anche `PAGES_ORIGIN`.
3. Applica lo schema: `npx wrangler d1 migrations apply appcani --remote`.
4. Con `npx wrangler secret put LOCATION_MASK_KEY`, imposta un segreto casuale di almeno 32 byte. Conserva il segreto in Cloudflare.
5. Distribuisci l'API con `npx wrangler deploy` e inserisci la sua origine HTTPS in `docs/config.js`.
6. Su GitHub, attiva Pages da `main` → `/docs`. Con GitHub Free la sorgente Pages deve trovarsi in un repository pubblico.

Modifica l'interfaccia in `worker.mjs`, poi rigenera e salva `docs/index.html` con `node build.mjs`.

I profili in questa versione beta sono legati al browser in cui vengono creati. L'API mostra una zona approssimativa. L'organizzatore può condividere l'indirizzo esatto dopo l'accettazione di una richiesta.
