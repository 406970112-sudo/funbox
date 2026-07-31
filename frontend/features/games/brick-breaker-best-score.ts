import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const bestScoreKey = 'funbox.brick-breaker.best-score.v1';

export async function getStoredBrickBreakerBestScore() {
  const value =
    Platform.OS === 'web'
      ? typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(bestScoreKey)
      : await SecureStore.getItemAsync(bestScoreKey);
  const score = Number.parseInt(value ?? '0', 10);

  return Number.isFinite(score) && score > 0 ? score : 0;
}

export async function setStoredBrickBreakerBestScore(score: number) {
  const normalizedScore = String(Math.max(0, Math.floor(score)));
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(bestScoreKey, normalizedScore);
    }
    return;
  }

  await SecureStore.setItemAsync(bestScoreKey, normalizedScore);
}
