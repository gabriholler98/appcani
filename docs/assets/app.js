import { setupAccounts } from "./account-client.js?v=3";
import { currentPushEndpoint, setupNotifications } from "./notification-client.js";

const byId = id => document.getElementById(id);
const app = byId("appView");
const profileDialog = byId("profileDialog");
const profileForm = byId("profileForm");
const walkDialog = byId("walkDialog");
const walkForm = byId("walkForm");
let map;
let markers;
let chatTimer;
let selectedWalk;
let locationChoice;
let locationMode = "popular";
let currentProfile;
let loadId = 0;
let archiveLoadId = 0;
const archive = byId("archiveDialog");
const archiveFilters = document.querySelectorAll("[data-archive-filter]");
let archiveFilter = "created";

const accounts = setupAccounts({ openProfile, showApp, closeApp, currentPushEndpoint });
const api = accounts.api;
const notifications = setupNotifications(api);

function announce(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(announce.timeout);
  announce.timeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function openProfile(profile) {
  profileForm.reset();
  for (const field of ["owner", "dog", "breed", "birth", "size", "energy", "emoji"]) {
    if (profile) profileForm.elements[field].value = profile[field];
  }
  profileDialog.showModal();
}

function showApp(profile) {
  currentProfile = profile;
  byId("myEmoji").textContent = profile.emoji;
  byId("myDog").textContent = profile.dog;
  byId("myDetails").textContent = profile.breed + " · " + profile.size.toLowerCase();
  byId("editProfile").textContent = "Modifica profilo";
  app.hidden = false;
  if (!map && window.L) {
    map = window.L.map("map", { zoomControl: false }).setView([46.45, 11.25], 9);
    window.L.control.zoom({ position: "topright" }).addTo(map);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    markers = window.L.layerGroup().addTo(map);
  }
  map?.invalidateSize();
  void loadWalks();
  const url = new URL(window.location.href);
  if (url.searchParams.get("avvisi") === "1") {
    url.searchParams.delete("avvisi");
    history.replaceState(history.state, "", url);
    notifications.open();
  }
}

function closeApp() {
  currentProfile = null;
  loadId += 1;
  app.hidden = true;
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  notifications.reset();
  clearInterval(chatTimer);
  selectedWalk = null;
  walkForm.reset();
  locationChoice = null;
  locationMode = "popular";
  document.querySelectorAll("[data-mode]").forEach(control => {
    control.classList.toggle("active", control.dataset.mode === "popular");
  });
  byId("popularFields").hidden = false;
  byId("addressFields").hidden = true;
  byId("addressResult").textContent = "";
  byId("walks").replaceChildren();
  byId("requestBox").replaceChildren();
  byId("count").textContent = "";
  archiveLoadId += 1;
  byId("archiveList").replaceChildren();
  archiveNotice();
  markers?.clearLayers();
}

function element(tag, text, className) {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  return item;
}

function button(text, action, className = "primary") {
  const item = element("button", text, className);
  item.type = "button";
  item.onclick = action;
  return item;
}

function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours && hours + " h", remainder && remainder + " min"].filter(Boolean).join(" ");
}

async function loadWalks() {
  if (!currentProfile || document.hidden) return;
  const id = ++loadId;
  try {
    const data = await api("/api/walks");
    if (id !== loadId) return;
    showWalks(data.walks);
    showRequests(data.requests);
    notifications.updateUnread(data.unread_notifications);
  } catch (failure) {
    if (id === loadId && currentProfile) announce(failure.message);
  }
}

function showWalks(walks) {
  const list = byId("walks");
  list.replaceChildren();
  markers?.clearLayers();
  byId("count").textContent = walks.length ? walks.length + " disponibili" : "nessuna per ora";
  if (!walks.length) list.append(element("div", "Ancora nessuna passeggiata. Crea la prima!", "empty"));
  for (const walk of walks) {
    if (markers) {
      const coordinates = [walk.latitude, walk.longitude];
      window.L.circle(coordinates, { radius: 500, color: "#08654b", fillOpacity: 0.14 }).addTo(markers);
      const icon = element("div", walk.emoji, "map-dog");
      const popup = element("p", walk.title + " · " + walk.area_label);
      window.L.marker(coordinates, {
        icon: window.L.divIcon({ className: "", html: icon, iconSize: [35, 35], iconAnchor: [17, 17] }),
      }).addTo(markers).bindPopup(popup);
    }
    const card = element("article", "", "card");
    card.append(
      element("h3", walk.title),
      element("p", walk.dog_name + " " + walk.emoji + " · " + walk.breed + " · taglia " + walk.size.toLowerCase()),
      element("p", "📅 " + walk.day + " · " + walk.time + " · " + durationLabel(walk.duration_minutes)),
      element("p", "Fino a " + walk.max_participants + " amico/i"),
      element("p", "📍 " + walk.area_label + (walk.reveal_exact ? " · luogo sbloccato" : "")),
    );
    const actions = element("footer", "");
    actions.append(element("span", walk.city, "status"));
    if (walk.is_host) {
      actions.append(button("Annulla", () => {
        if (confirm("Annullare questa passeggiata?")) return act("/api/cancel", { walk_id: walk.id }, "Passeggiata annullata");
      }, "cancel"));
    } else if (walk.request_status === "accepted") {
      actions.append(button("Apri chat", () => openChat(walk.id)));
    } else if (walk.request_status === "pending") {
      actions.append(element("span", "Richiesta inviata", "status"));
    } else {
      actions.append(button("Chiedi di unirti", () => act("/api/join", { walk_id: walk.id }, "Richiesta inviata")));
    }
    card.append(actions);
    list.append(card);
  }
}

function showRequests(requests) {
  const list = byId("requestBox");
  list.replaceChildren(element("strong", "Richieste ricevute"));
  if (!requests.length) list.append(element("p", "Qui compariranno le richieste per le tue passeggiate.", "muted"));
  for (const request of requests) {
    const row = element("div", "", "request");
    const data = { walk_id: request.walk_id, request_id: request.id };
    row.append(element("b", request.dog_name + " " + request.emoji), element("p", request.title, "muted"));
    if (request.status === "pending") {
      row.append(button("Accetta", () => act("/api/requests/action", data, "Richiesta accettata"), "outline"));
    } else {
      row.append(button("Chat", () => openChat(request.walk_id), "outline"));
      if (request.details_released) row.append(element("span", " Indirizzo inviato", "muted"));
      else row.append(button("Invia indirizzo", () => {
        if (confirm("Inviare l’indirizzo completo al partecipante?")) return act("/api/reveal", data, "Indirizzo inviato");
      }, "outline"));
    }
    list.append(row);
  }
}

async function act(path, data, success) {
  try {
    await api(path, { data });
    announce(success);
    await loadWalks();
  } catch (failure) {
    announce(failure.message);
  }
}

function archiveNotice(message = "") {
  const status = byId("archiveNotice");
  status.textContent = message;
  status.hidden = !message;
}

function renderArchive(walks) {
  const list = byId("archiveList");
  if (!walks.length) {
    list.replaceChildren(element("p", "Nessuna passeggiata in questo filtro.", "empty"));
    return;
  }
  list.replaceChildren(...walks.map(walk => {
    const card = element("article", "", "card archive-card");
    card.append(element("h3", walk.title),
      element("p", walk.dog_name + " " + walk.emoji + " · " + walk.city),
      element("p", walk.day + " · " + walk.time + " · " + durationLabel(walk.duration_minutes)));
    const actions = element("footer", "");
    const status = walk.status === "cancelled" ? "Annullata"
      : archiveFilter === "requests" ? "Non accettata" : "Conclusa";
    actions.append(element("span", status, "status"));
    if (walk.can_chat) actions.append(button("Apri chat", () => openChat(walk.id, true), "primary"));
    if (walk.is_host) actions.append(button("Elimina definitivamente", () => deleteArchivedWalk(walk), "cancel archive-delete"));
    card.append(actions);
    return card;
  }));
}

async function loadArchive() {
  if (!currentProfile || !archive.open || document.hidden) return;
  const load = ++archiveLoadId;
  try {
    const { walks } = await api("/api/walks/archive?filter=" + encodeURIComponent(archiveFilter));
    if (load === archiveLoadId && archive.open) renderArchive(walks);
  } catch (failure) {
    if (load === archiveLoadId && archive.open) archiveNotice(failure.message);
  }
}

function selectArchive(filter) {
  archiveFilter = filter;
  archiveFilters.forEach(item => item.setAttribute("aria-pressed", String(item.dataset.archiveFilter === filter)));
  byId("archiveList").replaceChildren(element("p", "Caricamento…", "muted"));
  archiveNotice();
  void loadArchive();
}

byId("openArchive").onclick = () => {
  archive.showModal();
  selectArchive("created");
};
archiveFilters.forEach(item => { item.onclick = () => selectArchive(item.dataset.archiveFilter); });

async function deleteArchivedWalk(walk) {
  if (!confirm("Eliminare definitivamente «" + walk.title + "»? La passeggiata, le richieste e la chat spariranno anche per gli altri partecipanti.")) return;
  try {
    await api("/api/walks/delete", { data: { walk_id: walk.id } });
    archiveNotice("Passeggiata eliminata definitivamente.");
    await loadArchive();
  } catch (failure) {
    archiveNotice(failure.message);
  }
}

byId("editProfile").onclick = () => openProfile(currentProfile);
profileForm.onsubmit = async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await accounts.saveProfile(Object.fromEntries(new FormData(profileForm)));
    profileDialog.close();
    announce("Profilo salvato sull’account");
  } catch (failure) {
    announce(failure.message);
  } finally {
    submit.disabled = false;
  }
};

document.querySelectorAll("[data-close]").forEach(control => {
  control.onclick = () => byId(control.dataset.close).close();
});

byId("openWalk").onclick = () => walkDialog.showModal();
document.querySelectorAll("[data-mode]").forEach(control => {
  control.onclick = () => {
    locationMode = control.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach(option => option.classList.toggle("active", option === control));
    byId("popularFields").hidden = locationMode !== "popular";
    byId("addressFields").hidden = locationMode !== "address";
  };
});

walkForm.elements.address.oninput = () => {
  locationChoice = null;
  byId("addressResult").textContent = "";
};
byId("findAddress").onclick = async () => {
  const address = walkForm.elements.address.value.trim();
  if (!address) return announce("Inserisci un indirizzo");
  const result = byId("addressResult");
  result.textContent = "Ricerca in corso…";
  const query = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "it", q: address });
  try {
    const response = await fetch("https://nominatim.openstreetmap.org/search?" + query);
    const [place] = await response.json();
    if (!place) throw new Error("Not found");
    if (walkForm.elements.address.value.trim() !== address) return;
    locationChoice = { area_label: place.display_name, latitude: Number(place.lat), longitude: Number(place.lon) };
    result.textContent = "Trovato: " + locationChoice.area_label;
  } catch {
    result.textContent = "Indirizzo non trovato. Prova con città e numero civico.";
  }
};

walkForm.onsubmit = async event => {
  event.preventDefault();
  const { title, city, day, time, max, popular, duration_minutes } = Object.fromEntries(new FormData(walkForm));
  let coordinates = locationChoice;
  if (locationMode === "popular") {
    const [area_label, latitude, longitude] = popular.split("|");
    coordinates = { area_label, latitude: Number(latitude), longitude: Number(longitude) };
  }
  if (!coordinates) return announce("Cerca prima l’indirizzo");
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await api("/api/walk", { data: { title, city, day, time, max: Number(max), duration_minutes: Number(duration_minutes), ...coordinates } });
    walkDialog.close();
    walkForm.reset();
    locationChoice = null;
    byId("addressResult").textContent = "";
    announce("Passeggiata pubblicata");
    await loadWalks();
  } catch (failure) {
    announce(failure.message);
  } finally {
    submit.disabled = false;
  }
};

const chat = byId("chatDialog");
const chatForm = byId("chatForm");
const chatMessages = byId("chatMessages");
function setChatReadOnly(readOnly) {
  chatForm.hidden = readOnly;
  byId("chatArchived").hidden = !readOnly;
}

function openChat(walkId, archived = false) {
  selectedWalk = walkId;
  chatMessages.replaceChildren();
  chatForm.reset();
  setChatReadOnly(archived);
  chat.showModal();
  void refreshChat();
  chatTimer = setInterval(refreshChat, 8000);
}

chat.onclose = () => {
  clearInterval(chatTimer);
  selectedWalk = null;
  chatMessages.replaceChildren();
};

async function refreshChat() {
  const walk = selectedWalk;
  if (!walk || !currentProfile || document.hidden) return;
  try {
    const { messages, read_only } = await api("/api/messages?walk_id=" + encodeURIComponent(walk));
    if (!chat.open || selectedWalk !== walk) return;
    setChatReadOnly(read_only);
    const nodes = messages.map(message => {
      const row = element("p", "");
      row.append(element("b", message.emoji + " " + message.dog_name), document.createElement("br"), document.createTextNode(message.body));
      return row;
    });
    chatMessages.replaceChildren(...(nodes.length ? nodes : [element("p", "Nessun messaggio ancora.", "muted")]));
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (failure) {
    if (!chat.open || selectedWalk !== walk) return;
    if (failure.status === 403) {
      chat.close();
      if (archive.open) {
        archiveNotice(failure.message);
        void loadArchive();
      } else {
        announce(failure.message);
        void loadWalks();
      }
    } else {
      announce(failure.message);
    }
  }
}

chatForm.onsubmit = async event => {
  event.preventDefault();
  const message = chatForm.elements.message.value.trim();
  if (!message || !selectedWalk) return;
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await api("/api/messages", { data: { walk_id: selectedWalk, text: message } });
    chatForm.reset();
    await refreshChat();
  } catch (failure) {
    announce(failure.message);
  } finally {
    submit.disabled = false;
  }
};

function refreshHome() {
  void loadWalks();
  if (archive.open && !chat.open) void loadArchive();
}

setInterval(refreshHome, 20000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  refreshHome();
  if (chat.open) void refreshChat();
});
void accounts.restore();
