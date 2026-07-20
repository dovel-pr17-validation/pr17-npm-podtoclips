# Production Reframing Architecture

Goal: production-grade vertical podcast clips at the lowest practical compute cost.

## Decision

Use a face-first hybrid reframing pipeline:

```text
selected clip
  -> sparse vision/face analysis
  -> multi-face CPU tracking
  -> diarization + mouth-motion active-speaker scoring
  -> layout decision
  -> smoothed 9:16 crop plan
  -> FFmpeg render
  -> QC/fallback
```

Do not run full-video vision. Do not use an always-on GPU. Do not run YOLO continuously for podcast faces.

## Why This Is Better

- Face detectors are cheaper and more relevant than general object detectors for podcasts.
- CPU face tracking gives smooth crop motion without GPU cost.
- Lower-face motion scoring gives a cheap active-speaker signal without running a heavy AV model.
- Diarization speaker-change timings tell the cropper when switching speakers is more likely.
- Gemini/OpenRouter vision stays selective: only candidate windows and uncertain visual cases.
- FFmpeg can render the final crop cheaply once the crop plan is correct.
- Remotion is useful later for captions, overlays, and UI-flow animation, but reframing quality comes from crop intelligence.

## Layout Rules

1. `speaker_focus_crop`
   - Use for true talking-head clips.
   - Track face and upper-body center over time.
   - Generate a full 9:16 crop with `x`, `y`, and zoom/crop-size semantics.

2. `stacked_speaker_blur`
   - Use as the first QC fallback when a destructive active-speaker crop fails.
   - Crop two distinct, co-visible stable face tracks from the source and stack them vertically.
   - Require the pair to remain co-visible through most of the clip; alternating single-camera edits and B-roll are not valid stacked inputs.
   - Render speaker one on top and speaker two on bottom for the whole clip.
   - Use a clean black canvas, not a blurred source background.
   - Preserve a bottom caption band so the fallback still looks like an intentional podcast clip.

3. `safe_contain_blur`
   - Use for screen demos, show-and-tell, and uncertain detections.
   - Preserve the full source frame.
   - Use blurred/dimmed vertical background.

4. `speaker_plus_screen`
   - Use only when speaker and shown content are separate regions.
   - Never duplicate the speaker if they already appear inside the source screen/demo frame.

## Current Local Implementation

- OpenCV CPU face tracking is installed in `server/.tools/opencv-venv`.
- `server/src/renderWorker/faceTrack.py` samples frames, detects multiple faces, assigns track IDs, and returns a switch-safe speaker crop track.
- The primary face detector is OpenCV YuNet CPU (`server/models/face_detection_yunet_2023mar.onnx`), with Haar only as a fallback when YuNet produces no usable faces.
- The render plan includes `activeSpeakerTimeline`, derived from word-level transcript diarization.
- Very short diarization speaker blips are filtered before crop switching, so the frame does not jump for false or tiny interjections.
- The tracker combines face area, lower-face motion, center bias, and diarization switch hints.
- The tracker maps diarized speaker labels to face track IDs by scoring mouth motion inside each speaker segment.
- Weak speaker-to-face assignments are not trusted blindly; on speaker changes the tracker can switch to the best non-current visible face instead of staying stuck on the old listener.
- Speaker changes are rendered as hard cuts, not pans, so the crop does not travel through background/object space.
- If the mapped face is first detected slightly after the diarization boundary, the nearest mapped point is inserted at the boundary to avoid visual lag.
- Raw detection points are compressed into locked speaker anchors, so the crop does not follow every tiny face-box movement.
- While the same speaker is active, the frame holds a median crop anchor instead of hovering around the face.
- Stable anchors use the detected face center for framing, while padded face/body bounds still control zoom.
- Low-confidence speaker-to-face assignments widen the crop instead of over-zooming onto a possibly wrong face.
- Edge speakers are biased inward and widened so the vertical crop does not cut off half the face.
- `DENSE_FACE_TRACKING=1` enables CPU face tracking in the render worker.
- FFmpeg uses the speaker track to crop a real 9:16 window around the face/upper body.
- The crop uses both `x` and `y`, not just horizontal pan.
- Large crop jumps are treated as camera cuts so FFmpeg does not slowly pan through empty/random middle space.
- Speaker-switch crop expressions are step cuts, not interpolated pans.
- Render expressions preserve switch/cut points and decimate non-critical tracking points to stay within FFmpeg expression limits.
- Dense tracking metadata now includes stable per-track face anchors, so the stacked fallback can use both people even when only one of them is active in the active-speaker crop path.
- Dense tracking metadata includes track co-visibility, and diarized speaker labels use a one-to-one face assignment so both stacked panels cannot select the same person.
- `server/src/renderWorker/renderQc.py` checks the rendered MP4 for missing faces and edge-cut faces.
- If a `speaker_focus_crop` render fails QC, the worker rerenders the same clip as `stacked_speaker_blur` when two stable speaker regions are available.
- If two valid speaker regions are not available, or the stacked output fails its layout-aware QC, the worker rerenders as `safe_contain_blur`.
- Final metadata stores `renderQc`, `qcFallbackApplied`, `qcFallback.fallbackMode`, and the final render plan.

## Latest Test Result

- Full R2-backed render verified at `renders/quality-tests/active-speaker-face-anchor-test-1783584539474.mp4`.
- Output is 1080x1920, 26.87 seconds, with audio.
- Direct tracker output on the same segment collapsed 98 raw active-speaker detections into 8 stabilized crop points.
- The tested source is a screen-share with an embedded face-cam. For that content type, `speaker_focus_crop` is not the final production layout; the renderer should choose `speaker_plus_screen` or `safe_contain_blur` so the shown screen and speaker remain visible together.
- Standard podcast test video: `https://www.youtube.com/watch?v=cpg78ouK54I&t=1746s`.
- Re-rendered all 7 clips from `episode_9187ed441d064b47` with YuNet + QC.
- Final result from the previous tested build: all 7 final outputs pass render QC with no missing-face samples. Unsafe edge crops were rerendered as `safe_contain_blur`.
- Current build changes the preferred QC fallback to `stacked_speaker_blur`; no API-credit test has been run for this update yet.

## Production Deployment

Run this inside the Cloud Run render worker:

```text
Cloud Run Job
  -> download source from R2
  -> run OpenCV YuNet CPU multi-face tracking when layout=speaker_focus_crop
  -> use transcript diarization timeline as switch hints
  -> render with FFmpeg
  -> run render QC
  -> rerender safe-contain fallback if face crop fails QC
  -> upload final MP4 to R2
```

The render image installs:

```text
ffmpeg
python3
python3-opencv
OpenCV YuNet ONNX model
node runtime
```

## Cost Profile

This remains low cost because:

- Cloud Run Jobs scale to zero.
- OpenCV face tracking is CPU-only.
- Tracking runs only on selected clips, not full episodes.
- Gemini vision is still selective and frame-gated.
- No always-on GPU is required.

Expected incremental cost for dense tracking is small compared with transcription and rendering.

## Remaining Work

- Improve fallback layout design so safe clips still feel premium.
- Strengthen layout classification so screen-share/show-and-tell moments are not forced into face-only crop.
- Add stronger audio-visual sync later if diarization + mouth motion is not enough.
- Add caption-aware QC: captions not covering faces or important screen content.
- Add word-level caption highlighting and collision-aware caption placement.
