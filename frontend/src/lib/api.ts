import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Single-flight refresh: while one refresh is in flight, queue concurrent 401s.
let refreshing: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const rt = useAuthStore.getState().refreshToken;
  if (!rt) return null;
  try {
    const { data } = await axios.post('/api/auth/refresh', { refreshToken: rt });
    if (data?.token) {
      useAuthStore.getState().setToken(data.token);
      if (data.refreshToken) useAuthStore.getState().setRefreshToken(data.refreshToken);
      return data.token as string;
    }
    return null;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as AxiosRequestConfig & { _retry?: boolean };
    const status = err.response?.status;
    // Don't try to refresh on the refresh / login endpoints themselves.
    const url = original?.url || '';
    const isAuthEndpoint = url.includes('/auth/refresh') || url.includes('/auth/login');

    if (status === 401 && !original?._retry && !isAuthEndpoint && useAuthStore.getState().refreshToken) {
      original._retry = true;
      if (!refreshing) refreshing = performRefresh().finally(() => { refreshing = null; });
      const newToken = await refreshing;
      if (newToken) {
        original.headers = original.headers || {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${newToken}`;
        return api.request(original);
      }
      useAuthStore.getState().logout();
    } else if (status === 401 && !isAuthEndpoint) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  },
);

export default api;
