let memoryToken: string | null = null;

export async function getStoredAccessToken() {
  return memoryToken;
}

export async function setStoredAccessToken(token: string) {
  memoryToken = token;
}

export async function removeStoredAccessToken() {
  memoryToken = null;
}
