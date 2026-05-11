// Skerry PWA Service Worker — handles web push notifications.
// Installed from the root so it can control all pages.

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
    let title = "Skerry";
    let body = "";
    let icon = "/icons/icon-192x192.png";
    let tag = "";
    let url = "/";

    if (event.data) {
        try {
            const data = event.data.json();
            title = data.title || title;
            body = data.body || body;
            icon = data.icon || icon;
            tag = data.tag || tag;
            url = data.url || url;
        } catch (_) {
            // If JSON parse fails, use the raw text as the body.
            body = event.data.text();
        }
    }

    const promise = self.registration.showNotification(title, {
        body,
        icon,
        tag,
        badge: "/icons/icon-192x192.png",
        data: { url },
        requireInteraction: true,
    });

    event.waitUntil(promise);
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = event.notification.data?.url || "/";

    event.waitUntil(
        (async () => {
            const allClients = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });

            for (const client of allClients) {
                if (client.url.includes(self.location.origin) && "focus" in client) {
                    await client.focus();
                    await client.navigate(url);
                    return;
                }
            }

            if (self.clients.openWindow) {
                await self.clients.openWindow(url);
            }
        })()
    );
});
