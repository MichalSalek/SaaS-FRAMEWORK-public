# Native smoke — boot-and-assert for the Capacitor APK

**Run before shipping an APK.** Not part of `run-all.sh` and never a commit gate: it needs a
running emulator or device plus the Windows-side Android SDK.

```bash
bash tests/native/native-smoke.sh                 # test the installed app
bash tests/native/native-smoke.sh --apk <path>    # install first, then test
```

Exit `0` = all assertions passed · `1` = an assertion failed · `2` = environment unusable (skip).

## Why it exists

The wrapper remote-loads the frontend from `https://nailfolio.app`, and Capacitor injects its
runtime only into origins it serves itself. The shell therefore injects the bridge by hand
(`RemoteBridgeInjector`). That whole layer is load-bearing and had **no automated verification
at all**, while every failure in it is invisible from the outside:

- **Haptics and share were dead in the APK for months.** `window.androidBridge` exists per
  WebView, so `isNativePlatform()` returned `true` while `PluginHeaders` was empty and no call
  could ever return. Nothing threw. The app simply did nothing, exactly like the web build.
- **Reviving the bridge silently switched the `CapacitorHttp` fetch patch back ON** for the
  production origin (its only gate is the presence of `CapacitorHttpAndroidInterface`, which
  also lives on the whole WebView). PostHog started rejecting ingestion with
  `400 invalid GZIP data` and session recording died. Visible only in device logs.

Hence the assertions: presence is never enough, so the battery insists on a **live round trip**
(clipboard write→read must return the written value) and on the patch being **absent** on the
remote origin while `fetch`/`XHR` stay native.

## Environment notes (WSL + Windows SDK)

- `adb forward` binds the port on the **Windows** loopback, unreachable from WSL — so the CDP
  driver runs under Windows `node.exe` via `cmd.exe`.
- **Port 9222 is reserved by Windows** (bind error 10013). This harness uses `19222`;
  override with `NF_CDP_PORT`.
- Override adb with `ADB=/path/to/adb.exe`.
- Start an emulator: `emulator.exe -list-avds` then `emulator.exe -avd Pixel_9`.

## Files

| File | Role |
|---|---|
| `native-smoke.sh` | harness: install, launch, wait for the devtools socket, forward, report |
| `cdp-driver.mjs` | minimal CDP client (`Runtime.evaluate`, `awaitPromise`, `returnByValue`) |
| `assertions.js` | the battery, evaluated inside the WebView; returns a JSON report |

## Teeth-test (2026-09-10)

Injecting `window.CapacitorHttpAndroidInterface = {}` into the live page makes the harness exit
`1` and name `http_patch_absent_on_remote`; removing it returns exit `0` with 14/14. A smoke test
that has never been seen to fail proves nothing, so re-do this after changing the battery.
