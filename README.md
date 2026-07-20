# Podcast Repurposing Engine

Upload a podcast file, or import a podcast/video link, and run it through the v3 repurposing architecture:

1. Ingest uploaded audio/video or download a supported video URL.
2. Transcribe and diarize.
3. Score transcript-only candidate moments.
4. Run selective visual verification on candidates.
5. Extract UI-flow scene scripts for narrated product flows.
6. Rank clips and create render plans.
7. Prepare FFmpeg/Remotion render work.
8. Generate social posts on demand.

The local app uses deterministic development adapters so the product flow runs without paid vendor credentials. Production integrations should replace the adapter modules under `server/src/adapters`.

## Run Locally

```bash
npm install
npm run dev
npm run server
```

Frontend defaults to `http://localhost:3000`.

Backend defaults to `http://localhost:3005`.

## Neon + Inngest Local

Create `server/.env` from `server/.env.example`, then run:

```bash
npm run db:migrate
npm run dev:all
```

Inngest Dev Server runs at `http://localhost:8288` and connects to `http://localhost:3005/api/inngest`.

Useful local endpoints:

```bash
POST /api/podcasts/upload
POST /api/podcasts/import-url
GET  /api/podcasts/:episodeId
GET  /api/podcasts/:episodeId/clips
POST /api/clips/:clipId/social-posts
POST /api/clips/:clipId/social-posts/request
GET  /api/clips/:clipId/social-posts
```

## Object Storage

Local dev uses `server/storage` by default. To switch uploads to Cloudflare R2, set:

```bash
OBJECT_STORAGE_PROVIDER=r2
CLOUDFLARE_R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
CLOUDFLARE_R2_ACCESS_KEY_ID="..."
CLOUDFLARE_R2_SECRET_ACCESS_KEY="..."
CLOUDFLARE_R2_BUCKET_NAME="..."
```

`CLOUDFLARE_R2_PUBLIC_URL` is optional. Without it, the API redirects `/api/assets/:key` to a signed R2 URL.

## Real AI Providers

AssemblyAI and OpenRouter are selected through env flags:

```bash
TRANSCRIPTION_PROVIDER=assemblyai
AI_PROVIDER=openrouter
SOCIAL_PROVIDER=openrouter
OPENROUTER_TEXT_MODEL="google/gemini-3-flash-preview"
OPENROUTER_STRUCTURED_MODEL="google/gemini-3-flash-preview"
OPENROUTER_VISION_MODEL="google/gemini-3-flash-preview"
```

All Gemini calls go through OpenRouter. The backend uses OpenRouter chat completions with JSON Schema structured outputs for moment scoring, UI-flow Scene Script extraction, and social copy.

Visual verification can be enabled with:

```bash
VISUAL_PROVIDER=openrouter
FFMPEG_PATH="ffmpeg"
```

That path extracts scene-change frames with FFmpeg and sends only those frames to Gemini through OpenRouter image inputs.

## Rendering

Cloud Run render-spec mode is enabled with:

```bash
RENDER_PROVIDER=cloud_run
CLOUD_RUN_RENDER_DISPATCH_URL=""
```

When the dispatch URL is blank, the backend stores render job specs in R2 under `render_jobs/...`. When a dispatcher URL is configured, the backend posts the same job payload there so a Cloud Run Job can run FFmpeg and upload the final MP4 back to R2.

The Cloud Run worker entrypoint is:

```bash
npm run render:job
```

Container build file: `render-worker.Dockerfile`.

## Video URL Imports

YouTube and other platform links use a `yt-dlp` binary on the backend:

```bash
YT_DLP_PATH="yt-dlp"
YT_DLP_FORMAT="best[ext=mp4]/bestaudio[ext=m4a]/best"
YT_DLP_MAX_FILESIZE="2G"
```

The URL import endpoint downloads the source once, stores it in R2, then emits the same `podcast.uploaded` event as file uploads. In production this importer should run in a Cloud Run/Inngest step because long videos can exceed ordinary HTTP request timeouts.

## Important Docs

- `docs/build-plan.md`
- `docs/architecture-v3.md`
- `docs/cloud-run-render-worker.md`
- `remotion/README.md`
