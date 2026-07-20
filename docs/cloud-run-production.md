# Cloud Run Production Deployment

The production backend is a Cloud Run Service. Inngest calls its `/api/inngest`
endpoint and starts one durable pipeline. After Gemini finalizes clip boundaries,
Inngest emits one render event per clip. Each event starts an independent
execution of the same Cloud Run render Job, so up to eight clips run in parallel.

The render worker uses a signed R2 URL. FFmpeg and OpenCV seek only the selected
time range instead of downloading the entire podcast for every clip. Moment
selection still uses the complete transcript before any render work is split.

## Required secrets

Create these Google Secret Manager secrets before deployment:

```text
DATABASE_URL
CLOUDFLARE_R2_ENDPOINT
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
CLOUDFLARE_R2_BUCKET_NAME
ASSEMBLYAI_API_KEY
OPENROUTER_API_KEY
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
CLERK_AUTHORIZED_PARTIES
BREVO_API_KEY
SUPPORT_RECEIVER_EMAIL
SUPPORT_FROM_EMAIL
YOUTUBE_COOKIES
```

`YOUTUBE_COOKIES` contains a Netscape-format cookie file exported from a
dedicated browser profile. The API mounts it read-only at
`/secrets/youtube/cookies.txt`. Refresh the secret version when YouTube expires
the session; never commit the cookie file to the repository.

`CLERK_AUTHORIZED_PARTIES` contains the production frontend origin, such as
`https://app.example.com`. The deployed API sets `CLERK_AUTH_REQUIRED=1`, so it
fails closed if either authentication key is missing.

For a staged Clerk cutover, keep the live credentials in separate secrets and
select them at deployment time:

```bash
export CLERK_PUBLISHABLE_SECRET_NAME=CLERK_PRODUCTION_PUBLISHABLE_KEY
export CLERK_SECRET_SECRET_NAME=CLERK_PRODUCTION_SECRET_KEY
export CLERK_AUTHORIZED_PARTIES_SECRET_NAME=CLERK_PRODUCTION_AUTHORIZED_PARTIES
```

This keeps the previous Development revision intact for immediate rollback and
prevents a future deployment from silently rebinding the API to the wrong Clerk
instance.

`SUPPORT_RECEIVER_EMAIL` is the fixed team inbox shown on the Help & Support
page. `SUPPORT_FROM_EMAIL` must use a sending domain authenticated in Brevo. The
customer-entered sender is applied as `Reply-To`, so replies still go directly
to the customer without spoofing the email's technical sender.

## Deploy

```bash
export GOOGLE_CLOUD_PROJECT="your-project-id"
export CLOUD_RUN_LOCATION="asia-south1"
bash server/scripts/deploy-cloud-run.sh
```

The script builds two images, deploys the API Service and render Job, applies
the required IAM roles, verifies `/api/health`, and prints the production
Inngest URL.

## Inngest

Create or update the production Inngest app with:

```text
https://<cloud-run-service>/api/inngest
```

The `process-podcast-upload` run performs durable transcription, full-context
Gemini selection, parallel visual verification, and planning. It then fans out
`render-podcast-clip` runs. Cloud Run retries each render task twice; Inngest
persists and collects each independent result before marking delivery ready.

## Direct upload CORS

Large files upload directly from the browser to R2 because Cloud Run request
bodies cannot carry multi-gigabyte podcasts. Allow the frontend origin to send
`PUT` requests with the `Content-Type` header in the R2 bucket CORS policy.

## Resource tuning

The deployment defaults to 4 vCPU and 8 GiB per render. Benchmark 4 vCPU and
8 vCPU using real clips before increasing it. Parallelism changes wall-clock
latency, while billed resource-seconds remain close to sequential rendering.
