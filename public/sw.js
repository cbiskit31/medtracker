self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'MedTracker', body: event.data ? event.data.text() : 'Reminder' };
  }

  const title = data.title || 'MedTracker';
  const options = {
    body: data.body || 'Reminder',
    tag: data.tag || 'medtrack-push',
    data: { medicationId: data.medicationId },
    actions: data.actions || [
      { action: 'taken', title: 'Taken' },
      { action: 'skipped', title: 'Skip' },
      { action: 'snoozed', title: 'Snooze' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action; // 'taken', 'skipped', 'snoozed', or '' if body clicked
  const medicationId = event.notification.data?.medicationId;

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      if (action && medicationId) {
        // Tell any open app window to record the action
        for (const client of allClients) {
          client.postMessage({ type: 'NOTIFICATION_ACTION', action, medicationId });
        }
      }

      // Focus or open the app
      if (allClients.length > 0) {
        allClients[0].focus();
      } else {
        self.clients.openWindow('/');
      }
    })()
  );
});