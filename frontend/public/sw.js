self.addEventListener('push', function(event) {
    let payload = { title: 'Notification', body: 'New update available.', icon: '/favicon.svg' };
    
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            payload.body = event.data.text();
        }
    }

    const options = {
        body: payload.body,
        icon: payload.icon || '/favicon.svg',
        badge: '/favicon.svg',
        vibrate: [100, 50, 100],
        data: payload.data || { url: '/' }
    };

    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // Fallback to '/' if no url is provided
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
