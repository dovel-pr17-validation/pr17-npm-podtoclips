# Build Plan: Podcast Repurposing Engine v3

This migration follows `Podcast-Repurposing-Master-Architecture-v3.md` from Downloads.

## Target

Move from a manual podcast clipper to an event-driven podcast repurposing engine:

1. Upload podcast audio/video.
2. Store raw media in object storage.
3. Transcribe and diarize.
4. Score transcript-only moments with an LLM.
5. Selectively verify visuals only for candidate windows.
6. Extract UI-flow scene scripts for narrated product flows.
7. Rank clips and build render plans.
8. Render podcast footage, captions, b-roll, and optional Remotion UI-flow animations.
9. Review clips and generate LinkedIn/X/thread posts on click.

## Implementation Slices

1. **Local architecture scaffold**
   - Keep local filesystem storage and JSON catalog for dev.
   - Shape modules around future Cloudflare R2, Postgres, Inngest, Cloud Run Jobs, and Remotion Lambda.

2. **Pipeline backend**
   - Add upload endpoint.
   - Add episode and clip read APIs.
   - Add local orchestrator with the same step order as Inngest.
   - Add adapter interfaces for STT, scoring, vision, UI-flow extraction, rendering, animation, and social posts.

3. **Frontend**
   - Replace manual clipper UI with upload, processing timeline, candidate clips, UI-flow badges, and social post generation.

4. **Remotion scaffold**
   - Add scene-script schema and reusable animation component plan.
   - Keep actual Lambda deployment behind an adapter boundary.

5. **Verification**
   - Run dependency install.
   - Run frontend build.
   - Start backend and smoke test health/API endpoints.

## Neon + Inngest Local Setup

1. Create a Neon project and copy the Node.js connection string from the Neon console.
2. Put it in `server/.env`:

   ```bash
   DATABASE_URL="postgresql://..."
   INNGEST_DEV=1
   USE_INNGEST=1
   INNGEST_EVENT_KEY="local-dev"
   INNGEST_SIGNING_KEY="local-dev"
   ```

3. Run the migration:

   ```bash
   npm run db:migrate
   ```

4. Start the app and Inngest dev server:

   ```bash
   npm run dev:all
   ```

5. Open Inngest Dev Server at `http://localhost:8288`.

## Adapter Policy

Local dev adapters return deterministic, cheap placeholder outputs so the product flow can be developed without paid vendor keys. Production adapters should replace these modules without changing routes or frontend contracts.
