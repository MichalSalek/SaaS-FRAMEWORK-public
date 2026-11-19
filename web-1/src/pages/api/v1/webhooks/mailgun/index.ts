import { lifecycleWebhookHandler } from '@app/email-handler/lifecycle/delivery-webhook-handler';
export const config = { api: { bodyParser: false } };
export default lifecycleWebhookHandler('mailgun');
