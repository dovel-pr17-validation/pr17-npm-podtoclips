# Reversible render and ingest upgrades

The upgraded pipeline is enabled with `EASYED_UPGRADES_ENABLED=1`.

It enables:

- Remotion `@remotion/captions` pagination with responsive two-line, word-highlighted caption rendering.
- Full-source graphic/text/animation scenes fitted on a blurred 9:16 background while speaker scenes keep face tracking.
- Immediate URL submission followed by an Inngest background download.
- Reuse of an already stored source URL.
- yt-dlp 1080p-capped format selection and concurrent fragment downloads.
- Context-safe transcript boundary refinement for complete clip beginnings and endings.

## One-switch rollback

Set this in `server/.env` and restart the backend and Inngest:

```dotenv
EASYED_UPGRADES_ENABLED=0
```

That restores the previous architecture:

- legacy three-word ASS captions;
- the previous graphic-fit behavior;
- blocking `/podcasts/import-url` downloads;
- the previous `YT_DLP_FORMAT` and download arguments.
- fixed transcript-window boundaries without semantic completion.

Individual upgrades can also be disabled while leaving the others enabled:

```dotenv
REMOTION_CAPTIONS_ENABLED=0
CONTEXT_BOUNDARY_REFINEMENT_ENABLED=0
SOURCE_VISUAL_FIT_V2_ENABLED=0
ASYNC_URL_INGEST_ENABLED=0
URL_IMPORT_CACHE_ENABLED=0
YT_DLP_FAST_MODE_ENABLED=0
```

The advanced audio-first and time-range-only download architecture is intentionally not implemented.
