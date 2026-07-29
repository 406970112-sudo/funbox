import { Platform } from 'react-native';

const CONFIGURED_APP_URL = process.env.EXPO_PUBLIC_EMAIL_AGENT_APP_URL?.trim();

export function getEmailAgentAppUrl() {
  if (CONFIGURED_APP_URL) {
    if (Platform.OS === 'android') {
      return CONFIGURED_APP_URL.replace(/:\/\/(localhost|127\.0\.0\.1)/, '://10.0.2.2');
    }

    return CONFIGURED_APP_URL;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      return 'https://localhost:5173';
    }

    return `${window.location.origin}/email-agent/`;
  }

  return Platform.OS === 'android' ? 'https://10.0.2.2:5173' : 'https://localhost:5173';
}
