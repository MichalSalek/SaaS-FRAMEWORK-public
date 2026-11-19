import { describe, it, expect } from 'vitest';
import {
  isPolicyDraftDirty,
  orderPolicies,
  pageOfPolicy,
} from './policy-editor.utils';

describe('isPolicyDraftDirty', () => {
  const saved = { title: 'Regulamin', content: 'Treść' };

  it('is clean when the editor matches the saved policy', () => {
    expect(isPolicyDraftDirty({ id: 'p1', ...saved }, saved)).toBe(false);
  });

  it('is dirty when the title or the content departs from the saved policy', () => {
    expect(
      isPolicyDraftDirty({ id: 'p1', ...saved, title: 'Regulamin 2' }, saved)
    ).toBe(true);
    expect(
      isPolicyDraftDirty({ id: 'p1', ...saved, content: 'Nowa' }, saved)
    ).toBe(true);
  });

  it('new draft: dirty only with non-blank text', () => {
    expect(
      isPolicyDraftDirty({ id: undefined, title: ' ', content: '' }, null)
    ).toBe(false);
    expect(
      isPolicyDraftDirty({ id: undefined, title: '', content: 'x' }, null)
    ).toBe(true);
  });

  it('bound policy not re-read yet: nothing to compare, not dirty', () => {
    expect(
      isPolicyDraftDirty({ id: 'p-new', title: 'A', content: 'B' }, null)
    ).toBe(false);
  });
});

describe('orderPolicies', () => {
  it('puts the main policy first and keeps the order of the rest', () => {
    const list = [
      { id: 'a', is_main: false },
      { id: 'b', is_main: true },
      { id: 'c', is_main: false },
    ];
    expect(orderPolicies(list).map(policy => policy.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });
});

describe('pageOfPolicy', () => {
  const list = Array.from({ length: 25 }, (_, index) => ({
    id: `p${String(index)}`,
  }));

  it('returns the 1-based page that holds the policy', () => {
    expect(pageOfPolicy(list, 'p0', 10)).toBe(1);
    expect(pageOfPolicy(list, 'p9', 10)).toBe(1);
    expect(pageOfPolicy(list, 'p10', 10)).toBe(2);
    expect(pageOfPolicy(list, 'p24', 10)).toBe(3);
  });

  it('returns null for a new draft or a policy that is not listed', () => {
    expect(pageOfPolicy(list, undefined, 10)).toBeNull();
    expect(pageOfPolicy(list, 'gone', 10)).toBeNull();
  });
});
