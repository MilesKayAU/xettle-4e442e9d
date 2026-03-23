export const XERO_OAUTH_STATE_KEY = 'xero_oauth_state';
export const XERO_OAUTH_RETURN_PATH_KEY = 'xero_oauth_return_path';
export const DEFAULT_XERO_RETURN_PATH = '/dashboard';

const XERO_CALLBACK_PATH = '/xero/callback';

const isSafeInternalPath = (value: string | null | undefined): value is string => {
  if (!value) return false;
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (value.startsWith(XERO_CALLBACK_PATH)) return false;
  return true;
};

const sanitizeReturnPath = (value: string | null | undefined) =>
  isSafeInternalPath(value) ? value : DEFAULT_XERO_RETURN_PATH;

export const getCurrentPathWithSearch = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

export const storeXeroOauthReturnPath = (path = getCurrentPathWithSearch()) => {
  const safePath = sanitizeReturnPath(path);
  window.sessionStorage.setItem(XERO_OAUTH_RETURN_PATH_KEY, safePath);
  return safePath;
};

export const getXeroOauthReturnPath = () =>
  sanitizeReturnPath(window.sessionStorage.getItem(XERO_OAUTH_RETURN_PATH_KEY));

export const clearXeroOauthReturnPath = () => {
  window.sessionStorage.removeItem(XERO_OAUTH_RETURN_PATH_KEY);
};

export const clearXeroOauthState = () => {
  window.sessionStorage.removeItem(XERO_OAUTH_STATE_KEY);
};

export const buildXeroCompletionPath = (path = DEFAULT_XERO_RETURN_PATH) => {
  const safePath = sanitizeReturnPath(path);

  if (!safePath.startsWith('/dashboard')) {
    return safePath;
  }

  const url = new URL(safePath, window.location.origin);
  url.searchParams.set('connected', 'xero');
  return `${url.pathname}${url.search}${url.hash}`;
};