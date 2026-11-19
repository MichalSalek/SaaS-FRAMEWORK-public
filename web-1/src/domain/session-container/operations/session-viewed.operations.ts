import { DB_CLIENT } from '@app/db/db.client';

/** First stylist read marks the session as viewed; analytics only, never blocking. */
export async function markSessionViewed(
  sessionId: string,
  viewedAt: Date | null
): Promise<void> {
  if (viewedAt !== null) {
    return;
  }
  try {
    await DB_CLIENT.use.sessionContainer.updateMany({
      where: { id: sessionId, viewed_at: null },
      data: { viewed_at: new Date() },
    });
  } catch {
    // Deliberately non-blocking: the read must succeed without this signal.
  }
}
