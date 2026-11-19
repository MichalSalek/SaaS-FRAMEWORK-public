/**
 * Identity of the conversation partner in a support thread: name and address, or a translated
 * fallback.
 *
 * DECISION: the account may be deleted or moved after 90 days (soft-FK); the backend then returns
 * an empty string and a translated fallback is shown. The thread avatar is the shared AvatarAtom,
 * which derives initials and tone from the name like everywhere else; this panel has no avatar
 * logic of its own.
 */

interface ThreadIdentitySource {
  user_name?: string;
  user_email?: string;
}

export interface ThreadIdentity {
  name: string;
  /** Address to show; the translated fallback when the account is gone. */
  email: string;
  /** The real address, or null: only a real one can open the user's card. */
  knownEmail: string | null;
}

export function resolveThreadIdentity(
  thread: ThreadIdentitySource | null | undefined,
  fallback: { name: string; email: string }
): ThreadIdentity {
  const name = thread?.user_name?.trim();
  const email = thread?.user_email?.trim();
  const hasName = name !== undefined && name.length > 0;
  const hasEmail = email !== undefined && email.length > 0;
  return {
    // Without a name the person is their address (as in the thread list).
    name: hasName ? name : hasEmail ? email : fallback.name,
    email: hasEmail ? email : fallback.email,
    knownEmail: hasEmail ? email : null,
  };
}
