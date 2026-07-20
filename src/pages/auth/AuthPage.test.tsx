import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthConfigurationPage, AuthPage } from './AuthPage';

const authMocks = vi.hoisted(() => ({
  signInReset: vi.fn(),
  signUpReset: vi.fn(),
  signInSso: vi.fn(),
  signUpSso: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useSignIn: () => ({
    fetchStatus: 'idle',
    signIn: {
      reset: authMocks.signInReset,
      sso: authMocks.signInSso,
      supportedSecondFactors: [],
    },
  }),
  useSignUp: () => ({
    fetchStatus: 'idle',
    signUp: {
      reset: authMocks.signUpReset,
      sso: authMocks.signUpSso,
    },
  }),
}));

vi.mock('../../auth/AuthSession', () => ({
  clerkAuthEnabled: true,
  useAuthSession: () => ({
    enabled: true,
    isLoaded: true,
    isSignedIn: false,
    user: null,
    getToken: vi.fn(),
    signOut: vi.fn(),
  }),
}));

const renderAuthPage = (mode: 'login' | 'signup') => render(
  <MemoryRouter initialEntries={[mode === 'login' ? '/login' : '/signup']}>
    <AuthPage mode={mode} />
  </MemoryRouter>,
);

describe('authentication entry', () => {
  beforeEach(() => {
    vi.useRealTimers();
    authMocks.signInReset.mockReset().mockResolvedValue(undefined);
    authMocks.signUpReset.mockReset().mockResolvedValue(undefined);
    authMocks.signInSso.mockReset().mockResolvedValue({ error: null });
    authMocks.signUpSso.mockReset().mockResolvedValue({ error: null });
  });

  it('uses PodToClips branding without provider-facing UI copy', () => {
    render(<MemoryRouter><AuthConfigurationPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'PodToClips home' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Authentication is ready to connect' })).toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toContain('clerk');
  });

  it.each(['login', 'signup'] as const)('uses one clean Google flow from the %s page', async (mode) => {
    renderAuthPage(mode);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(authMocks.signInSso).toHaveBeenCalledWith({
      strategy: 'oauth_google',
      redirectCallbackUrl: '/sso-callback',
      redirectUrl: '/app',
    }));
    expect(authMocks.signInReset).toHaveBeenCalledOnce();
    expect(authMocks.signUpReset).toHaveBeenCalledOnce();
    expect(authMocks.signUpSso).not.toHaveBeenCalled();
  });

  it('surfaces a thrown Google error and restores the button', async () => {
    authMocks.signInSso.mockRejectedValueOnce(new Error('Google connection unavailable.'));
    renderAuthPage('login');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Google connection unavailable.');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it('surfaces a returned Google error and restores the button', async () => {
    authMocks.signInSso.mockResolvedValueOnce({ error: { message: 'Google sign-in was rejected.' } });
    renderAuthPage('login');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in was rejected.');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it('recovers instead of spinning forever when Google does not respond', async () => {
    vi.useFakeTimers();
    authMocks.signInSso.mockReturnValueOnce(new Promise(() => undefined));
    renderAuthPage('login');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await act(async () => undefined);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_001);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in took too long. Please try again.');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });
});
