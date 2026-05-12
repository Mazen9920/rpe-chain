import axios from 'axios';
import { secureStorage } from './secureStorage';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 10000,
});

// Attach JWT token to every request
api.interceptors.request.use(async (config) => {
  const token = await secureStorage.getItemAsync('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 globally
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await secureStorage.deleteItemAsync('token');
    }
    return Promise.reject(error);
  }
);

export default api;
