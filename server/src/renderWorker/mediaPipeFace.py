#!/usr/bin/env python3
"""Optional MediaPipe landmark refinement for the existing YuNet face tracker."""

import math
import os
import tempfile


def clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(maximum, value))


def distance(a, b):
    return math.hypot(a.x - b.x, a.y - b.y)


def model_path():
    candidates = [
        os.environ.get("MEDIAPIPE_FACE_LANDMARKER_MODEL", ""),
        os.path.join(os.path.dirname(__file__), "..", "..", "models", "face_landmarker.task"),
        os.path.join(os.getcwd(), "server", "models", "face_landmarker.task"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return os.path.abspath(candidate)
    return ""


def bbox_from_landmarks(landmarks):
    xs = [point.x for point in landmarks]
    ys = [point.y for point in landmarks]
    left, right = clamp(min(xs)), clamp(max(xs))
    top, bottom = clamp(min(ys)), clamp(max(ys))
    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "x": (left + right) / 2,
        "y": (top + bottom) / 2,
        "width": max(0.001, right - left),
        "height": max(0.001, bottom - top),
    }


def overlap(a, b):
    a_left = a.get("faceX", a["x"]) - a.get("faceWidth", a["width"]) / 2
    a_top = a.get("faceY", a["y"]) - a.get("faceHeight", a["height"]) / 2
    a_right = a_left + a.get("faceWidth", a["width"])
    a_bottom = a_top + a.get("faceHeight", a["height"])
    left = max(a_left, b["left"])
    top = max(a_top, b["top"])
    right = min(a_right, b["right"])
    bottom = min(a_bottom, b["bottom"])
    intersection = max(0, right - left) * max(0, bottom - top)
    union = (
        max(0, a_right - a_left) * max(0, a_bottom - a_top)
        + b["width"] * b["height"]
        - intersection
    )
    return intersection / max(0.000001, union)


def blendshape_score(categories, name):
    for category in categories or []:
        category_name = getattr(category, "category_name", None) or getattr(category, "display_name", None)
        if category_name == name:
            return float(category.score)
    return 0.0


class MediaPipeFaceRefiner:
    def __init__(self):
        self.enabled = os.environ.get("MEDIAPIPE_FACE_REFINEMENT", "0") == "1"
        self.available = False
        self.error = None
        self.refined_detections = 0
        self.recovered_detections = 0
        self.landmark_faces = 0
        self._last_timestamp_ms = -1
        self._landmarker = None
        self._mp = None

        if not self.enabled:
            return

        task_model = model_path()
        if not task_model:
            self.error = "face_landmarker.task was not found"
            return

        try:
            # MediaPipe imports matplotlib even for vision tasks. Keep its cache in
            # a writable temporary directory in local workers and containers.
            os.environ.setdefault("MPLCONFIGDIR", os.path.join(tempfile.gettempdir(), "easyedits-matplotlib"))
            import mediapipe as mp  # type: ignore

            options = mp.tasks.vision.FaceLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(
                    model_asset_path=task_model,
                    delegate=mp.tasks.BaseOptions.Delegate.CPU,
                ),
                running_mode=mp.tasks.vision.RunningMode.VIDEO,
                num_faces=int(os.environ.get("MEDIAPIPE_FACE_MAX_FACES", "6")),
                min_face_detection_confidence=float(os.environ.get("MEDIAPIPE_FACE_DETECTION_CONFIDENCE", "0.5")),
                min_face_presence_confidence=float(os.environ.get("MEDIAPIPE_FACE_PRESENCE_CONFIDENCE", "0.5")),
                min_tracking_confidence=float(os.environ.get("MEDIAPIPE_FACE_TRACKING_CONFIDENCE", "0.5")),
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=False,
            )
            self._landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
            self._mp = mp
            self.available = True
        except Exception as exc:
            self.error = str(exc)

    def close(self):
        if self._landmarker is not None:
            self._landmarker.close()

    def status(self):
        return {
            "enabled": self.enabled,
            "available": self.available,
            "provider": "mediapipe_face_landmarker" if self.available else None,
            "refinedDetections": self.refined_detections,
            "recoveredDetections": self.recovered_detections,
            "landmarkFaces": self.landmark_faces,
            "error": self.error,
        }

    def _features(self, landmarks, categories):
        bounds = bbox_from_landmarks(landmarks)
        inter_eye = max(0.001, distance(landmarks[33], landmarks[263]))
        lip_gap = distance(landmarks[13], landmarks[14])
        mouth_open = clamp((lip_gap / inter_eye) / 0.18)

        left_eye_x = landmarks[33].x
        right_eye_x = landmarks[263].x
        eye_span_x = max(0.001, abs(right_eye_x - left_eye_x))
        eye_left = min(left_eye_x, right_eye_x)
        nose_position = (landmarks[1].x - eye_left) / eye_span_x
        frontal_score = clamp(1 - abs(nose_position - 0.5) * 1.55)

        return {
            "bounds": bounds,
            "mediaPipeMouthOpen": round(mouth_open, 4),
            "mediaPipeJawOpen": round(clamp(blendshape_score(categories, "jawOpen")), 4),
            "mediaPipeFrontalScore": round(frontal_score, 4),
            "mediaPipeLandmarkCount": len(landmarks),
        }

    def refine(self, frame_bgr, timestamp_ms, detections):
        if not self.available:
            return detections

        timestamp_ms = max(self._last_timestamp_ms + 1, int(timestamp_ms))
        self._last_timestamp_ms = timestamp_ms
        frame_rgb = frame_bgr[:, :, ::-1]
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=frame_rgb)
        try:
            result = self._landmarker.detect_for_video(image, timestamp_ms)
        except Exception as exc:
            # Landmark refinement must never take down the existing YuNet path.
            self.error = str(exc)
            self.available = False
            return detections
        blendshapes = result.face_blendshapes or []
        faces = [
            self._features(landmarks, blendshapes[index] if index < len(blendshapes) else [])
            for index, landmarks in enumerate(result.face_landmarks or [])
        ]
        self.landmark_faces += len(faces)

        unused = set(range(len(faces)))
        for detection in detections:
            detection["mediaPipeAttempted"] = True
            candidates = []
            for index in unused:
                bounds = faces[index]["bounds"]
                center_distance = math.hypot(
                    detection.get("faceX", detection["x"]) - bounds["x"],
                    detection.get("faceY", detection["y"]) - bounds["y"],
                )
                iou = overlap(detection, bounds)
                max_distance = max(0.07, detection.get("faceWidth", 0.08) * 1.15)
                if iou >= 0.05 or center_distance <= max_distance:
                    candidates.append((iou * 2 - center_distance, index))
            if not candidates:
                detection["mediaPipeValidated"] = False
                continue

            _, best_index = max(candidates)
            unused.remove(best_index)
            features = faces[best_index]
            detection.update({key: value for key, value in features.items() if key != "bounds"})
            detection["mediaPipeValidated"] = True
            detection["landmarkProvider"] = "mediapipe_face_landmarker"
            self.refined_detections += 1

        if os.environ.get("MEDIAPIPE_FACE_RECOVERY", "1") == "1":
            for index in unused:
                features = faces[index]
                bounds = features["bounds"]
                # Preserve the same headroom/body framing proportions used by
                # face_to_region() in the YuNet path.
                left = clamp(bounds["left"] - bounds["width"] * 0.65)
                top = clamp(bounds["top"] - bounds["height"] * 0.8)
                right = clamp(bounds["right"] + bounds["width"] * 0.65)
                bottom = clamp(bounds["bottom"] + bounds["height"] * 1.15)
                region_width = max(0.08, right - left)
                region_height = max(0.12, bottom - top)
                detections.append({
                    "x": round(clamp(left + region_width / 2, 0.18, 0.82), 4),
                    "y": round(clamp(top + region_height / 2, 0.16, 0.86), 4),
                    "width": round(region_width, 4),
                    "height": round(region_height, 4),
                    "faceX": round(bounds["x"], 4),
                    "faceY": round(bounds["y"], 4),
                    "faceWidth": round(bounds["width"], 4),
                    "faceHeight": round(bounds["height"], 4),
                    "mouthMotion": 0,
                    "detectorConfidence": 0.82,
                    "detectorProvider": "mediapipe_face_landmarker_recovery",
                    "landmarkProvider": "mediapipe_face_landmarker",
                    "mediaPipeAttempted": True,
                    "mediaPipeValidated": True,
                    **{key: value for key, value in features.items() if key != "bounds"},
                })
                self.recovered_detections += 1

        return detections
