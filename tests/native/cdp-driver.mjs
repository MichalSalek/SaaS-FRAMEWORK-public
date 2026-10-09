// Minimal Chrome DevTools Protocol driver for the Android WebView of the Capacitor shell.
//
// MUST run under WINDOWS node.exe, not the WSL one: `adb forward` binds the port on the
// Windows loopback, which is unreachable from inside WSL. The wrapper script drives this
// through `cmd.exe /c node`.
//
// Usage: node cdp-driver.mjs <port> <list|eval> [exprFile]
import { readFileSync } from 'node:fs';

const [, , portArg, cmd, exprFile] = process.argv;
const port = portArg || '19222';

const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
const pages = targets.filter(t => t.type === 'page');

if (cmd === 'list') {
  console.log(JSON.stringify(pages.map(p => ({ id: p.id, url: p.url, title: p.title })), null, 2));
  process.exit(0);
}
if (!pages.length) {
  console.error('NO_PAGE_TARGET');
  process.exit(2);
}

const expression = readFileSync(exprFile, 'utf8');
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise(resolve => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
await new Promise(r => ws.addEventListener('open', r));

const out = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  allowUnsafeEvalBlockedByCSP: true,
  userGesture: true,
});
const r = out.result;
if (r?.exceptionDetails) {
  console.log('EXCEPTION: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  ws.close();
  process.exit(3);
}
console.log(JSON.stringify(r?.result?.value ?? r?.result, null, 2));
ws.close();
process.exit(0);
