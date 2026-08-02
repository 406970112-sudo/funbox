import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import {
  createRealDataCache,
  type CacheStorage,
} from '@/lib/real-data-cache-core';

function createPlatformStorage(): CacheStorage {
  if (Platform.OS === 'web') {
    return {
      async getItem(key) {
        if (typeof window === 'undefined') return null;
        return window.localStorage.getItem(key);
      },
      async setItem(key, value) {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, value);
        }
      },
      async removeItem(key) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(key);
        }
      },
    };
  }

  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  };
}

export const realDataCache = createRealDataCache(createPlatformStorage());
export { createRealDataCache } from '@/lib/real-data-cache-core';
