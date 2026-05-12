import { create } from 'zustand';
import { secureStorage } from '../lib/secureStorage';
import api from '../lib/api';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'STAFF';
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isLoading: true,

  loadSession: async () => {
    const token = await secureStorage.getItemAsync('token');
    if (token) {
      try {
        const res = await api.get('/auth/me');
        set({ user: res.data, token, isLoading: false });
      } catch {
        await secureStorage.deleteItemAsync('token');
        set({ user: null, token: null, isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    await secureStorage.setItemAsync('token', res.data.token);
    set({ user: res.data.user, token: res.data.token });
  },

  logout: async () => {
    await secureStorage.deleteItemAsync('token');
    set({ user: null, token: null });
  },
}));
