import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { getFromClientStorage } from '../client-device-storage/clientStorage.possibilities.api';

export type DocumentCredentials = {
  authorization: string | null;
  becomeUser: string | null;
};
export const DOCUMENT_CREDENTIAL_MISMATCH = 'nf:document-credential-mismatch';
let bound: DocumentCredentials | undefined;
export function readDocumentCredentials(): DocumentCredentials {
  return {
    authorization: getFromClientStorage({ key: CUSTOM_HEADERS.authorization }),
    becomeUser: getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser }),
  };
}
export function bindDocumentCredentials(): void {
  bound = readDocumentCredentials();
}
/** Only an accepted login for this exact token can replace the document binding. */
export function bindDocumentCredentialsIfCurrent(
  authorization: string
): DocumentCredentials | null {
  const current = readDocumentCredentials();
  if (current.authorization !== authorization) {
    return null;
  }
  bound = current;
  return current;
}
export function boundDocumentCredentials(): DocumentCredentials | undefined {
  return bound ? { ...bound } : undefined;
}
export function credentialsEqual(
  a: DocumentCredentials,
  b: DocumentCredentials
): boolean {
  return a.authorization === b.authorization && a.becomeUser === b.becomeUser;
}
export function currentCredentialsMatch(
  expected: DocumentCredentials
): boolean {
  return credentialsEqual(expected, readDocumentCredentials());
}
export function checkedDocumentCredentials(): DocumentCredentials | null {
  const current = readDocumentCredentials();
  if (bound === undefined) {
    bound = current;
  }
  if (!credentialsEqual(bound, current)) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(DOCUMENT_CREDENTIAL_MISMATCH));
    }
    return null;
  }
  return current;
}
export function notifyCredentialMismatch(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DOCUMENT_CREDENTIAL_MISMATCH));
  }
}
