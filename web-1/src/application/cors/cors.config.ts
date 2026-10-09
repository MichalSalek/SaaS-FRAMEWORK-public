import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ENV_VARS } from '@app/environment/environment.config';

const domains = ENV_VARS.FRONTEND_PUBLIC_DOMAIN.split(',').map(d => d.trim());
const ports = ENV_VARS.FRONTEND_PUBLIC_PORT
  ? ENV_VARS.FRONTEND_PUBLIC_PORT.split(',')
      .map(p => p.trim())
      .filter(Boolean)
  : [];
const portSuffixes = ports.map(p => `:${p}`);

export const CORS_ALLOWED_ORIGINS = domains.flatMap(domain => {
  const withPorts = portSuffixes.flatMap(port => [
    `http://${domain}${port}`,
    `https://${domain}${port}`,
    `${domain}${port}`,
  ]);

  return [...withPorts, `http://${domain}`, `https://${domain}`, `${domain}`];
});

export const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    '' +
    'Content-Type, ' +
    'Pathname, ' +
    'Cache-Control, ' +
    'Accept, ' +
    'Pragma, ' +
    'Referer, ' +
    'Upgrade-Insecure-Requests, ' +
    Object.values(CUSTOM_HEADERS).join(', '),
  'Access-Control-Expose-Headers': Object.values(CUSTOM_HEADERS).join(', '),
  'Access-Control-Allow-Credentials': 'true',
});

export const CORS_HEADERS_KEYS = Object.keys(CORS_HEADERS);

export const CORS_HEADERS_VALUES = Object.values(CORS_HEADERS);
