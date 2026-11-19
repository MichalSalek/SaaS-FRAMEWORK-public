import type { NextPageContext } from 'next';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../application/i18n/i18n.loader', () => ({
  getPublicPageMessages: async () => ({ messages: {} }),
}));
import CustomErrorComponent from '../pages/_error';

describe('custom error page props', () => {
  it('does not expose the server error message to serialized page props', async () => {
    const props = await CustomErrorComponent.getInitialProps({
      locale: 'pl',
      err: Object.assign(new Error('private server path and details'), {
        statusCode: 500,
      }),
    } as NextPageContext);
    expect(props.statusCode).toBe(500);
    expect(JSON.stringify(props)).not.toContain(
      'private server path and details'
    );
  });
});
