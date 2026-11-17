export const page = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <!-- head -->
</head>
<body>
  <!-- account -->
  <div class="app" id="appView" hidden>
    <aside class="sidebar">
      <!-- brand -->
      <nav class="navigation" aria-label="Navigazione principale">
        <button type="button" data-page="explore" aria-current="page"><span aria-hidden="true">⌖</span> Esplora</button>
        <button type="button" data-page="plans"><span aria-hidden="true">▤</span> Le mie<span class="desktop-only"> passeggiate</span><b id="requestBadge" class="badge" hidden></b></button>
        <button type="button" data-page="people"><span aria-hidden="true">⌕</span> Cerca</button>
        <button type="button" data-page="profile"><span aria-hidden="true">●</span> Profilo</button>
      </nav>
    </aside>
    <main id="mainContent" class="main">
      <header class="toolbar">
        <img src="./assets/dogs-in-giro-miniatura-light.png?v=2" width="40" height="40" alt="Dogs in Giro" class="mobile-icon">
        <h1 id="pageHeading" tabindex="-1">Esplora</h1>
        <button type="button" id="openNotifications" class="secondary toolbar-notice"><span aria-hidden="true">🔔</span><span class="desktop-only"> Notifiche</span><b id="unreadNotifications" class="badge" hidden></b></button>
      </header>
      <section id="explorePage" aria-label="Esplora">
        <div class="explore-bar">
          <div class="segment" aria-label="Vista delle passeggiate">
            <button type="button" id="mapView" aria-pressed="true">Mappa</button>
            <button type="button" id="listView" aria-pressed="false">Lista</button>
          </div>
          <button type="button" id="toggleFilters" class="secondary" aria-expanded="false" aria-controls="mapFilters">Filtri</button>
          <button type="button" id="openWalk" class="primary"><span aria-hidden="true">+</span> Crea<span class="desktop-only"> passeggiata</span></button>
        </div>
        <form id="mapFilters" class="panel flow" hidden>
          <div class="form-grid">
            <label>Città<input name="city" maxlength="40" placeholder="Es. Trento"></label>
            <label>Da<input name="day" type="date"></label>
            <label>A<input name="before" type="date"></label>
            <label>Taglia dei cani dell’organizzatore<select name="size"><option value="">Qualsiasi</option><option>Piccola</option><option>Media</option><option>Grande</option></select></label>
            <label>Distanza da te<select name="distance"><option value="">Qualsiasi</option><option value="5">Entro 5 km</option><option value="15">Entro 15 km</option><option value="30">Entro 30 km</option></select></label>
          </div>
          <div class="row">
            <label class="check"><input name="friends" type="checkbox"> Solo amici</label>
            <label class="check"><input name="full" type="checkbox"> Mostra anche le complete</label>
          </div>
          <p id="filterLocationStatus" class="form-error" role="status" hidden></p>
          <div class="actions"><button type="reset" class="secondary">Azzera</button><button class="primary">Applica</button></div>
        </form>
        <div class="map-card" id="mapPanel">
          <div id="map" aria-label="Mappa delle passeggiate"></div>
          <details class="map-info"><summary>Zona approssimativa ⓘ</summary><p>Il cerchio indica una zona di circa 500 m. L’organizzatore decide quando condividere il punto esatto con chi ha confermato.</p></details>
        </div>
        <p id="exploreStatus" class="muted" role="status"></p>
        <div id="walks" class="cards"></div>
      </section>
      <section id="plansPage" hidden>
        <div class="segment wrap" aria-label="Le mie passeggiate">
          <button type="button" data-plan="scheduled" aria-pressed="true">In programma</button>
          <button type="button" data-plan="received" aria-pressed="false">Ricevute</button>
          <button type="button" data-plan="sent" aria-pressed="false">Inviate</button>
          <button type="button" data-plan="archive" aria-pressed="false">Archivio</button>
        </div>
        <div id="archiveFilters" class="segment wrap archive-filters" hidden aria-label="Filtra archivio">
          <button type="button" data-archive="created" aria-pressed="true">Create da te</button>
          <button type="button" data-archive="requests" aria-pressed="false">Richieste</button>
          <button type="button" data-archive="attended" aria-pressed="false">Confermate</button>
        </div>
        <p id="plansStatus" class="muted" role="status"></p>
        <div id="plansList" class="cards"></div>
      </section>
      <section id="peoplePage" hidden>
        <form id="searchPeople" class="inline-form">
          <label>Cerca un proprietario o un cane<input name="q" type="search" minlength="2" maxlength="40" required></label>
          <button class="primary">Cerca</button>
        </form>
        <p id="peopleStatus" class="muted" role="status"></p>
        <div id="searchResults" class="flow"></div>
        <h2>Amici e richieste</h2>
        <div id="connectionsList" class="cards"></div>
      </section>
      <section id="profilePage" hidden>
        <div class="panel owner-card">
          <div><h2 id="ownerTitle"></h2><p id="currentUser" class="muted"></p></div>
          <button type="button" id="editOwner" class="secondary">Modifica profilo</button>
        </div>
        <div class="section-head"><h2>I tuoi cani</h2><button type="button" id="addDog" class="primary">+ Aggiungi cane</button></div>
        <div id="dogList" class="cards"></div>
        <div class="section-head"><h2>Account</h2><button type="button" data-account-settings class="secondary">Impostazioni</button></div>
        <button type="button" data-logout class="secondary">Esci</button>
      </section>
    </main>
  </div>
  <dialog class="modal" id="ownerDialog" aria-labelledby="ownerHeading"><article>
    <h2 id="ownerHeading">Il tuo profilo</h2>
    <form id="ownerForm" class="flow">
      <label>Nome visibile<input name="owner" required maxlength="30" autocomplete="nickname"></label>
      <div class="form-grid">
        <label>Fascia d’età<select name="age_group">
          <option value="">Preferisco non indicarla</option><option>18–24</option><option>25–34</option><option>35–44</option>
          <option>45–54</option><option>55–64</option><option>65+</option>
        </select></label>
        <label>Sesso<select name="gender">
          <option value="">Preferisco non indicarlo</option><option>Donna</option><option>Uomo</option><option>Altro</option>
        </select></label>
      </div>
      <label>Chi può vedere età e sesso<select name="visibility">
        <option value="friends">Solo gli amici</option><option value="members">Gli utenti dell’app</option><option value="private">Solo io</option>
      </select></label>
      <p class="form-error" role="status" hidden></p>
      <div class="actions"><button type="button" class="secondary" data-close="ownerDialog">Annulla</button><button class="primary">Salva</button></div>
    </form>
  </article></dialog>
  <dialog class="modal" id="dogDialog" aria-labelledby="dogHeading"><article>
    <h2 id="dogHeading">Scheda del cane</h2>
    <form id="dogForm" class="flow">
      <label id="setupOwner">Il tuo nome visibile<input name="owner" maxlength="30" autocomplete="nickname"></label>
      <div class="form-grid">
        <label>Nome del cane<input name="name" required maxlength="30"></label>
        <label>Razza o mix<input name="breed" required maxlength="45" placeholder="Es. Meticcio"></label>
        <label>Anno di nascita<input name="birth" type="number" min="1995" max="<!-- year -->" required inputmode="numeric"></label>
        <label>Taglia<select name="size"><option>Piccola</option><option selected>Media</option><option>Grande</option></select></label>
        <label>Energia<select name="energy"><option>Tranquilla</option><option selected>Media</option><option>Alta</option></select></label>
        <label>Simbolo<select name="emoji"><option>🐕</option><option>🐶</option><option>🐩</option><option>🦮</option></select></label>
      </div>
      <label>Note utili <span class="muted">(facoltative)</span><textarea name="notes" maxlength="300" rows="2" placeholder="Es. Preferisce gruppi piccoli"></textarea></label>
      <fieldset id="photoFields"><legend>Foto del cane</legend><img id="photoPreview" class="photo-preview" width="112" height="112" alt="Anteprima foto" hidden>
        <label>Scegli una foto da ritagliare<input name="photo" type="file" accept="image/*"></label>
        <label class="check" id="removePhoto" hidden><input name="removePhoto" type="checkbox"> Rimuovi la foto attuale</label>
      </fieldset>
      <p class="form-error" role="status" hidden></p>
      <div class="actions"><button type="button" class="secondary" data-close="dogDialog">Annulla</button><button class="primary">Salva cane</button></div>
    </form>
  </article></dialog>
  <dialog class="modal" id="walkDialog" aria-labelledby="walkHeading"><article>
    <h2 id="walkHeading">Crea una passeggiata</h2>
    <form id="walkForm" class="flow">
      <label>Titolo<input name="title" required maxlength="55"></label>
      <div class="form-grid">
        <label>Giorno<input name="day" type="date" required></label>
        <label>Ora<input name="time" type="time" required value="18:00"></label>
        <label>Durata (minuti)<input name="duration_minutes" type="number" min="5" max="1440" value="60" required inputmode="numeric"></label>
        <label>Capienza totale in cani<input name="max" type="number" min="1" max="24" value="3" required inputmode="numeric"></label>
      </div>
      <fieldset><legend>I cani che porti</legend><div id="hostDogs" class="choice-list"></div></fieldset>
      <label>Descrizione <span class="muted">(facoltativa)</span><textarea name="description" maxlength="500" rows="3" placeholder="Tipo di percorso e informazioni utili. L’indirizzo preciso va nel campo dedicato."></textarea></label>
      <fieldset><legend>Punto di ritrovo</legend>
        <label>Luogo suggerito<select name="popular">
          <option value="">Scegli un luogo o cerca un indirizzo</option>
          <option value="Piazza Fiera|Trento|46.0666|11.1258">Piazza Fiera · Trento</option>
          <option value="Parco delle Albere|Trento|46.0526|11.1141">Parco delle Albere · Trento</option>
          <option value="Parco Petrarca|Bolzano|46.5001|11.3484">Parco Petrarca · Bolzano</option>
          <option value="Lungo Passirio|Merano|46.6711|11.1591">Lungo Passirio · Merano</option>
          <option value="Campana dei Caduti|Rovereto|45.8880|11.0458">Campana dei Caduti · Rovereto</option>
        </select></label>
        <label>Oppure cerca un punto d’incontro<input name="address" maxlength="140" placeholder="Es. Piazza Fiera, Trento"></label>
        <button type="button" id="findAddress" class="secondary">Cerca indirizzo</button>
        <p id="addressResult" class="muted" role="status"></p>
        <div id="meetingMap" class="mini-map" hidden></div>
      </fieldset>
      <p class="form-error" role="status" hidden></p>
      <div class="actions"><button type="button" class="secondary" data-close="walkDialog">Annulla</button><button class="primary">Riepilogo</button></div>
    </form>
  </article></dialog>
  <dialog class="modal" id="summaryDialog" aria-labelledby="summaryHeading"><article>
    <h2 id="summaryHeading">Riepilogo passeggiata</h2><div id="walkSummary" class="flow"></div>
    <p id="summaryError" class="form-error" role="status" hidden></p>
    <div class="actions"><button type="button" class="secondary" data-close="summaryDialog">Torna al modulo</button><button type="button" id="confirmWalk" class="primary">Pubblica</button></div>
  </article></dialog>
  <dialog class="modal" id="detailsDialog" aria-labelledby="detailHeading"><article>
    <h2 id="detailHeading">Passeggiata</h2><div id="walkDetails" class="flow"></div>
    <div class="actions"><button type="button" class="secondary" data-close="detailsDialog">Chiudi</button></div>
  </article></dialog>
  <dialog class="modal" id="joinDialog" aria-labelledby="joinHeading"><article>
    <h2 id="joinHeading">Con quali cani vieni?</h2>
    <form id="joinForm" class="flow"><p id="joinCapacity" class="muted"></p><fieldset><legend>I tuoi cani</legend><div id="joinDogs" class="choice-list"></div></fieldset>
      <p class="form-error" role="status" hidden></p><div class="actions"><button type="button" class="secondary" data-close="joinDialog">Annulla</button><button class="primary">Invia richiesta</button></div>
    </form>
  </article></dialog>
  <dialog class="modal" id="personDialog" aria-labelledby="personHeading"><article>
    <h2 id="personHeading">Profilo</h2><div id="personCard" class="flow"></div>
    <div class="actions"><button type="button" class="secondary" data-close="personDialog">Chiudi</button></div>
  </article></dialog>
  <dialog class="modal" id="reportDialog" aria-labelledby="reportHeading"><article>
    <h2 id="reportHeading">Segnala</h2>
    <form id="reportForm" class="flow"><label>Motivo<textarea name="reason" maxlength="500" rows="4" required></textarea></label>
      <p class="form-error" role="status" hidden></p><div class="actions"><button class="secondary" type="button" data-close="reportDialog">Annulla</button><button class="primary">Invia segnalazione</button></div>
    </form>
  </article></dialog>
  <dialog class="modal" id="notificationsDialog" aria-labelledby="notificationsHeading"><article>
    <h2 id="notificationsHeading">Notifiche</h2>
    <p id="notificationsStatus" class="muted" role="status" hidden></p>
    <ul id="notificationsList" class="notification-list"></ul>
    <div class="notification-settings flow">
      <div class="row"><button class="secondary" type="button" id="pushToggle" disabled>Attiva notifiche push</button><button class="secondary" type="button" id="pushTest" hidden>Invia una prova</button></div>
      <p id="pushHelp" class="muted" role="status"></p>
      <details><summary>Preferenze push</summary><form id="pushPreferences" class="flow"><div id="pushKinds" class="choice-list"></div>
        <p class="form-error" role="status" hidden></p><button class="secondary">Salva preferenze</button></form></details>
    </div>
    <div class="actions"><button class="secondary" type="button" data-close="notificationsDialog">Chiudi</button><button class="secondary" type="button" id="markNotificationsRead" disabled>Segna come lette</button></div>
  </article></dialog>
  <dialog class="modal" id="chatDialog" aria-labelledby="chatHeading"><article>
    <h2 id="chatHeading">Chat della passeggiata</h2>
    <button class="secondary" id="olderMessages" type="button" hidden>Mostra messaggi precedenti</button>
    <div id="chatMessages" class="chat-messages" role="log" aria-label="Messaggi"></div>
    <button class="secondary" id="newMessages" type="button" hidden>Vai ai nuovi messaggi</button>
    <p id="chatArchived" class="muted" hidden>Passeggiata conclusa · chat in sola lettura.</p>
    <p id="chatStatus" class="muted" role="status" hidden></p>
    <form id="chatForm" class="chat-form"><input name="message" aria-label="Messaggio" maxlength="500" required placeholder="Scrivi un messaggio"><button class="primary">Invia</button></form>
    <div class="actions"><button class="secondary" type="button" data-close="chatDialog">Chiudi</button></div>
  </article></dialog>
  <div class="toast" id="toast" role="status" hidden></div>
  <script defer src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
  <script type="module" src="./assets/app.js?v=4"></script>
</body>
</html>`;
