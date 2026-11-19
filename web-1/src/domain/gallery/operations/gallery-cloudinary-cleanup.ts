import { cloudinary } from '@app/cloudinary/cloudinary.adapter';
import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
} from '@app/cloudinary/cloudinary-url.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { runAfterResponse } from '@app/runtime/run-after-response';

const RETRY_ATTEMPTS = 3;
// DECISION: 500ms, not the kernel RETRY.BASE_DELAY_MS (1000): orphan cleanup deliberately uses a
// tighter backoff than the email/Stripe retry loops. Do not merge it with the kernel RETRY.
const RETRY_BASE_DELAY_MS = 500;

// Cloudinary admin API delete_resources accepts max 100 public_ids per request.
const BATCH_SIZE = 100;

/**
 * Does this URL point at the cloud we operate?
 *
 * DECISION: `public_id` is computed from the URL alone, also when the URL belongs to ANOTHER cloud.
 * `UPLOAD_PATH_REGEX` matches `/upload/.../v<digits>/<rest>` anywhere and ignores the account segment,
 * and the input validator (`isCloudinaryAssetUrl`) only checks the `res.cloudinary.com/` prefix, so
 * `https://res.cloudinary.com/<other-cloud>/image/upload/v1/x.jpg` yielded `x`, an id in OUR namespace,
 * and would delete our file `x`. This check is fail-closed: with CLOUDINARY_CLOUD_NAME empty no address
 * belongs to our cloud and deletion is skipped (see the DECISION in cloudinary.adapter.ts).
 */
const belongsToOurCloud = (assetUrl: string): boolean => {
  const cloudName = ENV_VARS.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    return false;
  }
  return assetUrl.startsWith(`https://res.cloudinary.com/${cloudName}/`);
};

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Single-record variant (gallery record delete). It delegates to the batch version so cascade deletes
 * share one "is anyone still using this" gate (see filterUnreferencedUrls); it used to call
 * `uploader.destroy` itself and bypassed the gate.
 *
 * `deleteAssetFromVendor_IO` (gallery-asset.operations.ts) has its own `uploader.destroy` and is
 * intentionally not merged here: it verifies row ownership and deletes the `public_id` derived from the
 * STORED record, never client input. If it ever accepted a client identifier it MUST go through this sink.
 */
export const cleanupCloudinaryAsset = (assetUrl: string): void => {
  cleanupCloudinaryAssets([assetUrl]);
};

/**
 * Response shape of `cloudinary.api.delete_resources` (the SDK declares Promise<any>).
 * `deleted` maps every requested public_id to either 'deleted' (success) or 'not_found'
 * (already gone — treated as success here since cleanup is idempotent). Other status
 * strings are theoretically possible per Cloudinary docs and are logged for investigation.
 */
interface DeleteResourcesResponse {
  deleted?: Record<string, string>;
  partial?: boolean;
}

/**
 * Batch-delete via Cloudinary admin API with retry on transient transport errors.
 * Returns the per-id status map so the caller can log unexpected statuses.
 */
const batchDeleteWithRetry = async (
  publicIds: readonly string[]
): Promise<DeleteResourcesResponse> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = (await cloudinary.api.delete_resources([
        ...publicIds,
      ])) as DeleteResourcesResponse;
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
};

/**
 * DECISION: the still-referenced gate lives at this sink, not in each caller
 * (gallery delete, visit photo, whole visit, account delete by user or admin).
 * public_id comes from the URL alone, so a known foreign URL deletes that file;
 * one asset on two visits used to vanish from both. The caller deletes its own
 * row first, so any remaining reference keeps the blob. Fail-closed: a failed
 * query deletes nothing. Match public_id, not the URL spelling.
 */
const filterUnreferencedUrls = async (urls: string[]): Promise<string[]> => {
  const publicIdByUrl = new Map<string, string>();
  for (const url of urls) {
    const publicId = extractPublicIdFromUrl(url);
    if (publicId !== null) {
      publicIdByUrl.set(url, publicId);
    }
  }

  // DECISION: candidates are NOT narrowed by `contains` on the raw column. The URL -> public_id mapping is
  // many-to-one and unbounded (any character can be percent-encoded, any segment added or removed with
  // `..`), so no finite set of terms finds every row referencing the file, and a row stored
  // non-canonically would stop protecting the blob. The cost is only apparent: `contains` is
  // `LIKE '%...%'`, which a b-tree cannot serve anyway, so the old lookup was a sequential scan too.
  if (publicIdByUrl.size === 0) {
    return [];
  }

  const [galleryRows, visitPhotoRows, avatarRows, userAvatarRows, logoRows] =
    await Promise.all([
      DB_CLIENT.use.galleryRecord.findMany({ select: { asset_url: true } }),
      DB_CLIENT.use.visitResultPhoto.findMany({ select: { asset_url: true } }),
      // Stylist avatar_url is a third stored file address. Without this row the
      // still-in-use gate ignored avatars, so replacing or removing one's own
      // avatar could delete a file that is also someone else's avatar.
      // A new column that stores a file URL has to be included here.
      DB_CLIENT.use.stylistAccount.findMany({
        where: { avatar_url: { not: null } },
        select: { avatar_url: true },
      }),
      DB_CLIENT.use.user.findMany({
        where: {
          OR: [{ avatar_url: { not: null } }, { image: { not: null } }],
        },
        select: { avatar_url: true, image: true },
      }),
      DB_CLIENT.use.stylistAccount.findMany({
        where: { salon_logo_url: { not: null } },
        select: { salon_logo_url: true },
      }),
    ]);

  // Parseable rows go into a set (one read). Unrecognized rows stay on a list
  // and are checked with the predicate. Without the split, every cleanup batch
  // would scan the product of both collections.
  const referencedPublicIds = new Set<string>();
  const unparseableReferences: string[] = [];
  const referencedUrls: string[] = [
    ...galleryRows.map(row => row.asset_url),
    ...visitPhotoRows.map(row => row.asset_url),
    ...userAvatarRows
      .flatMap(row => [row.avatar_url, row.image])
      .filter((url): url is string => url !== null),
    ...logoRows
      .map(row => row.salon_logo_url)
      .filter((url): url is string => url !== null),
    ...avatarRows
      .map(row => row.avatar_url)
      .filter((url): url is string => url !== null),
  ];
  for (let i = 0; i < referencedUrls.length; i++) {
    const referencedUrl = referencedUrls[i];
    if (referencedUrl === undefined) {
      continue;
    }
    const publicId = extractPublicIdFromUrl(referencedUrl);
    if (publicId === null) {
      unparseableReferences.push(referencedUrl);
    } else {
      referencedPublicIds.add(publicId);
    }
  }

  // DECISION: an unrecognized row protects only the public_ids its normalized address actually names,
  // not the whole batch (one row without a derivable public_id used to block cleanup of every
  // candidate). Still fail-closed per file.
  return urls.filter(url => {
    const publicId = publicIdByUrl.get(url);
    // A URL with no derivable public_id is dropped by the sink, so this filter
    // does not need to pass it through.
    if (publicId === undefined || referencedPublicIds.has(publicId)) {
      return false;
    }
    for (let i = 0; i < unparseableReferences.length; i++) {
      const reference = unparseableReferences[i];
      if (
        reference !== undefined &&
        assetUrlReferencesPublicId(reference, publicId)
      ) {
        return false;
      }
    }
    return true;
  });
};

/**
 * DECISION: batch admin API instead of a per-asset `uploader.destroy()` loop. Account deletion may clean
 * up hundreds of assets, and ~200-400ms per call ballooned to minutes; `delete_resources` accepts up to
 * 100 public_ids per call, so the work is chunked by 100. Fire-and-forget at the call site, per-chunk
 * retry, failures go to reportIssueBackend. 'not_found' counts as success (idempotent cleanup).
 */
export const cleanupCloudinaryAssets = (assetUrls: string[]): void => {
  // Resolve public IDs first; track URL for log context if delete reports unexpected status.
  const publicIdToUrl = new Map<string, string>();
  for (const url of assetUrls) {
    // A URL outside OUR cloud never becomes a `public_id` to delete (see belongsToOurCloud).
    if (!belongsToOurCloud(url)) {
      continue;
    }
    const publicId = extractPublicIdFromUrl(url);
    if (publicId && !publicIdToUrl.has(publicId)) {
      publicIdToUrl.set(publicId, url);
    }
  }

  if (publicIdToUrl.size === 0) {
    return;
  }

  // DECISION: `runAfterResponse`, not a bare detached `void (async ...)()`. This loop deletes vendor
  // files on behalf of a user who just deleted an account or photos; as a bare promise it lived outside
  // the in-flight registry, so gracefulShutdown (instrumentation.ts) could not see it, and SIGTERM comes
  // with every Render redeploy. A half-finished batch leaves a blob whose references are already gone,
  // so nobody retries it. `runAfterResponse` does not delay the response; it only tracks the promise so
  // the drain can finish the batch before `process.exit`.
  runAfterResponse(async () => {
    let deletableUrls: Set<string>;
    try {
      deletableUrls = new Set(
        await filterUnreferencedUrls([...publicIdToUrl.values()])
      );
    } catch (error) {
      reportIssueBackend({
        namespace: 'CLOUDINARY_CLEANUP_REFERENCE_CHECK_FAILED',
        message: `Skipping cleanup of ${publicIdToUrl.size} assets — reference check failed (fail-closed: an asset in use must never be deleted)`,
        payload: {
          assetCount: publicIdToUrl.size,
          error: error instanceof Error ? error.message : String(error),
        },
        mode: 'error',
      });
      return;
    }

    const publicIds = [...publicIdToUrl.entries()]
      .filter(([, url]) => deletableUrls.has(url))
      .map(([publicId]) => publicId);

    if (publicIds.length === 0) {
      return;
    }

    const totalCount = publicIds.length;

    for (let offset = 0; offset < publicIds.length; offset += BATCH_SIZE) {
      const chunk = publicIds.slice(offset, offset + BATCH_SIZE);
      try {
        const result = await batchDeleteWithRetry(chunk);
        const deleted = result.deleted ?? {};
        for (const id of chunk) {
          const status = deleted[id];
          if (status === 'deleted' || status === 'not_found') {
            continue;
          }
          // Unknown status — log per-id (rare; usually means access denied or quota).
          reportIssueBackend({
            namespace: 'CLOUDINARY_CLEANUP_UNEXPECTED_STATUS',
            message: `Unexpected delete_resources status for ${id}: ${status ?? 'undefined'}`,
            payload: {
              publicId: id,
              assetUrl: publicIdToUrl.get(id),
              status: status ?? null,
              partial: result.partial ?? false,
            },
            mode: 'error',
          });
        }
      } catch (error) {
        reportIssueBackend({
          namespace: 'CLOUDINARY_CLEANUP_FAILED',
          message: `Failed to batch-delete ${chunk.length} assets from Cloudinary after ${RETRY_ATTEMPTS} attempts (chunk ${offset / BATCH_SIZE + 1} of ${Math.ceil(totalCount / BATCH_SIZE)})`,
          payload: {
            chunkSize: chunk.length,
            chunkOffset: offset,
            totalCount,
            attempts: RETRY_ATTEMPTS,
            // Identyfikatory MUSZA byc w logu: bez nich nieudane kasowanie jest
            // nie do ponowienia, nie do zaudytowania i nie do udowodnienia przy
            // obowiazku usuniecia danych. Wczesniej payload nie niosl ani jednego
            // `public_id`, a blad schodzil do `[object Object]` (zmierzone na zywym
            // logu deva) — czyli awaria NIEODWRACALNEJ operacji nie zostawiala sladu.
            publicIds: [...chunk],
            error:
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : typeof error === 'object' && error !== null
                  ? JSON.stringify(error)
                  : String(error),
          },
          mode: 'error',
        });
        // Continue with the next chunk — partial cleanup is better than zero cleanup.
      }
    }
  });
};
