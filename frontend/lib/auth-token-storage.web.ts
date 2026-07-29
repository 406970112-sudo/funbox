const accessTokenKey = 'funbox.auth.access-token.v1';

export async function getStoredAccessToken() {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(accessTokenKey);
}

export async function setStoredAccessToken(token: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(accessTokenKey, token);
  }
}

export async function removeStoredAccessToken() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(accessTokenKey);
  }
}
