import * as Sentry from '@sentry/react';

function stripUrl(value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value;
  try {
    const url = new URL(value, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  delete event.user;
  if (event.request) {
    event.request.url = stripUrl(event.request.url) as string | undefined;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.env;
    delete event.request.headers;
    delete event.request.query_string;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .filter((breadcrumb) => breadcrumb.category !== 'console')
      .map((breadcrumb) => ({
        ...breadcrumb,
        data: breadcrumb.data?.url
          ? { ...breadcrumb.data, url: stripUrl(breadcrumb.data.url) }
          : breadcrumb.data,
      }));
  }
  return event;
}

export function initializeBrowserMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn || !import.meta.env.PROD) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || 'production',
    sendDefaultPii: false,
    enableLogs: false,
    sampleRate: 1,
    tracesSampleRate: 0.05,
    replaysSessionSampleRate: 0.005,
    replaysOnErrorSampleRate: 0.1,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    beforeSend: scrubEvent,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null;
      if (!breadcrumb.data?.url) return breadcrumb;
      return { ...breadcrumb, data: { ...breadcrumb.data, url: stripUrl(breadcrumb.data.url) } };
    },
  });
}

