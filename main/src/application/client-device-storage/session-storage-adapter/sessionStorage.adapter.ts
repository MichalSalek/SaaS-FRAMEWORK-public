import { reportIssueFrontend } from '../../error-debugger/errorHandler.possibilities.api';

export const getSessionStorage = (key: string): string | null => {
  if (typeof sessionStorage === 'undefined') {
    reportIssueFrontend({
      namespace: 'getSessionStorage',
      message: `No sessionStorage access!`,
      payload: key,
      mode: 'error',
    });
    return null;
  }

  return sessionStorage.getItem(key);
};

export const deleteSessionStorage = (key: string): void => {
  if (typeof sessionStorage === 'undefined') {
    reportIssueFrontend({
      namespace: 'deleteSessionStorage',
      message: `No sessionStorage access!`,
      payload: key,
      mode: 'error',
    });
    return void undefined;
  }

  sessionStorage.removeItem(key);
};

export const setSessionStorage = (key: string, value: string): void => {
  if (typeof sessionStorage === 'undefined') {
    reportIssueFrontend({
      namespace: 'setSessionStorage',
      message: `No sessionStorage access!`,
      payload: key,
      mode: 'error',
    });
    return void undefined;
  }

  sessionStorage.setItem(key, value);
};
