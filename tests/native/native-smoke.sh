#!/usr/bin/env bash
# native-smoke.sh — boot-and-assert smoke test for the Capacitor APK.
#
# WHY THIS EXISTS:
#   The native layer is real and load-bearing (the shell injects Capacitor's bridge into
#   the REMOTE production origin) and had ZERO automated verification. Every failure this
#   file asserts against was silent in production: haptics and share were dead in the APK
#   for months because `PluginHeaders` was empty while `isNativePlatform()` returned true;
#   and reviving the bridge in S112 silently switched ON the `CapacitorHttp` fetch patch,
#   which broke PostHog ingestion with `400 invalid GZIP data`. Neither showed up anywhere
#   except in device logs.
#
# NOT IN run-all.sh, ON PURPOSE: this needs a running emulator/device plus the Windows-side
#   Android SDK, so it can never be a precondition for a commit. Run it before shipping an APK.
#
# ENVIRONMENT (WSL + Windows SDK):
#   - `adb forward` binds the port on the WINDOWS loopback, unreachable from WSL, so the CDP
#     driver is executed by Windows `node.exe` through `cmd.exe`.
#   - Port 9222 is RESERVED by Windows (bind error 10013) — hence 19222.
#
# USAGE: bash tests/native/native-smoke.sh [--apk <path>]
#   --apk  install this APK first (otherwise the already-installed app is used)
#
# EXIT: 0 all assertions passed · 1 an assertion failed · 2 environment unusable (skip)

set -uo pipefail

# Windows profile as seen from WSL — override WIN_USER (or ADB / WIN_TMP directly).
WIN_USER="${WIN_USER:-your-windows-user}"
WIN_LOCALAPPDATA="/mnt/c/Users/${WIN_USER}/AppData/Local"
ADB="${ADB:-${WIN_LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe}"
PKG="com.nailfolio.app"
PORT="${NF_CDP_PORT:-19222}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WIN_TMP="${WIN_TMP:-${WIN_LOCALAPPDATA}/Temp}"
APK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apk) APK="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

skip() { echo "SKIP: $*" >&2; exit 2; }

[[ -x "$ADB" ]] || skip "adb not found at $ADB (set ADB=...)"
command -v cmd.exe >/dev/null 2>&1 || skip "cmd.exe unavailable — this harness needs the Windows side"
"$ADB" get-state >/dev/null 2>&1 || skip "no device/emulator attached (start one: emulator.exe -avd Pixel_9)"

if [[ -n "$APK" ]]; then
  [[ -f "$APK" ]] || skip "APK not found: $APK"
  echo "==> installing $APK"
  "$ADB" install -r -d "$(wslpath -w "$APK" 2>/dev/null || echo "$APK")" >/dev/null || { echo "install failed" >&2; exit 1; }
fi

# Here-string, NOT `… | grep -q`: under `pipefail` grep exits early, `tr` takes SIGPIPE and
# the whole pipeline reports failure even though the package IS installed. Same flake the
# repo already hit in `ui-library-coverage` (fixed 2026-09-07 the same way).
INSTALLED="$("$ADB" shell pm list packages 2>/dev/null | tr -d '\r')"
grep -q "^package:${PKG}$" <<< "$INSTALLED" || skip "$PKG not installed (pass --apk)"

echo "==> launching $PKG"
"$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

# Wait for the WebView devtools socket rather than sleeping a fixed amount: cold start
# varies wildly between a warm emulator and a fresh boot.
PID=""
for _ in $(seq 1 40); do
  PID="$("$ADB" shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  if [[ -n "$PID" ]] && "$ADB" shell cat /proc/net/unix 2>/dev/null | grep -q "webview_devtools_remote_${PID}"; then
    break
  fi
  PID=""
  sleep 2
done
[[ -n "$PID" ]] || { echo "FAIL: WebView devtools socket never appeared" >&2; exit 1; }

"$ADB" forward --remove-all >/dev/null 2>&1
"$ADB" forward "tcp:${PORT}" "localabstract:webview_devtools_remote_${PID}" >/dev/null || {
  echo "FAIL: adb forward failed (port ${PORT} taken? 9222 is reserved by Windows)" >&2; exit 1; }

cp "$HERE/cdp-driver.mjs" "$WIN_TMP/nf-cdp-driver.mjs"
cp "$HERE/assertions.js" "$WIN_TMP/nf-assertions.js"

# The app navigates from the shell origin to production; give it a moment to land there
# before asserting, otherwise we measure the shell and report a false failure.
REPORT=""
for _ in $(seq 1 20); do
  REPORT="$(cmd.exe /c "cd /d $(wslpath -w "$WIN_TMP") && node nf-cdp-driver.mjs ${PORT} eval nf-assertions.js" 2>/dev/null \
    | grep -v "UNC\|CMD.EXE\|wsl.localhost")"
  [[ "$REPORT" == *"origin_is_production"* ]] && break
  sleep 3
done

[[ -n "$REPORT" ]] || { echo "FAIL: no report from the WebView (CDP channel dead)" >&2; exit 1; }

echo "$REPORT" | node -e '
let raw = ""; process.stdin.on("data", d => raw += d).on("end", () => {
  let payload;
  try { payload = JSON.parse(JSON.parse(raw)); }
  catch { try { payload = JSON.parse(raw); } catch { console.error("unparseable report:\n" + raw); process.exit(1); } }
  if (payload.fatal) { console.error("FATAL: " + payload.fatal); process.exit(1); }
  let failed = 0;
  for (const r of payload.results) {
    console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.detail ? "  — " + r.detail : ""));
    if (!r.ok) failed++;
  }
  console.log("");
  console.log(failed === 0
    ? "NATIVE SMOKE PASSED — " + payload.results.length + " assertions"
    : "NATIVE SMOKE FAILED — " + failed + " of " + payload.results.length);
  process.exit(failed === 0 ? 0 : 1);
});
'
