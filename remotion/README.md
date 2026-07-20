# Remotion UI-Flow Animation Scaffold

This folder maps the v3 architecture's "Scene Script JSON → deterministic animation" system.

Current state:

- `sceneScriptSchema.ts` defines the input contract from UI-flow extraction.
- `UiFlowComponents.tsx` contains the fixed component vocabulary:
  - `CursorClick`
  - `TypingCaret`
  - `SwipeGesture`
  - `ToastSlideIn`
  - `SpotlightBox`
  - `LoadingSpinner`
  - `ErrorShake`
- `UiFlowStoryboard.tsx` maps active scene-script steps to the component library.

Production next step:

Wrap `UiFlowStoryboard` in a real Remotion composition, pass `sceneScript` via `inputProps`, and deploy rendering through Remotion Lambda. Keep the quality gate in the backend: only render when `sceneScript.confidence >= 0.78`.

