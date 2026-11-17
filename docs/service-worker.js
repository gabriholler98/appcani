self.addEventListener("push", event => {
  event.waitUntil(self.registration.showNotification("Dogs in Giro", {
    body: "Hai un nuovo avviso. Apri l’app per leggerlo.",
    icon: new URL("assets/dogs-in-giro-miniatura-light.png?v=2", self.registration.scope).href,
    tag: "dogs-in-giro-alert",
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL("?avvisi=1", self.registration.scope);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appWindow = windows.find(client => client.url.startsWith(self.registration.scope));
    if (appWindow) {
      try {
        const navigated = await appWindow.navigate(target.href);
        if (navigated) return navigated.focus();
      } catch {
        // If the existing tab closed, open the inbox in a new window.
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
