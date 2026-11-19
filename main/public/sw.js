


var NOTIFICATION_CENTRE_PATH = '/app/notifications';
var OPEN_ACK_TIMEOUT_MS = 1000;

// This classic worker cannot import the shared TypeScript locale config. Keep
// the optional prefix aligned with I18N_CONFIG.locales and Next's i18n config.
function isAppPath(path) {
  return /^\/(?:pl\/|en\/|de\/)?app(?:\/|$)/.test(path);
}

function safeTarget(value) {
  try {
    if (typeof value !== 'string' || value.indexOf('//') === 0) {
      throw new Error('Invalid push target');
    }
    var url = new URL(value, self.location.origin);
    if (
      url.origin !== self.location.origin ||
      url.username ||
      url.password ||
      !isAppPath(url.pathname)
    ) {
      throw new Error('Invalid push target');
    }
    return url.href;
  } catch (error) {
    return new URL(NOTIFICATION_CENTRE_PATH, self.location.origin).href;
  }
}

function isAppClient(page) {
  try {
    var url = new URL(page.url);
    return (
      url.origin === self.location.origin &&
      isAppPath(url.pathname) &&
      typeof page.focus === 'function' &&
      typeof page.postMessage === 'function'
    );
  } catch (error) {
    return false;
  }
}

function probeApp(page) {
  return new Promise(function (resolve) {
    var channel = new MessageChannel();
    var done = false;
    var timer = setTimeout(function () {
      finish(false);
    }, OPEN_ACK_TIMEOUT_MS);
    function finish(accepted) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(accepted);
    }
    channel.port1.onmessage = function (event) {
      if (event.data && event.data.type === 'nf-push-ready') finish(true);
    };
    try {
      // The probe has no navigation side effect. An older or suspended page
      // cannot navigate late after the worker has opened a fallback window.
      page.postMessage({ type: 'nf-push-probe' }, [channel.port2]);
    } catch (error) {
      finish(false);
    }
  });
}

function openInAppOrNewWindow(pages, target) {
  var candidates = pages.filter(isAppClient);
  function attempt(index) {
    if (index >= candidates.length) return self.clients.openWindow(target);
    var page = candidates[index];
    return probeApp(page).then(function (accepted) {
      if (!accepted) return attempt(index + 1);
      try {
        page.postMessage({ type: 'nf-push-open', url: target });
      } catch (error) {
        return attempt(index + 1);
      }
      // A failed focus after dispatch must not bypass an active leave prompt.
      return page.focus().catch(function () {});
    });
  }
  return attempt(0);
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) {
    return null;
  }
  try {
    return event.data.json();
  } catch (error) {
    return null;
  }
}

function tellOpenPages(message) {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (pages) {
      pages.forEach(function (page) {
        page.postMessage(message);
      });
    });
}

self.addEventListener('push', function (event) {
  var payload = readPayload(event);
  if (!payload || typeof payload.title !== 'string') {
    return;
  }
  var url =
    typeof payload.url === 'string' ? payload.url : NOTIFICATION_CENTRE_PATH;
  var options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: url, notificationId: payload.notificationId || null },
  };
  if (typeof payload.tag === 'string' && payload.tag.length > 0) {
    options.tag = payload.tag;
    options.renotify = true;
  }
  event.waitUntil(
    self.registration
      .showNotification(payload.title, options)
      .then(function () {
        // An open page refreshes its bell without waiting for the next poll.
        return tellOpenPages({
          type: 'nf-push-received',
          tag: options.tag || null,
        });
      })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var target = safeTarget(data.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (pages) {
        // Never hard-navigate an app: a guarded unsaved draft may be there.
        return openInAppOrNewWindow(pages, target);
      })
  );
});
