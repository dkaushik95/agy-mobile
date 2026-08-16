// Service Worker with aggressive cache-purge on activation to guarantee instant UI updates

const _CACHE_NAME = 'agy-gemini-v5';

self.addEventListener('install', function(_event) {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    return caches.delete(cacheName);
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

self.addEventListener('push', function(event) {
    let payload = { title: 'Antigravity Agent', body: 'New response received.', icon: '/favicon.png' };
    
    if (event.data) {
        try {
            payload = event.data.json();
        } catch {
            payload.body = event.data.text();
        }
    }

    const options = {
        body: payload.body,
        icon: payload.icon || '/favicon.png',
        badge: '/favicon.png',
        vibrate: [100, 50, 100],
        data: payload.data || { url: '/' }
    };

    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    const urlToOpen = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url && 'focus' in client) {
                    client.focus();
                    if (client.url !== urlToOpen) {
                        return client.navigate(urlToOpen);
                    }
                    return client;
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
