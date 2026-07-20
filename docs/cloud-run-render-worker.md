# Cloud Run Render Worker

The render worker turns an R2 render job spec into a final vertical MP4.

## Inputs

Set one of these env vars on the Cloud Run Job:

```bash
RENDER_JOB_SPEC_KEY="render_jobs/<episodeId>/<candidateId>.json"
RENDER_JOB_SPEC_URL="https://signed-url-to-job-spec"
RENDER_JOB_SPEC_FILE="/path/to/local/job.json"
```

In production, prefer `RENDER_JOB_SPEC_KEY` so the worker reads the spec directly from R2.

## Required Env

```bash
CLOUDFLARE_R2_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
CLOUDFLARE_R2_ACCESS_KEY_ID="..."
CLOUDFLARE_R2_SECRET_ACCESS_KEY="..."
CLOUDFLARE_R2_BUCKET_NAME="easyedits"
FFMPEG_PATH="ffmpeg"
```

## Build

```bash
docker build -f render-worker.Dockerfile -t easyedits-render-worker .
```

## Runtime Behavior

1. Load the render job spec.
2. Download the source media from R2.
3. Write caption SRT from AssemblyAI word timestamps.
4. Run FFmpeg:
   - trim selected moment
   - scale/crop to 9:16
   - burn captions
   - encode MP4
5. Upload final MP4 to the output R2 key.

The current worker handles the FFmpeg podcast-footage path. Remotion animation rendering remains a separate worker path because Remotion Lambda is the recommended production renderer for UI-flow animation segments.
