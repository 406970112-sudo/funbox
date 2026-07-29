import * as SecureStore from 'expo-secure-store';

const accessTokenKey = 'funbox.auth.access-token.v1';

export function getStoredAccessToken() {
  return SecureStore.getItemAsync(accessTokenKey);
}

export function setStoredAccessToken(token: string) {
  return SecureStore.setItemAsync(accessTokenKey, token);
}

export function removeStoredAccessToken() {
  return SecureStore.deleteItemAsync(accessTokenKey);
}
