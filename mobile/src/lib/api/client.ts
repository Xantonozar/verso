import { AxiosError, InternalAxiosRequestConfig, create as createHttpClient } from 'axios';
import { clearAccessToken, getAccessToken } from './tokenStore';

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

/** Phase 1 wires this to reset navigation to the auth flow on 401. */
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
      if (status === 401) {
        await clearAccessToken();
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
