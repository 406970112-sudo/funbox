import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import {
  changePassword as changePasswordRequest,
  getCurrentUser,
  login,
  register,
  updateDisplayName,
  uploadAvatar as uploadAvatarRequest,
} from '@/lib/auth-api';
import {
  getStoredAccessToken,
  removeStoredAccessToken,
  setStoredAccessToken,
} from '@/lib/auth-token-storage';
import type { AuthUser, AvatarAsset } from '@/types/auth';

type AuthStatus = 'anonymous' | 'authenticated' | 'loading';

type AuthContextValue = {
  accessToken: string | null;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName: string,
    securityQuestion: string,
    securityAnswer: string,
  ) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  status: AuthStatus;
  updateDisplayName: (displayName: string) => Promise<void>;
  uploadAvatar: (asset: AvatarAsset) => Promise<void>;
  user: AuthUser | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const storedToken = await getStoredAccessToken();
      if (!storedToken) {
        if (active) setStatus('anonymous');
        return;
      }

      try {
        const currentUser = await getCurrentUser(storedToken);
        if (!active) return;
        setToken(storedToken);
        setUser(currentUser);
        setStatus('authenticated');
      } catch {
        await removeStoredAccessToken();
        if (active) setStatus('anonymous');
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function persistSession(nextToken: string, nextUser: AuthUser) {
    await setStoredAccessToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setStatus('authenticated');
  }

  async function signIn(username: string, password: string) {
    const session = await login(username, password);
    await persistSession(session.accessToken, session.user);
  }

  async function registerAccount(
    username: string,
    password: string,
    displayName: string,
    securityQuestion: string,
    securityAnswer: string,
  ) {
    const session = await register(
      username,
      password,
      displayName,
      securityQuestion,
      securityAnswer,
    );
    await persistSession(session.accessToken, session.user);
  }

  async function signOut() {
    await removeStoredAccessToken();
    setToken(null);
    setUser(null);
    setStatus('anonymous');
  }

  async function saveDisplayName(displayName: string) {
    if (!token) throw new Error('Authentication required');
    setUser(await updateDisplayName(token, displayName));
  }

  async function saveAvatar(asset: AvatarAsset) {
    if (!token) throw new Error('Authentication required');
    setUser(await uploadAvatarRequest(token, asset));
  }

  async function savePassword(currentPassword: string, newPassword: string) {
    if (!token) throw new Error('Authentication required');
    const session = await changePasswordRequest(token, currentPassword, newPassword);
    await persistSession(session.accessToken, session.user);
  }

  return (
    <AuthContext.Provider
      value={{
        accessToken: token,
        changePassword: savePassword,
        register: registerAccount,
        signIn,
        signOut,
        status,
        updateDisplayName: saveDisplayName,
        uploadAvatar: saveAvatar,
        user,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
