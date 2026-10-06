// Service worker for the timed photo log (/log).
// It shows the ten-minute ping the push worker sends, even with the screen off
// and the page closed, and routes a tap on it back to the page.

const PROMPT = "trace-ping";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function windowClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // An unreadable payload still has to show a notification (iOS revokes subscriptions that stay silent).
  }
  const promptedAt = data.promptedAt || new Date().toISOString();
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || "TRACE", {
      body: data.body || "位置情報を記録してください。",
      tag: PROMPT,
      renotify: true,
      requireInteraction: true,
      data: { url: `log?prompt=${encodeURIComponent(promptedAt)}`, promptedAt },
    });
    // A page that is already open shows the prompt without waiting for a tap.
    for (const client of await windowClients()) client.postMessage({ type: PROMPT, promptedAt });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, promptedAt } = event.notification.data || {};
  const target = new URL(url || "log", self.registration.scope);
  event.waitUntil((async () => {
    const open = (await windowClients()).find((client) => new URL(client.url).pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, ""));
    if (open) {
      if (promptedAt) open.postMessage({ type: PROMPT, promptedAt });
      return open.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
