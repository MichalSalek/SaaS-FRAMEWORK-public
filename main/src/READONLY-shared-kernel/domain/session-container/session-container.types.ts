/**
 * Session Container shared domain types
 *
 * Lifecycle helpers using generated SessionContainerLifecycleStateValue (SSOT from Prisma).
 */

import { SessionContainerLifecycleStateValue } from '../../models/db_models.generated.dto';
import type { SessionContainerLifecycleState } from '../../models/db_models.generated.dto';

const ACTIVE_LIFECYCLE_STATES: ReadonlySet<SessionContainerLifecycleState> =
  new Set([
    SessionContainerLifecycleStateValue.SHARED,
    SessionContainerLifecycleStateValue.ACTIVE,
  ]);

const TERMINAL_LIFECYCLE_STATES: ReadonlySet<SessionContainerLifecycleState> =
  new Set([
    SessionContainerLifecycleStateValue.EXPIRED,
    SessionContainerLifecycleStateValue.CLOSED,
  ]);

const DRAFT_LIFECYCLE_STATES: ReadonlySet<SessionContainerLifecycleState> =
  new Set([
    SessionContainerLifecycleStateValue.DRAFT,
    SessionContainerLifecycleStateValue.READY,
  ]);

export const isActiveSession = (
  state: SessionContainerLifecycleState
): boolean => ACTIVE_LIFECYCLE_STATES.has(state);

export const isTerminalSession = (
  state: SessionContainerLifecycleState
): boolean => TERMINAL_LIFECYCLE_STATES.has(state);

export const isDraftSession = (
  state: SessionContainerLifecycleState
): boolean => DRAFT_LIFECYCLE_STATES.has(state);
