import { startAuthentication,startRegistration } from "./webauthn-vendor.js";

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

export function setupAccounts({ openProfile, showApp, closeApp, currentPushEndpoint, announce }) {
  const accountForm = byId("accountForm");
  const accountError = byId("accountError");
  const submit = byId("submitAccount");
  const accountPage = byId("accountScreen");
  const accountEntry = byId("accountEntry");
  const accountSetup = byId("accountSetup");
  const loading = byId("accountLoading");
  const logoutButtons = document.querySelectorAll("[data-logout]");
  let registering = false;
  let token = sessionStorage.getItem(sessionKey) ?? localStorage.getItem(sessionKey);
  let account = null;
  const passkeysAvailable=Boolean(window.PublicKeyCredential && navigator.credentials?.get);
  let loginOptions=null;
  let registrationOptions=null;
  const passkeyForm=byId("passkeyForm");

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
    byId("passkeyLogin").hidden=registering||!passkeysAvailable;
    byId("confirmPasskeyLogin").hidden=true;
    loginOptions=null;
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
    localStorage.removeItem(sessionKey);
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
    if (options.body) headers.set("Content-Type", options.body.type);
    if (currentToken && !options.public) headers.set("Authorization", "Bearer " + currentToken);
    const response = await fetch(new URL(path, window.INSIEME_API_ORIGIN), {
      method: options.method ?? (options.data ? "POST" : "GET"),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers,
      body: options.data ? JSON.stringify(options.data) : options.body,
    });
    const result = response.ok && options.blob ? await response.blob() : await response.json().catch(() => ({}));
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
    if (!user.profile?.dogs?.length) {
      setView("setup");
      return;
    }
    setView("app");
    byId("currentUser").textContent = "@" + user.username;
    showApp(user.profile, user.username);
  }

  async function restore() {
    if (!token) {
      setView("entry");
      return;
    }
    try {
      applyAccount(await api("/api/auth/me"));
    } catch {
      if (token && account) applyAccount(account);
      else if (token) {
        setView("entry");
        showError(accountError, "Impossibile raggiungere il servizio. Riprova ad accedere.");
      }
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
      beginSession(result.token);
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

  function beginSession(value) {
    token=value;
    localStorage.removeItem(sessionKey);
    sessionStorage.removeItem(sessionKey);
    (accountForm.elements.remember.checked?localStorage:sessionStorage).setItem(sessionKey,token);
    accountForm.reset();
    accountForm.elements.password.type="password";
  }

  byId("createAccountProfile").onclick = () => openProfile(account?.profile);
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

  const recoveryDialog=byId("recoveryDialog");
  const recoveryForm=byId("recoveryForm");
  let recoveryUsername="", foundCode="";
  const resetRecovery = () => {
    recoveryUsername="";
    foundCode="";
    byId("newPasswordField").hidden=true;
    recoveryForm.elements.password.required=false;
    recoveryForm.elements.password.value="";
    byId("foundUsername").hidden=true;
    byId("recoverySubmit").textContent="Trova account";
  };
  byId("openRecovery").onclick=()=>{
    recoveryForm.reset();
    resetRecovery();
    showError(recoveryForm.querySelector(".form-error"));
    recoveryDialog.showModal();
  };
  recoveryForm.elements.code.oninput=resetRecovery;
  recoveryForm.onsubmit=async event=>{
    event.preventDefault();
    await submitSettings(recoveryForm,event.submitter,async()=>{
      const code=recoveryForm.elements.code.value.trim();
      if (recoveryUsername && foundCode===code) {
        const username=recoveryUsername;
        const proof=await passwordProof(username,recoveryForm.elements.password.value);
        await api("/api/auth/recover",{public:true,data:{code,username,proof}});
        recoveryDialog.close();
        setMode(false);
        accountForm.elements.username.value=username;
        announce("Password aggiornata. Accedi con la nuova password.");
        return;
      }
      const {username}=await api("/api/auth/recovery-name",{public:true,data:{code}});
      if (recoveryForm.elements.code.value.trim()!==code) return;
      recoveryUsername=username;
      foundCode=code;
      byId("foundUsername").textContent="Nome utente: @"+username;
      byId("foundUsername").hidden=false;
      byId("newPasswordField").hidden=false;
      recoveryForm.elements.password.required=true;
      byId("recoverySubmit").textContent="Reimposta password";
    });
  };

  async function submitSettings(form,button,action) {
    if (button.disabled) return;
    const status=form.querySelector(".form-error");
    button.disabled=true;
    showError(status);
    try { await action(); }
    catch (failure) { showError(status,failure.message); }
    finally { button.disabled=false; }
  }

  byId("passkeyLogin").hidden=!passkeysAvailable;
  const passkeySettings=byId("passkeySettings");
  passkeySettings.hidden=!passkeysAvailable;
  byId("openPasskeyLogin").onclick=async event=>{
    const button=event.currentTarget;
    if(button.disabled) return;
    button.disabled=true;
    showError(accountError);
    try {
      const {options}=await api("/api/auth/passkeys/login-options",{public:true,data:{}});
      if (!registering && !account) {
        loginOptions=options;
        const confirm=byId("confirmPasskeyLogin");
        confirm.hidden=false;
        confirm.focus();
      }
    } catch (failure) {showError(accountError,failure.message);}
    finally {button.disabled=false;}
  };
  byId("confirmPasskeyLogin").onclick=async event=>{
    const button=event.currentTarget;
    const options=loginOptions;
    if (button.disabled || !options) return;
    button.disabled=true;
    showError(accountError);
    try {
      const response=await startAuthentication({optionsJSON:options});
      const result=await api("/api/auth/passkeys/login",{public:true,data:{challenge:options.challenge,response}});
      beginSession(result.token);
      await restore();
    } catch (failure) {
      showError(accountError,failure.status?failure.message:"Accesso con passkey interrotto. Riprova o usa la password.");
    } finally {
      loginOptions=null;
      button.hidden=true;
      button.disabled=false;
    }
  };

  async function showPasskeys() {
    const {passkeys}=await api("/api/auth/passkeys");
    const root=byId("passkeyList");
    root.replaceChildren();
    for (const item of passkeys) {
      const row=document.createElement("div");
      row.className="row";
      const title=document.createElement("strong");
      title.textContent=item.label;
      const remove=document.createElement("button");
      remove.type="button";
      remove.className="text-button";
      remove.textContent="Rimuovi";
      remove.onclick=()=>{
        if (!passkeyForm.elements.password.reportValidity()) return;
        void submitSettings(passkeyForm,remove,async()=>{
          const proof=await passwordProof(account.username,passkeyForm.elements.password.value);
          await api("/api/auth/passkeys/remove",{data:{id:item.id,proof}});
          passkeyForm.reset();
          await showPasskeys();
        });
      };
      row.append(title,remove);
      root.append(row);
    }
  }
  passkeySettings.ontoggle=()=>{
    if (passkeySettings.open) void showPasskeys().catch(failure=>showError(passkeyForm.querySelector(".form-error"),failure.message));
  };
  passkeyForm.onsubmit=event=>{
    event.preventDefault();
    void submitSettings(passkeyForm,event.submitter,async()=>{
      const proof=await passwordProof(account.username,passkeyForm.elements.password.value);
      const {options}=await api("/api/auth/passkeys/register-options",{data:{proof}});
      registrationOptions=options;
      byId("confirmPasskey").hidden=false;
      byId("confirmPasskey").focus();
    });
  };
  byId("confirmPasskey").onclick=event=>{
    const selected=registrationOptions;
    if (!selected) return;
    void submitSettings(passkeyForm,event.currentTarget,async()=>{
      try {
        const response=await startRegistration({optionsJSON:selected});
        await api("/api/auth/passkeys/register",{data:{challenge:selected.challenge,response,label:passkeyForm.elements.label.value}});
        passkeyForm.reset();
        await showPasskeys();
        announce("Passkey aggiunta.");
      } catch (failure) {
        throw new Error(failure.status?failure.message:"Creazione della passkey interrotta. Riprova dalle impostazioni.");
      } finally {
        registrationOptions=null;
        byId("confirmPasskey").hidden=true;
      }
    });
  };

  const settings=byId("accountSettings");
  const codes=byId("recoveryCodes");
  const saveCodes=byId("saveCodes");
  document.querySelectorAll("[data-account-settings]").forEach(button=>{
    button.onclick=()=>{
      byId("settingsUsername").textContent="@"+account.username;
      settings.showModal();
    };
  });
  settings.onclose=()=>{
    settings.querySelectorAll("form").forEach(form=>{
      form.reset();
      showError(form.querySelector(".form-error"));
    });
    settings.querySelectorAll("details").forEach(item=>{item.open=false;});
    codes.textContent="";
    codes.hidden=true;
    saveCodes.hidden=true;
    registrationOptions=null;
    byId("confirmPasskey").hidden=true;
    byId("passkeyList").replaceChildren();
    showError(byId("settingsStatus"));
  };
  const codesForm=byId("codesForm");
  codesForm.onsubmit=event=>{
    event.preventDefault();
    void submitSettings(codesForm,event.submitter,async()=>{
      const proof=await passwordProof(account.username,codesForm.elements.password.value);
      const result=await api("/api/auth/recovery-codes",{data:{proof}});
      codesForm.reset();
      codes.textContent=result.codes.join("\n");
      codes.hidden=false;
      saveCodes.hidden=false;
    });
  };
  saveCodes.onclick=()=>{
    const source=URL.createObjectURL(new Blob(["Dogs in Giro · @"+account.username+"\n\n"+codes.textContent],{type:"text/plain"}));
    const link=document.createElement("a");
    link.href=source;
    link.download="dogs-in-giro-codici.txt";
    link.click();
    setTimeout(()=>URL.revokeObjectURL(source),1000);
  };
  const passwordForm=byId("passwordForm");
  passwordForm.onsubmit=event=>{
    event.preventDefault();
    void submitSettings(passwordForm,event.submitter,async()=>{
      const [proof,next_proof]=await Promise.all(["password","next"].map(key=>passwordProof(account.username,passwordForm.elements[key].value)));
      await api("/api/auth/password",{data:{proof,next_proof}});
      passwordForm.reset();
      announce("Password aggiornata. Le altre sessioni sono state chiuse.");
    });
  };
  const deleteForm=byId("deleteAccountForm");
  deleteForm.onsubmit=event=>{
    event.preventDefault();
    if (!confirm("Eliminare definitivamente il tuo account e le tue passeggiate?")) return;
    void submitSettings(deleteForm,event.submitter,async()=>{
      const proof=await passwordProof(account.username,deleteForm.elements.password.value);
      await api("/api/auth/delete",{data:{proof}});
      clearSession();
      announce("Account eliminato.");
    });
  };
  byId("signOutAll").onclick=async event=>{
    const button=event.currentTarget;
    if (button.disabled || !confirm("Chiudere tutte le sessioni, compresa questa?")) return;
    button.disabled=true;
    try {
      await api("/api/auth/logout-all",{data:{}});
      clearSession();
    } catch (failure) {showError(byId("settingsStatus"),failure.message);}
    finally {button.disabled=false;}
  };

  return {
    api,
    restore,
    setProfile(profile) { applyAccount({...account,profile}); },
    async saveProfile(data) {
      const result = await api("/api/profile", { data });
      applyAccount({ ...account, profile: result.profile });
    },
  };
}
