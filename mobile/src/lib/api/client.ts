import axios, { AxiosError, InternalAxiosRequestConfig, create as createHttpClient } from 'axios';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './tokenStore';

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code = 'UNKNOWN', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Wired by AuthProvider to reset navigation to the auth flow when the session dies. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

const baseURL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const api = createHttpClient({
  baseURL,
  timeout: 15000,
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Rotate the stored refresh token for a fresh access token. Concurrent 401s
 * share one in-flight refresh; any failure returns null (caller signs out).
 */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<string | null> {
  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;
    // Bare axios: the interceptors on `api` must not recurse into refresh.
    const res = await axios.post<{ success: boolean; data?: { accessToken?: string; refreshToken?: string } }>(
      `${baseURL}/auth/refresh`,
      { refreshToken },
      { timeout: 15000 },
    );
    const data = res.data?.data;
    if (!data?.accessToken) return null;
    await setAccessToken(data.accessToken);
    if (data.refreshToken) await setRefreshToken(data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

function isAuthPath(url?: string): boolean {
  return (url ?? '').includes('/auth/');
}

api.interceptors.response.use(
  (response) => {
    const body = response.data as ApiEnvelope<unknown> | unknown;
    if (body && typeof body === 'object' && 'success' in (body as object)) {
      const envelope = body as ApiEnvelope<unknown>;
      if (envelope.success) {
        return { ...response, data: envelope.data };
      }
      return Promise.reject(
        new ApiError(
          envelope.error?.message ?? 'Request failed',
          response.status,
          envelope.error?.code ?? 'UNKNOWN',
          envelope.error?.details,
        ),
      );
    }
    return response;
  },
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    if (error.response) {
      const { status, data } = error.response;
      const config = error.config as RetryableConfig | undefined;

      if (status === 401 && !isAuthPath(config?.url)) {
        if (config && !config._retry) {
          // One silent refresh + retry; login/refresh failures never get here.
          config._retry = true;
          const fresh = await refreshAccessToken();
          if (fresh) {
            config.headers.set('Authorization', `Bearer ${fresh}`);
            return api.request(config);
          }
        }
        await clearTokens();
        unauthorizedHandler?.();
      }

      return Promise.reject(
        new ApiError(
          data?.error?.message ?? 'Request failed',
          status,
          data?.error?.code ?? 'UNKNOWN',
          data?.error?.details,
        ),
      );
    }
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError('Request timed out', 0, 'TIMEOUT'));
    }
    return Promise.reject(
      new ApiError('Network error - check your connection', 0, 'NETWORK'),
    );
  },
);

export default api;
