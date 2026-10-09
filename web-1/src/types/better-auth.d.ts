import type { auth } from '../application/auth/better-auth/better-auth.config';

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
