import { useAuth, useClerk, useUser } from '@clerk/react';
import React, { createContext, useCallback, useContext, useMemo } from 'react';

export const clerkAuthEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim());

type SessionUser = {
  id: string;
  displayName: string;
  email: string;
  imageUrl: string | null;
  initials: string;
};

type AuthSessionValue = {
  enabled: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  user: SessionUser | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const localSession: AuthSessionValue = {
  enabled: false,
  isLoaded: true,
  isSignedIn: true,
  user: null,
  getToken: async () => null,
  signOut: async () => undefined,
};

const AuthSessionContext = createContext<AuthSessionValue>(localSession);

const initialsFor = (name: string, email: string) => {
  const source = name.trim() || email.split('@')[0] || 'PodToClips';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'EE';
};

export const ClerkAuthSessionBridge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const clerk = useClerk();

  const signOut = useCallback(() => clerk.signOut({ redirectUrl: '/' }), [clerk]);
  const value = useMemo<AuthSessionValue>(() => {
    const email = user?.primaryEmailAddress?.emailAddress || '';
    const displayName = user?.fullName || user?.firstName || email.split('@')[0] || 'Your account';
    return {
      enabled: true,
      isLoaded: auth.isLoaded && isUserLoaded,
      isSignedIn: Boolean(auth.isSignedIn),
      user: user ? {
        id: user.id,
        displayName,
        email,
        imageUrl: user.imageUrl || null,
        initials: initialsFor(displayName, email),
      } : null,
      getToken: auth.getToken,
      signOut,
    };
  }, [auth.getToken, auth.isLoaded, auth.isSignedIn, isUserLoaded, signOut, user]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
};

export const useAuthSession = () => useContext(AuthSessionContext);

export const useAuthenticatedFetch = () => {
  const { getToken } = useAuthSession();
  return useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = await getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  }, [getToken]);
};
