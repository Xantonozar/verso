import api, { ApiEnvelope } from '../lib/api/client';

function okAdapter(payload: unknown) {
  return async () => ({
    data: payload,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  });
}

function statusAdapter(status: number, payload: unknown) {
  return async () => {
    const error = Object.assign(new Error(`Request failed with status code ${status}`), {
      isAxiosError: true,
      config: {},
      response: {
        data: payload,
        status,
        statusText: 'Error',
        headers: {},
        config: {},
      },
    });
    return Promise.reject(error);
  };
}

describe('api client envelope handling', () => {
  it('unwraps a success envelope to its data payload', async () => {
    const envelope: ApiEnvelope<{ id: string }> = {
      success: true,
      data: { id: 'p1' },
    };
    const res = await api.get('/poems/p1', { adapter: okAdapter(envelope) });
    expect(res.data).toEqual({ id: 'p1' });
  });

  it('rejects a failure envelope with a typed ApiError', async () => {
    const envelope: ApiEnvelope<never> = {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Poem not found' },
    };
    await expect(
      api.get('/poems/missing', { adapter: statusAdapter(404, envelope) }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Poem not found',
    });
  });

  it('maps non-2xx responses without an envelope to ApiError', async () => {
    await expect(
      api.get('/boom', { adapter: statusAdapter(500, 'oops') }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 500 });
  });

  it('surfaces timeouts as ApiError with TIMEOUT code', async () => {
    const timeoutError = Object.assign(new Error('timeout of 15000ms exceeded'), {
      code: 'ECONNABORTED',
      config: {},
      isAxiosError: true,
    });
    await expect(
      api.get('/slow', {
        adapter: async () => Promise.reject(timeoutError),
      }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'TIMEOUT' });
  });
});
