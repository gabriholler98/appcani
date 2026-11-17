# Dogs in Giro

App per organizzare passeggiate tra cani in Trentino-Alto Adige. Il sito è pensato per telefono e PC.

## Pubblicazione

L'interfaccia statica vive in `docs/` e viene pubblicata da GitHub Pages dal ramo `main`. Le API usano Cloudflare Workers e D1.

1. Accedi a Cloudflare con Wrangler e crea un database: `npx wrangler d1 create appcani`.
2. Copia `wrangler.example.toml` in `wrangler.toml` e inserisci l'ID del nuovo database. Per un dominio personalizzato aggiorna anche `PAGES_ORIGIN`.
3. Applica lo schema: `npx wrangler d1 migrations apply appcani --remote`.
4. Imposta `LOCATION_MASK_KEY` e `PASSWORD_PEPPER` come segreti distinti in Cloudflare. Genera almeno 32 byte casuali per ciascuno. Conserva `PASSWORD_PEPPER` tra le pubblicazioni perché serve a verificare gli accessi esistenti.
5. Distribuisci l'API, inserisci la sua origine HTTPS in `docs/config.js` e rigenera la pagina con `node build.mjs`.
6. Su GitHub, attiva Pages da `main` → `/docs`. Con GitHub Free la sorgente Pages deve trovarsi in un repository pubblico.

Modifica la struttura in `layout.mjs` o `account-layout.html`, poi rigenera `docs/index.html` con `node build.mjs`. Esegui il test di integrazione con `node --test tests/accounts.test.mjs` su Node.js 24.

Ogni account ha un profilo proprietario e può gestire fino a 12 cani. Ogni foto viene ridimensionata e conservata in D1 come JPEG, fino a 80 KB. Le passeggiate contano i cani dell’organizzatore e quelli già confermati. L'API mostra una zona approssimativa. L'organizzatore può condividere il luogo esatto dopo l'accettazione e deve condividerlo di nuovo se lo modifica.

La migrazione `0005_owners_and_walks.sql` crea il primo cane a partire dai profili esistenti, converte la capienza da numero di ospiti a numero totale di cani e conserva richieste, avvisi e cronologia. Le segnalazioni sono disponibili nella tabella `reports` del database. Il recupero account usa codici monouso generati dalle impostazioni.

Le passkey richiedono la migrazione `0006_passkeys.sql`. Vengono registrate per l'host indicato in `PAGES_ORIGIN`. I moduli WebAuthn distribuiti sono inclusi nel repository con le relative licenze. Per rigenerarli, esegui `npm ci` e `npm run build:webauthn`.

## Notifiche

La campanella mostra gli avvisi degli ultimi 30 giorni. Le notifiche push sono facoltative e si attivano su ciascun dispositivo dalla campanella. Su iPhone e iPad occorre aprire l’app dalla schermata Home.

Per abilitare le push, imposta sul Worker il segreto `VAPID_PRIVATE_JWK` con una chiave privata ECDSA P‑256 in formato JWK. Conserva la stessa chiave tra le pubblicazioni: i browser associano le sottoscrizioni alla sua chiave pubblica.
