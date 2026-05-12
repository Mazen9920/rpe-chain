// Cross-platform token storage. Uses expo-secure-store on native, localStorage on web.
import { Platform } from 'react-native';

type Store = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

let impl: Store;

if (Platform.OS === 'web') {
  impl = {
    getItemAsync: async (key) => {
      try {
        return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      } catch {
        return null;
      }
    },
    setItemAsync: async (key, value) => {
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
      } catch {}
    },
    deleteItemAsync: async (key) => {
      try {
        if (typeof window !== 'undefined') window.localStorage.removeItem(key);
      } catch {}
    },
  };
} else {
  // Lazy require so web bundle doesn't try to resolve the native module.
  const SecureStore = require('expo-secure-store');
  impl = {
    getItemAsync: SecureStore.getItemAsync,
    setItemAsync: SecureStore.setItemAsync,
    deleteItemAsync: SecureStore.deleteItemAsync,
  };
}

export const secureStorage = impl;
