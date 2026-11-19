// Application -> domain gateway for the Better Auth sign-in hook: a sign-in finishes accepted salon
// invitations (DECISION in salon-invitation-token.service.ts). Kept out of the domain-interceptors
// barrel on purpose: that barrel loads user-session.operations, which loads better-auth.config,
// so routing this import through it would close a value cycle.
export { finishAcceptedSalonInvitations } from '@domain/salon-staff/salon-invitation-token.service';
