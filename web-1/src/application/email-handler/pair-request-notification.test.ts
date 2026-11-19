import { describe, expect, it } from 'vitest';
import { renderEmailTemplate } from './email-template.renderer';

describe('pair-request notification place and note', () => {
  it('escapes optional place and note and omits them when empty', () => {
    const withPlace = renderEmailTemplate(
      'pair-request-notification',
      {
        clientName: 'Anna',
        appUrl: 'https://nailfolio.app/app/pairing',
        place: '<b>Kraków</b>',
        note: 'czwartek 15:00',
      },
      'pl',
      'https://nailfolio.app/unsubscribe',
      'email.pairRequestNotification.subject'
    );
    expect(withPlace.html).toContain('Miejsce: &lt;b&gt;Kraków&lt;/b&gt;');
    expect(withPlace.html).not.toContain('<b>Kraków</b>');
    expect(withPlace.html).toContain('Wiadomość: czwartek 15:00');
    expect(withPlace.text).toContain('Kraków');

    const empty = renderEmailTemplate(
      'pair-request-notification',
      {
        clientName: 'Anna',
        appUrl: 'https://nailfolio.app/app/pairing',
        place: '',
        note: '   ',
      },
      'pl',
      'https://nailfolio.app/unsubscribe',
      'email.pairRequestNotification.subject'
    );
    expect(empty.html).not.toContain('Miejsce:');
    expect(empty.html).not.toContain('Wiadomość:');
  });
});
