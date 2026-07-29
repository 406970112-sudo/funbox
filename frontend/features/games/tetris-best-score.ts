import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const bestScoreKey = 'funbox.tetris.best-score.v1';

export async function getStoredTetrisBestScore() {
  const value =
    Platform.OS === 'web'
      ? typeof window === 'undefined'
        ? null
        : window.localStorage.getItem(bestScoreKey)
      : await SecureStore.getItemAsync(bestScoreKey);
  const score = Number.parseInt(value ?? '0', 10);

  return Number.isFinite(score) ? score : 0;
}

export async function setStoredTetrisBestScore(score: number) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(bestScoreKey, String(score));
    }

    return;
  }

  await SecureStore.setItemAsync(bestScoreKey, String(score));
}
