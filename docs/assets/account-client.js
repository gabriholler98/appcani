const sessionKey = "dogs-in-giro-session-v1";
const encoder = new TextEncoder();
const byId = id => document.getElementById(id);

export async function passwordProof(username, password) {
  const salt = encoder.encode("dogs-in-giro:account:v1:" + username);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const result = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, hash: "SHA-256", iterations: 600000 }, key, 256);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
}

function showError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

export function setupAccounts({ openProfile, showApp, closeApp, currentPushEndpoint }) {
  const accountForm = byId("accountForm");
  const accountError = byId("accountError");
  const submit = byId("submitAccount");
  const accountPage = byId("accountScreen");
  const accountEntry = byId("accountEntry");
  const accountSetup = byId("accountSetup");
  const loading = byId("accountLoading");
  const logoutButtons = document.querySelectorAll("[data-logout]");
  let registering = false;
  let token = sessionStorage.getItem(sessionKey);
  let account = null;

  function setMode(next) {
    registering = next;
    const action = next ? "Registrati" : "Accedi";
    byId("chooseLogin").setAttribute("aria-pressed", String(!next));
    byId("chooseRegister").setAttribute("aria-pressed", String(next));
    byId("accountHeading").textContent = next ? "Crea il tuo account" : "Accedi al tuo account";
    byId("accountHint").hidden = !next;
    byId("passwordHint").hidden = !next;
    accountForm.elements.password.autocomplete = next ? "new-password" : "current-password";
    accountForm.elements.password.minLength = next ? 12 : 0;
    submit.textContent = action;
    showError(accountError);
  }

  function setView(view) {
    loading.hidden = view !== "loading";
    accountEntry.hidden = view !== "entry";
    accountSetup.hidden = view !== "setup";
    accountPage.hidden = view === "app";
    if (view !== "app") closeApp();
  }

  function clearSession(message) {
    token = null;
    account = null;
    sessionStorage.removeItem(sessionKey);
    accountForm.reset();
    accountForm.elements.password.type = "password";
    setMode(false);
    setView("entry");
    showError(accountError, message);
  }

  async function api(path, options = {}) {
    if (!window.INSIEME_API_ORIGIN) throw new Error("Il servizio online non è disponibile.");
    const currentToken = token;
    const headers = new Headers();
    if (options.data) headers.set("Content-Type", "application/json");
    if (currentToken && !options.public) headers.set("Authorization", "Bearer " + currentToken);
    const response = await fetch(new URL(path, window.INSIEME_API_ORIGIN), {
      method: options.method ?? (options.data ? "POST" : "GET"),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers,
      body: options.data ? JSON.stringify(options.data) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && !options.public && currentToken && currentToken === token) {
      clearSession("La sessione è scaduta. Accedi di nuovo.");
    }
    if (!response.ok) {
      const failure = new Error(result.error || "Il servizio online non è disponibile.");
      failure.status = response.status;
      throw failure;
    }
    if (!options.public && currentToken !== token) throw new Error("La sessione è cambiata.");
    return result;
  }

  function applyAccount(user) {
    account = user;
    if (!user.profile) {
      setView("setup");
      return;
    }
    setView("app");
    byId("currentUser").textContent = "@" + user.username;
    showApp(user.profile);
  }

  async function restore() {
    if (!token) {
      setView("entry");
      return;
    }
    try {
      applyAccount(await api("/api/auth/me"));
    } catch {
      if (token) clearSession("Impossibile raggiungere il servizio. Prova ad accedere di nuovo.");
    }
  }

  byId("chooseLogin").onclick = () => setMode(false);
  byId("chooseRegister").onclick = () => setMode(true);
  byId("showPassword").onchange = event => {
    accountForm.elements.password.type = event.target.checked ? "text" : "password";
  };
  accountForm.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const create = registering;
    submit.disabled = true;
    byId("chooseLogin").disabled = true;
    byId("chooseRegister").disabled = true;
    showError(accountError);
    try {
      const username = accountForm.elements.username.value.trim().toLowerCase();
      const proof = await passwordProof(username, accountForm.elements.password.value);
      const result = await api(create ? "/api/auth/register" : "/api/auth/login", { public: true, data: { username, proof } });
      token = result.token;
      sessionStorage.setItem(sessionKey, token);
      accountForm.reset();
      accountForm.elements.password.type = "password";
      if (create) applyAccount({ username: result.username, profile: null });
      else await restore();
    } catch (failure) {
      showError(accountError, failure.message);
    } finally {
      submit.disabled = false;
      byId("chooseLogin").disabled = false;
      byId("chooseRegister").disabled = false;
    }
  };

  byId("createAccountProfile").onclick = () => openProfile(null);
  logoutButtons.forEach(button => {
    button.onclick = async () => {
      logoutButtons.forEach(item => { item.disabled = true; });
      try {
        const endpoint = await currentPushEndpoint();
        await api("/api/auth/logout", { method: "POST", data: { endpoint } });
      } catch {
        // Local logout still works if the network is unavailable.
      } finally {
        clearSession();
        logoutButtons.forEach(item => { item.disabled = false; });
      }
    };
  });

  return {
    api,
    restore,
    async saveProfile(data) {
      const result = await api("/api/profile", { data });
      applyAccount({ ...account, profile: result.profile });
    },
  };
}
