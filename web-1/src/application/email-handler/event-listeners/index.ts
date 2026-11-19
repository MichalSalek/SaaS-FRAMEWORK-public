/**
 * Email event-listeners registry.
 *
 * Side-effect imports: each listener registers its subscription via
 * subscribeToInfoEvent() at import time. Importing this barrel from the
 * application bootstrap (instrumentation.ts) wires up every listener once
 * per process. There are no exports — the only purpose is the side-effect.
 *
 * Adding a new listener:
 *  1) Create a new *.listener.ts file in this folder.
 *  2) Inside, call subscribeToInfoEvent(EVENT_NAME, async payload => { ... }).
 *  3) Add an `import './your-new.listener'` line below.
 */

import './pairing-session-claimed.listener';
import './pair-request-sent.listener';
import './session-shared.listener';
