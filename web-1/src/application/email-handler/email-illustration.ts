import { getEmailPreviewSpec } from '@kernel/domain/email/email-preview.catalog';

/** Nail-art collection; source prompts and approval state live in assets-library/ozdobniki/nail-art-v2/. */
export const EMAIL_ILLUSTRATIONS = {
  welcome: '/img/email/v2/welcome.png',
  gallery: '/img/email/v2/gallery.png',
  connection: '/img/email/v2/connection.png',
  payment: '/img/email/v2/payment.png',
  security: '/img/email/v2/security.png',
  message: '/img/email/v2/message.png',
  return: '/img/email/v2/return.png',
} as const;

export const getEmailIllustration = (templateId: string): string => {
  if (templateId.includes('winback') || templateId.startsWith('cancel-')) {
    return EMAIL_ILLUSTRATIONS.return;
  }
  if (templateId === 'support-reply-notification') {
    return EMAIL_ILLUSTRATIONS.message;
  }
  const group = getEmailPreviewSpec(templateId)?.group;
  switch (group) {
    case 'auth':
    case 'account':
      return EMAIL_ILLUSTRATIONS.security;
    case 'billing':
      return EMAIL_ILLUSTRATIONS.payment;
    case 'pairing':
      return templateId === 'messaging-notification'
        ? EMAIL_ILLUSTRATIONS.message
        : EMAIL_ILLUSTRATIONS.connection;
    case 'trial':
      return EMAIL_ILLUSTRATIONS.gallery;
    default:
      return EMAIL_ILLUSTRATIONS.welcome;
  }
};
