#!/usr/bin/env bash
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT to the target GCP project ID.}"

REGION="${CLOUD_RUN_LOCATION:-asia-south1}"
REPOSITORY="${CLOUD_RUN_ARTIFACT_REPOSITORY:-easyedits}"
API_SERVICE="${CLOUD_RUN_API_SERVICE:-easyedits-api}"
RENDER_JOB="${CLOUD_RUN_RENDER_JOB:-easyedits-render-worker}"
API_SERVICE_ACCOUNT="${CLOUD_RUN_API_SERVICE_ACCOUNT:-easyedits-api}"
RENDER_SERVICE_ACCOUNT="${CLOUD_RUN_RENDER_SERVICE_ACCOUNT:-easyedits-render}"
RENDER_RUNNER_ROLE_ID="${CLOUD_RUN_RENDER_RUNNER_ROLE_ID:-easyEditsRenderJobRunner}"
RUN_OPERATION_READER_ROLE_ID="${CLOUD_RUN_OPERATION_READER_ROLE_ID:-easyEditsRunOperationReader}"
RENDER_CPU="${CLOUD_RUN_RENDER_CPU:-4}"
RENDER_MEMORY="${CLOUD_RUN_RENDER_MEMORY:-8Gi}"
IMAGE_ROOT="${REGION}-docker.pkg.dev/${GOOGLE_CLOUD_PROJECT}/${REPOSITORY}"
API_IMAGE="${IMAGE_ROOT}/api:latest"
RENDER_IMAGE="${IMAGE_ROOT}/render-worker:latest"
DODO_PAYMENTS_ENABLED="${DODO_PAYMENTS_ENABLED:-0}"
DODO_PAYMENTS_ENVIRONMENT="${DODO_PAYMENTS_ENVIRONMENT:-test_mode}"
DODO_CREATOR_PRODUCT_ID="${DODO_CREATOR_PRODUCT_ID:-pdt_0NjR9KTtKDFYdunZ1jIvW}"
DODO_GROWTH_PRODUCT_ID="${DODO_GROWTH_PRODUCT_ID:-pdt_0NjRy6Tey69ZfhjeJVYkZ}"
DODO_STUDIO_PRODUCT_ID="${DODO_STUDIO_PRODUCT_ID:-pdt_0NjS2tzl9qu9otZ9TGulf}"
DODO_PUBLIC_APP_URL="${DODO_PUBLIC_APP_URL:-}"
CLERK_PUBLISHABLE_SECRET_NAME="${CLERK_PUBLISHABLE_SECRET_NAME:-CLERK_PUBLISHABLE_KEY}"
CLERK_SECRET_SECRET_NAME="${CLERK_SECRET_SECRET_NAME:-CLERK_SECRET_KEY}"
CLERK_AUTHORIZED_PARTIES_SECRET_NAME="${CLERK_AUTHORIZED_PARTIES_SECRET_NAME:-CLERK_AUTHORIZED_PARTIES}"

gcloud config set project "${GOOGLE_CLOUD_PROJECT}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com

if ! gcloud artifacts repositories describe "${REPOSITORY}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" --repository-format docker --location "${REGION}"
fi

for account in "${API_SERVICE_ACCOUNT}" "${RENDER_SERVICE_ACCOUNT}"; do
  if ! gcloud iam service-accounts describe "${account}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${account}"
  fi
done

required_secrets=(
  DATABASE_URL
  CLOUDFLARE_R2_ENDPOINT
  CLOUDFLARE_R2_ACCESS_KEY_ID
  CLOUDFLARE_R2_SECRET_ACCESS_KEY
  CLOUDFLARE_R2_BUCKET_NAME
  ASSEMBLYAI_API_KEY
  OPENROUTER_API_KEY
  INNGEST_EVENT_KEY
  INNGEST_SIGNING_KEY
  "${CLERK_PUBLISHABLE_SECRET_NAME}"
  "${CLERK_SECRET_SECRET_NAME}"
  "${CLERK_AUTHORIZED_PARTIES_SECRET_NAME}"
  BREVO_API_KEY
  SUPPORT_RECEIVER_EMAIL
  SUPPORT_FROM_EMAIL
  YOUTUBE_COOKIES
)
if [[ "${DODO_PAYMENTS_ENABLED}" == "1" ]]; then
  : "${DODO_PUBLIC_APP_URL:?Set DODO_PUBLIC_APP_URL to the deployed frontend origin.}"
  required_secrets+=(DODO_PAYMENTS_API_KEY DODO_PAYMENTS_WEBHOOK_KEY)
fi
for secret in "${required_secrets[@]}"; do
  if ! gcloud secrets describe "${secret}" >/dev/null 2>&1; then
    echo "Missing Secret Manager secret: ${secret}" >&2
    exit 1
  fi
done

for account in "${API_SERVICE_ACCOUNT}" "${RENDER_SERVICE_ACCOUNT}"; do
  gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
    --member "serviceAccount:${account}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor >/dev/null
done

if gcloud iam roles describe "${RENDER_RUNNER_ROLE_ID}" --project "${GOOGLE_CLOUD_PROJECT}" >/dev/null 2>&1; then
  gcloud iam roles update "${RENDER_RUNNER_ROLE_ID}" \
    --project "${GOOGLE_CLOUD_PROJECT}" \
    --title "PodToClips Render Job Runner" \
    --description "Run the PodToClips render job with per-clip overrides." \
    --permissions "run.jobs.run,run.jobs.runWithOverrides" \
    --stage GA >/dev/null
else
  gcloud iam roles create "${RENDER_RUNNER_ROLE_ID}" \
    --project "${GOOGLE_CLOUD_PROJECT}" \
    --title "PodToClips Render Job Runner" \
    --description "Run the PodToClips render job with per-clip overrides." \
    --permissions "run.jobs.run,run.jobs.runWithOverrides" \
    --stage GA >/dev/null
fi

if gcloud iam roles describe "${RUN_OPERATION_READER_ROLE_ID}" --project "${GOOGLE_CLOUD_PROJECT}" >/dev/null 2>&1; then
  gcloud iam roles update "${RUN_OPERATION_READER_ROLE_ID}" \
    --project "${GOOGLE_CLOUD_PROJECT}" \
    --title "PodToClips Run Operation Reader" \
    --description "Read completion state for render operations started by PodToClips." \
    --permissions "run.operations.get" \
    --stage GA >/dev/null
else
  gcloud iam roles create "${RUN_OPERATION_READER_ROLE_ID}" \
    --project "${GOOGLE_CLOUD_PROJECT}" \
    --title "PodToClips Run Operation Reader" \
    --description "Read completion state for render operations started by PodToClips." \
    --permissions "run.operations.get" \
    --stage GA >/dev/null
fi

gcloud projects add-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
  --member "serviceAccount:${API_SERVICE_ACCOUNT}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --role "projects/${GOOGLE_CLOUD_PROJECT}/roles/${RUN_OPERATION_READER_ROLE_ID}" >/dev/null

gcloud builds submit --config cloudbuild.backend.yaml --substitutions "_IMAGE=${API_IMAGE}" .
gcloud builds submit --config cloudbuild.render-worker.yaml --substitutions "_IMAGE=${RENDER_IMAGE}" .

R2_SECRETS="CLOUDFLARE_R2_ENDPOINT=CLOUDFLARE_R2_ENDPOINT:latest,CLOUDFLARE_R2_ACCESS_KEY_ID=CLOUDFLARE_R2_ACCESS_KEY_ID:latest,CLOUDFLARE_R2_SECRET_ACCESS_KEY=CLOUDFLARE_R2_SECRET_ACCESS_KEY:latest,CLOUDFLARE_R2_BUCKET_NAME=CLOUDFLARE_R2_BUCKET_NAME:latest"
RENDER_PARITY_ENV_VARS="$(node server/scripts/render-parity-env.cjs)"

gcloud run jobs deploy "${RENDER_JOB}" \
  --image "${RENDER_IMAGE}" \
  --region "${REGION}" \
  --service-account "${RENDER_SERVICE_ACCOUNT}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --cpu "${RENDER_CPU}" \
  --memory "${RENDER_MEMORY}" \
  --task-timeout 20m \
  --max-retries 2 \
  --set-secrets "${R2_SECRETS}" \
  --set-env-vars "${RENDER_PARITY_ENV_VARS}"

gcloud run jobs add-iam-policy-binding "${RENDER_JOB}" \
  --region "${REGION}" \
  --member "serviceAccount:${API_SERVICE_ACCOUNT}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --role "projects/${GOOGLE_CLOUD_PROJECT}/roles/${RENDER_RUNNER_ROLE_ID}" >/dev/null

# Older deployments granted this service account project-wide Run Invoker.
# The job-scoped custom role above replaces that broader legacy permission.
gcloud projects remove-iam-policy-binding "${GOOGLE_CLOUD_PROJECT}" \
  --member "serviceAccount:${API_SERVICE_ACCOUNT}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --role roles/run.invoker \
  --quiet >/dev/null 2>&1 || true

DODO_API_SECRETS=""
DODO_API_ENV_VARS=""
if [[ "${DODO_PAYMENTS_ENABLED}" == "1" ]]; then
  DODO_API_SECRETS=",DODO_PAYMENTS_API_KEY=DODO_PAYMENTS_API_KEY:latest,DODO_PAYMENTS_WEBHOOK_KEY=DODO_PAYMENTS_WEBHOOK_KEY:latest"
  DODO_API_ENV_VARS=",DODO_PAYMENTS_ENVIRONMENT=${DODO_PAYMENTS_ENVIRONMENT},DODO_CREATOR_PRODUCT_ID=${DODO_CREATOR_PRODUCT_ID},DODO_GROWTH_PRODUCT_ID=${DODO_GROWTH_PRODUCT_ID},DODO_STUDIO_PRODUCT_ID=${DODO_STUDIO_PRODUCT_ID},PUBLIC_APP_URL=${DODO_PUBLIC_APP_URL},BILLING_REQUIRE_DATABASE=1"
fi

API_SECRETS="DATABASE_URL=DATABASE_URL:latest,${R2_SECRETS},ASSEMBLYAI_API_KEY=ASSEMBLYAI_API_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,INNGEST_EVENT_KEY=INNGEST_EVENT_KEY:latest,INNGEST_SIGNING_KEY=INNGEST_SIGNING_KEY:latest,CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_SECRET_NAME}:latest,CLERK_SECRET_KEY=${CLERK_SECRET_SECRET_NAME}:latest,CLERK_AUTHORIZED_PARTIES=${CLERK_AUTHORIZED_PARTIES_SECRET_NAME}:latest,BREVO_API_KEY=BREVO_API_KEY:latest,SUPPORT_RECEIVER_EMAIL=SUPPORT_RECEIVER_EMAIL:latest,SUPPORT_FROM_EMAIL=SUPPORT_FROM_EMAIL:latest,/secrets/youtube/cookies.txt=YOUTUBE_COOKIES:latest${DODO_API_SECRETS}"
gcloud run deploy "${API_SERVICE}" \
  --image "${API_IMAGE}" \
  --region "${REGION}" \
  --service-account "${API_SERVICE_ACCOUNT}@${GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 4Gi \
  --timeout 900 \
  --concurrency 8 \
  --min 0 \
  --max 10 \
  --set-secrets "${API_SECRETS}" \
  --set-env-vars "USE_INNGEST=1,CLERK_AUTH_REQUIRED=1,CLERK_TELEMETRY_DISABLED=1,OBJECT_STORAGE_PROVIDER=r2,TRANSCRIPTION_PROVIDER=assemblyai,AI_PROVIDER=openrouter,SOCIAL_PROVIDER=openrouter,VISUAL_PROVIDER=openrouter,RENDER_PROVIDER=cloud_run,AUTO_RENDER_LOCAL=0,GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT},CLOUD_RUN_LOCATION=${REGION},CLOUD_RUN_RENDER_JOB=${RENDER_JOB},RENDER_FAN_OUT_LIMIT=8,VISUAL_FAN_OUT_LIMIT=4,SCENE_SCRIPT_FAN_OUT_LIMIT=4,VISUAL_MAX_FRAMES=24,VISUAL_TEXT_COVERAGE_SECONDS=1.5,VISUAL_CLASSIFICATION_BATCH_SIZE=6,OPENROUTER_TEXT_MODEL=google/gemini-3-flash-preview,OPENROUTER_STRUCTURED_MODEL=google/gemini-3-flash-preview,OPENROUTER_VISION_MODEL=google/gemini-3-flash-preview,EASYED_UPGRADES_ENABLED=1,ASYNC_URL_INGEST_ENABLED=1,URL_IMPORT_CACHE_ENABLED=1,REMOTION_CAPTIONS_ENABLED=1,SOURCE_VISUAL_FIT_V2_ENABLED=1,YT_DLP_COOKIES_PATH=/secrets/youtube/cookies.txt,YT_DLP_JS_RUNTIME=node${DODO_API_ENV_VARS}"

SERVICE_URL="$(gcloud run services describe "${API_SERVICE}" --region "${REGION}" --format='value(status.url)')"
curl -fsS "${SERVICE_URL}/api/health"
echo
echo "Cloud Run API: ${SERVICE_URL}"
echo "Configure the Inngest production app URL as: ${SERVICE_URL}/api/inngest"
echo "Build the frontend with: VITE_API_BASE_URL=${SERVICE_URL}/api VITE_CLERK_PUBLISHABLE_KEY=<your-publishable-key> npm run build"
