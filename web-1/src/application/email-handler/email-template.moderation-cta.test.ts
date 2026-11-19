import { describe, it, expect } from 'vitest';
import { renderEmailTemplate } from './email-template.renderer';

const render = (action: string, galleryRecordId = 'rec-1') =>
  renderEmailTemplate(
    'moderation-owner-notification',
    {
      moderationAction: action,
      galleryRecordId,
      appUrl: 'https://nailfolio.app',
    },
    'pl',
    '',
    'email.moderation.owner.subject'
  );

describe('moderation owner mail: the button follows the decision', () => {
  it('HIDE and WARN open the photo itself', () => {
    for (const action of ['HIDE', 'WARN']) {
      const { html, text } = render(action);
      expect(html).toContain('/app/photo/rec-1');
      expect(text).toContain('Zobacz to zdjęcie');
    }
  });

  it('DELETE opens the gallery, because the photo is gone', () => {
    const { html, text } = render('DELETE');
    expect(html).not.toContain('/app/photo/');
    expect(html).toContain('/app/gallery');
    expect(text).toContain('Otwórz galerię');
  });

  it('BAN has no button: every app route would answer 403', () => {
    const { html, text } = render('BAN');
    expect(html).not.toContain('/app/photo/');
    expect(html).not.toContain('/app/gallery');
    expect(html).toContain('support@nailfolio.app');
    // and it reads about the account, not about a photo
    expect(text).toContain('Konto zostało zablokowane');
    expect(text).not.toContain('Decyzja w sprawie zdjęcia');
  });
});
