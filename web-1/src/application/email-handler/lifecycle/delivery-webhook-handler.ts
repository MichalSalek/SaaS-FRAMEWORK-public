import { ENV_VARS } from '@app/environment/environment.config';
import { withPublicHandler } from '@app/http/define-raw-handler';
import { readRawBody } from '@app/stripe/webhooks/stripe-webhook-signature';
import { recordLifecycleDelivery } from './ledger-delivery';
import {
  verifyMailgunDelivery,
  verifyResendDelivery,
} from './delivery-webhook';

export const lifecycleWebhookHandler = (provider: 'resend' | 'mailgun') =>
  withPublicHandler({
    allowedMethods: ['POST'],
    cors: false,
    rateLimit: false,
    handle: async (req, res) => {
      const secret =
        provider === 'resend'
          ? ENV_VARS.RESEND_WEBHOOK_SECRET
          : ENV_VARS.MAILGUN_WEBHOOK_SIGNING_KEY;
      if (!secret) {
        res.status(503).json({ error: 'Webhook niedostępny' });
        return;
      }
      let event;
      try {
        const body = (await readRawBody({ req })).toString('utf8');
        const header = (name: string): string => {
          const value = req.headers[name];
          return typeof value === 'string' ? value : '';
        };
        event =
          provider === 'resend'
            ? verifyResendDelivery(
                body,
                {
                  id: header('svix-id'),
                  timestamp: header('svix-timestamp'),
                  signature: header('svix-signature'),
                },
                secret
              )
            : verifyMailgunDelivery(body, secret);
      } catch {
        res.status(400).json({ error: 'Nieprawidłowe zdarzenie' });
        return;
      }
      if (event) {
        const found = await recordLifecycleDelivery(event);
        // A provider callback can race the local acceptance write. Ask for retry rather than lose it.
        if (!found && event.messageId) {
          res
            .status(503)
            .json({ error: 'Wiadomość nie została jeszcze zapisana' });
          return;
        }
      }
      res.status(200).json({ received: true });
    },
  });
