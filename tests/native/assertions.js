// Assertion battery evaluated INSIDE the WebView of the running APK, on the
// production origin. Returns a JSON report; the harness decides pass/fail.
//
// Every assertion here corresponds to a failure that actually happened and was
// silent — see tests/native/README.md.
(async () => {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const C = window.Capacitor;

  check('origin_is_production', location.origin === 'https://nailfolio.app', location.origin);
  check('capacitor_present', typeof C !== 'undefined', typeof C);

  if (typeof C === 'undefined') {
    return JSON.stringify({ results, fatal: 'no Capacitor on the remote origin' });
  }

  check('platform_android', C.getPlatform && C.getPlatform() === 'android', C.getPlatform && C.getPlatform());
  check('is_native_platform', C.isNativePlatform && C.isNativePlatform() === true, null);

  // The bridge being ALIVE, not merely present: before the shell injected it, the
  // frontend saw `androidBridge` and reported isNativePlatform()===true while
  // PluginHeaders was empty and no call could ever return.
  check('native_promise_is_function', typeof C.nativePromise === 'function', typeof C.nativePromise);

  const plugins = C.PluginHeaders ? C.PluginHeaders.map(p => p.name).sort() : [];
  const EXPECTED = ['App','Browser','CapacitorCookies','CapacitorHttp','Clipboard','Filesystem',
    'Haptics','Keyboard','Network','ScreenBrightness','Share','SplashScreen','StatusBar','SystemBars','WebView'];
  const missing = EXPECTED.filter(p => !plugins.includes(p));
  check('all_plugins_registered', missing.length === 0, missing.length ? 'missing: ' + missing.join(',') : plugins.length + ' present');

  // Injecting the bridge also WOKE the CapacitorHttp fetch patch on the remote
  // origin (its only gate is the presence of this interface, which lives on the
  // whole WebView). PostHog then got 400 "invalid GZIP data" and session
  // recording died. The shell keeps the patch; the remote origin must not have it.
  check('http_patch_absent_on_remote', typeof window.CapacitorHttpAndroidInterface === 'undefined', typeof window.CapacitorHttpAndroidInterface);
  check('fetch_is_native', /\[native code\]/.test(String(window.fetch)), null);
  check('xhr_open_is_native', /\[native code\]/.test(String(XMLHttpRequest.prototype.open)), null);

  // A real round trip: a call that must cross the bridge and come back with data.
  // Clipboard write→read proves both directions, not just "did not throw".
  const withTimeout = (p, ms) => Promise.race([
    p.then(v => ({ ok: true, value: v })).catch(e => ({ ok: false, err: String((e && e.message) || e) })),
    new Promise(r => setTimeout(() => r({ ok: false, err: 'TIMEOUT_' + ms }), ms)),
  ]);

  const appInfo = await withTimeout(C.Plugins.App.getInfo(), 8000);
  check('bridge_round_trip', appInfo.ok, appInfo.ok ? JSON.stringify(appInfo.value) : appInfo.err);
  check('package_is_production', appInfo.ok && appInfo.value && appInfo.value.id === 'com.nailfolio.app',
    appInfo.ok && appInfo.value ? appInfo.value.id : 'n/a');

  const probe = 'nf-native-smoke-' + Date.now();
  const w = await withTimeout(C.Plugins.Clipboard.write({ string: probe }), 8000);
  const r = await withTimeout(C.Plugins.Clipboard.read(), 8000);
  check('clipboard_roundtrip_returns_written_value', w.ok && r.ok && r.value && r.value.value === probe,
    r.ok && r.value ? r.value.value : (r.err || w.err));

  // The QR scanner runs on web getUserMedia. Capacitor's BridgeWebChromeClient maps
  // VIDEO_CAPTURE to the runtime CAMERA permission, so this must be granted with a
  // real track — no native camera plugin is involved.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const tracks = stream.getVideoTracks();
    check('camera_granted_with_live_track', tracks.length > 0 && tracks[0].readyState === 'live',
      tracks.length ? tracks[0].label + ' / ' + tracks[0].readyState : 'no track');
    tracks.forEach(t => t.stop());
  } catch (e) {
    check('camera_granted_with_live_track', false, e.name + ': ' + e.message);
  }

  check('secure_context', window.isSecureContext === true, String(window.isSecureContext));

  return JSON.stringify({ results });
})()
