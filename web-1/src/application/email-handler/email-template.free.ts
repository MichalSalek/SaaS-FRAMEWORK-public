import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  UPLOAD,
  PROFILE,
  PAIRING,
  standard,
  renderStandard,
  type BodyGenerator,
} from './email-template.bodies';

export const FREE_BODY_TEMPLATES: Record<string, BodyGenerator> = {
  'free-first-photo': standard({
    id: 'free-first-photo',
    medium: 'lifecycle',
    cta: UPLOAD,
  }),
  'free-public-profile': standard({
    id: 'free-public-profile',
    medium: 'lifecycle',
    cta: PROFILE,
  }),
  'free-first-client': (vars, locale) =>
    renderStandard(
      {
        id: 'free-first-client',
        medium: 'lifecycle',
        cta:
          vars['pendingRequest'] === '1'
            ? { path: ROUTES_FRONT.CLIENTS }
            : PAIRING,
        variants: vars['pendingRequest'] === '1',
      },
      {
        ...vars,
        previewVariant: vars['pendingRequest'] === '1' ? 'inactive' : 'active',
      },
      locale
    ),
};
