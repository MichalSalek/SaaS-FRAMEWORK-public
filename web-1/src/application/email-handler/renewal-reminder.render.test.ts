import { beforeEach, describe, expect, it, vi } from 'vitest';
const { stripeFactory } = vi.hoisted(() => ({ stripeFactory: vi.fn() }));
vi.mock('../stripe/adapters/stripe.adapter', () => ({
  getStripe: stripeFactory,
}));
import { renderEmailTemplate } from './email-template.renderer';
import { BASE_SAMPLE_VARS, getSampleEmailVars } from './email-preview.samples';
import { adminGetEmailPreview_IO } from './email-preview.operation';

const locales = ['pl', 'en', 'de'] as const;
const subject = 'email.renewal.reminder7d.subject';
const plain = (text: string) => text.replaceAll('\u00a0', ' ');

beforeEach(() => vi.clearAllMocks());

describe('renewal reminder payment states', () => {
  for (const locale of locales) {
    it(`${locale}: shows the supplied quote, including a real zero, without a catalog calculation`, () => {
      for (const amount of ['123,00 PLN', '0,00 PLN']) {
        const vars: Record<string, string> = {
          ...getSampleEmailVars('renewal-reminder', locale),
          renewalAmount: amount,
        };
        const result = renderEmailTemplate(
          'renewal-reminder',
          vars,
          locale,
          '',
          subject
        );
        expect(plain(result.text)).toContain(amount);
        expect(result.subject).toContain(vars.renewalDate);
        expect(result.html).toContain('/app/user/account/pay');
        expect(result.html).not.toContain('billing.stripe.com');
        expect(result.html).not.toMatch(/\{\{|undefined|NaN/);
      }
    });

    it(`${locale}: unavailable or blank amount keeps a neutral reminder and the management link`, () => {
      for (const vars of [
        BASE_SAMPLE_VARS,
        { ...BASE_SAMPLE_VARS, renewalAmount: '' },
        { ...BASE_SAMPLE_VARS, renewalAmount: '  ' },
      ]) {
        const result = renderEmailTemplate(
          'renewal-reminder',
          vars,
          locale,
          '',
          subject
        );
        expect(result.text).toContain('Pro');
        expect(result.text).toContain(BASE_SAMPLE_VARS.renewalDate);
        expect(result.html).toContain('/app/user/account/pay');
        expect(result.text).not.toMatch(
          /0[,.]00|will be charged|zostanie pobrana|wird.*abgebucht/
        );
        expect(result.html).not.toMatch(/\{\{|undefined|NaN/);
      }
    });

    it(`${locale}: the admin preview uses a localized fictional amount without a provider read`, async () => {
      const result = await adminGetEmailPreview_IO({
        body: { templateId: 'renewal-reminder', locale },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(plain(result.data.text)).toContain(
          plain(
            getSampleEmailVars('renewal-reminder', locale).renewalAmount ?? ''
          )
        );
        expect(result.data.preheader).not.toBe('');
        expect(stripeFactory).not.toHaveBeenCalled();
      }
    });
  }
});
