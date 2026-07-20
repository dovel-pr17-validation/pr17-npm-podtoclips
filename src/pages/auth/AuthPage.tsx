import { useSignIn, useSignUp } from '@clerk/react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, LockKeyhole, Mail } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { clerkAuthEnabled, useAuthSession } from '../../auth/AuthSession';

type AuthMode = 'login' | 'signup';
type AuthStep = 'form' | 'verify-signup' | 'verify-session' | 'reset-code' | 'reset-password';

type AuthError = {
  code?: string;
  longMessage?: string;
  message?: string;
} | null;

const GOOGLE_OAUTH_TIMEOUT_MS = 15_000;

class GoogleOAuthTimeoutError extends Error {
  constructor() {
    super('Google sign-in took too long. Please try again.');
    this.name = 'GoogleOAuthTimeoutError';
  }
}

const withGoogleOAuthTimeout = async <T,>(operation: Promise<T>) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new GoogleOAuthTimeoutError()), GOOGLE_OAUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const caughtAuthError = (error: unknown): AuthError => {
  if (error instanceof Error) return { message: error.message };
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; longMessage?: unknown; message?: unknown; errors?: unknown };
    if (Array.isArray(candidate.errors) && candidate.errors.length > 0) return caughtAuthError(candidate.errors[0]);
    return {
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      longMessage: typeof candidate.longMessage === 'string' ? candidate.longMessage : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
    };
  }
  return null;
};

const readableError = (error: AuthError, fallback: string) => {
  if (!error) return fallback;
  if (error.code === 'form_password_pwned') return 'Choose a password that has not appeared in a known data breach.';
  return error.longMessage || error.message || fallback;
};

const GoogleMark = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.04H12v3.86h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.39 13.9A6 6 0 0 1 6.08 12c0-.66.11-1.3.31-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.59Z" />
    <path fill="#EA4335" d="M12 5.97c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.59C7.18 7.73 9.39 5.97 12 5.97Z" />
  </svg>
);

const AuthBrand = () => (
  <Link className="auth-brand" to="/" aria-label="PodToClips home">
    <span className="auth-brand-mark" aria-hidden="true"><i /><i /></span>
    <span>PodToClips</span>
  </Link>
);

export const AuthConfigurationPage = () => (
  <main className="auth-page">
    <div className="auth-ambient auth-ambient-one" />
    <div className="auth-ambient auth-ambient-two" />
    <AuthBrand />
    <section className="auth-card auth-config-card">
      <div className="auth-security-icon"><LockKeyhole /></div>
      <h1>Authentication is ready to connect</h1>
      <p>Add the application keys to enable secure sign-in on this environment.</p>
      <Link className="auth-primary-button" to="/"><ArrowLeft /> Return home</Link>
    </section>
  </main>
);

export const AuthPage: React.FC<{ mode: AuthMode }> = ({ mode }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const session = useAuthSession();
  const { signIn, fetchStatus: signInStatus } = useSignIn();
  const { signUp, fetchStatus: signUpStatus } = useSignUp();
  const [step, setStep] = useState<AuthStep>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const googleAttemptRef = useRef(0);
  const selectedPlan = ['creator', 'growth', 'studio'].includes(searchParams.get('plan') || '') ? searchParams.get('plan') : null;
  const destination = selectedPlan ? `/pricing?plan=${selectedPlan}` : '/app';

  useEffect(() => {
    googleAttemptRef.current += 1;
    setIsGoogleLoading(false);
  }, [mode]);

  if (session.isLoaded && session.isSignedIn) return <Navigate to={destination} replace />;

  const busy = signInStatus === 'fetching' || signUpStatus === 'fetching' || isGoogleLoading;
  const isSignup = mode === 'signup';

  const completeAuthentication = async (resource: typeof signIn | typeof signUp) => {
    if (!resource) return;
    const { error: finalizeError } = await resource.finalize({
      navigate: ({ decorateUrl }) => {
        const decoratedDestination = decorateUrl(destination);
        if (/^https?:\/\//.test(decoratedDestination)) window.location.assign(decoratedDestination);
        else navigate(decoratedDestination, { replace: true });
      },
    });
    if (finalizeError) setError(readableError(finalizeError, 'We could not finish signing you in.'));
  };

  const beginGoogle = async () => {
    if (!signIn || !signUp) return;
    const attempt = googleAttemptRef.current + 1;
    googleAttemptRef.current = attempt;
    setError(null);
    setIsGoogleLoading(true);
    try {
      // Social authentication is a sign-in-or-sign-up flow in Clerk. Reset both
      // resources first so an abandoned or failed OAuth attempt cannot poison a
      // later retry, then use one flow for both entry pages.
      await withGoogleOAuthTimeout((async () => {
        await Promise.all([signIn.reset(), signUp.reset()]);
        const { error: oauthError } = await signIn.sso({
          strategy: 'oauth_google',
          redirectCallbackUrl: '/sso-callback',
          redirectUrl: destination,
        });
        if (oauthError) throw oauthError;
      })());
    } catch (oauthError) {
      if (googleAttemptRef.current === attempt) {
        setError(readableError(caughtAuthError(oauthError), 'Google sign-in could not be started. Please try again.'));
      }
    } finally {
      if (googleAttemptRef.current === attempt) setIsGoogleLoading(false);
    }
  };

  const beginSessionVerification = async () => {
    if (!signIn) return;
    const supportsEmailCode = signIn.supportedSecondFactors.some((factor) => factor.strategy === 'email_code');
    if (!supportsEmailCode) {
      setError('This account requires an additional verification method that is not enabled here.');
      return;
    }
    const { error: verificationError } = await signIn.mfa.sendEmailCode();
    if (verificationError) setError(readableError(verificationError, 'We could not send the verification code.'));
    else {
      setCode('');
      setStep('verify-session');
    }
  };

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!signIn || !signUp) return;
    setError(null);

    if (isSignup) {
      const { error: signupError } = await signUp.password({
        emailAddress: email.trim(),
        password,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
      });
      if (signupError) {
        setError(readableError(signupError, 'We could not create your account.'));
        return;
      }
      if (signUp.status === 'complete') return completeAuthentication(signUp);
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) setError(readableError(sendError, 'We could not send your verification code.'));
      else {
        setCode('');
        setStep('verify-signup');
      }
      return;
    }

    const { error: signinError } = await signIn.password({ emailAddress: email.trim(), password });
    if (signinError) {
      setError(readableError(signinError, 'The email or password is incorrect.'));
      return;
    }
    if (signIn.status === 'complete') return completeAuthentication(signIn);
    if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
      await beginSessionVerification();
      return;
    }
    setError('This account needs an additional sign-in step.');
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!signIn || !signUp) return;
    setError(null);
    if (step === 'verify-signup') {
      const { error: verificationError } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (verificationError) setError(readableError(verificationError, 'That verification code is not valid.'));
      else if (signUp.status === 'complete') await completeAuthentication(signUp);
      else setError('Your account still needs additional information before it can be created.');
      return;
    }
    if (step === 'verify-session') {
      const { error: verificationError } = await signIn.mfa.verifyEmailCode({ code: code.trim() });
      if (verificationError) setError(readableError(verificationError, 'That verification code is not valid.'));
      else if (signIn.status === 'complete') await completeAuthentication(signIn);
      else setError('Your account still needs another verification step.');
      return;
    }
    if (step === 'reset-code') {
      const { error: verificationError } = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (verificationError) setError(readableError(verificationError, 'That reset code is not valid.'));
      else {
        setPassword('');
        setStep('reset-password');
      }
    }
  };

  const beginPasswordReset = async () => {
    if (!signIn || !email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    setError(null);
    const { error: createError } = await signIn.create({ identifier: email.trim() });
    if (createError) {
      setError(readableError(createError, 'We could not start password recovery.'));
      return;
    }
    const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
    if (sendError) setError(readableError(sendError, 'We could not send the reset code.'));
    else {
      setCode('');
      setStep('reset-code');
    }
  };

  const submitNewPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!signIn) return;
    setError(null);
    const { error: resetError } = await signIn.resetPasswordEmailCode.submitPassword({ password });
    if (resetError) setError(readableError(resetError, 'We could not update your password.'));
    else if (signIn.status === 'complete') await completeAuthentication(signIn);
  };

  const resetFlow = async () => {
    await Promise.all([signIn?.reset(), signUp?.reset()]);
    setStep('form');
    setCode('');
    setPassword('');
    setError(null);
  };

  const isCodeStep = step === 'verify-signup' || step === 'verify-session' || step === 'reset-code';
  const title = step === 'form'
    ? (isSignup ? 'Create your account' : 'Welcome back')
    : step === 'reset-password'
      ? 'Set a new password'
      : 'Check your inbox';
  const description = step === 'form'
    ? (isSignup ? 'Start turning long-form conversations into publish-ready clips.' : 'Continue to your projects and clip workspace.')
    : step === 'reset-password'
      ? 'Use a strong password you have not used elsewhere.'
      : `Enter the verification code sent to ${email}.`;

  return (
    <main className="auth-page">
      <div className="auth-ambient auth-ambient-one" />
      <div className="auth-ambient auth-ambient-two" />
      <AuthBrand />
      <Link className="auth-back-home" to="/"><ArrowLeft /> Back to home</Link>

      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-heading">
          <span className="auth-eyebrow"><Check /> Secure workspace access</span>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>

        {step === 'form' && (
          <>
            <button className="auth-google-button" type="button" onClick={beginGoogle} disabled={busy}>
              {isGoogleLoading ? <Loader2 className="auth-spinner" /> : <GoogleMark />}
              Continue with Google
            </button>
            <div className="auth-divider"><span>or continue with email</span></div>
            <form className="auth-form" onSubmit={submitCredentials}>
              {isSignup && (
                <div className="auth-name-row">
                  <label>First name<input autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Alex" /></label>
                  <label>Last name<input autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Morgan" /></label>
                </div>
              )}
              <label>Email address<div className="auth-input-wrap"><Mail /><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></div></label>
              <label>
                <span className="auth-label-row"><span>Password</span>{!isSignup && <button type="button" onClick={beginPasswordReset}>Forgot password?</button>}</span>
                <div className="auth-input-wrap"><LockKeyhole /><input type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div>
              </label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="auth-spinner" /> : null}{isSignup ? 'Create account' : 'Sign in'}<ArrowRight /></button>
            </form>
          </>
        )}

        {isCodeStep && (
          <form className="auth-form auth-code-form" onSubmit={submitCode}>
            <label>Verification code<input className="auth-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000" /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-primary-button" type="submit" disabled={busy || code.length < 6}>{busy ? <Loader2 className="auth-spinner" /> : null}Verify and continue<ArrowRight /></button>
            <button className="auth-text-button" type="button" onClick={resetFlow}>Use a different email</button>
          </form>
        )}

        {step === 'reset-password' && (
          <form className="auth-form" onSubmit={submitNewPassword}>
            <label>New password<div className="auth-input-wrap"><LockKeyhole /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-primary-button" type="submit" disabled={busy}>{busy ? <Loader2 className="auth-spinner" /> : null}Save password<ArrowRight /></button>
          </form>
        )}

        <p className="auth-switch">
          {isSignup ? 'Already have an account?' : 'New to PodToClips?'}{' '}
          <Link to={isSignup ? '/login' : '/signup'}>{isSignup ? 'Sign in' : 'Create an account'}</Link>
        </p>
      </section>

      <p className="auth-legal">By continuing, you agree to the <Link to="/legal/terms">Terms of Service</Link> and <Link to="/legal/privacy">Privacy Policy</Link>.</p>
    </main>
  );
};

export const AuthRoute: React.FC<{ mode: AuthMode }> = ({ mode }) => {
  if (!clerkAuthEnabled) return <AuthConfigurationPage />;
  return <AuthPage mode={mode} />;
};
