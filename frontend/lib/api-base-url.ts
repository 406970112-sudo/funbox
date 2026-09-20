const defaultApiBaseUrls = {
  android: 'http://10.0.2.2:3000',
  default: 'http://127.0.0.1:3000',
} as const;

export function getAPIBaseUrl(platformOS?: string) {
  const fallback = platformOS === 'android' ? defaultApiBaseUrls.android : defaultApiBaseUrls.default;
  return (
    process.env.EXPO_PUBLIC_API_BASE_URL?.trim()
    || process.env.EXPO_PUBLIC_VOICE_SERVER_URL?.trim()
    || fallback
  ).replace(/\/$/, '');
}
