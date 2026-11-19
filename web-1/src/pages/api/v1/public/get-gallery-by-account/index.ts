import { defineEndpoint } from '@app/http/define-endpoint';
import { VALIDATION_GALLERY } from '@kernel/policies/validation.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { publicGetGalleryRecordsByAccount_IO } from '@domain/gallery/operations/gallery-public.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { qStr } from '@app/http/query-params.utils';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(
  GALLERY_CONTRACTS.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT,
  {
    handle: async ({ input, res, req, ok }) => {
      res.setHeader(
        'Cache-Control',
        'public, max-age=60, stale-while-revalidate=300'
      );

      // DECISION: `account_id` is read back from the query, not from the parsed body. The
      // `nf/identity-from-session` ratchet forbids identity fields from the request body.
      // Here `account_id` is the SUBJECT of a public read (whose profile), not the caller's
      // identity. The query schema already rejected an empty value, so `?? ''` is unreachable.
      const account_id = qStr(req.query, 'account_id') ?? '';

      // DoS cap: each filter id becomes its own condition, so query cost grows
      // non-linearly (measured: 200 ids = 7s per request). Limit SSOT:
      // VALIDATION_GALLERY.MAX_FILTER_*. Slicing rather than rejecting is deliberate:
      // a performance guard, not a contract. The kernel schema declares no maximum
      // length for these arrays.
      const props = {
        account_id,
        ...(input.limit !== undefined && { limit: input.limit }),
        ...(input.offset !== undefined && { offset: input.offset }),
        ...(input.color_ids !== undefined && {
          color_ids: input.color_ids.slice(
            0,
            VALIDATION_GALLERY.MAX_FILTER_COLOR_IDS
          ),
        }),
        ...(input.trait_ids !== undefined && {
          trait_ids: input.trait_ids.slice(
            0,
            VALIDATION_GALLERY.MAX_FILTER_TRAIT_IDS
          ),
        }),
      };
      const result = await publicGetGalleryRecordsByAccount_IO({ props });

      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      reportIssueBackend({
        namespace: 'PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT',
        message: 'Public gallery records fetched successfully',
        payload: {
          account_id,
          returned_count: result.data.records.length,
          total_count: result.data.total_count,
        },
        mode: 'info',
      });

      ok(result.data, APP_EVENTS.INFO.GALLERY.PUBLIC_GALLERY_RECORDS_FETCHED);
    },
  }
);
