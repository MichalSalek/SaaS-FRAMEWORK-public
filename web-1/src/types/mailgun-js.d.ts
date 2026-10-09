declare module 'mailgun.js' {
  export type MailgunClientOptions = {
    username: string;
    key: string;
    url?: string;
  };

  export default class Mailgun {
    constructor(formData: unknown);
    client(options: MailgunClientOptions): unknown;
  }
}
