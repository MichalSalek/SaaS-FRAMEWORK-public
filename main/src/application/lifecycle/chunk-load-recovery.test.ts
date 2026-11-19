import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOwnChunkLoadFailure,
  recoverFromChunkLoadFailure,
} from './chunk-load-recovery';
import { getDocumentBuildId } from './document-build';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import {
  registerLeaveGuard,
  resetLeaveGuardForTests,
} from '../routing/leave-guard';

const origin = 'https://nailfolio.app';
const cssFailure = `Loading CSS chunk 6973 failed.\n(${origin}/_next/static/css/b609a06da31ffa18.css)`;

beforeEach(() => {
  sessionStorage.clear();
  resetLeaveGuardForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetLeaveGuardForTests();
  document.getElementById('__NEXT_DATA__')?.remove();
});

describe('chunk recovery', () => {
  it('reloads the production CSS failure once per build in this tab', () => {
    const reload = vi.fn();
    const args = { message: cssFailure, origin, buildId: 'old-build', reload };
    expect(recoverFromChunkLoadFailure(args)).toBe('reloaded');
    expect(recoverFromChunkLoadFailure(args)).toBe('suppressed');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(STORAGE_KEYS.CHUNK_RECOVERY_BUILD)).toBe(
      'old-build'
    );
  });

  it('permits recovery for a different build without a time-based reload loop', () => {
    const reload = vi.fn();
    sessionStorage.setItem(STORAGE_KEYS.CHUNK_RECOVERY_BUILD, 'older-build');
    expect(
      recoverFromChunkLoadFailure({
        message: cssFailure,
        origin,
        buildId: 'new-build',
        reload,
      })
    ).toBe('reloaded');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('preserves an unsaved form protected by the shared leave guard', () => {
    registerLeaveGuard('Niezapisana wiadomość');
    const reload = vi.fn();
    expect(
      recoverFromChunkLoadFailure({
        message: cssFailure,
        origin,
        buildId: 'old',
        reload,
      })
    ).toBe('suppressed');
    expect(reload).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem(STORAGE_KEYS.CHUNK_RECOVERY_BUILD)
    ).toBeNull();
  });

  it('does not reload offline or without a known document build', () => {
    const reload = vi.fn();
    expect(
      recoverFromChunkLoadFailure({
        message: cssFailure,
        origin,
        buildId: null,
        reload,
      })
    ).toBe('suppressed');
    expect(
      recoverFromChunkLoadFailure({
        message: cssFailure,
        origin,
        buildId: 'old',
        online: false,
        reload,
      })
    ).toBe('suppressed');
    expect(reload).not.toHaveBeenCalled();
  });

  it('fails closed when the reload marker cannot be persisted', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined);
    const reload = vi.fn();
    expect(
      recoverFromChunkLoadFailure({
        message: cssFailure,
        origin,
        buildId: 'old',
        reload,
      })
    ).toBe('suppressed');
    expect(reload).not.toHaveBeenCalled();
  });

  it('fails closed when session storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    const reload = vi.fn();
    expect(
      recoverFromChunkLoadFailure({
        message: cssFailure,
        origin,
        buildId: 'old',
        reload,
      })
    ).toBe('suppressed');
    expect(reload).not.toHaveBeenCalled();
  });

  it('limits matching to our exact Next chunk-load failures', () => {
    expect(isOwnChunkLoadFailure(cssFailure, origin)).toBe(true);
    expect(
      isOwnChunkLoadFailure(
        `Loading chunk 123 failed.\n(error: ${origin}/_next/static/chunks/123.js)`,
        origin
      )
    ).toBe(true);
    expect(
      isOwnChunkLoadFailure(
        cssFailure.replace(origin, 'https://third-party.example'),
        origin
      )
    ).toBe(false);
    expect(
      isOwnChunkLoadFailure(
        'RangeError: Maximum call stack size exceeded.',
        origin
      )
    ).toBe(false);
    expect(
      isOwnChunkLoadFailure(
        `Loading chunk 123 failed.\n(${origin}/api/123.js)`,
        origin
      )
    ).toBe(false);
    expect(isOwnChunkLoadFailure('Loading chunk 123 failed.', origin)).toBe(
      false
    );
  });

  it('leaves unrelated exceptions to the normal error handler', () => {
    const reload = vi.fn();
    expect(
      recoverFromChunkLoadFailure({
        message: 'Broken render',
        origin,
        buildId: 'old',
        reload,
      })
    ).toBe('unrelated');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reads only a valid build id from the document metadata', () => {
    const script = document.createElement('script');
    script.id = '__NEXT_DATA__';
    script.type = 'application/json';
    document.head.appendChild(script);
    script.textContent = '{"buildId":"build-123"}';
    expect(getDocumentBuildId()).toBe('build-123');
    script.textContent = '{"buildId":12}';
    expect(getDocumentBuildId()).toBeNull();
    script.textContent = 'broken';
    expect(getDocumentBuildId()).toBeNull();
  });
});
