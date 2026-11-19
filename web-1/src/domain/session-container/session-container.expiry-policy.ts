import { TIME } from '@kernel/application/constants.config';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { Prisma } from '../../prisma/js-client';

/** Extend only sessions still live at the sweep's fence; never reactivate or shorten. */
export const extendLiveSessionExpiryQuery = (now: Date): Prisma.Sql => {
  const windowMs =
    SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS * TIME.MS_PER_DAY;
  return Prisma.sql`
    UPDATE "SessionContainer"
    SET "expires_at" = "shared_at" + (${windowMs}::double precision * interval '1 millisecond')
    WHERE "lifecycle_state" IN (${SessionContainerLifecycleStateValue.SHARED}::"SessionContainerLifecycleState", ${SessionContainerLifecycleStateValue.ACTIVE}::"SessionContainerLifecycleState")
      AND "closed_at" IS NULL
      AND "shared_at" IS NOT NULL
      AND "expires_at" > ${now}
      AND "expires_at" < "shared_at" + (${windowMs}::double precision * interval '1 millisecond')
  `;
};
