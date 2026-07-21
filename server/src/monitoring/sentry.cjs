const Sentry = require('@sentry/node');

let initialized = false;

function stripUrl(value) {
  if (typeof value !== 'string' || !value) return value;
  try {
    const url = new URL(value, 'https://podtoclips.com');
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function scrubEvent(event) {
  delete event.user;
  if (event.request) {
    event.request.url = stripUrl(event.request.url);
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

function initSentry(service) {
  if (initialized) return Sentry;
  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) return Sentry;
  Sentry.init({
    dsn,
    environment: String(process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production'),
    serverName: service,
    sendDefaultPii: false,
    enableLogs: false,
    sampleRate: 1,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05),
    profilesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null;
      if (!breadcrumb.data?.url) return breadcrumb;
      return { ...breadcrumb, data: { ...breadcrumb.data, url: stripUrl(breadcrumb.data.url) } };
    },
  });
  Sentry.setTag('service', service);
  initialized = true;
  return Sentry;
}

module.exports = { ...Sentry, initSentry };

