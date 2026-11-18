import { announce,busy,button,element,status as messageStatus } from "./ui.js?v=8";

const workerUrl = new URL("../service-worker.js", import.meta.url);
const byId = id => document.getElementById(id);
const labels = {
  join: "Nuova richiesta di partecipazione",
  accepted: "Richiesta accettata",
  cancelled: "Passeggiata annullata",
  chat: "Nuovo messaggio in chat",
  changed: "Passeggiata modificata",
  withdrawn: "Partecipazione ritirata",
  rejected: "Richiesta rifiutata",
  friend_request:"Richiesta di amicizia",
  friend_accepted:"Amicizia accettata",
  admin:"Avviso dall’amministrazione",
  report:"Segnalazione aggiornata",
};
const dateFormat = new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" });

export async function currentPushEndpoint() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration(workerUrl);
    return (await registration?.pushManager?.getSubscription())?.endpoint;
  } catch {
    return undefined;
  }
}

export function setupNotifications(api, {openItem,preferences,setPreferences}) {
  const dialog = byId("notificationsDialog");
  const bell = byId("openNotifications");
  const badge = byId("unreadNotifications");
  const list = byId("notificationsList");
  const status = byId("notificationsStatus");
  const toggle = byId("pushToggle");
  const help = byId("pushHelp");
  const mark = byId("markNotificationsRead");
  const test = byId("pushTest");
  const pushForm = byId("pushPreferences");
  let generation = 0;
  let requestId = 0;
  let latestId;
  let unread = 0;
  let push;

  function showStatus(message = "") {
    status.textContent = message;
    status.hidden = !message;
  }

  function updateUnread(count, refresh = true) {
    if (!Number.isSafeInteger(count)) return;
    const changed = count !== unread;
    unread = count;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count === 0;
    bell.setAttribute("aria-label", count === 1 ? "Notifiche, 1 da leggere"
      : count > 0 ? "Notifiche, " + count + " da leggere" : "Notifiche");
    if (changed && refresh && dialog.open) void load();
  }

  async function load() {
    const id = ++requestId;
    try {
      const data = await api("/api/notifications");
      if (id !== requestId || !dialog.open) return;
      latestId = data.items.map(item=>item.id);
      updateUnread(data.unread, false);
      list.replaceChildren();
      for (const item of data.items) {
        const row = document.createElement("li");
        row.classList.toggle("unread", item.read_at === null);
        const heading = document.createElement("strong");
        heading.textContent = (item.read_at === null ? "Da leggere · " : "") + labels[item.kind];
        const walk = document.createElement("span");
        walk.textContent = item.title;
        const time = document.createElement("time");
        const date = new Date(item.created_at * 1000);
        time.dateTime = date.toISOString();
        time.textContent = dateFormat.format(date);
        time.className="muted";
        row.append(heading,walk,time);
        if (item.details) row.append(element("p",item.details,"muted"));
        row.append(button(item.kind==="admin"?"Segna come letto":item.kind==="report"?"Vedi segnalazioni":
          item.kind.startsWith("friend_")?"Vedi amicizie":item.kind==="chat"?"Apri chat":item.kind==="join"||item.kind==="withdrawn"?"Vedi richieste":"Vedi passeggiata",
          control=>busy(control,async()=>{
            if (item.read_at===null) {
              const next=await api("/api/notifications/read",{data:{id:item.id}});
              updateUnread(next.unread,false);
            }
            dialog.close();
            await openItem(item);
          }),"text-button"));
        list.append(row);
      }
      mark.disabled = !unread || !latestId;
      showStatus(list.childElementCount ? "" : "Nessun avviso negli ultimi 30 giorni.");
    } catch (error) {
      if (id === requestId && dialog.open) showStatus(error.message);
    }
  }

  function showPushState() {
    test.hidden=!push.enabled;
    toggle.textContent = push.enabled ? "Disattiva notifiche push" : "Attiva notifiche push";
    toggle.disabled = !push.enabled && Notification.permission === "denied";
    help.textContent = push.enabled ? "Notifiche push attive su questo dispositivo."
      : toggle.disabled ? "Le notifiche sono bloccate. Puoi consentirle dalle impostazioni del browser."
      : "Ricevi un avviso su questo dispositivo anche quando l’app è chiusa.";
  }

  async function preparePush() {
    const version = generation;
    push = undefined;
    toggle.textContent = "Attiva notifiche push";
    toggle.disabled = true;
    test.hidden=true;
    if (!navigator.serviceWorker || !window.PushManager || !window.Notification) {
      help.textContent = "Su iPhone e iPad, aggiungi l’app alla schermata Home e aprila da lì. Sugli altri dispositivi usa un browser che supporta le notifiche push.";
      return;
    }
    help.textContent = "Verifica delle notifiche push…";
    try {
      const [settings, registration] = await Promise.all([
        api("/api/notifications/push-settings"),
        navigator.serviceWorker.register(workerUrl).then(() => navigator.serviceWorker.ready),
      ]);
      if (!settings.key) throw new Error("Le notifiche push sono temporaneamente indisponibili.");
      const key = Uint8Array.from(atob(settings.key.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
      const subscription = await registration.pushManager.getSubscription();
      const enabled = subscription && (await api("/api/notifications/device/check", { data: { endpoint: subscription.endpoint } })).enabled;
      if (version !== generation || !dialog.open) return;
      push = { registration, key, subscription, enabled };
      showPushState();
    } catch {
      if (version === generation && dialog.open) help.textContent = "Impossibile configurare le notifiche push. Chiudi e riapri questa schermata per riprovare.";
    }
  }

  toggle.onclick = async () => {
    if (!push || toggle.disabled) return;
    const current = push;
    const version = generation;
    toggle.disabled = true;
    try {
      if (current.enabled) {
        await api("/api/notifications/device/disable", { data: { endpoint: current.subscription.endpoint } });
        current.enabled = false;
        if (await current.subscription.unsubscribe().catch(() => false)) current.subscription = null;
      } else {
        current.subscription ??= await current.registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: current.key,
        });
        if (version !== generation) return;
        await api("/api/notifications/device/enable", { data: { endpoint: current.subscription.endpoint } });
        current.enabled = true;
      }
      if (version === generation && push === current) showPushState();
    } catch (error) {
      if (version !== generation || push !== current) return;
      showPushState();
      if (!toggle.disabled) help.textContent = error.status ? error.message : "Impossibile aggiornare le notifiche push. Riprova.";
    }
  };

  test.onclick=control=>{
    if (!push?.enabled || !push.subscription) return;
    void busy(control.currentTarget,async()=>{
      await api("/api/notifications/device/test",{data:{endpoint:push.subscription.endpoint}});
      help.textContent="Invio accettato. Controlla le notifiche di questo dispositivo.";
    },failure=>{help.textContent=failure.message;});
  };

  function showPreferences() {
    const target=byId("pushKinds");
    const muted=preferences();
    target.replaceChildren(...Object.entries(labels).filter(([kind])=>!["admin","report"].includes(kind)).map(([kind,label])=>{
      const checkbox=element("input");
      checkbox.type="checkbox";
      checkbox.name="enabled";
      checkbox.value=kind;
      checkbox.checked=!muted.includes(kind);
      const option=element("label","","check");
      option.append(checkbox,document.createTextNode(label));
      return option;
    }));
    messageStatus(pushForm.querySelector(".form-error"));
  }
  pushForm.onsubmit=event=>{
    event.preventDefault();
    const formMessage=pushForm.querySelector(".form-error");
    void busy(event.submitter,async()=>{
      const enabled=new Set(new FormData(pushForm).getAll("enabled"));
      const {muted}=await api("/api/notifications/preferences",{data:{muted:Object.keys(labels).filter(kind=>!["admin","report"].includes(kind)&&!enabled.has(kind))}});
      setPreferences(muted);
      messageStatus(formMessage);
      announce("Preferenze salvate.");
    },failure=>messageStatus(formMessage,failure.message));
  };

  mark.onclick = async () => {
    const version = generation;
    mark.disabled = true;
    try {
      await api("/api/notifications/read", { data: { ids: latestId } });
      if (version === generation) await load();
    } catch (error) {
      if (version === generation && dialog.open) {
        showStatus(error.message);
        mark.disabled = false;
      }
    }
  };

  function open() {
    if (dialog.open) return;
    list.replaceChildren();
    latestId = undefined;
    mark.disabled = true;
    showStatus("Caricamento…");
    showPreferences();
    dialog.showModal();
    void load();
    void preparePush();
  }

  bell.onclick = open;
  return {
    open,
    updateUnread,
    reset() {
      generation += 1;
      requestId += 1;
      push = undefined;
      latestId = undefined;
      list.replaceChildren();
      updateUnread(0, false);
    },
  };
}

