import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError, default as api } from '../lib/api/client';
import { toast } from '../lib/toast';
import { AuthProvider } from '../context/AuthContext';
import LoginScreen from '../app/(auth)/login';
import RegisterScreen from '../app/(auth)/register';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: () => ({ id: 'u1' }),
}));

jest.mock('../lib/toast', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../lib/api/client', () => {
  const actual = jest.requireActual('../lib/api/client');
  return {
    __esModule: true,
    ...actual,
    default: { post: jest.fn(), get: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  };
});

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

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(View, null, children),
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) =>
      ReactModule.createElement(View, { style }, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    initialWindowMetrics: null,
  };
});

const { router } = jest.requireMock('expo-router');
const mockSecureStore = jest.requireMock('expo-secure-store') as {
  __store: Map<string, string>;
  setItemAsync: jest.Mock;
};
const apiMock = api as unknown as {
  post: jest.Mock;
  get: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};

const session = {
  user: { id: 'u1', username: 'reader', displayName: 'Reader One', email: 'reader@example.com' },
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
};

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginScreen />
    </AuthProvider>,
  );
}

function renderRegister() {
  return render(
    <AuthProvider>
      <RegisterScreen />
    </AuthProvider>,
  );
}

async function fillRegisterForm() {
  await fireEvent.changeText(screen.getByTestId('register-username'), 'reader_one');
  await fireEvent.changeText(screen.getByTestId('register-display-name'), 'Reader One');
  await fireEvent.changeText(screen.getByTestId('register-email'), 'reader@example.com');
  await fireEvent.changeText(screen.getByTestId('register-password'), 'Password1');
}

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.post.mockReset();
  apiMock.get.mockReset();
  mockSecureStore.__store.clear();
});

describe('login screen — validation, loading, error states', () => {
  it('shows field-level errors when submitting an empty form', async () => {
    await renderLogin();
    await fireEvent.press(screen.getByTestId('login-submit'));

    const requiredMessages = await screen.findAllByText('is required');
    expect(requiredMessages).toHaveLength(2);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('disables submit while signing in, then redirects on success', async () => {
    let resolveLogin!: (value: unknown) => void;
    apiMock.post.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );

    await renderLogin();
    await fireEvent.changeText(screen.getByTestId('login-identifier'), 'reader');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'Password1');

    // fireEvent.press resolves only when signIn settles, so keep its promise
    // pending while we observe the in-flight state, then release it inside act.
    const pressPromise = fireEvent.press(screen.getByTestId('login-submit'));
    try {
      await waitFor(() => {
        expect(screen.getByTestId('login-submit').props.accessibilityState).toEqual(
          expect.objectContaining({ busy: true, disabled: true }),
        );
      });
      expect(apiMock.post).toHaveBeenCalledWith('/auth/login', {
        identifier: 'reader',
        password: 'Password1',
      });
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        resolveLogin({ data: session });
        await pressPromise;
      });
    }

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/profile'));
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('verso.accessToken', 'access-1');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('verso.refreshToken', 'refresh-1');
  });

  it('maps invalid credentials to a form-level error without redirecting', async () => {
    apiMock.post.mockRejectedValue(
      new ApiError('Invalid credentials', 401, 'AUTH_INVALID_CREDENTIALS'),
    );

    await renderLogin();
    await fireEvent.changeText(screen.getByTestId('login-identifier'), 'reader');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'WrongPass1');
    await fireEvent.press(screen.getByTestId('login-submit'));

    expect(await screen.findByText('Incorrect email or password.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('toasts on network failure instead of showing a field error', async () => {
    apiMock.post.mockRejectedValue(
      new ApiError('Network error - check your connection', 0, 'NETWORK'),
    );

    await renderLogin();
    await fireEvent.changeText(screen.getByTestId('login-identifier'), 'reader');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'Password1');
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Can't reach the server. Check your connection and try again.",
      ),
    );
    expect(screen.queryByText('Incorrect email or password.')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('register screen — validation, loading, error states', () => {
  it('shows client-side field errors for a weak submission', async () => {
    await renderRegister();
    await fireEvent.changeText(screen.getByTestId('register-username'), 'a');
    await fireEvent.changeText(screen.getByTestId('register-display-name'), '');
    await fireEvent.changeText(screen.getByTestId('register-email'), 'not-an-email');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'short');
    await fireEvent.press(screen.getByTestId('register-submit'));

    expect(await screen.findByText('must be at least 3 characters')).toBeTruthy();
    expect(screen.getByText('is required')).toBeTruthy();
    expect(screen.getByText('must be a valid email')).toBeTruthy();
    expect(screen.getByText('must be at least 8 characters')).toBeTruthy();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('maps server username conflict onto the username field', async () => {
    apiMock.post.mockRejectedValue(
      new ApiError('Username already taken', 409, 'AUTH_USERNAME_TAKEN', {
        field: 'username',
      }),
    );

    await renderRegister();
    await fillRegisterForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    expect(await screen.findByText('Username already taken')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('maps a VALIDATION_ERROR details array onto the matching fields', async () => {
    apiMock.post.mockRejectedValue(
      new ApiError('Request validation failed', 400, 'VALIDATION_ERROR', [
        { field: 'email', message: 'must be a valid email', code: 'invalid_string' },
      ]),
    );

    await renderRegister();
    await fillRegisterForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    expect(await screen.findByText('must be a valid email')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('disables submit while registering, then redirects on success', async () => {
    let resolveRegister!: (value: unknown) => void;
    apiMock.post.mockReturnValue(
      new Promise((resolve) => {
        resolveRegister = resolve;
      }),
    );

    await renderRegister();
    await fillRegisterForm();

    const pressPromise = fireEvent.press(screen.getByTestId('register-submit'));
    try {
      await waitFor(() => {
        expect(screen.getByTestId('register-submit').props.accessibilityState).toEqual(
          expect.objectContaining({ busy: true, disabled: true }),
        );
      });
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        resolveRegister({ data: session });
        await pressPromise;
      });
    }

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/profile'));
    expect(apiMock.post).toHaveBeenCalledWith('/auth/register', {
      username: 'reader_one',
      displayName: 'Reader One',
      email: 'reader@example.com',
      password: 'Password1',
    });
  });

  it('toasts on network failure without showing field errors', async () => {
    apiMock.post.mockRejectedValue(new ApiError('Request timed out', 0, 'TIMEOUT'));

    await renderRegister();
    await fillRegisterForm();
    await fireEvent.press(screen.getByTestId('register-submit'));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText('must be a valid email')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
