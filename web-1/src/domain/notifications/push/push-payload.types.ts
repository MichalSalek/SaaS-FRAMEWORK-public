/**
 * What every device receives, whatever the transport. The service worker and
 * the Android plugin both read `url` to open the owned notification and
 * `tag` to collapse repeats of the same subject (`tag` = the row's dedup key).
 */
export type PushPayload = {
  title: string;
  body: string;
  /** Owned notification opener, or the legacy notification centre while its flag is off. */
  url: string;
  tag: string;
  notificationId: string;
};

export type PushDeliveryOutcome =
  /** Accepted by the push service. */
  | 'sent'
  /** The device is gone for good (404/410, UNREGISTERED): drop the subscription. */
  | 'gone'
  /** Anything else (network, 5xx, auth): keep the device, remember the failure. */
  | 'failed';
