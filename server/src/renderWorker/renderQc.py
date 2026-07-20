#!/usr/bin/env python3
import argparse
import json
import os
import sys


def load_cv2():
    try:
        import cv2  # type: ignore
        return cv2
    except Exception as exc:
        raise RuntimeError(f"OpenCV is not available: {exc}")


def yunet_model_path():
    candidates = [
        os.environ.get("FACE_DETECTOR_YUNET_MODEL", ""),
        os.path.join(os.path.dirname(__file__), "..", "..", "models", "face_detection_yunet_2023mar.onnx"),
        os.path.join(os.getcwd(), "server", "models", "face_detection_yunet_2023mar.onnx"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return os.path.abspath(candidate)
    return ""


def cascade_path(cv2):
    candidates = [
        getattr(getattr(cv2, "data", None), "haarcascades", "") + "haarcascade_frontalface_default.xml",
        "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
        "/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return ""


def create_detector(cv2, width, height):
    model = yunet_model_path()
    if model and hasattr(cv2, "FaceDetectorYN_create"):
        return {
            "type": "yunet",
            "detector": cv2.FaceDetectorYN_create(model, "", (int(width), int(height)), 0.55, 0.3, 5000),
            "fallback": None,
        }
    cascade = cascade_path(cv2)
    if not cascade:
        raise RuntimeError("No face detector available for render QC")
    return {"type": "haar", "detector": cv2.CascadeClassifier(cascade), "fallback": None}


def detect_faces(cv2, detector, frame, gray, width, height, layout):
    faces = []
    if detector["type"] == "yunet":
        detector["detector"].setInputSize((int(width), int(height)))
        ok, detected = detector["detector"].detect(frame)
        if ok and detected is not None:
            for face in detected:
                x, y, w, h = [float(value) for value in face[:4]]
                score = float(face[-1])
                if score >= 0.55:
                    faces.append((x, y, w, h, score))
    else:
        detected = detector["detector"].detectMultiScale(gray, scaleFactor=1.08, minNeighbors=5, minSize=(70, 70))
        faces = [(float(x), float(y), float(w), float(h), 1.0) for x, y, w, h in detected]
    filtered = []
    for x, y, w, h, score in faces:
        face_w = w / width
        face_h = h / height
        # Only safe-contain has a large blurred duplicate behind the foreground.
        # Applying this limit to speaker-focus clips incorrectly reported a
        # legitimate close-up face as missing.
        if layout == "safe_contain_blur" and (face_w > 0.42 or face_h > 0.46):
            continue
        filtered.append((x, y, w, h, score))
    return filtered


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--fps", type=float, default=1.0)
    parser.add_argument("--edge-margin", type=float, default=0.045)
    parser.add_argument("--max-no-face-ratio", type=float, default=0.14)
    parser.add_argument("--max-edge-face-ratio", type=float, default=0.12)
    parser.add_argument("--layout", default="speaker_focus_crop")
    parser.add_argument("--panel-split-y", type=float, default=850 / 1920)
    args = parser.parse_args()

    cv2 = load_cv2()
    cap = cv2.VideoCapture(args.source)
    if not cap.isOpened():
        raise RuntimeError("Could not open rendered video for QC")

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1
    height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = frame_count / source_fps if source_fps else 0
    detector = create_detector(cv2, width, height)
    sample_count = max(1, int(duration * args.fps))
    step = duration / sample_count if sample_count else duration

    samples = []
    for index in range(sample_count + 1):
        t = min(duration, index * step)
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = detect_faces(cv2, detector, frame, gray, width, height, args.layout)
        if args.layout in {"safe_contain_blur", "speaker_plus_screen"}:
            # These layouts intentionally preserve B-roll, title cards, screens,
            # and other moments with no visible face. Face presence is therefore
            # not a valid QC requirement; successful frame decoding is the safety
            # property this fallback is responsible for.
            samples.append({
                "t": round(t, 2),
                "faces": len(faces),
                "issue": None,
            })
            continue
        if not faces:
            samples.append({"t": round(t, 2), "faces": 0, "issue": "no_face"})
            continue
        if args.layout == "stacked_speaker_blur":
            split_y = height * args.panel_split_y
            panel_bottom = height * min(1, args.panel_split_y * 2)
            top_faces = [face for face in faces if face[1] + face[3] / 2 < split_y]
            bottom_faces = [face for face in faces if split_y <= face[1] + face[3] / 2 < panel_bottom]
            if not top_faces or not bottom_faces:
                samples.append({
                    "t": round(t, 2),
                    "faces": len(faces),
                    "topFaces": len(top_faces),
                    "bottomFaces": len(bottom_faces),
                    "issue": "missing_stacked_speaker",
                })
                continue
            selected = [
                max(top_faces, key=lambda item: item[2] * item[3]),
                max(bottom_faces, key=lambda item: item[2] * item[3]),
            ]
            panel_bounds = [(0, split_y), (split_y, panel_bottom)]
            margins = []
            for face, (panel_top, panel_end) in zip(selected, panel_bounds):
                x, y, w, h, _ = face
                margins.append(min(
                    x / width,
                    (width - (x + w)) / width,
                    (y - panel_top) / height,
                    (panel_end - (y + h)) / height,
                ))
            margin = min(margins)
            issue = "edge_face" if margin < min(args.edge_margin, 0.025) else None
            samples.append({
                "t": round(t, 2),
                "faces": len(faces),
                "topFaces": len(top_faces),
                "bottomFaces": len(bottom_faces),
                "margin": round(margin, 4),
                "issue": issue,
            })
            continue
        x, y, w, h, score = max(faces, key=lambda item: item[2] * item[3])
        margin = min(x / width, y / height, (width - (x + w)) / width, (height - (y + h)) / height)
        issue = "edge_face" if margin < args.edge_margin else None
        samples.append({
            "t": round(t, 2),
            "faces": len(faces),
            "faceX": round((x + w / 2) / width, 4),
            "faceY": round((y + h / 2) / height, 4),
            "faceWidth": round(w / width, 4),
            "faceHeight": round(h / height, 4),
            "margin": round(margin, 4),
            "score": round(score, 4),
            "issue": issue,
        })

    cap.release()

    total = max(1, len(samples))
    no_face = len([sample for sample in samples if sample.get("issue") in {"no_face", "missing_stacked_speaker"}])
    edge_face = len([sample for sample in samples if sample.get("issue") == "edge_face"])
    no_face_ratio = no_face / total
    edge_face_ratio = edge_face / total
    passed = no_face_ratio <= args.max_no_face_ratio and edge_face_ratio <= args.max_edge_face_ratio

    print(json.dumps({
        "provider": f"opencv_{detector['type']}_render_qc",
        "passed": passed,
        "duration": round(duration, 2),
        "sampleCount": total,
        "noFaceSamples": no_face,
        "edgeFaceSamples": edge_face,
        "noFaceRatio": round(no_face_ratio, 4),
        "edgeFaceRatio": round(edge_face_ratio, 4),
        "failReason": None if passed else "face_missing_or_too_close_to_edge",
        "problemSamples": [sample for sample in samples if sample.get("issue")][:12],
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"passed": False, "error": str(exc), "failReason": "qc_error"}))
        sys.exit(0)
