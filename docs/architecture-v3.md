# Podcast Repurposing Engine v3 Architecture

## System Shape

```text
Upload or Video URL Import
  -> normalize source into R2
  -> object storage
  -> transcribe + diarize
  -> transcript-only moment scoring
  -> selective visual verification
  -> UI-flow scene-script extraction
  -> final ranking + clip assembly plans
  -> footage render on Cloud Run Jobs
  -> UI-flow animation render on Remotion Lambda
  -> final clip delivery
  -> social post generation on demand
```

## Local Repository Implementation

The repo is structured as a local-dev version of the production architecture:

```text
server/src
  adapters/       vendor boundaries and local mock implementations
  domain/         shared pipeline constants
  objectStorage/  local/R2 object storage selector
  pipeline/       orchestration and event names
  routes/         HTTP API
  storage/        Neon Postgres store with local fallback
  utils/          ids and helpers
remotion/src      scene-script schema and animation component scaffold
components/       React upload/review UI
```

## Production Mapping

| Local module | Production replacement |
| --- | --- |
| `objectStorage/index.cjs` + `localObjectStorage.cjs` | Cloudflare R2 through `r2ObjectStorage.cjs` |
| `videoUrlIngest.cjs` | yt-dlp in a Cloud Run/Inngest ingest step |
| `episodeStore.cjs` JSON catalog | Neon Postgres through `neonEpisodeStore.cjs` |
| `pipeline/orchestrator.cjs` | Inngest function graph exposed at `/api/inngest` |
| `ai/index.cjs` + `localAi.cjs` | Gemini through OpenRouter structured JSON via `openRouterAi.cjs` |
| `transcription/index.cjs` + `localTranscription.cjs` | AssemblyAI through `assemblyAiTranscription.cjs` |
| `visual/index.cjs` + `localVisual.cjs` | FFmpeg scene-change frames + OpenRouter Gemini image calls through `ffmpegOpenRouterVisual.cjs` |
| `rendering/index.cjs` + `cloudRunRenderer.cjs` | FFmpeg Cloud Run Jobs render specs and optional dispatch |
| `localAnimationRenderer.cjs` | Remotion Lambda |
| `localSocial.cjs` | Claude Haiku or Gemini Flash |

## Current Neon + Inngest Dev Setup

- Neon is selected when `DATABASE_URL` is present.
- Local JSON storage is used only as a fallback when `DATABASE_URL` is missing.
- Inngest is selected when `USE_INNGEST=1`.
- The local Inngest endpoint is `http://localhost:3005/api/inngest`.
- Run the Inngest Dev Server with `npm run inngest`.
- Local filesystem storage is selected by default.
- Cloudflare R2 is selected when `OBJECT_STORAGE_PROVIDER=r2` and the `CLOUDFLARE_R2_*` variables are present.
- If `CLOUDFLARE_R2_PUBLIC_URL` is not set, `/api/assets/:key` redirects to a signed R2 URL.
- AssemblyAI is selected when `TRANSCRIPTION_PROVIDER=assemblyai`.
- OpenRouter Gemini scoring is selected when `AI_PROVIDER=openrouter`.
- OpenRouter Gemini social copy is selected when `SOCIAL_PROVIDER=openrouter`.
- FFmpeg/OpenRouter visual verification is selected when `VISUAL_PROVIDER=openrouter`.
- Gemini model slugs are configured with `OPENROUTER_TEXT_MODEL` and `OPENROUTER_STRUCTURED_MODEL`.
- Gemini vision model slug is configured with `OPENROUTER_VISION_MODEL`.
- `VISUAL_PROVIDER=openrouter` requires FFmpeg on the host or `FFMPEG_PATH` pointing to the binary.
- Cloud Run render-spec mode is selected with `RENDER_PROVIDER=cloud_run`.
- If `CLOUD_RUN_RENDER_DISPATCH_URL` is empty, render job specs are stored in R2 under `render_jobs/...`.
- If `CLOUD_RUN_RENDER_DISPATCH_URL` is set, the renderer posts the job payload to that dispatcher so it can start a Cloud Run Job.
- The Cloud Run worker entrypoint is `npm run render:job` and is packaged with `render-worker.Dockerfile`.
- The render worker reads `RENDER_JOB_SPEC_KEY`, downloads source media from R2, burns captions with FFmpeg, and uploads the MP4 output to R2.
- Video URL import uses `YT_DLP_PATH`, downloads a single source asset, stores it in R2, then emits the same `podcast.uploaded` event.
- In production, long URL imports should run as an Inngest step or Cloud Run Job instead of holding an HTTP request open.

## API Flow

- `POST /api/podcasts/upload` stores the source file, creates an episode, and emits `podcast.uploaded` when Inngest is enabled.
- `POST /api/podcasts/import-url` downloads a supported URL with yt-dlp, stores the media in R2, creates an episode, and emits `podcast.uploaded`.
- `GET /api/podcasts/:episodeId` returns the persisted pipeline state.
- `GET /api/podcasts/:episodeId/clips` returns selected clips and render plans.
- Clip render payloads include source R2 key, output R2 key, caption track, visual metadata, and optional Remotion Scene Script.
- `POST /api/clips/:clipId/social-posts` generates posts immediately for the current UI.
- `POST /api/clips/:clipId/social-posts/request` emits `posts.requested` for the async Inngest path.
- `GET /api/clips/:clipId/social-posts` polls persisted social posts.

## Pipeline Stages

1. `uploaded`
2. `transcribing`
3. `scoring`
4. `visual_verification`
5. `ui_flow_extraction`
6. `ranking`
7. `rendering`
8. `ready`

Each stage is persisted on the episode record so the frontend can show progress while the eventual Inngest implementation runs asynchronously.

## Quality And Cost Rules

- Never run a full-video multimodal LLM pass for moment discovery.
- Score moments from transcript text first.
- Use visual/vision calls only on short candidate windows.
- Render Remotion animations from structured scene scripts, not generative video pixels.
- Skip UI-flow animation if confidence is below threshold.
- Default rendering to CPU; use GPU only for explicit exceptions.
