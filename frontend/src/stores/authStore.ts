import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User { id: string; email: string; name: string; role: string }

interface AuthStore {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  setAuth: (token: string, user: User, refreshToken?: string | null) => void;
  setToken: (token: string) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      setAuth: (token, user, refreshToken) =>
        set((s) => ({ token, user, refreshToken: refreshToken ?? s.refreshToken })),
      setToken: (token) => set({ token }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      logout: () => set({ token: null, user: null, refreshToken: null }),
    }),
    { name: 'rpe-chain-auth' },
  ),
);
