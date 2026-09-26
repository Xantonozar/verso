import axios, { AxiosAdapter, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import api, { setUnauthorizedHandler } from '../lib/api/client';
import { getAccessToken, getRefreshToken, setRefreshToken } from '../lib/api/tokenStore';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __store: store,
  };
});

const mockSecureStore = jest.requireMock('expo-secure-store') as {
  __store: Map<string, string>;
};

interface RecordedCall {
  url: string;
  authorization: string;
}

function response(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {},
    config,
  };
}

function authHeaderOf(config: InternalAxiosRequestConfig): string {
  const value = config.headers?.get?.('Authorization') ?? config.headers?.Authorization;
  return value == null ? '' : String(value);
}

function useAdapter(handler: (config: InternalAxiosRequestConfig, call: RecordedCall) => AxiosResponse) {
  const calls: RecordedCall[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const call: RecordedCall = { url: config.url ?? '', authorization: authHeaderOf(config) };
    calls.push(call);
    const resp = handler(config, call);
    // Real adapters honour validateStatus; without this a 401 would resolve
    // as a success and never reach the error interceptor's refresh path.
    if (config.validateStatus && !config.validateStatus(resp.status)) {
      throw new AxiosError(
        `Request failed with status code ${resp.status}`,
        AxiosError.ERR_BAD_REQUEST,
        config,
        null,
        resp,
      );
    }
    return resp;
  };
  axios.defaults.adapter = adapter;
  api.defaults.adapter = adapter;
  return calls;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSecureStore.__store.clear();
  setUnauthorizedHandler(null);
});

afterEach(() => {
  delete (axios.defaults as { adapter?: AxiosAdapter }).adapter;
  delete (api.defaults as { adapter?: AxiosAdapter }).adapter;
  setUnauthorizedHandler(null);
});

describe('401 refresh-retry (Phase 1)', () => {
  it('refreshes once, retries with the new token, and stores rotated tokens', async () => {
    await setRefreshToken('rt-old');

    const calls = useAdapter((config, call) => {
      if (call.url.includes('/auth/refresh')) {
        return response(
          config,
          200,
          { success: true, data: { accessToken: 'access-new', refreshToken: 'rt-new' } },
        );
      }
      if (call.authorization === 'Bearer access-new') {
        return response(config, 200, { success: true, data: { me: true } });
      }
      return response(config, 401, {
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Auth required' },
      });
    });

    const res = await api.get('/users/me');

    expect(res.data).toEqual({ me: true });
    expect(calls.filter((c) => c.url.includes('/auth/refresh'))).toHaveLength(1);
    const resourceCalls = calls.filter((c) => !c.url.includes('/auth/refresh'));
    expect(resourceCalls).toHaveLength(2);
    expect(resourceCalls[1].authorization).toBe('Bearer access-new');
    expect(await getAccessToken()).toBe('access-new');
    expect(await getRefreshToken()).toBe('rt-new');
  });

  it('clears the session and fires the unauthorized handler when refresh fails', async () => {
    await setRefreshToken('rt-dead');

    const handler = jest.fn();
    setUnauthorizedHandler(handler);

    const calls = useAdapter((config, call) => {
      if (call.url.includes('/auth/refresh')) {
        return response(config, 401, {
          success: false,
          error: { code: 'AUTH_REFRESH_INVALID', message: 'Invalid refresh token' },
        });
      }
      return response(config, 401, {
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Auth required' },
      });
    });

    await expect(api.get('/users/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'AUTH_REQUIRED',
    });

    expect(calls.some((c) => c.url.includes('/auth/refresh'))).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await getAccessToken()).toBeNull();
    expect(await getRefreshToken()).toBeNull();
  });

  it('does not attempt refresh for login 401s (bad credentials)', async () => {
    const handler = jest.fn();
    setUnauthorizedHandler(handler);

    const calls = useAdapter((config) =>
      response(config, 401, {
        success: false,
        error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' },
      }),
    );

    await expect(
      api.post('/auth/login', { identifier: 'reader', password: 'WrongPass1' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

    expect(calls.filter((c) => c.url.includes('/auth/refresh'))).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});
