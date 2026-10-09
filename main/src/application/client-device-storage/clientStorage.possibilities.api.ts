import {
  deleteLocalStorage,
  getLocalStorage,
  setLocalStorage,
} from './local-storage-adapter/localStorage.adapter';
import {
  deleteSessionStorage,
  getSessionStorage,
  setSessionStorage,
} from './session-storage-adapter/sessionStorage.adapter';

export const getFromClientStorage = ({
  key,
}: {
  key: string;
}): string | null => {
  const sessionValue = getSessionStorage(key);
  if (sessionValue) {
    return sessionValue;
  } else {
    return getLocalStorage(key);
  }
};

export const setToClientStorage = ({
  key,
  value,
  sessionOnly = false,
}: {
  key: string;
  value: string;
  sessionOnly?: boolean;
}): void => {
  if (sessionOnly) {
    setSessionStorage(key, value);
  } else {
    setLocalStorage(key, value);
  }
};

export const deleteFromClientStorage = ({ key }: { key: string }): void => {
  deleteSessionStorage(key);
  deleteLocalStorage(key);
};
