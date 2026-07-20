# Progress

Last updated: 2026-07-19

## Goal

Build a podcast repurposing engine:

Upload a podcast file or video URL, find the best moments, create short-form captioned clips, optionally add UI-flow animation, and generate LinkedIn/X posts.

## Current Working Architecture

```text
File upload
  -> Cloudflare R2 source storage
  -> Inngest event: podcast.uploaded
  -> AssemblyAI transcription + diarization
  -> OpenRouter Gemini transcript scoring
  -> selective visual verification path
  -> UI-flow Scene Script extraction
  -> global clip ranking + context-complete render planning
  -> one Inngest render event per selected clip
  -> up to eight parallel Cloud Run Job executions
  -> FFmpeg 8.1.2 + dav1d + MediaPipe/YuNet render worker
  -> final MP4 uploaded to R2
  -> frontend review + social posts

Video URL
  -> immediate episode creation
  -> Inngest event: podcast.url-import.requested
  -> background yt-dlp download or stored-source cache hit
  -> Cloudflare R2 source storage
  -> Inngest event: podcast.uploaded
  -> same processing pipeline as file uploads
```

## Completed

### Session Update: Clerk Production Credential Staging (2026-07-20)

- Completed the Clerk production domain DNS configuration and certificate issuance for `podtoclips.com` outside the codebase.
- Stored the production Clerk backend secret and publishable key as separate, inactive Google Secret Manager entries named `CLERK_PRODUCTION_SECRET_KEY` and `CLERK_PRODUCTION_PUBLISHABLE_KEY`. Both have an enabled first version.
- Saved the production frontend publishable key in the ignored `.env.production.local` file while preserving the Development key in `.env.local`.
- Did not replace the active `CLERK_SECRET_KEY` or `CLERK_PUBLISHABLE_KEY`, grant runtime access, rebuild the frontend, or redeploy Cloud Run. The current application therefore remains on Clerk Development until the public website is hosted and the production cutover is explicitly performed.

### Session Update: Two-Hour Free Source Limit (2026-07-19)

- Reduced the Free source duration limit from 2 hours 15 minutes to exactly 2 hours, or 7,200 seconds.
- Kept Creator, Growth, Studio, and Enterprise at 4 hours 20 minutes.
- Updated server validation, browser validation, URL metadata rejection, the Free limit dialog, and regression fixtures. Existing 5 GiB Free and 20 GiB paid file-size ceilings remain unchanged.
- Over-limit sources remain terminal cancellations and cannot start transcription or rendering.
- Verification passed: 108 Node tests, 7 Python tracking tests, 26 UI tests, and both production frontend bundles. Deployed backend revision `easyedits-api-00028-tgz` with 100 percent traffic; health returned `200` and the revision had no error-level logs. No podcast, clip, render, payment, or support-email operation was triggered.

### Session Update: Plan-Wide Source Duration Limits (2026-07-19)

- Reduced the Free source duration limit from 2 hours 30 minutes to exactly 2 hours 15 minutes, or 8,100 seconds.
- Added a universal paid-plan source duration limit of exactly 4 hours 20 minutes, or 15,600 seconds, for Creator, Growth, Studio, and Enterprise.
- Applied both limits to browser file validation, direct-upload requests, post-upload FFprobe verification, URL metadata inspection before yt-dlp download, cached-source reuse, the durable Inngest pipeline, and the local fallback pipeline.
- Kept the existing byte limits: 5 GiB for Free uploads and the 20 GiB infrastructure ceiling for all uploads.
- Duration and size violations remain terminal cancellations. They do not retry ingest or emit transcription, quota-reservation, or rendering events.
- Updated the Free limit dialog and all related messages to show 2 hours 15 minutes.
- Verification passed: 108 Node tests, 7 Python tracking tests, 26 UI tests, and both production frontend bundles. Deployed backend revision `easyedits-api-00027-7xn` with 100 percent traffic; health returned `200` and the revision had no error-level logs. No podcast, clip, render, payment, or support-email operation was triggered.

### Session Update: Terminal Free Source Limit Cancellation (2026-07-19)

- Changed Free source duration and size violations from retriable ingest failures into terminal project cancellations.
- URL imports still inspect metadata before downloading. When the source exceeds 2 hours 30 minutes, the Inngest URL-import function now records the project as canceled, closes the active ingest stage, and returns successfully without retrying the rejected download.
- Added an explicit downstream guard so a canceled URL import cannot emit `podcast.uploaded`, start transcription, reserve clip quota, or create render work.
- Applied the same canceled project state to rejected direct uploads and the local pipeline fallback. Cached URL sources and completed yt-dlp files are rechecked for both duration and size before storage or reuse.
- Added regression coverage proving the canceled result is terminal and emits zero downstream podcast-processing events, while an allowed import emits exactly one event.
- Verification passed: 106 Node tests, 7 Python tracking tests, and 26 UI tests. Deployed backend revision `easyedits-api-00026-xnw` with 100 percent traffic; health returned `200` and the revision had no error-level logs. No podcast, clip, render, payment, or support-email operation was triggered.

### Session Update: Permanent Cross-Account Content Isolation (2026-07-19)

- Diagnosed a production account-isolation defect: Clerk authenticated requests correctly, but project and clip routes used global storage reads without applying the authenticated account ID. Direct ID, reprocessing, social-post, editor-export, and media routes shared the same missing ownership boundary.
- Added immutable `owner_user_id` ownership to every Neon episode, indexed by owner and creation time. New episode creation now fails closed when ownership is absent, and user-facing responses redact internal ownership and billing identity.
- Added owner-scoped storage methods for project lists, project details, project clip lists, and individual clips. Every user-content API route now uses these methods and returns not-found semantics for cross-account IDs. Reprocessing can no longer reassign an episode to the caller.
- Added the `user_assets` ownership ledger for editor uploads and exports. Editor export inputs are authorized before FFmpeg runs, and stored exports are assigned permanently to the authenticated account.
- Removed unauthenticated media delivery. Preview and download URLs are issued only after Clerk authentication plus asset ownership verification. Production receives short-lived private R2 URLs; local development uses key-bound, expiring HMAC tokens. Legacy asset endpoints now require authentication and ownership too.
- Updated the clip library and video editor to request authorized media URLs without placing Clerk tokens in media URLs. Downloads reacquire authorization, and exported-video download actions remain usable after an earlier signed URL expires.
- Added the stable Clerk user ID to frontend session state. Workspace, editor, and entitlement state now reset and remount when the authenticated account changes, preventing previous-account React state from surviving an account switch.
- Migrated production Neon and quarantined ownerless legacy rows by default. Production evidence showed one established project owner and one active paid workspace with the same identity, so 82 legacy projects were transactionally reconciled to that verified owner. Final integrity: 85 owned projects, 486 attached clips, zero unassigned projects, and zero orphaned clips.
- Added two-account regression tests for project lists, direct project IDs, direct clip IDs, clip collections, source media, rendered media, editor uploads, editor exports, immutable asset ownership, response redaction, signed local access, token tampering, and frontend authorized-URL requests.
- Verification passed: 102 backend tests, 7 Python tracking tests, 26 UI tests, both production frontend bundles, migration integrity checks, unauthenticated denial probes, and Cloud Run health. Deployed `easyedits-api-00025-fkv` with 100 percent traffic. Health returned `200`, unauthenticated project and asset requests returned `401`, and no error-level revision logs were present. No podcast, clip, render, payment, or support-email operation was triggered.

### Session Update: Free Source Limit Modal (2026-07-19)

- Replaced inline Free source size and duration errors with a centered, responsive limit dialog using a dark blurred backdrop, theme-aware surface styling, restrained entrance motion, and mobile stacking.
- The dialog contains only the two requested actions: return to New Project to choose or edit the source, or open the Pricing page.
- Applied the same dialog to immediate local file validation, synchronous API rejections, and asynchronous pasted-link failures discovered during background metadata inspection.
- Added focus placement, page scroll locking while open, dialog semantics, reduced-motion handling, error-classification coverage, and a component test that verifies exactly two actions and both destinations.
- Verification passed: all 24 UI tests and both production frontend bundles. No podcast or clip generation was triggered.

### Session Update: Evidence-Based Progress And Free Source Limits (2026-07-19)

- Replaced the static completed-stage percentage with a monotonic weighted progress model. Completed pipeline stages and rendered clip counts are exact; the active stage advances using elapsed time against learned historical stage duration and never reaches 100 percent before output readiness.
- Added exact render-phase status such as `3 of 8 clips ready` alongside the current ETA. Progress updates once per second with a smooth 950ms linear width transition, never moves backward within a project, shows `Finalizing` instead of a stuck less-than-one-minute estimate, and switches to `Done` only on rendered-output or terminal project readiness.
- Added a strict Free plan source limit of 9,000 seconds, exactly 2 hours 30 minutes. URL metadata is rejected before yt-dlp download, uploaded files are probed with FFprobe before Inngest starts, and both durable and local pipelines repeat the entitlement-aware duration check before transcription.
- Added a Free-only 5 GiB early upload safety boundary, equivalent to roughly 4.8 Mbps across 2 hours 30 minutes, while paid plans do not inherit the Free duration or size restriction. A separate 20 GiB infrastructure ceiling protects signed and multipart uploads.
- Added frontend media metadata validation for immediate feedback and server-authoritative validation that cannot be bypassed with a modified client request. Rejected direct uploads are removed from object storage and recorded as failed ingest rather than entering the processing pipeline.
- Added account ownership verification to direct-upload completion and object deletion support for both local storage and Cloudflare R2.
- Verification passed: 96 Node tests, 7 Python tracking tests, all 22 UI tests, and both production frontend bundles. Deployed backend revision `easyedits-api-00024-5z4` with 100 percent traffic; health passed and no error-level logs were present. No podcast or clip generation was triggered.

### Session Update: Permanent Quota Identity And Project Completion Repair (2026-07-19)

- Diagnosed the live Studio quota discrepancy against Neon. URL imports were losing the authenticated account ID when the downloaded or cached media source replaced the queued source object, causing the durable pipeline to charge a shared `local-development` Free account.
- Rebuilt URL import completion so cached media ownership, orchestration metadata, and temporary upload state are discarded. Only the requesting episode's authenticated account ID is retained alongside the reusable media metadata.
- Removed every implicit `local-development` fallback from both durable Inngest and local pipeline quota reservation. Missing generation ownership now fails closed with `BILLING_IDENTITY_MISSING` instead of charging any shared account.
- Added regression coverage proving cached sources cannot transfer billing ownership and missing billing identity cannot reserve quota.
- Refreshed account entitlement when render planning, settlement, project completion, browser focus, or the 15-second safety interval occurs, preventing the sidebar allowance from remaining stale after asynchronous generation.
- Project progress now displays `Done` as soon as all clip outputs are rendered, including before the parent Inngest run closes. A terminal zero-clip project no longer displays a false less-than-one-minute estimate, and Open Clips remains gated on every planned clip having a rendered output.
- Transactionally reconciled the one affected eight-clip generation: the settled reservation moved from the shared Free account to the active Studio account, the shared counter returned to zero, and the Studio allowance now reports 8 used and 184 remaining. No payment or media job was triggered.
- Verification passed: 89 Node tests, 7 Python tracking tests, 9 focused UI tests, and both production frontend bundles. Deployed backend revision `easyedits-api-00023-kbf` with 100 percent traffic; health passed and no error-level revision logs were present.

### Session Update: Strict Clip-Based Quotas And Pricing Refresh (2026-07-19)

- Replaced podcast-conversion allowances with delivered-clip allowances: Free includes 8 lifetime clips; Creator 40 clips per paid billing period; Growth 96; Studio 192.
- Moved quota enforcement from upload/transcription time to the durable render-planning boundary. The backend reserves only the available clip slots before Cloud Run fan-out and never creates more quota-approved render jobs than the account can receive.
- Added the `clip_quota_reservations` Neon ledger with per-generation idempotency, account-row locking, immutable server-owned user/generation identity, database constraints, and indexed episode/user audit paths.
- Added settlement accounting: successfully rendered clips remain consumed, while failed or uncreated reserved slots are released exactly once. Repeated completion/failure callbacks cannot double-charge or double-refund quota.
- Preserved the Free pool across the complete subscription lifecycle. It is 8 clips per account forever and is never reset by checkout, upgrade, downgrade, renewal, cancellation, or resubscription.
- Paid clip usage resets to 0 only when a verified Dodo event supplies a genuinely new billing period (or a newly paid subscription is activated). Ordinary repeated `subscription.updated` events that omit the period start no longer reset usage.
- Preserved same-period usage during upgrades, scheduled downgrades for renewal, and Free fallback after cancellation. Creator-to-Growth-to-cancelled resolves to Free, never back to Creator.
- Migrated existing conversion counters conservatively into clip counters once, using an idempotent migration marker, without removing historical billing fields.
- Updated the sidebar, New Project access state, Settings billing summary, limit messages, and entitlement API to report clips. Compatibility aliases remain temporarily for older frontend clients but carry clip units only.
- Rewrote Pricing features to the approved 8/40/96/192 clip offers, added the requested Opus Clips comparison and Discord/priority feature copy, removed the `AI video` logo chip, and moved the Growth `Most popular` badge into a dedicated flex row so it cannot overlap the eyebrow text.
- Verification passed: 85 Node tests, 7 Python tracking tests, 9 focused UI tests, production frontend/SSR builds, Neon migration, and a real 20-request concurrency test that stopped exactly at 40 Creator clips. Temporary concurrency records were deleted.
- Deployed final backend revision `easyedits-api-00022-s56` with 100 percent traffic. The final safeguard prevents Dodo's lifetime subscription creation timestamp from being interpreted as a new monthly period when a routine update omits the explicit period start. Health returned `200` and the revision had no error-level logs. No podcast, clip, render, checkout, or payment was triggered during this work.

### Session Update: Pricing Preview Page (2026-07-16)

- Centered the compact pricing header and changed it to **Create enterprise clips.** with a maximum 52-pixel desktop size. Added a restrained 620ms staggered pop-up entrance for the three plan cards, with reduced-motion support and mobile-safe transforms.
- Added a dedicated `/pricing` preview in the same porcelain, coral, cobalt, editorial typography, rounded-card, and restrained-depth design language as the optimized landing page.
- Added three illustrative tiers: **Free ($0/month)**, **Creator ($10/month)**, and **Enterprise (custom)**, with concise feature lists and plan-specific conversion actions.
- Clearly labeled the entire page as illustrative. Final prices, usage limits, billing terms, and enterprise commitments remain open so placeholder commercial details cannot be mistaken for a launched offer.
- Added desktop and mobile navigation, landing-page header and footer links to Pricing, responsive single-column card behavior, a featured Creator tier, and a closing commercial-model notice.
- Added route-aware pricing metadata and a dedicated statically rendered `/pricing/index.html` with `noindex, nofollow`, no canonical, and no sitemap entry until real pricing is approved.
- Added 2 pricing-page component tests. Current frontend verification: TypeScript passed, 8 UI tests passed, the production build passed, and all 33 SEO/crawl-boundary checks passed. Screenshot-level browser inspection remains pending because no browser tab was available.

### Session Update: Initial-Design SEO Copy Variant (2026-07-16)

- Tightened the optimized variant into concise, result-led enterprise copy. The page now focuses on a repeatable content pipeline, production-ready 9:16 output, lower editing overhead, review and approval, and controlled export while retaining natural AI podcast clipping and repurposing terminology.
- Removed em dashes from all optimized visible copy and metadata. The untouched original and “teams of one” variants retain their original wording.
- Rebuilt the three “How it works” cards as vertical flex layouts. Each card now reserves a 30-pixel separation after its description and bottom-aligns its graphic without absolute positioning, preventing text and graphics from touching at different content lengths or breakpoints.
- Shortened the optimized hero import action from **Generate podcast clips** to **Generate clips** so the primary button remains compact while surrounding copy continues to establish podcast-clipping intent.
- Added a third landing-page variant that preserves the initial approved page's layout, styling, component structure, hero composition, and “One recording. Your next month of content.” headline while changing only its wording.
- Rewrote the supporting copy to define PodToClips immediately as an AI podcast clipping tool for long video podcasts, interviews, and expert conversations. The page naturally covers AI podcast clip generation, video repurposing, complete-context moment selection, captions, 9:16 reframing, editing, and MP4 export without naming individual target industries or stuffing keywords.
- Added intent-aligned copy for expert-led podcasts, founder conversations, educational episodes, and authority-building content so the same message speaks to time-poor, high-value professionals and lean teams.
- Made the optimized variant the default indexable homepage and preserved both older versions at `/landing/original` and `/landing/podcast`. A direct `/landing/optimized` preview is also available; all three preview routes are pre-rendered with `noindex, nofollow` and excluded from the sitemap.
- Expanded `VITE_LANDING_VARIANT` to support `optimized`, `original`, and `podcast`, making every version reversible without overwriting another page.
- Updated the homepage title to **AI Podcast Clip Generator & Video Clipping Tool | PodToClips**, aligned the meta description and social metadata with visible page content, and retained the initial page's approved social artwork.
- Expanded automated SEO verification to 30 checks covering visible search-intent language, the preserved hero, metadata, crawl boundaries, social assets, and all three pre-rendered preview routes.
- Verification completed: TypeScript passed; 6 landing component tests passed; the configured-origin production build and all 30 SEO checks passed; 57 Node and 7 Python regressions passed; the original and podcast root-variant rollback builds passed; the runtime dependency audit reported 0 vulnerabilities; and `/landing/optimized` returned `200 OK` from the running local frontend. Screenshot-level browser QA remains pending because no browser tab was available to the in-app browser connection.

### Session Update: Audience-Focused Landing Variant And SEO Architecture (2026-07-16)

- Preserved the first approved landing page and added a second variant with the same editorial design language, specifically written for solo podcasters, small founder/B2B podcast teams, and course or digital-product creators.
- Made the audience-focused version the default indexable homepage. The original remains available at `/landing/original`, is excluded from indexing, and can be restored at the root with `VITE_LANDING_VARIANT=original`.
- Reframed the main promise around an **AI podcast clipper for teams of one**, with audience-specific workflow, capability, product-preview, use-case, FAQ, and conversion copy. No fabricated testimonials, usage figures, virality guarantees, or processing-speed claims were introduced.
- Added Unhead as the typed route-metadata framework and integrated it into both the browser application and server-render pass. Titles, descriptions, robots rules, canonical links, Open Graph/X metadata, and factual `WebSite` JSON-LD now share one route-aware implementation.
- Added a dedicated 1200×630 audience-focused social image while retaining the original social artwork for rollback.
- Expanded automated SEO verification to 24 checks covering the podcast-search intent, target audiences, rendered H1 and content, metadata, crawl boundaries, sitemap, conversion links, social-image dimensions, and the original preview's dedicated noindex document.
- Documented the search-intent map, future substantive audience pages, content guardrails, measurement plan, and a deferred real-product demo-video specification in `docs/landing-seo-strategy.md`.
- Aligned React and React DOM at version 19.2.7 after the dependency update and retained a zero-vulnerability dependency audit.
- Verification completed: TypeScript passed; 5 landing component tests passed; the configured-origin production build and all 24 SEO checks passed; 57 Node and 7 Python regressions passed; the original-variant rollback build passed; and the runtime dependency audit reported 0 vulnerabilities. Interactive browser visual QA remains pending because the in-app browser backend was unavailable.

### Session Update: Production Landing Page And SEO Foundation (2026-07-16)

- Added the first completely new UI-v2 surface: a responsive PodToClips marketing landing page with an original warm editorial design language, code-built product previews, workflow explanation, capability sections, editor showcase, use cases, accessible FAQ, final CTA, and footer.
- Added visible **Log in** and **Sign up** actions to desktop navigation, mobile navigation, footer, editor showcase, and primary conversion sections. Until authentication is introduced, `/login` enters the existing workspace and `/signup` enters the new-project route, avoiding dead buttons while preserving future auth-ready URLs.
- Replaced manual query-string-only navigation with React Router for `/`, `/app/*`, `/editor/:clipId`, `/login`, and `/signup`, while retaining compatibility for legacy `?editor=<clipId>` links.
- Preserved the working podcast workspace and video editor through lazy route adapters. The marketing bundle is isolated from the heavy editor and workspace chunks.
- Added the reversible `VITE_UI_V2_ENABLED` boundary. Setting it to `0` restores the legacy root application; a dedicated rollback build was verified successfully.
- Replaced the Tailwind CDN and inline theme with the compiled Tailwind Vite integration, semantic CSS tokens, self-hosted Geist/Instrument Serif fonts, reusable button variants, and accessible Radix primitives.
- Added a build-time server-render pass that writes the complete landing page into the initial `dist/index.html`, allowing the headline, explanatory copy, semantic links, FAQ, Log in, and Sign up actions to exist before client JavaScript runs.
- Added SEO metadata, index directives, Open Graph and X/Twitter cards, a 1200×630 social image, favicon, configurable canonical origin, factual `WebSite` JSON-LD, `robots.txt`, and production sitemap generation when `VITE_SITE_URL` is configured.
- Added public/private search boundaries: `/app` and `/editor` are excluded by robots policy and receive client-side `noindex` metadata.
- Added landing-to-workspace source handoff. A URL pasted on the landing page arrives prefilled in the existing link-ingest form; the upload action enters the file workflow.
- Added frontend component tests covering the primary product heading, Log in/Sign up destinations, URL submission, and accessible FAQ behavior.
- Added automated SEO output verification covering 16 crawlability, metadata, structured-data, robots, sitemap, conversion-link, and social-image requirements.
- Verification completed:
  - frontend production build passed with statically rendered landing HTML;
  - TypeScript check passed;
  - 4 landing-page interaction tests passed;
  - 16 SEO output checks passed against a configured canonical test origin;
  - 57 Node tests and 7 Python face-tracking tests passed;
  - production dependency audit reported 0 vulnerabilities for runtime dependencies;
  - interactive in-app browser QA could not run because no browser backend was available in the session and remains a separate visual-verification step.

### Session Update: Final Production Render-Parity Repairs (2026-07-15)

- Fixed the clip editor's production load failure. `VideoEditorPage` was the only frontend surface hardcoded to `http://localhost:3005/api`; it now uses the same `VITE_API_BASE_URL` configuration as the podcast workspace. The active Vite frontend hot-reloaded the correction and both production editor data endpoints were verified successfully.
- Fixed production dense tracking deriving its temporary speaker-timeline path from a signed HTTPS R2 URL. Timeline and tracking files now stay inside each Cloud Run execution's writable work directory.
- Fixed AV1/OpenCV incompatibility without lowering final-video quality. For signed sources, FFmpeg now creates a lightweight H.264 proxy containing only the selected clip window; YuNet and MediaPipe track that local proxy while the final render still uses the original source.
- Added the missing Linux EGL/GLES runtime libraries and a build assertion for `libGLESv2.so.2`. Production MediaPipe Face Landmarker now initializes successfully instead of silently falling back to YuNet alone.
- Expanded visual safety inspection from 12 samples over 45 seconds to as many as 24 samples over the complete 58-second clip, with 1.5-second periodic coverage plus scene boundaries.
- Kept Gemini vision requests provider-safe by classifying six globally indexed frames per strict-schema request, merging all batches, and removing duplicate or hallucinated frame indexes before render planning.
- Increased effective oversized-text/editorial coverage across the full clip. Source-edited titles, B-roll, graphics, and animations temporarily switch to proportional full-source framing over the blurred 9:16 background; ordinary speaker sections remain face-focused.
- Reused the eight existing ranked moments for episode `episode_b9f1b51b18a14905`; transcription, moment discovery, ranking, and context boundaries were not rerun.
- Deployed API revision `easyedits-api-00008-bcl` with image digest `sha256:2273cc68728824e0c77e34e4941198d8bf60e1c5622882538de4b915a47d681c` and Cloud Run render Job generation 11 with final worker image digest `sha256:85fcdee8ffa6aeb642c1ba08dde550a74b1253f0fc5ae2389f2db05b715fe2ef`.
- Production validation confirmed YuNet dense tracking on AV1, stable speaker tracks, and MediaPipe available with 124 refined detections, one recovered detection, 125 landmark faces, and no runtime error on the proof clip.
- Re-rendered all eight saved moments on the final worker. Final state: `8/8 rendered`; every clip recorded YuNet dense tracking, MediaPipe `available: true`, no MediaPipe error, and stabilized speaker points.
- Visually inspected the graphics-heavy output at exact timestamps and confirmed full illustrations and large source text remain inside the rectangular source frame rather than being cropped out of the vertical canvas.
- Visually inspected the final talking-head output and confirmed the active speaker remains face-focused and stable, captions contain shaped Hindi/English words at the requested low-safe height, and the composition switches to full-source framing only for detected editorial content.
- Final automated verification: 55 Node tests plus 7 Python face-tracking tests passed. Render QC remains completely disabled as requested.

### Session Update: Production Parity, Selection Quality, Ingest Reliability, And Security (2026-07-15)

#### Moment Discovery And Context Completion

- Replaced the old partial/fixed-window best-moment approach with full-transcript discovery. The entire transcript is covered by overlapping time windows; long podcasts widen the stride only enough to stay inside the request-size cap without truncating the beginning, middle, or end.
- Added a two-stage Gemini/OpenRouter selection architecture:
  - global discovery returns up to 16 distinct candidate moments from the complete podcast
  - global reranking compares every candidate and selects at most eight
- The final score now explicitly balances engagement, virality, retention, unique speaker insight, surprise/wow factor, clarity, and context. Attention and retention signals receive 60% of the score while insight and surprise remain hard quality requirements.
- Added strict quality floors so dry knowledge, generic motivation, repetitive setup, promotional filler, shallow clickbait, and incomplete teases are rejected.
- Gave highest preference to guest-owned revelations, surprising stories, contrarian takes, emotional truths, memorable numbers, high-stakes decisions, and insights that only the speaker could credibly deliver.
- Preserved the separate context-completion stage. Gemini selects exact global start/end word indexes using surrounding transcript context, with deterministic punctuation/pause/speaker-turn fallback and a hard 58-second maximum.
- Added regression coverage proving discovery reaches the beginning, middle, and end of long podcasts, rejects shallow virality, preserves strong unique insight, and avoids abrupt sentence/question cutoffs.

#### URL Import Cache And YouTube Reliability

- Fixed stored-source reuse so equivalent YouTube URL variants share a canonical provider cache key.
- Cache hits are accepted only when the stored R2 object still exists and matches the active `quality_1080p_concurrent_v2` download profile; stale/missing/lower-quality cached assets trigger a fresh download.
- Added a per-cache-key import lock so simultaneous submissions of the same video cannot race into duplicate downloads. Different videos still ingest concurrently.
- Production yt-dlp now supports a Secret Manager-backed Netscape cookie file and JavaScript challenge runtime for YouTube authentication.
- Read-only mounted cookies are copied into a temporary writable file for yt-dlp, then removed after the command.
- Documented that the production cookie secret must come from a dedicated browser profile and must be refreshed when YouTube expires that authenticated session.

#### Production Cloud Run And Inngest Architecture

- Deployed the backend as a Cloud Run API Service and the renderer as a Cloud Run Job in `asia-south1` under project `gen-lang-client-0403595599`.
- Inngest remains the durable orchestrator. It owns transcription, full-context Gemini selection, visual verification, render planning, one render event per clip, result collection, retries, and final episode readiness.
- Each selected clip starts an independent execution of the same render Job. Up to eight clips render in parallel without splitting transcript context or duplicating moment selection.
- Render workers seek only the selected time range through signed R2 source URLs; they do not download the full podcast once per clip.
- Production render resources are 4 vCPU, 8 GiB, a 20-minute timeout, and two Cloud Run retries per task.
- The active production job is generation 8, pinned to immutable image digest `sha256:540b5643f840771cd82d84ce386f2c09f7b32f021aeb53c2af96ba804f90d589`.
- Added a single production parity profile used by deployment so local-equivalent thresholds, captions, encoding, visual fit, and QC flags cannot silently drift again.

#### Local-To-Production Renderer Parity

- Pinned the production render path to the proven local versions:
  - Node `20.20.2`
  - Python `3.14.5`
  - FFmpeg `8.1.2`
  - x264 `0.165.3222` at revision `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`
  - MediaPipe `0.10.35`
  - OpenCV `5.0.0.93`
  - NumPy `2.5.1`
  - FreeType `2.14.3`
  - fontconfig `2.18.1`
  - FriBidi `1.0.16`
  - HarfBuzz `14.2.1`
  - libass `0.17.5`
  - dav1d `1.5.3`
- Fully pinned the render worker's Python dependency lock instead of allowing transitive packages to drift between builds.
- Added build-time assertions for every runtime version, the x264 source revision, registered `libdav1d` AV1 decoding, and an actual one-frame libass subtitle render.
- Matched local face-tracking sampling, confidence thresholds, crop stabilization, caption geometry, CRF/preset/audio bitrate, source visual-fit behavior, and background treatment.
- The only intentional platform accommodation is the Devanagari font: Linux production uses `Noto Sans Devanagari` because the macOS `Adelle Sans Devanagari` fallback is proprietary and not portable to the container.

#### Caption, Framing, And Render Failure Fixes

- Kept render QC fully disabled in production. `RENDER_QC_ENABLED`, safe-contain fallback, and stacked-speaker fallback are all `0`; no destructive QC rerender can replace a good primary output.
- Restored the complete local caption layout in production: fixed 68-pixel text, compact yellow/white active-word styling, outline/shadow, fixed low-safe caption centers, Hindi/Devanagari shaping, and no full-width caption rectangle.
- Enabled the local graphic-safe source-fit behavior in production. Talking-head sections use face-focused crops; editorial cards, source text, animation, and B-roll temporarily use proportional full-frame fit with the blurred background.
- Fixed a production failure where libass scanned the entire Noto collection and overflowed Node's FFmpeg stderr buffer. The image now exposes only Inter and Noto Sans Devanagari through `/opt/easyed-fonts`, with a defensive 64 MiB diagnostic ceiling.
- Fixed AV1 source failures by compiling and registering the same `dav1d 1.5.3` software decoder used locally. Cloud Run no longer attempts an unavailable hardware-only AV1 path.

#### Render-Only Production Validation

- Reused the eight saved ranked moments for episode `episode_9c344e11e33a4362`; transcription, discovery, global ranking, boundaries, and render-plan selection were not rerun.
- Re-rendered all eight saved clip IDs successfully in parallel. Final state: `8/8 rendered`, `0 failed`, episode `ready`, and `0` QC records.
- Downloaded and visually inspected contact sheets from every output. Captions contain real Hindi/English words rather than line artifacts, remain readable in the intended lower-safe position, and face framing follows the speaker except during intentionally preserved editorial/full-frame source sections.

#### npm And Production Dependency Security

- Verified that npm `12.0.1` is not compatible with the parity-pinned Node `20.20.2`; it requires Node `22.22.2+`, `24.15.0+`, or `26+`.
- Updated the image to npm `11.18.0`, the newest release compatible with Node 20.20.2.
- Removed npm from the production execution path. The container now starts `server/src/renderWorker/runRenderJob.cjs` directly with Node.
- Ran a production dependency audit, found critical/high transitive vulnerabilities, applied the available non-breaking lockfile fixes, and rebuilt the production overlay.
- Final `npm audit --omit=dev --audit-level=high` result: `0 vulnerabilities`.
- Final automated verification: 51 Node tests plus 7 Python face-tracking tests passed.

### Repository Cleanup

- Removed non-podcast product areas from the previous PodToClips app.
- Removed old music/news/sports/movie/motivational/text-highlighter UI paths.
- Removed old Colab/autocrop/download/generated-asset backend paths.
- Rebuilt the app around podcast-to-clips only.

### Documentation

- Added `docs/build-plan.md`.
- Added `docs/architecture-v3.md`.
- Added `docs/cloud-run-render-worker.md`.
- Added this progress log.
- Updated `README.md` with local setup, providers, URL import, rendering, and worker details.

### Frontend

- Replaced the old app shell with the Podcast Repurposing Engine UI.
- Added file upload flow.
- Added video/podcast link import flow.
- Added episode list and pipeline stage display.
- Added ranked clip list.
- Added clip inspector.
- Added UI-flow Scene Script display.
- Added async social post generation UI.
- Added failure banner and reprocess button.
- Added final MP4 player for rendered clips.
- Added MP4 open/download link.
- Added local render button when the clip output key exists but the actual R2 object is missing.
- Added a dedicated clip editor route, opened from each available rendered clip and with a browser-history-safe return to the ranked-clips workspace.
- The editor supports a 9:16 timeline made from rendered clips in the same episode, per-segment start/end trimming, clip removal, and in-browser source preview.
- Added music upload, music-volume control, and a downloadable MP4 export action.
- Upgraded the editor to a Clipchamp-style multitrack timeline:
  - draggable red playhead/scrubber with time ruler and preview seeking
  - video lane with visually sized clip blocks
  - drag-and-drop reordering and clip insertion from the clip library
  - draggable left/right trim handles to crop or extend a selected clip within its original bounds
  - dedicated audio lane directly below video, accepting a dragged uploaded music track
  - timeline music placement/removal remains separate from upload, so an uploaded track is not exported until it is placed on the audio lane
- Simplified cutting to the conventional edit workflow: position the playhead, choose **Cut at playhead**, then select and delete the unwanted piece. Removed the exposed trim-start/trim-end controls and trim handles.
- Added imported video media: users can upload a video clip into the editor library, then drag it onto the video lane alongside generated clips.
- Added independent video/program and music volume controls.
- Added an optional quick fade between video cuts. The FFmpeg exporter now applies selected video volume and fade transitions to the downloaded MP4.
- Fixed editor preview playback after cuts:
  - the HTML video preview now enforces each timeline segment's `end` boundary
  - playback automatically advances from a cut to the next segment's `start`
  - playback stops at the end of the final timeline segment
  - seeking exactly on a cut selects the following segment, preventing the prior source segment from replaying
- Added direct one-action timeline shortening controls:
  - **Keep before playhead** retains everything through the playhead and immediately removes the remaining timeline
  - **Keep after playhead** removes everything before the playhead
  - **Split** remains available only for removing a middle section with a subsequent delete
- Removed the direct shortening controls after UX review. The editor now uses only the standard **Split → select unwanted section → Delete** workflow.
- Replaced the native source-video control bar with editor-owned play/pause and timeline scrub controls. The preview time display now reports project playhead / edited timeline duration instead of the untrimmed source MP4 duration.
- Changed clip-boundary behavior to an instant cut by default and added source preloading for upcoming timeline clips to prevent the preview from pausing during a normal clip swap.
- Replaced the global transition setting with draggable per-boundary animation markers. The current animation set includes an instant cut and an opt-in fade; exports receive the animation choice for each individual boundary.
- Improved transition usability after editor feedback: boundary markers are now large labelled **Cut**/**Fade** junctions, users select one with a click and apply **Instant cut** or **Fade** from explicit sidebar buttons. Drag-and-drop remains an optional shortcut.
- Removed animation drag-and-drop after further UX feedback. Transitions are now click-only: select a labelled boundary and choose **Cut** or **Fade**; the selected action receives a high-contrast active state.
- Improved preview responsiveness at cuts:
  - split segments from the same media source reuse the existing video element instead of reloading it
  - manual scrub input temporarily suppresses stale playback updates, so the playhead remains movable after the end of the timeline
  - preview slider updates immediately as it is dragged
- Hardened editor scrub behavior at the timeline end:
  - manual scrubbing pauses and seeks the source explicitly
  - stale end-of-video time updates are ignored while a user seeks
  - the playhead is reconciled from the browser `seeked` event
  - the draggable red timeline handle now uses pointer capture, preventing it from losing its drag at an edge
- Fixed the remaining end-of-timeline seek regression for split segments sharing one source asset. Because those segments reuse one video element, backward seeks now execute directly instead of waiting for a `loadedmetadata` event that will never fire; the requested global timeline time is also preserved through the asynchronous `seeked` event.
- Replaced the preview's native range input with a custom pointer-controlled scrubber after the native control continued locking at its maximum in the browser. The custom scrubber owns pointer capture through the full drag, supports backward movement from 100%, and adds Arrow/Home/End keyboard seeking.
- Fully replaced the scrubber and playback synchronization architecture:
  - extracted a standalone `TimelineScrubber` component
  - editor timeline time is now authoritative rather than being reconciled from asynchronous video `seeked`/`timeupdate` events
  - playback events may update the playhead only while the controller is explicitly in `playing` mode
  - `scrubbing`, `loading`, `ended`, and `idle` modes cannot overwrite a manual seek
  - the previous timer-based end-lock workarounds were removed
- Fixed live editor audio preview:
  - video-volume changes now apply immediately to the preview video element as well as export
  - imported music is synchronized with timeline play, pause, and seek
  - music loops across the edit, follows the music-volume control, and corrects drift during playback
  - music pauses at the end of the timeline and while the user scrubs
- Added editor keyboard shortcuts and bounded undo history:
  - Delete/Backspace removes the selected timeline clip
  - Command+Z on macOS and Control+Z on Windows/Linux restores the previous edit
  - undo covers clip add/split/delete/reorder, music placement/removal, and per-boundary transitions
  - shortcuts are suppressed while focus is inside an input, textarea, select, or editable text field

### Clip Editor Export

- Added `POST /api/editor/assets/upload` for editor-only audio/video assets. Media is stored in the active object store rather than relying on fragile browser blob URLs.
- Added `POST /api/editor/exports` backed by FFmpeg.
  - joins up to 12 timeline segments
  - respects exact trim boundaries
  - normalizes each source to a 1080×1920 vertical canvas
  - retains program audio and optionally loops/mixes a music track underneath it
  - limits exports to five minutes and stores the finished downloadable MP4 in the active object store
- Existing generated clips and the generation pipeline are unchanged; editor exports are written separately under `editor_exports/`.

### Backend Core

- Replaced monolithic server code with modular backend structure:
  - `routes/`
  - `pipeline/`
  - `storage/`
  - `objectStorage/`
  - `transcription/`
  - `ai/`
  - `visual/`
  - `rendering/`
  - `social/`
  - `renderWorker/`
- Added `/api/architecture/status`.
- Added `/api/assets/:key` signed R2 redirect.
- Added `/api/assets/status/:key` to check if an object exists before the UI shows it.
- Added Express async error handling.

### Neon Postgres

- Added Neon-backed storage adapter.
- Added migration script.
- Migrated tables:
  - `episodes`
  - `clips`
  - `social_posts`
- Added local JSON fallback when `DATABASE_URL` is absent.
- Verified Neon persistence with uploaded/imported episodes, clips, and social posts.

### Inngest

- Added Inngest client and `/api/inngest` serve handler.
- Added `podcast.uploaded` function.
- Added `posts.requested` function.
- Added `podcast.url-import.requested` function for background URL downloads.
- Link submission now returns an episode immediately instead of holding the HTTP request open for the full download.
- Ran Inngest Dev Server locally.
- Verified all three functions are registered in the local Inngest manifest.

### Cloudflare R2

- Added R2 object storage adapter.
- Fixed Cloudflare path-style S3 addressing.
- Configured bucket `easyedits`.
- Verified upload to R2.
- Verified signed read redirects.
- Verified rendered MP4 upload/read.

### File Upload Ingest

- Added `POST /api/podcasts/upload`.
- Stores uploaded source file in R2.
- Creates Neon episode.
- Emits `podcast.uploaded`.
- Verified with real test files.

### Video URL Import

- Added `POST /api/podcasts/import-url`.
- Uses `yt-dlp` binary for YouTube and other yt-dlp supported platforms.
- Stores downloaded source in R2.
- Saves URL metadata:
  - source URL
  - canonical URL
  - provider
  - title
  - author
  - duration
  - thumbnail
- Emits the same `podcast.uploaded` event as file uploads.
- Installed local `yt-dlp` in `server/.tools/yt-dlp-venv`.
- Verified URL import end to end with a YouTube URL.
- Moved URL import into a reversible background architecture:
  - API validates the URL and immediately creates a processing episode
  - Inngest downloads and stores the source in the background
  - the normal `podcast.uploaded` pipeline starts only after ingest completes
  - ingest failures are persisted on the episode and ingest stage
- Added stored-source reuse for a URL that has already been downloaded and still exists in object storage.
- Added reversible fast yt-dlp mode:
  - maximum resolution capped at 1080p
  - combined MP4 with audio is preferred when suitable
  - separate 1080p video/audio remains a fallback
  - six concurrent DASH/HLS fragments by default
  - bounded retries, fragment retries, and socket timeout
- Added `ASYNC_URL_INGEST_ENABLED`, `URL_IMPORT_CACHE_ENABLED`, and `YT_DLP_FAST_MODE_ENABLED` feature flags.
- The advanced audio-first/time-range-only download path was intentionally not implemented.

### AssemblyAI

- Added AssemblyAI transcription adapter.
- Supports local source upload and R2 signed URL transcription.
- Normalizes:
  - transcript text
  - word timestamps
  - speaker labels
  - duration
  - vendor transcript id
- Verified transcription through URL-imported video.

### OpenRouter Gemini

- Added OpenRouter client.
- All Gemini calls go through OpenRouter.
- Added structured JSON transcript scoring.
- Added structured JSON UI-flow Scene Script extraction.
- Added structured JSON social copy generation.
- Verified OpenRouter-generated social posts through Inngest.
- Verified OpenRouter transcript scoring on imported video.

### Visual Verification

- Added provider path for `VISUAL_PROVIDER=openrouter`.
- The intended production path:
  - use FFmpeg to extract scene-change frames only from candidate windows
  - send selected frames to Gemini through OpenRouter image input
  - return screen-recording detection, confidence, and highlight regions
- Added `npm run vision:test` to verify one existing candidate without reprocessing a full episode.
- Hardened audio-only handling so non-video sources skip visual sampling cleanly.
- Switched local config to `VISUAL_PROVIDER=openrouter`.
- Verified the real path on an existing `video/mp4` episode:
  - FFmpeg extracted 6 candidate-window frames
  - OpenRouter Gemini classified the frames
  - result correctly identified no screen recording/UI for the sampled talking-head/outdoor moment
- Fixed FFmpeg frame extraction for videos that require JPEG-compatible full-range pixel format during frame export.
- Extended OpenRouter vision output to include:
  - speaker regions
  - primary subject
  - composition hint
  - screen/UI regions
- Tested a full YouTube URL import with `https://www.youtube.com/watch?v=YP30hXK6dvw`:
  - source video imported to R2
  - AssemblyAI transcription completed
  - OpenRouter Gemini scoring completed
  - OpenRouter Gemini vision detected screen/UI frames
  - one UI-flow moment produced a Scene Script with confidence `0.8`
  - local FFmpeg auto-render produced 5 final MP4 clips
  - all rendered MP4 keys exist in R2

### Rendering

- Added render provider selector.
- Added Cloud Run render-spec adapter.
- Render plans now include:
  - source R2 key
  - output R2 key
  - clip start/end/duration
  - caption word track
  - caption line track
  - visual verification data
  - optional Remotion Scene Script
  - composition plan
  - caption safe area
  - detected speaker/screen regions when available
- Render job specs are stored in R2 under `render_jobs/...`.
- Added optional dispatch URL:
  - `CLOUD_RUN_RENDER_DISPATCH_URL`
  - `CLOUD_RUN_RENDER_DISPATCH_TOKEN`
- Added `POST /api/clips/:clipId/render-local` for local development rendering.
- Extracted local FFmpeg rendering into a shared service used by both the manual render endpoint and the pipeline.
- Added `AUTO_RENDER_LOCAL=1` local development mode so future video clip pipelines can render playable MP4s automatically after render-plan creation.
- Replaced unsafe center-crop rendering with `safe_contain_blur` composition:
  - full source frame is preserved
  - blurred source fills the vertical background
  - foreground is fit without destructive zoom
  - speaker and shown screen/content remain visible together
- Added `speaker_focus_crop` composition path for future talking-head clips when vision returns speaker boxes and no screen/demo content.
- Added low-cost speaker crop tracking:
  - converts sampled speaker boxes into speaker keyframes
  - stores a `speakerTrack` in the render plan
  - FFmpeg interpolates crop center over clip time
  - avoids always-on GPU and avoids full-video vision analysis
- Added optional dense CPU face tracking in the render worker:
  - `server/src/renderWorker/faceTrack.py`
  - originally used OpenCV Haar; now uses YuNet as primary detection, optional Haar fallback, and MediaPipe landmark refinement/recovery
  - updates `speakerTrack` at render time when `DENSE_FACE_TRACKING=1`
  - gracefully falls back to sampled Gemini/vision keyframes if OpenCV is unavailable or confidence is low
  - production render Docker image now installs a pinned MediaPipe Python environment that includes OpenCV
- Upgraded speaker-focus rendering from x-only pan to full 9:16 crop planning:
  - dynamic crop center `x`
  - dynamic crop center `y`
  - computed crop height/zoom from face/upper-body box size
  - FFmpeg interpolates the dense track over clip time
- Installed OpenCV locally in `server/.tools/opencv-venv`.
- Enabled local dense tracking with:
  - `DENSE_FACE_TRACKING=1`
  - `PYTHON_PATH=server/.tools/opencv-venv/bin/python`
- Verified local dense tracking on the TestSprite clip:
  - OpenCV 4.12 loaded successfully
  - 24/24 sampled face detections
  - confidence `1.0`
  - dense face-tracking render uploaded to `renders/quality-tests/dense-face-tracking-test.mp4`
- Added `speaker_plus_screen` composition planning:
  - main panel for detected screen/demo content
  - separate speaker panel when speaker and screen regions are separate
  - overlap guard prevents duplicating the speaker when the source already has speaker PiP inside the screen region
  - falls back to `safe_contain_blur` when separation is uncertain
- Replaced plain SRT burn-in with styled ASS captions:
  - controlled bottom safe area
  - shorter caption chunks
  - boxed background
  - fixed named color handling
  - clamped negative word timestamps
- Raised local render defaults:
  - `FFMPEG_PRESET=medium`
  - `FFMPEG_CRF=18`
  - `FFMPEG_AUDIO_BITRATE=160k`

### FFmpeg

- Installed regular `ffmpeg`.
- Found regular Homebrew FFmpeg lacked text/subtitle filters.
- Installed `ffmpeg-full`.
- Set local `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`.
- Added render worker:
  - downloads source from R2
  - writes styled ASS captions from transcript word timings
  - cuts selected clip
  - applies selected composition/reframing plan
  - burns styled captions
  - uploads final MP4 to R2
- Added automatic local FFmpeg rendering for video sources when `AUTO_RENDER_LOCAL=1`.
- Added quality-first FFmpeg filter graph:
  - safe vertical composition
  - Lanczos foreground scaling
  - blurred/dimmed background fill
  - styled ASS caption overlay
- Verified rendered output:
  - MP4 uploaded to R2
  - `1080x1920`
  - around `16.87s`
  - playable through backend asset proxy
- Verified upgraded renderer on the TestSprite UI-flow clip:
  - speaker and shown UI remained visible together
  - destructive hyper-zoom was removed
  - captions rendered white with boxed background in the bottom safe area
  - final MP4 remained available through R2/backend asset proxy
- Verified temporary `speaker_focus_crop` render output:
  - output key `renders/quality-tests/speaker-focus-test.mp4`
  - `1080x1920`
  - speaker crop used sampled speaker keyframes
  - this mode is intentionally reserved for talking-head clips, not screen-demo/show-and-tell clips
- Verified temporary dense CPU face-tracking render output:
  - output key `renders/quality-tests/dense-face-tracking-test.mp4`
  - `1080x1920`
  - dense OpenCV speaker track centered the visible speaker
- Verified improved dense x/y/zoom face-tracking render output:
  - output key `renders/quality-tests/dense-face-tracking-xyzoom-test.mp4`
  - `1080x1920`
  - bitrate around `1.74 Mbps`
  - inspected frames at 5s and 15s
  - face/upper body remained visible instead of being cut off vertically
- Added multi-face CPU tracking in the render worker:
  - detects multiple faces per sampled frame
  - assigns stable track IDs across the clip window
  - chooses a switch-safe active crop path instead of blindly following the first/largest detection forever
  - inserts cut-hold points so FFmpeg does not pan through random empty space during camera switches
  - keeps up to `DENSE_FACE_TRACKING_MAX_RENDER_POINTS` crop points in the FFmpeg expression
- Added low-cost active-speaker scoring:
  - render plans now include `activeSpeakerTimeline` from word-level transcript diarization
  - render worker passes the timeline into the OpenCV tracker
  - tracker measures lower-face motion as a cheap visual speaking signal
  - track choice now combines face area, mouth motion, center bias, and diarization switch hints
  - output metadata includes `activeSpeakerMode`, `averageMouthMotion`, and active transcript speaker markers
- Upgraded active-speaker switching:
  - maps transcript speaker labels to face track IDs using mouth-motion scores inside diarized speaker segments
  - adds speaker-boundary crop points so switches happen at the diarization boundary instead of waiting for the next tracker sample
  - hard-cuts between speakers instead of panning across background/object space
  - suppresses stale post-boundary points that would briefly bounce back to the previous listener
  - tracks at `4 fps` with up to `96` samples per clip window for tighter switch timing
  - decimates non-critical render points to `48` while preserving hard-cut/speaker-switch points so FFmpeg expressions stay valid
- Verified multi-face tracking render output:
  - output key `renders/quality-tests/active-speaker-multitrack-test-1783497252177.mp4`
  - output size `5,933,675` bytes
  - `1080x1920`
  - duration around `26.87s`
  - bitrate around `1.6 Mbps` video / `1.76 Mbps` container
  - inspected frames at 5s and 15s
  - speaker remained visible with screen context preserved
- Verified AV-guided active-speaker render output:
  - output key `renders/quality-tests/active-speaker-av-test-1783497729778.mp4`
  - output size `5,933,485` bytes
  - `1080x1920`
  - duration around `26.87s`
  - inspected frames at 8s and 15s
  - speaker remained visible through the diarization-switch region
- Verified hard-cut active-speaker render output:
  - output key `renders/quality-tests/active-speaker-hardcut-test-1783504531895.mp4`
  - output size `6,057,829` bytes
  - `1080x1920`
  - duration around `26.87s`
  - inspected frames at 8.04s and 14.04s
  - speaker switch points rendered without FFmpeg expression errors after smart decimation
- Added locked crop stabilization:
  - compresses raw face-tracking points into stable speaker anchors
  - holds the crop while the same speaker is active instead of following every small face-box jitter
  - preserves hard cuts at diarization speaker boundaries
  - direct tracker test reduced `98` raw points to `8` stable points on the validation clip
- Verified stabilized active-speaker render output:
  - output key `renders/quality-tests/active-speaker-stable-crop-test-1783582907418.mp4`
  - output size `5,284,642` bytes
  - `1080x1920`
  - duration around `26.87s`
  - inspected frames at 7.7s, 8.04s, and 14.04s
  - crop stayed locked instead of micro-hovering around the speaker
- Verified temporary `speaker_plus_screen` render output:
  - output key `renders/quality-tests/speaker-plus-screen-test-v2.mp4`
  - `1080x1920`
  - screen/demo panel and speaker panel rendered correctly
  - planner correctly falls back to `safe_contain_blur` for TestSprite because the speaker is already visible inside the source screen region

### Cloud Run Render Worker

- Added `server/src/renderWorker/runRenderJob.cjs`.
- Added `render-worker.Dockerfile`.
- Added npm script:
  - `npm run render:job`
- Worker accepts:
  - `RENDER_JOB_SPEC_KEY`
  - `RENDER_JOB_SPEC_URL`
  - `RENDER_JOB_SPEC_FILE`
- Worker is packaged and deployed as the production Cloud Run Job container; current production generation and digest are recorded in the 2026-07-15 session update above.

## Current Runtime Status

- Production backend: Cloud Run API Service in `asia-south1`.
- Production rendering: Cloud Run Job generation 8, 4 vCPU / 8 GiB, eight-way Inngest fan-out.
- Production renderer image: immutable digest `sha256:540b5643f840771cd82d84ce386f2c09f7b32f021aeb53c2af96ba804f90d589`.
- Production orchestration: Inngest Cloud calling the Cloud Run `/api/inngest` endpoint.
- Active frontend is configured to use the production Cloud Run backend.
- Storage: Cloudflare R2.
- Database: Neon Postgres.
- Transcription: AssemblyAI.
- Text/structured AI and vision: Gemini through OpenRouter.
- Rendering: FFmpeg 8.1.2, dav1d, MediaPipe, YuNet/OpenCV, libass/Remotion caption planning.
- Local frontend/backend/Inngest can still be started for development, but production clip execution does not depend on the laptop.
- Final clip playback and editor access are implemented in the frontend.

## Verified End-to-End Paths

- File upload to R2.
- URL import with `yt-dlp`.
- Immediate `podcast.url-import.requested` submission, background source ingest, follow-up `podcast.uploaded` event, and completed pipeline execution.
- Full YouTube URL pipeline test with `episode_1d445ea723eb4324`.
- R2 signed asset reads.
- AssemblyAI transcription from imported video.
- OpenRouter Gemini moment scoring.
- OpenRouter Gemini visual verification on sampled video frames.
- Inngest pipeline completion.
- Neon persistence.
- OpenRouter social post generation.
- Render job spec creation and R2 storage.
- Local FFmpeg render worker.
- Shared local FFmpeg render service used by the API endpoint and pipeline auto-render mode.
- Safe-contain vertical composition renderer.
- Styled ASS caption renderer.
- Final MP4 upload to R2.
- Frontend final clip playback wiring.
- UI asset-status endpoint confirmed all 5 generated MP4 outputs exist for the YouTube test.
- Production URL ingest through Cloud Run and Inngest.
- Production stored-source cache reuse with R2 existence and download-profile validation.
- Production cookie-authenticated yt-dlp invocation with a writable temporary cookie copy.
- Full-transcript Gemini discovery, global reranking, and context-complete boundaries.
- Eight independent Cloud Run render executions fanned out and collected by Inngest.
- AV1 decoding in Cloud Run through dav1d 1.5.3.
- Hindi/Devanagari libass caption shaping in Cloud Run through FriBidi 1.0.16 and HarfBuzz 14.2.1.
- Render-only rerun of eight saved ranked moments: 8/8 successful, episode ready.
- Production dependency audit after remediation: 0 vulnerabilities.

## Known Gaps

- YouTube cookies are an authenticated session artifact and will eventually expire or be invalidated. Production needs an operational secret-refresh procedure or a dedicated licensed/managed ingest provider for stronger long-term reliability.
- yt-dlp cookies improve restricted YouTube downloads but cannot guarantee every source; YouTube can still apply bot challenges, geo restrictions, account restrictions, or throttling.
- Production URL ingest and rendering are deployed, but sustained long-video load, concurrency, cost, cold-start, and failure-rate benchmarks still need to be collected.
- The Cloud Run renderer matches the effective local render path, but macOS-only VideoToolbox/AudioToolbox/NEON features and the proprietary Adelle font cannot be reproduced in the Linux container.
- Remotion UI-flow animation render is scaffolded but not yet producing final animation MP4s.
- Remotion caption pagination, word highlighting, and a fixed caption center are implemented; broader content-aware collision placement remains future work.
- Periodic source-text detection and context-safe boundaries are implemented and tested, but should continue to be reviewed across varied languages, editing styles, and podcast formats.
- Dense MediaPipe/YuNet speaker tracking is running in Cloud Run; broader benchmarking is still needed for crowded scenes, occlusions, rapid cuts, and unusual camera layouts.
- Show-and-tell/screen-demo clips now preserve the full source frame; split-layout/PiP composition exists when screen and speaker regions are separate, but needs more real samples before making it aggressive.
- Render QC is intentionally disabled because its automatic fallback damaged otherwise good outputs; the next QC design should report warnings without destructive rerenders.

## Latest Reframing Update

- Changed dense face tracking anchors to center the crop on the detected face, while keeping upper-body crop sizing from the padded region.
- Added assignment-confidence metadata for diarized-speaker-to-face-track mapping.
- Added a low-confidence fallback: when speaker-to-face mapping is weak, the crop widens instead of over-zooming onto a possibly wrong face.
- Changed FFmpeg crop expressions so speaker switches are hard cuts, not micro-pans through background/object space.
- Verified direct OpenCV tracker output on the YouTube test segment:
  - 96 sampled frames
  - 137 face detections
  - 6 face tracks
  - 98 raw active-speaker points
  - 8 stabilized crop points
  - 3 low-confidence fallback points
- Verified full R2-backed render output:
  - `renders/quality-tests/active-speaker-face-anchor-test-1783584539474.mp4`
  - 5,063,222 bytes
  - 1080x1920
  - 26.87 seconds
  - confirmed reachable through `/api/assets/status/...`
- Visual frame checks show less crop shake and no visible pan-through-background at the tested speaker switch.
- Remaining issue from the inspected sample: screen-share plus face-cam clips should use `speaker_plus_screen` or `safe_contain_blur`, not pure `speaker_focus_crop`, because the important content is the screen plus the face together.

## Standard Quality Test Podcast

- Use this video for future quality checks:
  - `https://www.youtube.com/watch?v=cpg78ouK54I&t=1746s`
- Current processed episode:
  - `episode_9187ed441d064b47`
  - source asset: `episodes/episode_9187ed441d064b47/source.mp4`
- Rendered clips inspected:
  - `clip_9ac9b643810f456d` - Faking a Birth Certificate to Work at 17
  - `clip_f7e2d43b715c475a` - The Awkwardness of Fake British Accents
  - `clip_9b41b4b1a16f422a` - The Cycle of Losing Everything in Trading
  - `clip_1fffc906f7874bc3` - Why Sales is the Most Important Skill
  - `clip_b28a3314d78d4e41` - The Addiction of 50x Leverage
  - `clip_ce0ea740f1824028` - Living on Rs 8,500 and 60 Rupee Beers
  - `clip_f157491f33ee434e` - Hard Selling the Free 60-Day Period
- Findings from the current renderer:
  - Good: several single-speaker clips are stable and centered enough for review.
  - Good: major speaker changes are mostly direct cuts, not slow pans across empty background.
  - Bad: `The Addiction of 50x Leverage` spends roughly the first 6 seconds cropped onto a hand/couch even though the source frame contains the speaker's face. Direct tracker output shows Haar face detection selected a false face-like region around `x ~= 0.24` instead of the real face.
  - Bad: `The Cycle of Losing Everything in Trading` cuts the speaker's face on the left edge late in the clip.
  - Bad: `Why Sales is the Most Important Skill` has over-tight/edge framing around speaker switches.
  - Bad: diarization creates very short speaker blips, including likely false extra speakers. These can cause unnecessary crop switches unless filtered.
  - Bad: pure `speaker_focus_crop` is too aggressive for two-person wide shots when the active speaker is near the source edge.
- Required next fix:
  - Replace or supplement Haar with a stronger CPU face detector, preferably MediaPipe/RetinaFace-style face detection.
  - Reject false detections using temporal consistency and face-size/skin/landmark confidence.
  - Add a minimum speaker segment duration before switching crop targets.
  - Add edge-safe crop constraints so faces near the source edge trigger a wider crop or safe-contain fallback.
  - Add a QC pass that flags rendered clips with missing faces or face margins below the threshold.

## Speaker Crop Fix Implementation

- Added OpenCV YuNet CPU face detection:
  - model: `server/models/face_detection_yunet_2023mar.onnx`
  - Haar remains as fallback only when YuNet produces no usable faces.
- Added diarization cleanup:
  - filters very short speaker blips before crop switching
  - merges nearby same-speaker segments
- Changed active-speaker selection:
  - weak speaker-to-face mappings are no longer trusted blindly
  - on speaker changes, the tracker can switch to the best non-current visible face instead of staying stuck on the old listener
- Added edge-safe crop behavior:
  - crop stays centered on the detected edge face instead of being moved away from it
  - crop widens when confidence is low or face is near an edge
- Added render QC:
  - script: `server/src/renderWorker/renderQc.py`
  - checks rendered MP4s for missing faces and edge-cut faces
  - ignores oversized blurred-background detections in safe-contain renders
- Added automatic fallback:
  - if `speaker_focus_crop` fails QC, the worker rerenders the same clip as `safe_contain_blur`
  - final render metadata stores `renderQc`, `qcFallbackApplied`, and the final render plan
- Re-rendered all 7 clips for the standard test podcast:
  - all use YuNet
  - all final outputs pass QC with `noFaceRatio = 0`
  - unsafe speaker-focus crops fallback to `safe_contain_blur`
- Current final layout results:
  - `The Awkwardness of Fake British Accents`: `speaker_focus_crop`, QC passed
  - `Hard Selling the Free 60-Day Period`: `speaker_focus_crop`, QC passed
  - `Faking a Birth Certificate to Work at 17`: `safe_contain_blur`, QC passed
  - `The Cycle of Losing Everything in Trading`: `safe_contain_blur`, fallback QC passed
  - `Why Sales is the Most Important Skill`: `safe_contain_blur`, fallback QC passed
  - `The Addiction of 50x Leverage`: `safe_contain_blur`, fallback QC passed
  - `Living on Rs 8,500 and 60 Rupee Beers`: `safe_contain_blur`, fallback QC passed
- Remaining quality note:
  - safe-contain fallback prevents missing/cut speakers, but it is visually less premium than a perfect face crop. Next design work should improve this fallback layout with a larger foreground, better caption placement, or a two-person split layout.

## Update: Polished QC Fallback Layout

- Added `stacked_speaker_blur` as the preferred QC fallback mode.
- When a `speaker_focus_crop` render fails QC, the render worker now derives two stable speaker regions from all dense YuNet face tracks first, not only from the active-speaker crop track.
- If two speaker regions are available, the fallback render stacks both speakers vertically with speaker one on top and speaker two on bottom.
- The stacked fallback no longer uses a blurred source background. It renders on a clean black canvas so the output looks like a deliberate two-person podcast layout.
- If two speaker regions are not available, the worker still uses `safe_contain_blur` as the last-resort safety layout.
- Added `RENDER_QC_STACKED_SPEAKER_FALLBACK=1` to enable this behavior by default.
- No API-credit test was run for this change per user request.
- Follow-up diagnosis after user trial:
  - latest stored clips were still ending as `safe_contain_blur`
  - stored `qcFallback` metadata did not include the new `fallbackMode`, which means the active backend/render process had not picked up the new render code or was reusing old final fallback plans
  - `/api/clips/:clipId/render-local` reused an existing fallback render plan, so rerendering a fallbacked clip could stay trapped in `safe_contain_blur`
  - fixed rerender logic so clips with `qcFallback`, `safe_contain_blur`, or `stacked_speaker_blur` rebuild from the original candidate render plan before rendering again

## Update: QC Integrity And Distinct-Speaker Fallback

- Inspected the latest stored episode and existing rendered outputs without starting any render.
- Confirmed that several stacked fallbacks duplicated the same person or source edit in both panels.
- Confirmed that four newest stacked fallbacks failed their fallback QC while aggregate metadata incorrectly reported `passed: true`.
- Changed diarized speaker-to-face mapping to a one-to-one assignment so two speaker labels cannot resolve to the same face track.
- Added per-track co-visibility metadata and require two spatially distinct faces to be co-visible through most of the clip before stacked fallback is allowed.
- Alternating single-camera edits and B-roll clips now use `safe_contain_blur` instead of a false two-person split.
- Tightened and separated stacked panel crop regions so each valid panel isolates its assigned speaker.
- Made render QC layout-aware:
  - large close-up faces are no longer discarded as blurred-background duplicates in speaker-focus mode
  - stacked mode requires a detectable face in both the top and bottom panels
- Added a second safety fallback: if stacked output fails QC, rerender as `safe_contain_blur` and run QC again.
- Aggregate QC now reflects the actual final QC result; final failures are persisted as `failed_qc` instead of `rendered`.
- Added non-rendering regression tests for same-face track fragments, insufficient two-person coverage, distinct co-visible pair selection, and speaker panel ordering.
- No clips were rendered or rerendered for this update.

## Update: Layout-Aware Fallback QC And Edge-Crop Correction

- Inspected the next post-restart episode and confirmed that safe-contain outputs were being marked `failed_qc` for face absence during legitimate B-roll/title-card frames.
- Changed `safe_contain_blur` and `speaker_plus_screen` QC to validate frame decodability without requiring a face; face-presence QC remains active for speaker-focus and two-speaker stacked layouts.
- Fixed edge-safe crop geometry: the previous code moved the crop center away from an edge speaker, directly causing the face to be clipped.
- Speaker-focus crop size now uses a high-percentile safety size across the clip instead of the median shot, preventing a brief wider/edge shot from being rendered with an unsafe narrow crop.
- Added Python regression tests for edge-speaker geometry and unique diarized-speaker mappings.
- Restarted the backend after the update; frontend and Inngest remained healthy.
- No clips were rendered or rerendered for this update.
- Remaining architectural requirement for alternating single-camera footage: build an episode-level speaker identity/portrait bank and a conversation compositor. A fixed spatial two-crop filter cannot show two live people when the source frame contains only one speaker or B-roll.

## Update: QC-Off Output Review And Dynamic Full-Frame Visual Fit

- Inspected all four newest QC-disabled outputs and confirmed that the primary speaker-focus format is materially better than the previous fallback-heavy outputs.
- Found the hand/empty-chair crop cause: stabilization locked one globally mapped face track across a full diarized speaker segment even when the source cut to another camera and that track was no longer visible.
- Changed stabilization to build hard-cut anchors per visible face-track run inside each diarized segment.
- Added prominent-face visibility analysis to dense tracking.
- Added dynamic visual-fit metadata for intervals where no credible podcast face is visible.
- Extended selective vision classification to flag oversized editorial text, full-frame animations, title cards, and unsuitable B-roll separately from ordinary studio signage and small lower subtitles.
- Speaker-focus rendering now switches flagged graphics, animations, title cards, and B-roll into a proportional full-source fit inside the 1080x1920 9:16 canvas. Source graphics remain visible without zooming or clipping.
- Extended visual classification to detect whether the uploaded source already has burned-in captions and their approximate lower caption band.
- The source-caption strip is cropped out only inside fitted visual sections. Generated captions use their compact ASS text-sized background; there is no full-width caption rectangle.
- Added regression coverage for camera-cut track changes, missing-face visual-fit intervals, and the FFmpeg 9:16 dynamic-fit graph.
- QC remains disabled in the active local configuration (`RENDER_QC_ENABLED=0`).
- Restarted the backend after the update. No existing clips were rerendered.

## Update: Exact Scene Transitions And Caption Box Removal

- Inspected all eight newest outputs and confirmed the large translucent caption rectangle came from the full-width `drawbox` layer, not from the ASS subtitle itself.
- Removed that layer completely; generated subtitles retain only their compact text-sized ASS background.
- Fixed visual sample timestamps. Scene-change frames previously received invented evenly spaced timestamps, which caused horizontal/full-frame fit mode to leak into later speaker shots.
- FFmpeg `showinfo` timestamps now preserve actual scene-boundary times.
- Scene detection scans up to 30 changes across the candidate and selects API frames across the entire clip instead of only the first six changes.
- Each classified graphic/animation interval now ends at its exact next scene boundary.
- All B-roll, title-card, editorial-animation, and large-text scenes are routed to full-source proportional fit on the 9:16 canvas, even when a non-podcast face appears in the B-roll.
- Increased the fitted visual height allowance to 1500 pixels so vertical graphics use the 9:16 canvas effectively while still remaining fully contained.
- Brightened the subdued fill behind contained graphics so dark source frames do not create apparent black letterboxing.
- When source captions are detected in a fitted visual, their narrow bottom strip is cropped out rather than covered by a black rectangle.
- Added regression coverage for exact scene-boundary intervals and validated the filter with a real FFmpeg synthetic smoke test.

## Update: MediaPipe Face Landmark Refinement

- Kept OpenCV YuNet as the primary CPU face detector and crop-geometry source.
- Added the MediaPipe Face Landmarker as an optional local refinement and recovery layer:
  - validates YuNet face detections
  - measures normalized lip opening and `jawOpen` blendshape activity
  - adds landmark-derived mouth-motion signals to active-speaker scoring
  - penalizes YuNet boxes that MediaPipe cannot validate
  - recovers a face when YuNet has no matching detection
  - reports refined, recovered, and landmark-face counts in render metadata
- Uses MediaPipe VIDEO mode with CPU inference and a local `face_landmarker.task` model.
- Added a dedicated local runtime at `server/.tools/mediapipe-venv` so the previous OpenCV environment remains isolated.
- Updated the render-worker container to install pinned MediaPipe dependencies and select the container Python virtual environment.
- Added graceful fallback: if MediaPipe is disabled or unavailable, YuNet and the existing pixel-motion logic continue unchanged.
- Enabled locally with:
  - `MEDIAPIPE_FACE_REFINEMENT=1`
  - `MEDIAPIPE_FACE_RECOVERY=1`
  - `PYTHON_PATH=server/.tools/mediapipe-venv/bin/python`
- Verified MediaPipe against an existing clip using face analysis only; no clip was rendered during implementation.
- Expanded Python regression coverage for landmark motion scoring, pixel-motion fallback, unvalidated detection penalties, unique speaker mapping, and edge-safe crop behavior.

## Update: QC Disabled After Output Comparison

- Compared QC-disabled outputs with the earlier QC/fallback-heavy outputs and retained the primary render path because it produced materially better clips.
- Active local configuration remains `RENDER_QC_ENABLED=0`.
- The previous render-QC, stacked-speaker fallback, and safe-contain fallback code remains in the repository but is dormant while QC is disabled.
- No automatic QC rerender can occur with the active configuration.
- Future QC work should be non-destructive: record warnings/confidence without replacing a good primary render.

## Update: Remotion Caption Layout And Graphic-Safe Rendering

- Added `@remotion/captions` to the production caption-planning path.
- Render plans now use Remotion token pagination when upgrades are enabled.
- Added responsive caption constraints:
  - maximum six words and 42 characters per caption page by default
  - maximum two lines
  - balanced line breaks
  - per-page font sizing from 58 to 76 pixels
  - word-level timing retained from the transcript
- Added active-word highlighting using Remotion-produced pages and deterministic ASS events.
- Replaced the large translucent caption box with an outline and small shadow in the upgraded caption path.
- Generated captions move higher when the source contains detected burned-in subtitles.
- Kept ASS as the final burn-in transport for FFmpeg performance and render-worker compatibility; Remotion owns pagination/timing/layout data.
- Separated editorial visual-fit planning from successful dense face tracking so flagged graphics are protected even when dense tracking is unavailable.
- Speaker scenes keep the MediaPipe/YuNet face crop.
- Large text, title cards, animations, and B-roll switch at exact scene boundaries to:
  - full proportional source-frame contain
  - 996-pixel foreground width and 1760-pixel height allowance
  - blurred and dimmed 9:16 duplicate-source background
  - no black letterbox bars
- Updated the visual-classification prompt so editorial graphics are preserved rather than described as replaceable.

## Update: Reversible Upgrade Architecture

- Added one global rollback switch: `EASYED_UPGRADES_ENABLED`.
- Current local setting is `EASYED_UPGRADES_ENABLED=1`.
- Setting it to `0` and restarting the backend/Inngest restores:
  - legacy three-word ASS caption grouping and boxed style
  - previous visual-fit behavior
  - blocking `/podcasts/import-url` downloads
  - previous `YT_DLP_FORMAT` and yt-dlp arguments
- Added independent rollback flags:
  - `REMOTION_CAPTIONS_ENABLED`
  - `SOURCE_VISUAL_FIT_V2_ENABLED`
  - `ASYNC_URL_INGEST_ENABLED`
  - `URL_IMPORT_CACHE_ENABLED`
  - `YT_DLP_FAST_MODE_ENABLED`
- Added `docs/reversible-render-and-ingest-upgrades.md` with exact rollback instructions.
- Added regression tests for both upgraded and legacy paths.
- Current automated verification:
  - 13 Node tests passed
  - 7 Python face-tracking tests passed
  - production Vite build passed
- Restarted the backend and Inngest after implementation.
- Verified local service state:
  - frontend `http://localhost:3001` returns HTTP 200
  - backend `http://localhost:3005/api/health` is healthy
  - Inngest `http://localhost:8288` returns HTTP 200
  - Inngest manifest reports three registered functions
- No media was downloaded and no clips were rendered during this upgrade implementation.
- Subsequent user testing across many clips, podcasts, and videos reported that the current output quality is working very well.

## Update: Stable Captions And Source-Text Coverage

- Inspected the seven newest R2-rendered clips and their render-job metadata without rerendering any media.
- Confirmed generated captions changed apparent vertical position because pages alternated between one and two lines and used varying 64/70/76-pixel font sizes.
- Locked upgraded captions to:
  - one fixed 68-pixel font size
  - centered ASS alignment
  - one fixed block center at `(540, 1640)` on the 1080x1920 canvas
  - a separate fixed center at y `1370` when source subtitles are detected
- The renderer enforces the fixed font size even for an older stored Remotion caption plan, so a rebuilt plan is not required for caption stability.
- Confirmed the graphic-safe renderer was working whenever visual verification identified the interval.
- Found the remaining oversized-text cause: large words were animating over an unchanged speaker shot, so scene-change-only sampling did not capture them.
- Added periodic source-text safety sampling alongside exact scene-boundary sampling:
  - one coverage frame every 2.5 seconds
  - up to 12 frames sent to visual classification
  - oversized source text is flagged even when it overlays a speaker, appears briefly, touches an edge, or is already partially cropped
  - detected text uses the same proportional full-frame contain and blurred-background treatment as graphics and animations
  - periodic detections use midpoint fit intervals, while true scene-boundary detections retain exact boundaries
- Verified the 2.5-second coverage FFmpeg extraction against an existing newest clip without rendering a new clip.
- Inspected a full-resolution output frame and confirmed the mild face softness is source/crop enlargement rather than low output bitrate; the inspected MP4 was 1080x1920 H.264 at approximately 3.3 Mbps.
- Changed fast yt-dlp format priority to prefer separate video/audio up to 1080p before a lower-resolution combined MP4.
- Added download profile `quality_1080p_concurrent_v2`; older cached URL sources without that profile are not reused, preventing a lower-quality cached source from persisting into new episodes.
- Current verification after the fix:
  - 15 Node tests passed
  - 7 Python face-tracking tests passed
  - source-text coverage extraction smoke test passed
- No clips were rendered or rerendered for this update.
- Restarted backend and Inngest after the fix; frontend, backend, and Inngest all returned HTTP 200 and the Inngest manifest reported three functions.

## Update: Context-Safe Transcript Boundaries

- Diagnosed abrupt clip endings in transcript selection rather than rendering.
- Confirmed the previous OpenRouter scorer selected a fixed transcript `window_index`, and candidate start/end timestamps were copied directly from the first and last words of that arbitrary word-count window.
- Preserved the existing strong-moment scorer and added a separate context-safe boundary refinement stage before visual verification.
- The new stage sends all selected candidates in one batched structured Gemini request rather than one request per clip.
- Each candidate includes:
  - the original core moment and reasoning
  - 12 seconds of transcript context before
  - 18 seconds of transcript context after
  - exact global word indexes, timestamps, and speaker labels
- Gemini selects exact start/end word indexes that:
  - include enough setup to understand the idea independently
  - include a preceding question when the answer otherwise lacks context
  - finish the explanation, example, conclusion, answer, or punchline
  - avoid ending on conjunctions, unfinished clauses, or promises of information that follows
  - prefer 25-42 seconds and remain within a 52-second hard limit
- Added local validation for every model boundary:
  - indexes must remain inside supplied context
  - selection must overlap the original core moment
  - `context_complete` and `ends_cleanly` cannot be false
  - confidence must be at least `0.5`
- Invalid or unavailable model results fall back to deterministic punctuation, speaker-change, and pause boundary expansion.
- Added a local incomplete-ending guard for words such as `because`, `but`, `and`, `which`, `then`, and similar clause continuations.
- Duration enforcement preserves the conclusion and moves the beginning forward when a selection would exceed 52 seconds.
- Removed the renderer's previous forced 12-second minimum, which could append an unrelated next sentence after a short but complete conclusion.
- Added 0.2-second pre-roll and 0.35-second post-roll for natural audio boundaries while keeping the final duration inside the hard maximum.
- Added `boundaryRefinement` diagnostics to candidates, render plans, and Cloud Run job payloads.
- Added reversible configuration:
  - `CONTEXT_BOUNDARY_REFINEMENT_ENABLED=1`
  - `CONTEXT_BOUNDARY_MODEL_ENABLED=1`
  - global `EASYED_UPGRADES_ENABLED=0` also restores the previous fixed-window architecture
- Added regression coverage for sentence completion, valid model indexes, invalid model fallback, conclusion-preserving duration clamping, and incomplete conjunctions.
- Verification after implementation:
  - 20 Node tests passed
  - 7 Python face-tracking tests passed
- No clips were generated or rendered for this update.

## Update: Editor Export Downloads and Transitions

- Fixed editor exports opening an MP4 in a new browser tab instead of downloading it.
- Replaced the generated clip card's **Open or download MP4** link with a dedicated **Download** action using the same attachment endpoint, so rendered clips also download instead of opening in a new tab.
- Added a same-origin download endpoint that serves local files directly or signs R2 objects with `Content-Disposition: attachment`.
- The editor now starts the download automatically when export completes and retains a manual **Download exported media** fallback.
- Added an elapsed export timer and an in-progress status message so the synchronous export no longer appears stalled.
- Changed the default editor export preset from `medium` to `veryfast` while retaining high-quality CRF 20 output; the preset remains environment-configurable.
- Implemented actual video `xfade` and audio `acrossfade` transitions in FFmpeg instead of separate fades through black.
- Kept `cut` as an instantaneous boundary and explicitly concatenates cut segments in the export graph.
- Added the matching 350 ms fade behavior to the browser editor preview.
- Added unit and real-FFmpeg integration tests for mixed fade/cut graphs and transition duration.
- Verification after implementation:
  - 57 Node tests passed
  - 7 Python face-tracking tests passed
  - frontend production build passed
  - production two-segment fade export completed in 8.96 seconds
  - exported MP4 duration was 3.67 seconds and the download response included attachment disposition
- Deployed API revision `easyedits-api-00009-fgw` to 100% of production traffic.

## Update: Uppercase, Larger, Slightly Higher Captions

- Changed enhanced captions to render Latin text in all caps while preserving non-cased scripts such as Hindi/Devanagari.
- Enforced uppercase during ASS generation so the styling also applies when rerendering older stored moments, without repeating moment selection.
- Increased the fixed caption font size from 68 to 74 pixels, with the final review adjustment being only 72 to 74 pixels.
- Moved the normal caption block from center y 1580 to y 1520 on the 1080x1920 canvas; the final review adjustment was only 20 pixels upward.
- Moved the source-caption-safe block to y 1310 by the same final 20-pixel increment; it remains 350 pixels below the vertical center.
- Updated local defaults, render-plan defaults, example configuration, and the production parity profile together.
- Verification after implementation:
  - 57 Node tests passed
  - 7 Python face-tracking tests passed
  - production worker runtime self-check passed
  - production Cloud Run Job read-back confirmed font size 74 and center positions 1520/1310
- Deployed immutable worker image digest `sha256:4a87471b4d54df7ed5c52fd0209f640d5181327e6e944fecaa90304a9eaea975`.
- Rerendered all eight existing ranked moments from the newest Oz Pearlman episode after the final adjustment, without repeating ingest, transcription, visual analysis, or moment selection; all eight Cloud Run executions completed successfully.

## Next Build Plan

1. Add production observability for ingest latency, selection latency, per-clip render latency, Cloud Run retries, cache-hit rate, and cost per source hour.
2. Load-test several 60- to 120-minute podcasts concurrently and measure cold starts, R2 seek behavior, 4-vCPU render speed, and eight-way fan-out limits.
3. Define a production-grade YouTube source policy: operational cookie-secret rotation, user-provided authenticated source, or a licensed/managed media-ingest provider.
4. Add non-destructive render-quality warnings and confidence metadata without automatic fallback rerenders.
5. Continue strengthening layout classification so speaker focus is used only for true talking-head sections and screen/share content is protected automatically.
6. Benchmark MediaPipe/YuNet active-speaker tracking on multi-person, rapid-cut, low-light, and partially occluded footage.
7. Build full Remotion animation execution for UI-flow Scene Scripts and combine it with FFmpeg footage output.
8. Add content-aware caption collision placement beyond the current fixed safe centers.
9. Add an automated runtime/dependency image audit to CI so version parity and zero high/critical npm vulnerabilities are enforced before future deployments.
10. Improve production review/download UX and expose useful render diagnostics without showing internal infrastructure details.

## Needed From User

- A decision on the long-term YouTube ingest policy before broad public launch: maintained dedicated-profile cookies versus a licensed/managed ingest provider.
- More varied production podcast samples for layout, language, and performance benchmarking.
- Any final brand preferences for captions and future UI-flow animations.

## Update: Complete Product UI Redesign

- Extended the approved landing-page design language across the working product without changing ingest, selection, rendering, QC, caption, or export behavior.
- Added a responsive product shell with:
  - branded workspace navigation
  - new-project, project, clip-library, settings, and support destinations
  - production workspace identity and plan entry
  - compact mobile navigation
- Rebuilt the podcast workspace into a clear end-to-end flow:
  - dedicated file and URL import surface
  - recent project selection with processing states
  - active-project progress summary
  - eight-stage pipeline timeline with running, ready, pending, and failed treatments
  - ranked moment review with duration, match score, category, and readiness metadata
  - focused vertical preview, download, editor entry, render recovery, motion plan, and social-copy actions
  - intentional onboarding, empty, loading, and failure states
- Redesigned the video editor as a focused dark workbench while preserving its existing controller and API contract:
  - compact project/export bar
  - media library and import area
  - high-contrast 9:16 preview stage
  - refined playback controls
  - rebuilt visual treatment for video, audio, playhead, cut, and fade timeline elements
  - clear split/delete tool strip and keyboard guidance
  - cohesive sound, volume, transition, and export inspector
  - responsive tablet and mobile layouts
- Added a dedicated product component and CSS architecture rather than extending the previous purple prototype styling.
- Preserved the `VITE_UI_V2_ENABLED=0` rollback path for the pre-refactor application.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 8 frontend component tests passed
  - production Vite and SSR builds passed
  - local frontend at `http://localhost:3001/app` returned HTTP 200
- Interactive browser visual QA remains pending because no in-app browser backend was available in this session.

## Update: Routed Product UX, Collapsible Sidebar, And Theme System

- Replaced the previous product navigation, which sent Projects and Clip Library into different positions on one oversized component, with dedicated route-owned surfaces:
  - `/app` for projects and pipeline status
  - `/app/new` for a focused ingest composer
  - `/app/clips` for ranked clip review
  - `/app/settings` for real workspace preferences
- Fixed the navigation path responsible for the broken Projects and Clip Library experience; these destinations now return the application shell and their own UI rather than relying on hash jumps.
- Reduced the desktop sidebar width to 210 pixels and added a one-click collapsed 72-pixel icon rail.
- Persisted the collapsed/expanded sidebar preference locally.
- Added persistent light and dark themes to the complete product shell.
- Added the same appearance toggle to the video editor while keeping the video stage and timeline appropriately high-contrast.
- Completely rebuilt New Project as a compact, dedicated screen:
  - concise page promise
  - clear link/upload source switch
  - prominent single URL field with direct submission
  - compact drag-and-drop media upload
  - optional project naming
  - one primary Generate clips action
  - restrained workflow preview explaining moment selection, 9:16 framing, and editing
- Successful imports now navigate directly to the generated clip library for the created episode instead of leaving the user above a long dashboard.
- Rebuilt the Projects surface as a dense project list, focused project overview, and separate processing timeline.
- Rebuilt the Clip Library surface around a project selector, ranked moments, and a sticky clip inspector.
- Added UI regression coverage for real product route links, sidebar collapse persistence, and theme persistence.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - production Vite and SSR builds passed
  - `/app`, `/app/new`, `/app/clips`, and `/app/settings` each returned HTTP 200 from the live frontend
- No clip was generated, rendered, rerendered, or downloaded during this UI work.
- Interactive browser screenshot QA remains pending because no browser backend was available in this session.

## Update: Production Studio UI Rebuild And Live WebKit QA

- Connected the official Playwright MCP browser runtime with isolated WebKit and completed live visual QA against the running application at desktop and mobile viewport sizes.
- Found and fixed the actual cause of the Projects page exposing code on macOS:
  - the `/app` route collided case-insensitively with the root `App.tsx` module
  - Vite served the transformed module source instead of the SPA route
  - renamed the entry module to `EasyEditsApp.tsx` and updated the client and SSR imports
- Rebuilt the product UI as an isolated studio design system in `src/styles/studio.css`, leaving the approved marketing landing page unchanged.
- Replaced the previous product shell with:
  - a narrower 218-pixel sidebar and 76-pixel collapsed rail
  - 20-pixel navigation icons and accessible 44-pixel navigation targets
  - client-side React Router links instead of full-page product-route reloads
  - clear active states, workspace usage summary, account area, support entry, and persisted theme controls
  - a compact responsive mobile header
- Rebuilt Projects into a task-focused workspace with:
  - project, ready-clip, and in-progress summary metrics
  - real source thumbnails where available
  - searchable, bounded project results instead of an unbounded 79-row page
  - clear customer-facing statuses
  - a selected-project summary with four understandable progress milestones
  - no raw stage messages, adapter names, or pipeline implementation details
- Rebuilt New Project into a compact import workflow with:
  - link and upload modes
  - direct source submission and automatic cache-reuse messaging
  - drag-and-drop file selection
  - optional project naming
  - one clear Generate clips action
  - a concise explanation of context-complete moment selection, 9:16 composition, and editing
- Rebuilt Clip Library with:
  - project selection, search, and category filters
  - ranked, readable clip rows
  - a focused vertical video preview
  - editor and download actions
  - customer-facing reasoning and publishing-copy tools
  - removal of render provider, job-spec, raw render note, and motion-plan debug details
- Rebuilt Settings with working light and dark theme selectors, accessible labels, output-default summaries, and a direct support path.
- Verified the complete mobile New Project flow at a 390-pixel WebKit viewport and verified the dark theme visually at desktop size.
- Preserved all ingest, selection, rendering, QC, caption, editor, and export behavior; no clips were generated or rerendered during this UI work.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - 57 Node tests passed
  - 7 Python face-tracking tests passed
  - production Vite build passed
  - SSR/prerender build passed
  - WebKit console reported zero errors on the redesigned routes

## Update: Enterprise Clip Library Scale And Navigation Pass

- Refactored the Clip Library into a larger, more operational enterprise workspace without changing clip selection, rendering, editing, or download behavior.
- Replaced the marketing-style Clip Library headline with a direct product title and clearer publishing-workflow description.
- Increased the primary Clip Library interaction scale:
  - project selector and search controls to 46 pixels high
  - source artwork to 60 pixels
  - filter controls to 40 pixels high with a visible 20-pixel filter icon
  - ranked clip rows to a minimum height of 138 pixels
  - row-open controls to 38 pixels with 20-pixel icons
  - section icons to 21 pixels inside 42-pixel containers
  - clip titles to 15 pixels and transcript previews to 13 pixels
- Added clearer source-project context, clip counts, processing state, filter labels, match-score language, and truthful ready-to-review badges.
- Strengthened active, hover, focus-visible, and selected-row treatments for keyboard and pointer navigation.
- Increased the preview, editor, download, reasoning, publishing-copy, and clip-stat controls and typography.
- Preserved responsive behavior with larger mobile rows, simplified mobile row actions, horizontally scrollable filters, and full-width search.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - production Vite build passed
  - SSR/prerender build passed
- The installed browser connector reported no attached browser in this session, so this pass used the exact measurements and screenshots from the preceding WebKit QA. No unrelated browser-control fallback was used.
- No clips were generated, rendered, or rerendered during this UI work.

## Update: Simplified Clip Library Header And New Project Rebuild

- Simplified the congested Clip Library header into one compact product row:
  - direct Clip library title and clip count
  - one project selector
  - one New project action
  - identical 46-pixel control heights and shared vertical alignment
- Removed the large Clip Library description, separate current-project context card, and six always-visible category chips.
- Consolidated clip discovery controls inside the ranked-clip card with one search field and one type selector.
- Kept the larger enterprise clip rows, preview controls, icons, typography, selection states, and accessibility treatments from the preceding scale pass.
- Completely rebuilt New Project as one restrained creation workflow:
  - compact Projects back-navigation and page heading
  - two clear source choices for link import and file upload
  - one source panel that changes with the selected method
  - concise optional project naming
  - aligned Cancel and Generate clips actions in a dedicated footer
- Removed the promotional split-screen layout, black workflow panel, oversized marketing headline, and repeated explanatory copy from New Project.
- Added responsive behavior that stacks source options and form sections cleanly on mobile while keeping actions usable.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - production Vite build passed
  - SSR/prerender build passed
  - frontend Clip Library route returned HTTP 200
  - backend podcast endpoint returned HTTP 200
  - Inngest returned HTTP 200
- The browser connector still reported no attached browser for live screenshot QA in this session.
- No clips were generated, rendered, or rerendered during this UI work.

## Update: Production Video Editor Workbench

- Removed the Publishing copy feature from Clip Library, including its visible panel, generation action, status state, API handler, and unused presentation styles.
- Rebuilt the Video Editor as a dedicated full-height editing workbench while preserving the existing editing and export behavior:
  - a restrained 72-pixel command bar with clear Back, theme, and Export controls
  - a persistent media library with larger assets and import controls
  - a centered 9:16 preview stage with accessible playback controls
  - a dedicated inspector for music, video volume, transition selection, and export status
  - a wide timeline dock spanning the preview and inspector columns
- Increased editor control legibility throughout:
  - primary icons are now 21 to 23 pixels
  - icon containers are 42 to 48 pixels
  - Split and Delete use 20-pixel icons in 40-pixel controls
  - media rows, thumbnails, transition controls, volume sliders, and playback controls have larger hit targets
- Reworked timeline sizing so the ruler, video lane, audio lane, playhead, and Split/Delete toolbar all fit inside a 1000-pixel-high viewport without being clipped.
- Strengthened selected clip and junction styling. Cut and Fade now show distinct, high-contrast active states in both the inspector and timeline.
- Replaced the Video Editor loading sentence with a centered animated spinner and retained an explicit error state when loading fails.
- Added responsive editor layouts for narrower desktop, tablet, and mobile viewports, plus reduced-motion handling.
- Verified the live application with the standalone Playwright WebKit MCP at 1440 by 1000:
  - the full editor workspace and toolbar fit in the viewport
  - adding a second clip created a Cut junction
  - selecting the junction enabled Cut and Fade
  - choosing Fade highlighted both controls correctly
  - Clip Library contains neither Publishing copy nor Generate post
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - production Vite build passed
  - SSR/prerender build passed
- No clips were generated, exported, rendered, or rerendered during this UI work.

## Update: Enlarged Video Editor Preview

- Rebalanced the editor around the 9:16 clip preview so the video is materially larger and the workspace no longer feels compressed.
- Reduced the command bar from 72 to 64 pixels, the media rail from 280 to 240 pixels, the inspector from 320 to 288 pixels, and the timeline from 326 to 250 pixels.
- Removed the 360-pixel preview-width cap. The preview now fills the available stage height up to 720 pixels while preserving its 9:16 aspect ratio.
- Moved playback controls into a readable translucent overlay so they no longer take vertical space away from the video.
- Moved Split and Delete into the timeline header, eliminating the extra toolbar row and keeping the compact timeline fully usable.
- Reduced unnecessary panel padding while retaining the larger icon and control sizes from the production-editor pass.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - production Vite build passed
  - SSR/prerender build passed
- No clips were generated, exported, rendered, or rerendered during this layout work.

## Update: Strict 9:16 Full-Stage Editor Player

- Removed the remaining 720-pixel player-height ceiling and made the preview a strict 9:16 canvas whose width is derived from its full available height.
- Increased the usable preview area again by reducing the editor command bar to 56 pixels and the timeline dock to 205 pixels.
- Reduced the media rail and inspector widths to 220 and 264 pixels while preserving their controls and scrolling behavior.
- Compressed the timeline ruler and track heights without removing video, audio, transition, split, or delete functionality.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - production Vite build passed
  - SSR/prerender build passed
- No clips were generated, exported, rendered, or rerendered during this layout work.

## Update: Unified Production Video Editor Theme And Proportions

- Replaced the accumulated Video Editor CSS overrides with one cohesive workbench stylesheet.
- Established a shared semantic surface system for dark and light modes covering the shell, command bar, panels, stage, raised controls, timeline, tracks, borders, text, and interaction states.
- Removed the mismatched dark checkerboard and black timeline surfaces from light mode. The only intentionally dark surface in light mode is the video canvas and its playback overlay.
- Added explicit light-theme overrides for legacy high-specificity rules so media thumbnails, upload controls, inspector copy, timeline lanes, and panel headers no longer retain incompatible dark styling.
- Rebalanced the primary desktop layout:
  - 64-pixel command bar
  - responsive 236-to-260-pixel media rail
  - flexible central preview workspace
  - responsive 288-to-320-pixel inspector
  - 236-pixel timeline dock
- Restored usable timeline density with a 56-pixel video lane, 46-pixel clip segments, a 34-pixel audio lane, readable ruler labels, and 36-pixel Split and Delete controls.
- Preserved the full-height strict 9:16 preview and overlaid playback controls.
- Replaced utility-only preview scrubber styling with editor-owned semantic classes for consistent rendering and focus behavior.
- Added coordinated theme transitions, focus-visible states, reduced-motion handling, and responsive tablet and mobile layouts.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - production Vite build passed
  - SSR/prerender build passed
- No clips were generated, exported, rendered, or rerendered during this rebuild.

## Update: New Project Completion Routing

- Changed successful file-upload and URL-import completion routing from Clip Library to Projects.
- The destination retains the new episode identifier in the query string, so the newly created project is selected and its live processing stages are visible immediately.
- Clip Library remains available through its navigation item and each ready project's Open clips action.

## Update: Project Progress Checkmark Alignment

- Corrected the completed milestone indicator to use an explicit 16-by-16-pixel flex circle and a fixed 10-by-10-pixel block-level checkmark.
- Removed inline SVG baseline and inferred-height behavior so the checkmark remains centered in Safari and across light and dark themes.

## Update: Failed And Canceled Project States

- Added explicit Projects-page handling for failed, canceled, and cancelled episode states.
- Terminal errors now render a full red progress bar, red milestone circles, centered cross icons, and a direct failure or cancellation explanation.
- The backend-provided episode error is shown when available, with a clear fallback message otherwise.
- Open clips is rendered as a disabled button for terminal-error projects while Try again remains available.
- Polling now stops for canceled states as it already did for ready and failed projects.

## Update: Inngest Cancellation And Failure Synchronization

- Persisted the active Inngest run ID and function ID against each episode before pipeline work begins.
- Persisted individual render-run IDs on their clip render records.
- Registered a new `inngest/function.cancelled` reconciliation function that maps a canceled Inngest run back to its episode, changes the episode to `canceled`, records the cancellation error, and fails the active pipeline stage.
- Added Inngest `onFailure` callbacks for URL import, podcast processing, and clip rendering so exhausted workflow failures no longer leave episodes stuck in `processing`.
- Added `canceled` to the backend episode-status domain and retained frontend compatibility with both `canceled` and `cancelled` spellings.
- Reconciled the pre-existing canceled `Nikhil Kamath x CoinBase CEO` project from `processing` to `canceled`; its `score_transcript` stage is now failed with the cancellation explanation.
- Restarted the backend and Inngest services and verified that the cancellation function and three generated failure functions are registered.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 11 frontend component tests passed
  - 59 Node tests passed, including two new cancellation-mapping tests
  - 7 Python face-tracking tests passed

## Update: Authenticated Entry Routing

- Changed the sign-up entry route to open Projects instead of New Project.
- Login, sign-up, and the generic authenticated `/app` route now consistently land on the Projects tab.

## Update: Branded Clerk Authentication

- Added Clerk's current React and Express SDKs.
- Replaced the temporary login and sign-up redirects with centered PodToClips authentication pages built entirely in the product design system.
- Added Google as the primary authentication action, plus custom email/password sign-in, email/password sign-up, email verification, client-trust email verification, password recovery, and new-password flows.
- Kept third-party component branding out of the product interface by using Clerk's headless authentication resources instead of its prebuilt sign-in, sign-up, and user-menu components.
- Added protected workspace and video-editor routes. Signed-out visitors are sent to login, and every completed login or sign-up lands on Projects.
- Added an OAuth callback route for Google authentication.
- Added an authenticated fetch layer that attaches short-lived session tokens to podcast, clip, upload, render, and editor-export API requests.
- Added conditional Express session verification for product APIs while keeping health, Inngest, and media-delivery endpoints compatible with their existing infrastructure.
- Replaced the placeholder sidebar account control with the authenticated user's name, email, avatar or initials, account settings action, and sign-out action.
- Added fail-closed production configuration through `CLERK_AUTH_REQUIRED=1` and updated the Cloud Run deployment script to require authentication keys and an authorized frontend origin from Secret Manager.
- Added local and production setup documentation in `docs/clerk-authentication.md` and updated the example environment files.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 12 frontend tests passed
  - 62 Node tests passed, including authentication configuration coverage
  - 7 Python face-tracking tests passed
  - production frontend and SSR/prerender builds passed
- Live browser visual inspection could not run because no in-app browser instance was attached in this session. No standalone browser automation fallback was used.
- Authentication activation remains pending until a Clerk application publishable key and secret key are supplied and Google plus email/password are enabled in that application.

## Update: Local Authentication Activation

- Configured the supplied development publishable key for Vite and the matching publishable and secret keys for the backend without committing either environment file.
- Restarted the frontend and backend with the authentication configuration loaded.
- Confirmed the configured application is named PodToClips and has Google, email, passwords, email codes, and password-reset email codes enabled.
- Confirmed the backend credential is valid using a read-only identity API request.
- Confirmed `/api/health` remains public and `/api/podcasts` now returns `401 Authentication required` without a valid session.
- Disabled authentication SDK telemetry in the backend environment and production deployment configuration.

## Update: Live Project Milestones And ETA

- Replaced percentage-threshold milestone checks with the real pipeline objective states for ingest, transcription, moment planning, rendering, and delivery.
- The currently active milestone now renders a 16-by-16-pixel circular spinner, exactly matching the completed green circle footprint.
- A milestone changes to the green background and centered checkmark only after its corresponding pipeline objective is completed or skipped.
- Later milestones retain their existing empty-circle state until they become active.
- Added a subtle, same-size estimated-time label beside Project progress.
- ETA is recalculated every second from live elapsed stage time, stage-specific workload baselines, median durations from the user's completed projects, and a speed calibration derived from stages already completed in the current project.
- Ready, failed, and canceled projects do not show a remaining-time estimate.
- Added regression coverage for active milestone selection, completed milestone state, live ETA reduction, and ready-state completion.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 14 frontend tests passed
  - production frontend and SSR/prerender builds passed

## Update: Authenticated Help And Support

- Added a dedicated `/app/support` page in the existing product shell and made Help & Support a real active navigation destination.
- Added a centered, responsive support composer with editable sender, subject, and message fields plus a fixed read-only receiver loaded from the backend.
- Replaced the Settings mail link with an internal route to the support page.
- Added authenticated support configuration and message endpoints with server-side validation, per-account/IP rate limiting, provider error handling, and idempotent delivery requests.
- Integrated Resend using a verified PodToClips `From` address and the customer-entered sender as `Reply-To` for reliable delivery and direct replies.
- Kept the receiver server-owned so a browser request cannot redirect support messages to another address.
- Added production Secret Manager wiring and setup documentation for `RESEND_API_KEY`, `SUPPORT_RECEIVER_EMAIL`, and `SUPPORT_FROM_EMAIL`.
- Delivery remains intentionally disabled until the final receiver, verified From address, and Resend API key are configured.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 16 frontend tests passed, including fixed-receiver and form-submission coverage
  - 65 Node tests and 7 Python face-tracking tests passed
  - production frontend and SSR/prerender builds passed
  - restarted the authenticated backend and confirmed health plus unauthenticated support-route rejection

## Update: Local Support Inbox Activation

- Configured the supplied receiver and Resend API key in the ignored local backend environment without committing either value.
- Restarted the backend and confirmed the Resend credential is accepted.
- Resend currently reports no verified sending domains, so local delivery uses its onboarding test sender until an PodToClips domain is verified.
- No test email was sent during configuration.

## Update: Production Support Route Deployment

- Diagnosed the Help & Support load failure from Cloud Run request logs: the authenticated frontend was correctly calling the production API, but the active revision returned `404` because it predated the support endpoints.
- Added the Resend credential, fixed receiver, and support From address to Google Secret Manager and attached them to Cloud Run as runtime-only secrets.
- Built and deployed the backend-only API revision `easyedits-api-00010-gzq`; the render worker was not rebuilt or invoked.
- Confirmed the new revision is healthy and serving 100 percent of production API traffic.
- Replaced the support-page introduction with “We reply within a few hours.”
- TypeScript and the focused support-page tests passed after deployment.
- No support email or clip render was triggered during deployment.

## Update: Dodo Decision And Free Conversion Enforcement

- Selected Dodo Payments as the intended Merchant of Record for PodToClips subscriptions; checkout and webhook integration remains pending merchant approval, API credentials, webhook secret, and final product IDs.
- Added a durable account-entitlements table keyed by immutable Clerk user ID.
- Every free account now receives exactly one lifetime podcast conversion.
- Added an atomic database claim so parallel upload or import requests cannot exceed the allowance.
- Enforced the allowance server-side across multipart uploads, direct uploads, and URL imports.
- Restricted project reprocessing and manual clip rerendering to active Creator or Enterprise accounts.
- Added `GET /api/billing/entitlement` for authenticated UI state.
- Added a new-project upgrade gate, live free-allowance indicator, sidebar plan status, and explicit one-conversion wording on the Free pricing tier.
- Added the Dodo onboarding, checkout, verified-webhook, entitlement-event, and customer-portal architecture in `docs/dodo-payments-plan.md`.
- Migrated the production Neon database and deployed API revision `easyedits-api-00011-pbv` with 100 percent traffic.
- Corrected the production authentication boundary by storing the existing Clerk credentials in Google Secret Manager, attaching them to Cloud Run, and enforcing `CLERK_AUTH_REQUIRED=1`.
- Deployed API revision `easyedits-api-00012-q8d` with 100 percent traffic; the public health endpoint returns `200`, while an unauthenticated entitlement request now correctly returns `401` instead of sharing a fallback account.
- Verification after implementation:
  - TypeScript no-emit check passed
  - 16 frontend tests passed
  - 67 Node tests and 7 Python face-tracking tests passed
  - production frontend and SSR/prerender builds passed
  - no podcast conversion or render job was triggered during deployment

## Update: Dodo Checkout And Strict Tier Quotas

- Added the final Free, Creator, Growth, and Studio allowance model: one
  lifetime Free conversion, then 5, 12, or 24 podcast conversions per verified
  billing period.
- Replaced paid unlimited access with a single atomic PostgreSQL quota claim
  shared by multipart upload, direct-upload completion, and URL import.
- Added production fail-closed behavior when the durable quota database is not
  configured, preventing Cloud Run instances from falling back to independent
  local counters.
- Added Dodo hosted checkout sessions for Creator, Growth, and Studio, with
  server-resolved product IDs and immutable Clerk user metadata.
- Added a raw-body, signed Dodo webhook endpoint with persisted replay
  protection and subscription lifecycle synchronization.
- Paid access is granted only by verified `subscription.*` webhooks; checkout
  return URLs never grant access.
- Added customer billing portal sessions, plan usage fields, billing-period
  state, and cancellation state to the account entitlement API.
- Rebuilt the pricing grid around Free ($0), Creator ($5.99), Growth ($14.99),
  and Studio ($24.99), and connected authenticated paid actions to checkout.
- Added current allowance reporting to the workspace sidebar, New Project gate,
  and Settings billing card.
- Preserved a selected paid plan through custom Clerk login and sign-up flows.
- Added Dodo configuration placeholders and stored the supplied non-secret
  product IDs in the ignored local backend environment. No API or webhook key
  was written to the repository.
- Verification after implementation:
  - 72 Node tests passed, including strict 1/5/12/24 caps, inactive and expired
    subscription blocking, renewal reset behavior, and webhook replay handling
  - the Neon concurrency check sent 20 simultaneous Creator claims and accepted
    exactly 5; the temporary test row was deleted afterward
  - focused pricing and support UI tests passed
  - production frontend and SSR/prerender builds passed
  - no podcast conversion, clip generation, render job, payment, or test email
    was triggered
- Payment activation remains pending a rotated Dodo API key and a Dodo webhook
  signing key supplied through the backend secret store.
- The production Neon schema migration completed successfully. The backend code
  has not been deployed or restarted yet, so the current production API remains
  on its previous revision until payment secrets are configured.

## Update: Dodo Test-Mode Activation

- Stored the supplied Dodo test API credential in Google Secret Manager as
  `DODO_PAYMENTS_API_KEY`; no payment credential was added to source control or
  a local environment file.
- Confirmed the Dodo webhook subscribes to all eight supported subscription
  lifecycle events and has endpoint throttling disabled.
- Retrieved the endpoint-specific signing key through the Dodo API and stored it
  directly in Secret Manager as `DODO_PAYMENTS_WEBHOOK_KEY` without displaying
  or persisting the value in the workspace.
- Built the backend-only container and deployed Cloud Run revision
  `easyedits-api-00013-czj` with Dodo test mode, the three server-owned product
  IDs, durable billing enforcement, and localhost as the temporary checkout
  return origin.
- The new revision serves 100 percent of API traffic. Health returns `200`, an
  unsigned webhook is correctly rejected with `401`, and the revision has no
  error-level startup or runtime logs.
- No payment, checkout, podcast conversion, clip generation, render job, or
  support email was triggered during activation.
- Verified signed dashboard webhook delivery end to end: Dodo received `200 OK`
  and Cloud Run recorded two successful signed test requests on revision
  `easyedits-api-00013-czj`; the earlier unsigned probe remains correctly logged
  as `401`.
- Remaining validation: complete a Dodo test-mode subscription checkout with an
  authenticated Clerk account and confirm the resulting signed activation event
  changes that account's allowance.

## Update: Dodo End-To-End Creator Checkout Verified

- Opened authenticated Creator checkout from the local pricing page and
  confirmed the hosted Dodo page displayed the correct $5.99 subscription.
- Completed a successful Dodo test-mode card payment; no real funds were moved.
- Dodo delivered the resulting subscription lifecycle webhooks to Cloud Run,
  and revision `easyedits-api-00013-czj` accepted all deliveries with `200`.
- Verified the durable Neon entitlement without exposing billing identifiers:
  plan `creator`, subscription `active`, zero of five monthly conversions used,
  a complete billing period, stored Dodo customer/subscription/product links,
  and no scheduled cancellation.
- The authenticated Settings page now reflects Creator access. Checkout redirects
  remain non-authoritative; the verified Dodo webhook produced the entitlement.
- Remaining billing smoke test: open the hosted customer portal from Settings and
  confirm it loads the active subscription and returns to the application.

## Update: Production-Hardened Dodo Plan Changes

- Added Creator, Growth, and Studio plan changes through Dodo's subscription
  change-plan API, using immediate time-prorated billing for upgrades and
  next-renewal scheduling without an immediate charge for downgrades.
- Replaced the temporary plan-change redirect with a centered, blurred pricing
  modal that displays the provider charge and live processing state, remains on
  the Pricing page, and exposes a secure payment-action link only when Dodo
  supplies one.
- Added a durable `billing_plan_changes` Neon ledger with a partial unique index
  that permits exactly one open change per Dodo subscription.
- Provider idempotency keys are now created once from the durable ledger record;
  repeated and concurrent application requests reuse the open record instead of
  generating independent payment requests.
- Added signed handling for `payment.processing`, `payment.succeeded`,
  `payment.failed`, and `payment.cancelled`, alongside the existing subscription
  lifecycle events and webhook replay protection.
- Added provider reconciliation to handle delayed or previously-created payment
  events and to complete access only after Dodo reports the target subscription
  product.
- Added a persistent Settings billing-status card that continues polling a
  pending plan change after the Pricing modal is closed.
- Migrated Neon, recovered the existing Creator-to-Growth test payment as one
  processing ledger record, and confirmed no duplicate Growth payments exist.
- Deployed Cloud Run revision `easyedits-api-00016-qqk` with 100 percent traffic.
- Verified the configured Dodo endpoint is enabled, unthrottled, and subscribed
  to all eight subscription plus four payment lifecycle events.
- Sent one signed processing-only webhook through the production receiver; it
  returned `200`, updated the existing ledger idempotently, and did not create,
  retry, complete, or charge a payment.
- Verification: 81 backend tests, five focused UI tests, the production frontend
  build, SSR/prerender build, API health check, database migration, webhook
  configuration audit, and signed payment-event delivery all passed.
- The initial India-billed Creator-to-Growth test upgrade remained in provider
  processing, so the user explicitly requested immediate cancellation of the
  Test Mode Creator subscription. Dodo confirmed `cancelled`, the signed
  cancellation webhook updated Neon, and the pending Growth ledger was closed
  with zero remaining open changes. No live subscription or real payment was
  involved.
- Added automatic pending-ledger cleanup for future cancelled, failed, or expired
  subscriptions and deployed Cloud Run revision `easyedits-api-00017-zfr`.

## Update: Brevo Production Support Email Migration

- Replaced the Resend support-email adapter with Brevo's transactional email
  API while preserving authentication, server-side input validation, fixed
  recipient enforcement, rate limiting, safe provider errors, and customer
  `Reply-To` behavior.
- Configured `PodToClips Support <support@podtoclips.com>` as the authenticated
  sender and `supportcontact584@gmail.com` as the fixed support inbox.
- Added Brevo request idempotency and support-message tagging, and mapped the
  provider's `messageId` response into the existing API contract.
- Stored `BREVO_API_KEY` in Google Secret Manager, updated the receiver and
  sender secret versions, and removed the inactive Resend binding from the
  Cloud Run service.
- Updated production deployment wiring, environment examples, and support-email
  documentation from Resend to Brevo.
- Verification passed with 109 backend tests and seven face-tracking tests.
  Backend-only Cloud Build `1feb1d50-8243-4175-9c36-26cfaad73a6a` succeeded.
- Deployed Cloud Run revision `easyedits-api-00029-7k7` with 100 percent traffic.
  The live health check passed, and Brevo accepted and delivered one labeled
  test from `support@podtoclips.com` to the fixed support inbox.
- Brevo's domain-management API is currently unavailable for this free account,
  so the accidental second domain entry was left untouched. The production
  integration uses only authenticated and branded `podtoclips.com`.

## Update: Public Legal Center and OpusClip Comparison Navigation

- Added a production-styled public legal center at `/legal` with dedicated
  Terms of Service, Privacy Policy, Refund and Cancellation Policy, Acceptable
  Use Policy, and Cookie Notice pages.
- Tailored the policies to the actual PodToClips workflow, including AI and
  media processing, account isolation, clip allowances, source-duration limits,
  Dodo Payments as merchant of record, Brevo support delivery, subscription
  cancellation, and user content rights.
- Added legal links to the landing, pricing, and authentication surfaces and
  included every public legal route in prerendering, canonical metadata, and
  the production sitemap.
- Added a `vs OpusClip` landing-page navigation item that jumps directly to the
  existing PodToClips comparison section.
- Corrected all landing and pricing references to the official `OpusClip`
  spelling and added a comparison-date and trademark clarification.
- Verification passed with 31 UI tests, a production frontend build, and 40 SEO
  checks. Live in-app browser visual inspection was unavailable because no
  browser was attached to this Codex session; route and content behavior was
  covered by component and prerender tests.

## Update: Final-Sale Policy and Legal Layout Refinement

- Rewrote the Refund and Cancellation Policy around a clear all-sales-final
  default. Subscription charges are non-refundable and non-creditable for
  unused time, unused clip allowances, change of mind, accidental purchase,
  missed cancellation, output dissatisfaction, or third-party source issues.
- Limited refund consideration to mandatory consumer rights and narrow
  payment exceptions controlled by Dodo Payments, such as duplicate,
  incorrect, unauthorized, post-cancellation, or verified non-delivery cases.
- Added the same final-sale rule to the Terms of Service so billing language is
  consistent across both documents. Cancellation prevents the next renewal but
  does not refund the active billing period.
- Replaced the legal-center headline with the direct `Legal terms and policies.`
  wording and separated the legal-document back link from the policy label to
  eliminate their overlap.
- Converted marketing footers to a three-column grid at desktop widths so the
  Terms, Privacy, and Refunds links remain centered relative to the page. Mobile
  footers retain the existing readable stacked layout.
- Verification passed with 109 backend tests, seven face-tracking tests, 31 UI
  tests, 41 SEO checks, and the production frontend build. Live browser visual
  inspection remained unavailable because no browser was attached to this CLI
  session.

## Update: Rollback-Safe Clerk Production Staging

- Validated the staged Clerk Production backend credential directly against
  Clerk without printing or persisting the secret value. Clerk returned `200`.
- Created `CLERK_PRODUCTION_AUTHORIZED_PARTIES` with the HTTPS origins
  `podtoclips.com` and `www.podtoclips.com`.
- Created Cloud Run revision `easyedits-api-clerkprod1` from the currently proven
  API image and bound it to the three isolated Clerk Production secrets.
- Tagged the revision as `clerk-production` with zero public traffic. Its health
  endpoint returned `200`, an unauthenticated protected request returned `401`,
  and no error-level revision logs were present.
- Left revision `easyedits-api-00029-7k7` on 100 percent traffic with Clerk
  Development so the current localhost application remains usable until the
  frontend is deployed.
- Updated the Cloud Run deployment script to select Clerk secret names through
  explicit environment variables. Future deployments can reproduce the live
  binding without copying credentials or overwriting Development secrets.
- Documented the cutover order and rollback boundary. The final traffic switch,
  Google login, email signup, logout, and two-account isolation smoke tests wait
  for the HTTPS frontend at `podtoclips.com`.
- Verification: deployment script syntax and three focused authentication tests
  passed. No podcast, render, payment, support email, or public traffic change
  occurred.

## Update: Production Content Reset and Clean Deployment Repository

- Confirmed no Cloud Run render execution was active before cleanup.
- Permanently deleted 1,096 objects totaling 15,968,798,290 bytes from the
  dedicated Cloudflare R2 bucket. This removed source media, rendered clips,
  render job specifications, editor uploads, editor exports, and 66 orphaned or
  legacy objects.
- Deleted all 93 project rows from Neon. Cascading ownership constraints removed
  494 clips, six social posts, and four clip-quota reservation rows. The editor
  asset ledger is also empty.
- Verified the post-reset state contains zero R2 objects and zero episodes,
  clips, social posts, user assets, or clip-quota reservations.
- Preserved four account entitlement records, 30 verified billing webhook
  records, and three billing plan-change records. The reset did not alter Clerk
  users, subscriptions, plan state, or lifetime and monthly quota accounting.
- Added a reusable inventory-first production cleanup script. Permanent deletion
  requires the explicit `--execute-permanent-reset` flag and verifies both R2
  and Neon are empty before reporting success.
- Added Vercel deployment configuration for the Vite frontend and protected SPA
  routes while retaining the prerendered public marketing and legal pages.
- Prepared a new-history deployment snapshot that excludes environment files,
  credentials, generated media, local databases, caches, browser artifacts,
  model environments, and build output. Gitleaks 8.30.1 scanned the complete
  publish set and reported zero secrets.
- Published the clean snapshot as the first `main` commit in the private
  `APPNINJAS123/podtoclips` GitHub repository. A second commit-history scan and
  a remote tree audit found zero secrets, forbidden environment files, private
  keys, or generated video files.
- Connected the GitHub repository to the Vercel project `podtoclips`, persisted
  only public Vite build variables, and completed the first production build at
  `podtoclips.vercel.app`.
- Verified the landing, pricing, login, and projects routes return `200`. The
  staged Clerk Production API health endpoint returns `200`, while a protected
  unauthenticated API request correctly returns `401`.
- Attached `podtoclips.com` and `www.podtoclips.com` to the Vercel project.
  Custom-domain activation is waiting only for the required Wix DNS record
  changes and subsequent Vercel verification.
- Replaced the Wix website-routing records with Vercel's two apex A records and
  the project-specific `www` CNAME. Vercel verified both domains as configured
  correctly, and HTTPS requests to the landing, pricing, login, and projects
  routes returned `200` with valid certificates.
- Switched `easyedits-api` production traffic from the Clerk Development
  revision to the staged `easyedits-api-clerkprod1` revision at 100 percent.
  The stable API health endpoint returned `200`, protected unauthenticated data
  returned `401`, the production-origin preflight returned `204`, and no
  unexpected error-level logs followed the cutover.
- Updated Vercel's public `VITE_API_BASE_URL` configuration from the temporary
  revision tag to the stable Cloud Run service URL so future backend revisions
  can be released without rebuilding the frontend around a revision-specific
  hostname.

## Update: Resilient Production Google Authentication

- Confirmed the production Google OAuth credentials and redirect path work by
  completing a real Google signup and verifying the resulting Clerk user uses
  the `oauth_google` provider.
- Replaced the separate Google login and signup operations with one Clerk
  sign-in-or-sign-up flow. Both entry pages now reset abandoned sign-in and
  sign-up attempts before starting OAuth, preventing a failed or stale attempt
  from poisoning the next retry.
- Added handling for returned Clerk errors, thrown exceptions, and an explicit
  15-second timeout. The Google button always recovers instead of displaying an
  endless loading spinner when navigation does not begin.
- Added regression coverage for login, signup, stale-attempt resets, returned
  errors, thrown errors, and timeout recovery. Six focused authentication tests,
  all 36 UI tests, and the production frontend build pass.
