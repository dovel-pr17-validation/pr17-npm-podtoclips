import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { createHead, UnheadProvider } from '@unhead/react/client';
import '@fontsource-variable/geist';
import '@fontsource/instrument-serif/400.css';
import './index.css';
import './src/styles/studio.css';
import './src/styles/editor.css';
import './src/styles/auth.css';
import App from './EasyEditsApp';
import { ClerkAuthSessionBridge, clerkAuthEnabled } from './src/auth/AuthSession';
import { initializeBrowserMonitoring } from './src/monitoring/sentry';

initializeBrowserMonitoring();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const head = createHead();
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || '';
const appContent = (
  <React.StrictMode>
    <UnheadProvider head={head}>
      <App />
    </UnheadProvider>
  </React.StrictMode>
);

const application = clerkAuthEnabled ? (
  <ClerkProvider
    publishableKey={clerkPublishableKey}
    signInUrl="/login"
    signUpUrl="/signup"
    signInFallbackRedirectUrl="/app"
    signUpFallbackRedirectUrl="/app"
    afterSignOutUrl="/"
  >
    <ClerkAuthSessionBridge>{appContent}</ClerkAuthSessionBridge>
  </ClerkProvider>
) : appContent;

const canHydrateLanding = import.meta.env.VITE_UI_V2_ENABLED !== '0'
  && window.location.pathname === '/'
  && rootElement.hasChildNodes();

if (canHydrateLanding) {
  ReactDOM.hydrateRoot(rootElement, application);
} else {
  rootElement.replaceChildren();
  ReactDOM.createRoot(rootElement).render(application);
}
