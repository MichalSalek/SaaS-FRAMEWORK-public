import { reportIssueFrontend } from '../../error-debugger/errorHandler.possibilities.api';

export const getLocalStorage = (key: string): string | null => {
  if (typeof localStorage === 'undefined') {
    reportIssueFrontend({
      namespace: 'getLocalStorage',
      message: `No localStorage access!`,
      payload: key,
      mode: 'error',
    });
    return null;
  }

  return localStorage.getItem(key);
};

export const deleteLocalStorage = (key: string): void => {
  if (typeof localStorage === 'undefined') {
    reportIssueFrontend({
      namespace: 'deleteLocalStorage',
      message: `No localStorage access!`,
      payload: key,
      mode: 'error',
    });
    return void undefined;
  }

  localStorage.removeItem(key);
};

export const setLocalStorage = (key: string, value: string): void => {
  if (typeof localStorage === 'undefined') {
    reportIssueFrontend({
      namespace: 'setLocalStorage',
      message: `No localStorage access!`,
      payload: key,
      mode: 'error',
    });
    return void undefined;
  }

  localStorage.setItem(key, value);
};
