import { useHead, useSeoMeta } from '@unhead/react';
import { AuthenticateWithRedirectCallback } from '@clerk/react';
import React, { Suspense } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import { LandingPage } from './src/pages/marketing/LandingPage';
import { PricingPage } from './src/pages/marketing/PricingPage';
import { LegalPage, legalPageMetadata, type LegalDocument } from './src/pages/legal/LegalPage';
import { AuthRoute } from './src/pages/auth/AuthPage';
import { useAuthSession } from './src/auth/AuthSession';

const PodcastPage = React.lazy(() => import('./components/PodcastPage').then((module) => ({ default: module.PodcastPage })));
const VideoEditorPage = React.lazy(() => import('./components/VideoEditorPage').then((module) => ({ default: module.VideoEditorPage })));
const SupportPage = React.lazy(() => import('./components/SupportPage').then((module) => ({ default: module.SupportPage })));

const UI_V2_ENABLED = import.meta.env.VITE_UI_V2_ENABLED !== '0';
const LANDING_VARIANT = import.meta.env.VITE_LANDING_VARIANT === 'original'
  ? 'original'
  : import.meta.env.VITE_LANDING_VARIANT === 'podcast'
    ? 'podcast'
    : 'optimized';

const ProductLoading = () => (
  <div className="product-route-loading">
    <span className="brand-glyph" aria-hidden="true" />
    <p>Preparing your workspace…</p>
  </div>
);

const LegacyApp: React.FC = () => {
  const [editorClipId, setEditorClipId] = React.useState(() => new URLSearchParams(window.location.search).get('editor'));
  const openEditor = (clipId: string) => {
    window.history.pushState({}, '', `?editor=${encodeURIComponent(clipId)}`);
    setEditorClipId(clipId);
  };
  const closeEditor = () => {
    window.history.pushState({}, '', window.location.pathname);
    setEditorClipId(null);
  };

  React.useEffect(() => {
    const syncLocation = () => setEditorClipId(new URLSearchParams(window.location.search).get('editor'));
    window.addEventListener('popstate', syncLocation);
    return () => window.removeEventListener('popstate', syncLocation);
  }, []);

  return (
    <div className="min-h-screen bg-[#030014] font-sans text-white selection:bg-violet-500/30">
      <Suspense fallback={<ProductLoading />}>
        {editorClipId ? <VideoEditorPage clipId={editorClipId} onBack={closeEditor} /> : <PodcastPage onOpenEditor={openEditor} />}
      </Suspense>
    </div>
  );
};

const RouteMetadata: React.FC = () => {
  const location = useLocation();
  const isIndexableLanding = location.pathname === '/';
  const isOriginalPreview = location.pathname === '/landing/original';
  const isPodcastPreview = location.pathname === '/landing/podcast';
  const isOptimizedPreview = location.pathname === '/landing/optimized';
  const isPricingPreview = location.pathname === '/pricing';
  const legalDocument = ({
    '/legal': 'overview',
    '/legal/terms': 'terms',
    '/legal/privacy': 'privacy',
    '/legal/refunds': 'refunds',
    '/legal/acceptable-use': 'acceptable-use',
    '/legal/cookies': 'cookies',
  } as Record<string, LegalDocument | undefined>)[location.pathname];
  const legalMetadata = legalDocument ? legalPageMetadata(legalDocument) : null;
  const siteUrl = (import.meta.env.VITE_SITE_URL || '').trim().replace(/\/$/, '');
  const isPodcastVariant = isIndexableLanding && LANDING_VARIANT === 'podcast';
  const isOptimizedVariant = isIndexableLanding && LANDING_VARIANT === 'optimized';
  const title = legalMetadata?.title || (isOptimizedVariant
    ? 'AI Podcast Clip Generator & Video Clipping Tool | PodToClips'
    : isPodcastVariant
    ? 'AI Podcast Clip Generator for Solo Podcasters | PodToClips'
    : isIndexableLanding
      ? 'PodToClips — AI Video Clipper for Podcasts & Long Videos'
      : isOriginalPreview
        ? 'Original landing concept — PodToClips'
        : isPodcastPreview
          ? 'Podcast landing concept — PodToClips'
          : isOptimizedPreview
            ? 'SEO-optimized landing concept | PodToClips'
            : isPricingPreview
              ? 'Pricing preview | PodToClips'
        : location.pathname === '/login'
          ? 'Sign in — PodToClips'
          : location.pathname === '/signup'
            ? 'Create your account — PodToClips'
        : location.pathname.startsWith('/editor')
          ? 'Video editor — PodToClips'
          : location.pathname === '/app/support'
            ? 'Help & support — PodToClips'
          : 'Workspace — PodToClips');
  const description = legalMetadata?.description || (isPricingPreview
    ? 'Compare PodToClips Free, Creator, Growth, and Studio plans for turning podcast episodes into complete, captioned vertical clips.'
    : isOptimizedVariant
    ? 'Turn long podcasts and interviews into complete, captioned vertical clips with AI moment discovery, speaker-aware reframing, and a built-in video editor.'
    : isPodcastVariant
    ? 'Turn full podcast episodes into context-complete vertical clips with AI moment discovery, speaker-aware reframing, captions, and a built-in editor for teams of one.'
    : 'Turn podcasts and long videos into complete, captioned 9:16 clips with AI moment discovery, speaker-aware reframing, and a built-in timeline editor.');
  const isIndexablePublicPage = isIndexableLanding || Boolean(legalDocument);
  const canonical = isIndexablePublicPage && siteUrl ? `${siteUrl}${isIndexableLanding ? '/' : location.pathname}` : undefined;
  const socialImage = siteUrl
    ? `${siteUrl}/${isPodcastVariant ? 'og-podcast-clips.png' : 'og-easy-edits.png'}`
    : `/${isPodcastVariant ? 'og-podcast-clips.png' : 'og-easy-edits.png'}`;

  useSeoMeta({
    title,
    description,
    robots: isIndexablePublicPage ? 'index, follow, max-image-preview:large' : 'noindex, nofollow',
    ogType: 'website',
    ogSiteName: 'PodToClips',
    ogTitle: title,
    ogDescription: description,
    ogUrl: canonical,
    ogImage: socialImage,
    ogImageAlt: isPodcastVariant
      ? 'PodToClips turning a podcast episode into editable vertical clips'
      : 'PodToClips turning a long recording into polished vertical clips',
    twitterCard: 'summary_large_image',
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: socialImage,
  });

  useHead({
    link: canonical ? [{ rel: 'canonical', href: canonical }] : [],
    script: canonical ? [{
      type: 'application/ld+json',
      textContent: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': legalDocument ? 'WebPage' : 'WebSite',
        name: legalMetadata?.title || 'PodToClips',
        url: canonical,
        description,
      }),
    }] : [],
  });

  return null;
};

const LandingRoute: React.FC = () => {
  const [searchParams] = useSearchParams();
  const legacyEditorId = searchParams.get('editor');
  return legacyEditorId ? <Navigate to={`/editor/${encodeURIComponent(legacyEditorId)}`} replace /> : <LandingPage variant={LANDING_VARIANT} />;
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { enabled, isLoaded, isSignedIn } = useAuthSession();
  if (!enabled) return children;
  if (!isLoaded) return <ProductLoading />;
  if (!isSignedIn) return <Navigate to="/login" replace />;
  return children;
};

const WorkspaceRoute: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuthSession();
  if (location.pathname === '/app/support') {
    return <Suspense fallback={<ProductLoading />}><SupportPage /></Suspense>;
  }
  const view = location.pathname === '/app/new'
    ? 'new'
    : location.pathname === '/app/clips'
      ? 'clips'
      : location.pathname === '/app/settings'
        ? 'settings'
        : 'projects';
  return (
    <Suspense fallback={<ProductLoading />}>
      <PodcastPage
        key={user?.id || 'local-development'}
        view={view}
        focusEpisodeId={searchParams.get('episode')}
        onOpenEditor={(clipId) => navigate(`/editor/${encodeURIComponent(clipId)}`)}
        onProjectCreated={(episodeId) => navigate(`/app?episode=${encodeURIComponent(episodeId)}`)}
      />
    </Suspense>
  );
};

const EditorRoute: React.FC = () => {
  const { clipId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthSession();

  if (!clipId) return <Navigate to="/app" replace />;

  return (
    <Suspense fallback={<ProductLoading />}>
      <VideoEditorPage key={user?.id || 'local-development'} clipId={clipId} onBack={() => navigate('/app')} />
    </Suspense>
  );
};

const NotFoundPage = () => (
  <main className="grid min-h-screen place-items-center bg-[var(--canvas)] px-6 text-[var(--ink)]">
    <div className="max-w-lg text-center">
      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--coral-strong)]">404 / Lost frame</p>
      <h1 className="font-display text-5xl leading-none sm:text-6xl">This scene is not on the timeline.</h1>
      <p className="mx-auto mt-6 max-w-md text-base leading-7 text-[var(--muted)]">The page may have moved, or the link may be incomplete.</p>
      <a className="ee-button ee-button-primary mt-8" href="/">Return home</a>
    </div>
  </main>
);

export const AppRoutes: React.FC = () => (
  <>
    <RouteMetadata />
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/landing/original" element={<LandingPage variant="original" />} />
      <Route path="/landing/podcast" element={<LandingPage variant="podcast" />} />
      <Route path="/landing/optimized" element={<LandingPage variant="optimized" />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/legal" element={<LegalPage />} />
      <Route path="/legal/terms" element={<LegalPage document="terms" />} />
      <Route path="/legal/privacy" element={<LegalPage document="privacy" />} />
      <Route path="/legal/refunds" element={<LegalPage document="refunds" />} />
      <Route path="/legal/acceptable-use" element={<LegalPage document="acceptable-use" />} />
      <Route path="/legal/cookies" element={<LegalPage document="cookies" />} />
      <Route path="/login/*" element={<AuthRoute mode="login" />} />
      <Route path="/signup/*" element={<AuthRoute mode="signup" />} />
      <Route path="/sso-callback" element={<AuthenticateWithRedirectCallback signInFallbackRedirectUrl="/app" signUpFallbackRedirectUrl="/app" />} />
      <Route path="/app/*" element={<ProtectedRoute><WorkspaceRoute /></ProtectedRoute>} />
      <Route path="/editor/:clipId" element={<ProtectedRoute><EditorRoute /></ProtectedRoute>} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </>
);

const App: React.FC = () => {
  if (!UI_V2_ENABLED) return <LegacyApp />;

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
};

export default App;
