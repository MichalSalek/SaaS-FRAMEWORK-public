import { beforeEach, describe, expect, it } from 'vitest';
import {
  cameFromDeeperScreen,
  cameFromRoutePrefix,
  markGlobalNavigation,
  noteScreen,
  resetScreenArrivals,
} from './screen-arrival';

const PROFILE = '/app/client/profile';
const SESSIONS = '/app/sessions';
const HOME = '/app';

beforeEach(() => {
  resetScreenArrivals();
});

describe('a tab root reached from a deeper screen', () => {
  it('offers a way back when a link in the content led there', () => {
    noteScreen(PROFILE, false, 'k1');
    const arrival = noteScreen(SESSIONS, true, 'k2');
    expect(cameFromDeeperScreen(arrival)).toBe(true);
  });

  it('offers none when the tab bar or the drawer led there', () => {
    noteScreen(PROFILE, false, 'k1');
    markGlobalNavigation();
    const arrival = noteScreen(SESSIONS, true, 'k2');
    expect(cameFromDeeperScreen(arrival)).toBe(false);
  });

  it('offers none when she came from another tab root', () => {
    noteScreen(HOME, true, 'k1');
    const arrival = noteScreen(SESSIONS, true, 'k2');
    expect(cameFromDeeperScreen(arrival)).toBe(false);
  });

  it('offers none on the first screen of a page load', () => {
    expect(cameFromDeeperScreen(noteScreen(SESSIONS, true, 'k1'))).toBe(false);
  });

  it('remembers the answer when she returns to that entry', () => {
    noteScreen(PROFILE, false, 'k1');
    noteScreen(SESSIONS, true, 'k2');
    noteScreen('/app/sessions/[id]', false, 'k3');
    // Back from the detail: the same history entry, the same answer.
    expect(cameFromDeeperScreen(noteScreen(SESSIONS, true, 'k2'))).toBe(true);
  });

  it('does not leak a global navigation mark into the next step', () => {
    markGlobalNavigation();
    noteScreen(PROFILE, false, 'k1');
    expect(cameFromDeeperScreen(noteScreen(SESSIONS, true, 'k2'))).toBe(true);
  });

  it('claims no origin for an entry whose screen was replaced', () => {
    noteScreen(HOME, true, 'k1');
    noteScreen(PROFILE, false, 'k2');
    // `replace` keeps the key: the deeper screen is gone from history, so a
    // back control on the tab root would not lead to it.
    expect(cameFromDeeperScreen(noteScreen(SESSIONS, true, 'k2'))).toBe(false);
  });

  it('survives a second note of the same screen (the role arrived)', () => {
    noteScreen(PROFILE, true, 'k1');
    noteScreen(PROFILE, false, 'k1');
    expect(cameFromDeeperScreen(noteScreen(SESSIONS, true, 'k2'))).toBe(true);
  });

  it('knows nothing without a history key', () => {
    noteScreen(PROFILE, false, null);
    expect(noteScreen(SESSIONS, true, null)).toBeNull();
  });
});

describe('cameFromRoutePrefix', () => {
  it('recognises an arrival from inside the app', () => {
    noteScreen('/app/profile', false, 'k1');
    const arrival = noteScreen('/stylist/[identifier]', false, 'k2');
    expect(cameFromRoutePrefix(arrival, '/app')).toBe(true);
  });

  it('does not match a sibling prefix or a direct landing', () => {
    noteScreen('/application', false, 'k1');
    const arrival = noteScreen('/stylist/[identifier]', false, 'k2');
    expect(cameFromRoutePrefix(arrival, '/app')).toBe(false);
    resetScreenArrivals();
    expect(
      cameFromRoutePrefix(
        noteScreen('/stylist/[identifier]', false, 'k1'),
        '/app'
      )
    ).toBe(false);
  });
});

describe('the tab a screen belongs to (originTabRoot)', () => {
  const GALLERY = '/app/gallery';
  const PHOTO = '/app/photo/[id]';
  const EDIT = '/app/photo/[id]/edit';
  const CLIENTS = '/app/clients';

  it('is the tab itself on a tab root', () => {
    expect(noteScreen(GALLERY, true, 'k1')?.originTabRoot).toBe(GALLERY);
  });

  it('is inherited by a screen opened from the tab by a link in the content', () => {
    noteScreen(GALLERY, true, 'k1');
    expect(noteScreen(PHOTO, false, 'k2')?.originTabRoot).toBe(GALLERY);
  });

  it('is inherited down the whole chain of pushed screens', () => {
    noteScreen(GALLERY, true, 'k1');
    noteScreen(PHOTO, false, 'k2');
    expect(noteScreen(EDIT, false, 'k3')?.originTabRoot).toBe(GALLERY);
  });

  it('is empty for a screen opened from the drawer', () => {
    noteScreen(HOME, true, 'k1');
    markGlobalNavigation();
    expect(noteScreen(CLIENTS, false, 'k2')?.originTabRoot).toBeNull();
  });

  it('is empty on the first screen of a page load that is not a tab root', () => {
    expect(noteScreen(PHOTO, false, 'k1')?.originTabRoot).toBeNull();
  });

  it('survives going back to an entry already seen', () => {
    noteScreen(GALLERY, true, 'k1');
    noteScreen(PHOTO, false, 'k2');
    noteScreen(EDIT, false, 'k3');
    expect(noteScreen(PHOTO, false, 'k2')?.originTabRoot).toBe(GALLERY);
  });
});
