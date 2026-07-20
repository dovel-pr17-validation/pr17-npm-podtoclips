# PodToClips UI Refactor Plan

Status: Phases 1-6 implemented across marketing, routed product surfaces, clip review, editor, collapsible navigation, and theming; interactive browser visual QA pending  
Created: 2026-07-16  
Working product name: **PodToClips**

## 1. Objective

Rebuild the complete customer-facing interface as a cohesive, production-grade SaaS product, beginning with the public landing page and then moving through the working application one surface at a time.

The new UI must:

- feel like one deliberate product rather than a collection of screens;
- explain the product in seconds;
- make the upload-to-clips workflow obvious;
- preserve the proven ingest, selection, rendering, and export behavior;
- remain fast and usable on desktop, tablet, and mobile;
- make search discoverability, crawlability, and content quality first-class architectural concerns;
- meet accessibility and performance targets before it replaces the current interface;
- be reversible throughout the migration.

## 2. Non-negotiable design rule

The existing UI is **not a visual reference**.

It will only be treated as an inventory of working product behavior and API contracts. The new work will not reuse its purple glass treatment, gradient text, layout, component styling, page hierarchy, or visual patterns. Existing functional logic can be moved behind new feature components where doing so avoids breaking production behavior.

OpusClip is a quality benchmark for product clarity, confidence, hierarchy, and polish—not a template to copy. PodToClips will have its own art direction, components, copy, and interaction model.

## 3. Product design north star

### Creative direction: Editorial precision

PodToClips should feel like a high-end editing studio made approachable: decisive, spacious, tactile, and fast.

Core visual language:

- **Porcelain canvas** for a warm, premium marketing surface instead of generic white.
- **Carbon typography** for clarity and strong editorial hierarchy.
- **Signal coral** for primary actions and important moments.
- **Cobalt** for utility states, selections, and data visualization.
- **Dark editing stage** only where video, timelines, or output previews need maximum contrast.
- Thin rules, precise alignment, intentional whitespace, and restrained depth.
- Subtle motion that communicates cause and effect; no decorative animation that delays work.

Initial token direction, to be tuned visually during the landing-page build:

| Role | Direction |
| --- | --- |
| Canvas | warm porcelain, approximately `#F5F3EE` |
| Primary text | carbon, approximately `#11120F` |
| Surface | clean white |
| Primary action | signal coral, approximately `#FF5A36` |
| Utility accent | saturated cobalt, approximately `#3157FF` |
| Product stage | charcoal, approximately `#151614` |
| Muted text | warm neutral gray |
| Success/warning/error | semantic colors with AA contrast |

Typography direction:

- Self-hosted **Geist Sans** or a similarly crisp grotesk for interface and body text.
- A restrained editorial display face such as **Instrument Serif** for selected marketing headlines only.
- Tabular numerals for durations, scores, timestamps, and processing progress.
- A documented type scale rather than one-off font sizes.

The product name remains a replaceable text token. No permanent logo work will depend on “PodToClips.”

## 4. Experience architecture

### Public marketing

- `/` — landing page
- `/product` — detailed product story, added after the landing page
- `/pricing` — only after actual pricing and plan limits exist
- `/resources` — later educational content and product help

### Product application

- `/app` — project dashboard
- `/app/new` — upload or import a recording
- `/app/projects/:episodeId` — processing state and project overview
- `/app/projects/:episodeId/clips` — ranked moments and generated clips
- `/app/projects/:episodeId/clips/:clipId` — focused clip review
- `/editor/:clipId` — timeline editor
- `/app/settings` — account, workspace, defaults, and integrations when available

Until authentication exists, marketing calls to action can enter `/app/new` directly. The routing structure will be authentication-ready without pretending that sign-in, billing, teams, or plans already exist.

The current `?editor=<clipId>` URL will receive a compatibility redirect so saved development links do not break.

## 5. Landing page specification — first implementation slice

Three variants now share the same approved production design system:

- `/` uses the search-and-conversion optimized version by default. It preserves the initial page's exact hero and design while explaining the AI podcast clipping product more clearly.
- `/landing/original` preserves the first approved creative version for comparison and rollback. It is intentionally excluded from search indexing.
- `/landing/podcast` preserves the later “teams of one” audience-focused version.
- `/landing/optimized` provides a direct preview of the new default version.

`VITE_LANDING_VARIANT=original`, `podcast`, or `optimized` can select any version at the root without undoing the shared component architecture.

### 5.1 Navigation

- Replaceable PodToClips wordmark.
- Product, How it works, Editor, and Use cases anchors.
- A restrained sign-in placeholder only if it has a real destination.
- High-contrast “Create clips” primary action.
- Responsive menu with keyboard-safe focus management.

### 5.2 Hero

Proposed message direction:

> One recording. Your next month of content.

Supporting copy will explain that PodToClips finds complete, high-value moments, reframes speakers, adds captions, and produces editable vertical clips.

The primary interaction will be a real-looking import surface with:

- a video-link field;
- a paste affordance;
- an upload alternative;
- supported-source guidance;
- a clear transition into the product workspace.

The hero will not claim unsupported processing speeds, customer counts, or virality guarantees.

### 5.3 Product theatre

A code-built, responsive product demonstration—not a flattened screenshot—will show:

- a source recording entering the system;
- complete-context moments being identified;
- speaker-aware 9:16 reframing;
- captions and a quality score;
- selected clips moving into the editor timeline.

This area will establish the dark editing-stage motif and demonstrate actual product capabilities without exposing user media.

### 5.4 Capability narrative

The main story will be organized around outcomes rather than infrastructure:

1. **Find the moment** — transcript-wide discovery with context-complete boundaries.
2. **Frame the story** — speaker tracking and source-graphic-safe vertical composition.
3. **Make it yours** — captions, timeline cuts, music, transitions, and export.

### 5.5 Proof without fabricated social proof

Until real customer approvals exist, the site will use:

- supported source types;
- real product capability demonstrations;
- verified workflow details;
- honest quality and control statements.

It will not use invented testimonials, customer logos, star ratings, or made-up performance statistics.

### 5.6 Editor showcase

A focused section will demonstrate:

- a vertical preview;
- a multi-clip video lane;
- an audio lane;
- cut and fade boundaries;
- caption styling;
- export.

The interaction will visually match the real editor concepts so the marketing promise and application experience remain consistent.

### 5.7 Use cases

- Video podcasts and interviews
- Founder and expert content
- Educational recordings
- Product and screen-led videos

Each use case gets a distinct outcome, not a repeated generic feature card.

### 5.8 FAQ, final action, and footer

The FAQ will cover input types, generated clip length, captions, reframing, editing, and export using only current capabilities. The final action returns to the same import flow. The footer will reserve room for legal and support links without shipping dead navigation.

### 5.9 Product-demo video after the application redesign

After all product surfaces use the final design language, add a short real-product preview that moves from podcast import to ranked clips, editing, and export. It will use actual captured UI, optimized MP4/WebM sources, a poster, reduced-motion handling, accessible supporting content, reserved dimensions, and lazy loading. `VideoObject` structured data will be added only when the public video and thumbnail have stable production URLs. The detailed specification lives in `docs/landing-seo-strategy.md`.

## 6. SEO strategy — equal priority with production-grade design

SEO is part of the landing-page architecture, content model, and acceptance criteria. It is not a metadata pass added after the design is complete.

### 6.1 Rendering and crawlability

- Pre-render public marketing routes into meaningful static HTML during the production build so the headline, product explanation, links, FAQ, and calls to action are available without waiting for client JavaScript.
- Hydrate interactive areas after the primary content is visible.
- Keep real crawlable `<a href>` links for public navigation; do not rely on click handlers or hash-based routing.
- Return meaningful HTTP status codes, including a real `404` for missing public routes rather than a soft-404 application shell.
- Keep authenticated or user-specific `/app`, project, clip, and editor routes out of the public index with the appropriate authentication controls and `noindex` policy.
- Ensure production JavaScript, CSS, images, fonts, `robots.txt`, and sitemap resources are accessible to crawlers.

### 6.2 Search-intent and content plan

Before final copy is frozen, perform evidence-based keyword and competitor research around relevant intent clusters such as:

- long video to short clips;
- AI podcast clip generator;
- podcast to social media clips;
- automatic speaker reframing;
- captioned vertical video maker;
- online short-form video editor.

The research will determine actual primary and supporting phrases, user questions, and page opportunities. Search volume will not be invented or assumed.

The landing page will target one clear primary intent and use natural supporting language. Future product and use-case pages will own narrower intents so the landing page does not become an unfocused wall of keywords.

Copy requirements:

- one descriptive, human-readable H1;
- logical H2/H3 hierarchy;
- clear explanations of what the product does, who it is for, and how the workflow works;
- product-specific language based on real capabilities;
- useful FAQ answers based on actual user objections;
- descriptive anchor text and image alternatives;
- no keyword stuffing, doorway pages, hidden text, fake comparisons, or meta-keyword tag.

### 6.3 Page metadata and sharing

- Unique, descriptive `<title>` and meta description for every indexable route.
- One configurable production canonical origin and a self-referencing canonical URL on every public page.
- `lang`, viewport, theme color, favicon set, web app manifest, and brand-safe application name.
- Open Graph and X/Twitter metadata with a purpose-built 1200×630 social preview.
- Stable, descriptive public URLs that survive future UI changes.
- `hreflang` only when genuinely localized versions exist.
- Configurable brand and canonical-domain values so the placeholder “PodToClips” can be replaced without leaving stale metadata.

### 6.4 Structured data

- Add factual JSON-LD for `Organization` and `WebSite` when the final company/domain details are available.
- Add `SoftwareApplication` or `WebApplication` only when all required public properties, including a truthful offer or pricing value where required, exist.
- Mark up only content visible to users; never create ratings, reviews, prices, or capabilities solely for structured data.
- Validate every schema change with Google's Rich Results Test and Schema.org validation.
- Treat rich-result eligibility as an enhancement, never a guaranteed search appearance.

### 6.5 Technical SEO assets

- Generate `robots.txt` with separate public-marketing and private-application rules.
- Generate an XML sitemap containing canonical, indexable public URLs only.
- Add clean redirects for renamed pages and, once selected, any product-name or domain migration.
- Prevent duplicate indexing caused by query parameters, trailing-slash variants, preview deployments, or staging domains.
- Add breadcrumb structure when the public site expands beyond the landing page.
- Use HTTPS in production and avoid mixed content.

### 6.6 Image, video, and media SEO

- Use descriptive filenames, useful alt text, explicit dimensions, responsive `srcset`, and modern compressed formats.
- Keep decorative product art out of the accessibility tree.
- Place meaningful media near relevant explanatory text.
- Do not expose private customer videos to search crawlers.
- Add video structured data only if a public, indexable demonstration video with a stable thumbnail and playback URL is intentionally published later.

### 6.7 Performance as search infrastructure

- Preload only the critical self-hosted font subset and avoid layout-shifting font swaps.
- Keep landing-page JavaScript independent from the heavy editor bundle.
- Reserve dimensions for every image, video, and product-demo panel.
- Optimize the hero for LCP and defer below-the-fold media.
- Use hashed, long-lived assets and sensible document caching.
- Track Core Web Vitals from real users after launch, not only from local Lighthouse runs.

### 6.8 Measurement and maintenance

- Configure Google Search Console and Bing Webmaster Tools after the production domain is known.
- Submit and monitor the sitemap.
- Verify representative pages with URL Inspection after deployment.
- Track indexed pages, crawl errors, canonical mismatches, structured-data errors, branded/non-branded queries, impressions, click-through rate, and landing-page conversions.
- Review search performance and content gaps on a recurring cadence; SEO is an ongoing product responsibility.
- Keep analytics privacy-conscious and avoid delaying rendering with blocking trackers.

### 6.9 SEO launch gate

The landing page cannot ship as complete until:

- its primary content is present in the initial HTML response;
- title, description, canonical, social metadata, and index directives are correct;
- the public URL is crawlable and the private product workspace is not indexable;
- sitemap and robots rules validate;
- semantic heading and link structure passes review;
- structured data contains no critical errors;
- mobile rendering and Core Web Vitals targets pass;
- there are no broken internal links, redirect chains, duplicate canonicals, or soft 404s;
- the page has genuinely useful, non-duplicated product copy rather than SEO filler.

## 7. Design-system foundation

The landing page will be the first consumer of a reusable system, not a one-off composition.

### Tokens

- semantic color tokens for marketing and application contexts;
- type families, sizes, weights, line heights, and letter spacing;
- 4px-based spacing scale with named layout gaps;
- container widths and responsive gutters;
- radii, borders, shadows, and overlays;
- motion durations and easing curves;
- z-index layers;
- focus-ring and selection states.

### Core primitives

- Button and icon button
- Link
- Input, textarea, select, and field shell
- Badge and status chip
- Card and inset panel
- Tooltip, popover, dropdown, dialog, and toast
- Tabs and segmented control
- Progress, skeleton, and empty state
- Media frame and aspect-ratio shell
- Page container, section, stack, cluster, and grid layout primitives

Every primitive must document its variants, disabled/loading/error behavior, keyboard behavior, and responsive constraints.

## 8. Frontend technology decisions

The backend and render architecture remain unchanged. The UI layer will evolve on top of the current React/Vite application.

### Adopt

- **Compiled Tailwind CSS through the Vite plugin** — replaces the runtime CDN script and inline configuration.
- **Radix Primitives** — accessible behavior for dialogs, menus, tooltips, tabs, popovers, sliders, and similar controls while preserving a fully custom visual identity.
- **Motion for React** — controlled entrance, shared-layout, and state-transition motion with reduced-motion support.
- **React Router** — real marketing, workspace, project, clip, and editor URLs instead of manual history and query-string state.
- **TanStack Query** — server-state caching, polling, invalidation, retry rules, and loading/error ownership for episode and clip APIs.
- **class-variance-authority**, **clsx**, and **tailwind-merge** — deterministic component variants and class composition.
- **Lucide React** — retain the existing icon library, but wrap icons with system sizing and accessibility rules.
- **Vitest + Testing Library** — component and interaction tests.
- **Playwright** — browser-level responsive, navigation, upload-entry, and accessibility smoke coverage.

Exact dependency versions will be the current compatible stable releases at implementation time, pinned in the lockfile and followed by a production build and dependency audit.

### Avoid

- A pre-styled enterprise kit such as Material UI that would impose a generic brand.
- Tailwind CDN or CSS-in-JS runtime styling in production.
- Multiple overlapping component libraries.
- Animation libraries inside the timeline playback path unless they solve a measured problem.
- Decorative WebGL, large autoplay video backgrounds, or effects that harm loading and mobile battery life.

## 9. Target code organization

```text
src/
  app/
    App.tsx
    router.tsx
    providers.tsx
  pages/
    marketing/
      LandingPage.tsx
    app/
      DashboardPage.tsx
      NewProjectPage.tsx
      ProjectPage.tsx
      ClipsPage.tsx
      ClipReviewPage.tsx
      EditorPage.tsx
  components/
    ui/
    marketing/
    product-preview/
  features/
    ingest/
    episodes/
    clips/
    editor/
    social-posts/
  layouts/
    MarketingLayout.tsx
    AppShell.tsx
  lib/
    api/
    query/
    analytics/
    env.ts
  styles/
    globals.css
    tokens.css
  assets/
  test/
```

The current 730-line podcast page and 558-line editor page will later be decomposed by feature. That decomposition will happen behind tests and will not be bundled into the initial landing-page change.

## 10. Reversible migration strategy

### Feature flag

Add `VITE_UI_V2_ENABLED`:

- `0` — render the current application exactly as it works now;
- `1` — use the new router, landing page, and progressively rebuilt product surfaces.

### Route isolation

During the migration:

- `/` becomes the new landing page only when UI v2 is enabled;
- `/app` initially hosts the stable existing workspace through a compatibility adapter;
- `/editor/:clipId` initially hosts the stable editor through route props;
- each old surface is removed only after its replacement passes functional parity checks.

### Functional boundaries

- No API route changes are required for the landing page.
- No ingest, selection, render, caption, face-tracking, editor-export, or QC setting changes are part of this UI refactor.
- The existing app remains available until the replacement is verified.
- No user-generated media is used in public marketing visuals without explicit approval.

Rollback is an environment-variable change plus a frontend redeploy, not a source-code reversal.

## 11. Full rebuild phases

### Phase 0 — safety and baseline

- Capture current critical workflows and routes.
- Add the v2 feature flag and legacy adapter.
- Add frontend smoke tests for upload/import, project polling, clip opening, editor loading, and export entry.
- Record bundle and Lighthouse baselines.

### Phase 1 — system foundation and landing page

- Move Tailwind from CDN to the compiled Vite integration.
- Add routing, providers, font assets, tokens, primitives, and layout utilities.
- Build the complete responsive landing page.
- Add static pre-rendering, route metadata, canonical URLs, social-preview assets, favicon treatment, robots rules, sitemap generation, and structured product copy.
- Complete search-intent research before finalizing the H1, title, description, supporting copy, and FAQ.
- Verify with browser screenshots at mobile, tablet, laptop, and wide desktop sizes.

### Phase 2 — application shell and dashboard

- ✅ Created a calm, dense-enough authenticated-style shell with responsive navigation.
- ✅ Added project navigation, recent projects, creation entry, processing states, and empty states.
- ⏳ Server-data extraction from the compatibility page remains a later maintainability refactor; API behavior was deliberately preserved during the visual migration.

### Phase 3 — ingest and processing experience

- ✅ Rebuilt upload and URL import as a clear new-project surface within the workspace.
- ✅ Clarified immediate background processing and project progress.
- ✅ Added responsive stage, retry, failure, ready, and empty-state treatments without changing ingest contracts.

### Phase 4 — generated clips workspace

- ✅ Built a ranked clip review list with duration, match score, status, preview, download, and editor entry.
- ✅ Added a focused clip inspector and simplified internal render details.
- ✅ Preserved social-post generation as a contextual secondary action.

### Phase 5 — editor visual system

- ✅ Applied the shared product language to preview, library, timeline, controls, music, transitions, undo, and export.
- ✅ Kept the proven authoritative timeline controller and export contract unchanged.
- ⏳ Further playback profiling and high-frequency state isolation remain launch-hardening work after visual browser QA.

### Phase 6 — settings, account-ready surfaces, and product polish

- ✅ Added a real appearance preference with persistent light and dark modes.
- ✅ Added a narrower retractable navigation shell with persistent expanded/collapsed state.
- ✅ Replaced hash jumps and the single endless product page with focused `/app`, `/app/new`, `/app/clips`, and `/app/settings` surfaces.
- ✅ Kept authentication, billing, teams, and integrations out of the interface until those capabilities exist.
- ⏳ Continue notification, offline, partial-failure, and first-run education hardening after interactive browser QA.

### Phase 7 — launch hardening

- Cross-browser and device testing.
- Keyboard and screen-reader audit.
- Performance profiling and bundle splitting.
- Empty, loading, offline, partial-failure, and long-content states.
- Final content review and analytics events.
- Search Console/Bing verification, sitemap submission, URL inspection, structured-data validation, and production crawl review.

## 12. Landing-page definition of done

The landing page is complete only when all of the following are true:

### Visual quality

- Clear hierarchy and intentional composition at 320px, 375px, 768px, 1024px, 1440px, and wide desktop sizes.
- No horizontal overflow, clipped text, layout shifts, or low-contrast states.
- Original product art and interaction; no copied OpusClip sections or assets.
- Consistent tokens and primitives with no arbitrary one-off styling.
- The marketing promise visually connects to the real product workflow.

### Interaction

- Navigation, mobile menu, import field, upload entry, anchor navigation, and calls to action work.
- Keyboard order is logical and visible.
- Motion respects `prefers-reduced-motion`.
- Touch targets meet a 44px minimum wherever practical.
- Forms expose labels, validation, and error recovery.

### Performance and accessibility targets

- Lighthouse performance target: 90+ on a representative production build.
- Lighthouse accessibility target: 95+ with no known critical violations.
- Core Web Vitals targets: LCP at or below 2.5s, CLS at or below 0.1, and INP at or below 200ms at the 75th percentile once real traffic exists.
- WCAG 2.2 AA color contrast, semantics, focus behavior, and keyboard access.
- Images and product art are responsive, lazy-loaded below the fold, and size-reserved.

### SEO

- Meaningful landing-page content is available in the initial HTML response.
- Search intent, title, meta description, canonical URL, H1, section hierarchy, and internal links are aligned without keyword stuffing.
- Open Graph and X/Twitter previews validate with a production-quality share image.
- `robots.txt`, XML sitemap, index/noindex boundaries, HTTP status codes, and canonical redirects are correct.
- Any JSON-LD is factual, visible-content-aligned, and passes structured-data validation.
- Public pages are indexable; user projects, generated media, clip review, and editor routes are not.
- Image filenames, alt text, dimensions, formats, and loading behavior are appropriate.
- No broken links, soft 404s, duplicate title/description pairs, canonical conflicts, or preview-domain indexing.

### Engineering

- Production build passes.
- Component and browser smoke tests pass.
- No runtime Tailwind CDN, inline theme script, or unnecessary remote font request remains.
- Route-level code splitting keeps marketing code away from the editor bundle and editor code away from initial landing load.
- Legacy UI remains usable with `VITE_UI_V2_ENABLED=0`.

## 13. Implementation order for the next turn

1. Add the reversible application boundary and real router.
2. Install and configure the agreed UI dependencies.
3. Establish static pre-rendering, SEO configuration, canonical-domain handling, and public/private index boundaries.
4. Complete search-intent research and write the page's semantic content outline.
5. Create tokens, typography, global styles, and the first UI primitives.
6. Build the landing navigation and hero.
7. Build the code-driven product theatre.
8. Build capability, workflow, editor showcase, use-case, FAQ, final-action, and footer sections.
9. Connect landing actions to `/app/new` while preserving the current workspace.
10. Add responsive, accessibility, metadata, structured-data, and crawlability tests.
11. Run the production build, browser verification, Lighthouse checks, SEO validation, and dependency audit.
12. Present the landing page for review before redesigning the application dashboard.

## 14. Decisions intentionally deferred

- Final product name and permanent logo
- Authentication provider and sign-in behavior
- Pricing and billing model
- Approved customer logos, testimonials, and public usage metrics
- Public use of existing generated clips
- Final legal, privacy, and support URLs

These missing decisions do not block the landing-page build. The layout will support them without inventing product facts.
