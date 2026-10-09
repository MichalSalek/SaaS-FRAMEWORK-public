export type NewsletterAlreadySubscribedError = {
  type: 'ALREADY_SUBSCRIBED';
};

export type NewsletterSubscribeFailedError = {
  type: 'SUBSCRIBE_FAILED';
  reason: string;
};

export type NewsletterInvalidTokenError = {
  type: 'NEWSLETTER_INVALID_TOKEN';
};

export type NewsletterUnsubscribeNotFoundError = {
  type: 'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND';
};

export type NewsletterError =
  | NewsletterAlreadySubscribedError
  | NewsletterSubscribeFailedError
  | NewsletterInvalidTokenError
  | NewsletterUnsubscribeNotFoundError;
