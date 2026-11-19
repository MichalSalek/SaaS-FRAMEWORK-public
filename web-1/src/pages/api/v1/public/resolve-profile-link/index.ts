import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import {
  ProfileLinkKindValue,
  type ProfileLinkKind,
} from '@kernel/models/db_models.generated.dto';
import { resolveProfileLink_IO } from '@domain/account/profile-link-alias.operations';

const isKind = (value: string): value is ProfileLinkKind =>
  Object.values<string>(ProfileLinkKindValue).includes(value);

// Called by the public stylist and salon pages only after their live lookup returned 404: an old
// link of a live profile answers with the current identifier, the page answers with a 301.
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_RESOLVE_PROFILE_LINK, {
  handle: async ({ input, res }) => {
    const kind = input.kind ?? '';
    const slug = input.slug;
    if (!isKind(kind) || !slug) {
      return respondValidationFailed(res, {
        kind: 'Required',
        slug: 'Required',
      });
    }
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300'
    );
    const result = await resolveProfileLink_IO({
      kind,
      slug: slug.toLowerCase(),
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ACCOUNT.PUBLIC_PROFILE_FETCHED
    );
  },
});
