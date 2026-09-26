import { router } from 'expo-router';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import api, { setUnauthorizedHandler } from '../lib/api/client';
import { clearTokens, getRefreshToken, setAccessToken, setRefreshToken } from '../lib/api/tokenStore';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  bio?: string;
  profilePhotoUrl?: string;
  language?: string;
  followerCount?: number;
  followingCount?: number;
  productRoles?: string[];
  securityRole?: string;
  moderation?: { status: string; warningCount?: number; isAnonymizedAccount?: boolean };
  isFollowing?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RegisterInput {
  username: string;
  displayName: string;
  email: string;
  password: string;
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface SessionResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const userRef = useRef<AuthUser | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // 401 after a failed silent refresh: end the session; only navigate away if
  // the user was actually signed in (bad logins never reach this handler).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const hadSession = userRef.current != null;
      userRef.current = null;
      setUser(null);
      if (hadSession) router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) return;
        const { data: tokens } = await api.post<{ accessToken: string; refreshToken: string }>(
          '/auth/refresh',
          { refreshToken },
        );
        if (cancelled || !tokens?.accessToken) return;
        await setAccessToken(tokens.accessToken);
        if (tokens.refreshToken) await setRefreshToken(tokens.refreshToken);
        const { data: me } = await api.get<AuthUser>('/users/me');
        if (!cancelled) setUser(me);
      } catch {
        if (!cancelled) {
          await clearTokens();
          setUser(null);
        }
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const { data } = await api.post<SessionResponse>('/auth/login', { identifier, password });
    await setAccessToken(data.accessToken);
    await setRefreshToken(data.refreshToken);
    setUser(data.user);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const { data } = await api.post<SessionResponse>('/auth/register', input);
    await setAccessToken(data.accessToken);
    await setRefreshToken(data.refreshToken);
    setUser(data.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } catch {
      // best effort — local session is cleared regardless
    }
    await clearTokens();
    setUser(null);
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const status: AuthStatus = !bootstrapped ? 'loading' : user ? 'authenticated' : 'unauthenticated';

  return (
    <AuthContext.Provider value={{ status, user, signIn, register, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
