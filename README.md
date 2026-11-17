# Dogs in Giro

App per organizzare passeggiate tra cani in Trentino-Alto Adige. Il sito è pensato per telefono e PC.

## Pubblicazione

L'interfaccia statica vive in `docs/` e viene pubblicata da GitHub Pages dal ramo `main`. Le API in `worker.mjs` e `accounts.mjs` usano Cloudflare Workers e D1.

1. Accedi a Cloudflare con Wrangler e crea un database: `npx wrangler d1 create appcani`.
2. Copia `wrangler.example.toml` in `wrangler.toml` e inserisci l'ID del nuovo database. Per un dominio personalizzato aggiorna anche `PAGES_ORIGIN`.
3. Applica lo schema: `npx wrangler d1 migrations apply appcani --remote`.
4. Imposta `LOCATION_MASK_KEY` e `PASSWORD_PEPPER` come segreti distinti in Cloudflare. Genera almeno 32 byte casuali per ciascuno. Conserva `PASSWORD_PEPPER` tra le pubblicazioni perché serve a verificare gli accessi esistenti.
5. Distribuisci l'API, inserisci la sua origine HTTPS in `docs/config.js` e rigenera la pagina con `node build.mjs`.
6. Su GitHub, attiva Pages da `main` → `/docs`. Con GitHub Free la sorgente Pages deve trovarsi in un repository pubblico.

Modifica la struttura in `layout.mjs` o `account-layout.html`, poi rigenera `docs/index.html` con `node build.mjs`. Esegui il test di integrazione con `node --test tests/accounts.test.mjs` su Node.js 24.

Ogni account ha un profilo del cane. Accedendo con lo stesso nome utente su un altro dispositivo si ritrovano il profilo, le passeggiate, le richieste e le chat. L'API mostra una zona approssimativa. L'organizzatore può condividere l'indirizzo esatto dopo l'accettazione di una richiesta.
