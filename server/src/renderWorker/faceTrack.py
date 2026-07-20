#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys

from mediaPipeFace import MediaPipeFaceRefiner


MIN_SPEAKER_SEGMENT_SECONDS = float(os.environ.get("DENSE_FACE_MIN_SPEAKER_SEGMENT_SECONDS", "0.65"))
SPEAKER_MERGE_GAP_SECONDS = float(os.environ.get("DENSE_FACE_SPEAKER_MERGE_GAP_SECONDS", "0.8"))
MAPPED_TRACK_MIN_CONFIDENCE = float(os.environ.get("DENSE_FACE_MAPPED_TRACK_MIN_CONFIDENCE", "0.35"))


def load_cv2():
    try:
        import cv2  # type: ignore
        return cv2
    except Exception as exc:
        raise RuntimeError(f"OpenCV is not available: {exc}")


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def area(region):
    return region["width"] * region["height"]


def center_distance(a, b):
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2)


def detection_distance(a, b):
    ax = a.get("faceX", a["x"])
    ay = a.get("faceY", a["y"])
    bx = b.get("faceX", b["x"])
    by = b.get("faceY", b["y"])
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def load_speaker_timeline(path):
    if not path:
        return []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        timeline = [
            {
                "speaker": str(item.get("speaker", "")),
                "start": float(item.get("start", 0)),
                "end": float(item.get("end", 0)),
            }
            for item in data
            if item.get("speaker") and float(item.get("end", 0)) > float(item.get("start", 0))
        ]
        return normalize_speaker_timeline(timeline)
    except Exception:
        return []


def normalize_speaker_timeline(timeline):
    if not timeline:
        return []

    ordered = sorted(timeline, key=lambda item: item["start"])
    merged = []
    for segment in ordered:
        segment = {**segment}
        last = merged[-1] if merged else None
        if last and last["speaker"] == segment["speaker"] and segment["start"] - last["end"] <= SPEAKER_MERGE_GAP_SECONDS:
            last["end"] = max(last["end"], segment["end"])
        else:
            merged.append(segment)

    filtered = []
    for index, segment in enumerate(merged):
        duration = segment["end"] - segment["start"]
        if duration >= MIN_SPEAKER_SEGMENT_SECONDS:
            filtered.append(segment)
            continue

        previous = filtered[-1] if filtered else None
        next_segment = merged[index + 1] if index + 1 < len(merged) else None
        if previous and next_segment and previous["speaker"] == next_segment["speaker"]:
            previous["end"] = next_segment["end"]
            merged[index + 1] = previous
        elif previous and segment["start"] - previous["end"] <= SPEAKER_MERGE_GAP_SECONDS:
            previous["end"] = max(previous["end"], segment["end"])
        elif next_segment and next_segment["start"] - segment["end"] <= SPEAKER_MERGE_GAP_SECONDS:
            next_segment["start"] = min(next_segment["start"], segment["start"])

    output = []
    for segment in filtered:
        if segment["end"] <= segment["start"]:
            continue
        last = output[-1] if output else None
        if last and last["speaker"] == segment["speaker"] and segment["start"] - last["end"] <= SPEAKER_MERGE_GAP_SECONDS:
            last["end"] = max(last["end"], segment["end"])
        else:
            output.append(segment)
    return output


def active_speaker_at(t, timeline, pre_roll=0.18):
    for index, segment in enumerate(timeline):
        start = segment["start"]
        if index > 0 and timeline[index - 1]["speaker"] != segment["speaker"]:
            start = max(0, start - pre_roll)
        if start <= t <= segment["end"]:
            return segment["speaker"]
    return None


def timeline_segment_at(t, timeline):
    for segment in timeline:
        if segment["start"] <= t <= segment["end"]:
            return segment
    return None


def speaker_switch_near(t, timeline, window=0.45):
    for index in range(1, len(timeline)):
        boundary = timeline[index]["start"]
        if abs(t - boundary) <= window and timeline[index - 1]["speaker"] != timeline[index]["speaker"]:
            return True
    return False


def cascade_path(cv2):
    candidates = [
        getattr(getattr(cv2, "data", None), "haarcascades", "") + "haarcascade_frontalface_default.xml",
        "/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
        "/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    raise RuntimeError("Could not locate haarcascade_frontalface_default.xml")


def optional_haar_detector(cv2):
    try:
        detector = cv2.CascadeClassifier(cascade_path(cv2))
        return None if detector.empty() else detector
    except Exception:
        return None


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


def create_face_detector(cv2, width, height):
    model = yunet_model_path()
    if model and hasattr(cv2, "FaceDetectorYN_create"):
        detector = cv2.FaceDetectorYN_create(
            model,
            "",
            (int(width), int(height)),
            float(os.environ.get("FACE_DETECTOR_YUNET_SCORE_THRESHOLD", "0.55")),
            float(os.environ.get("FACE_DETECTOR_YUNET_NMS_THRESHOLD", "0.3")),
            5000,
        )
        return {
            "type": "yunet",
            "detector": detector,
            "fallback": optional_haar_detector(cv2),
        }

    haar = optional_haar_detector(cv2)
    if haar is None:
        raise RuntimeError("YuNet model and Haar fallback are both unavailable")
    return {
        "type": "haar",
        "detector": haar,
        "fallback": None,
    }


def same_identity(a, b):
    return (
        a.get("trackId") == b.get("trackId")
        and a.get("activeTranscriptSpeaker") == b.get("activeTranscriptSpeaker")
    )


def smooth_points(points, switch_distance=0.18):
    if len(points) < 3:
        return points
    smoothed = []
    for index, point in enumerate(points):
        previous = points[index - 1] if index > 0 else None
        next_point = points[index + 1] if index < len(points) - 1 else None
        is_cut_boundary = (
            (previous and center_distance(previous, point) > switch_distance)
            or (next_point and center_distance(point, next_point) > switch_distance)
            or (previous and not same_identity(previous, point))
            or (next_point and not same_identity(point, next_point))
        )
        if is_cut_boundary:
            smoothed.append({**point, "source": "opencv_haar_cpu_multi"})
            continue
        window = points[max(0, index - 1):min(len(points), index + 2)]
        smoothed.append({
            "t": point["t"],
            "x": round(sum(item["x"] for item in window) / len(window), 4),
            "y": round(sum(item["y"] for item in window) / len(window), 4),
            "width": round(sum(item["width"] for item in window) / len(window), 4),
            "height": round(sum(item["height"] for item in window) / len(window), 4),
            "mouthMotion": round(sum(item.get("mouthMotion", 0) for item in window) / len(window), 4),
            "activeTranscriptSpeaker": point.get("activeTranscriptSpeaker"),
            "speakerSwitchNear": bool(point.get("speakerSwitchNear")),
            "source": "opencv_haar_cpu_multitrack_av",
            "trackId": point.get("trackId"),
        })
    return smoothed


def face_to_region(face, frame_width, frame_height):
    x, y, w, h = face
    pad_x = w * 0.65
    pad_top = h * 0.8
    pad_bottom = h * 1.15
    left = clamp((x - pad_x) / frame_width, 0, 1)
    top = clamp((y - pad_top) / frame_height, 0, 1)
    right = clamp((x + w + pad_x) / frame_width, 0, 1)
    bottom = clamp((y + h + pad_bottom) / frame_height, 0, 1)
    region_w = max(0.08, right - left)
    region_h = max(0.12, bottom - top)
    return {
        "x": round(clamp(left + region_w / 2, 0.18, 0.82), 4),
        "y": round(clamp(top + region_h / 2, 0.16, 0.86), 4),
        "width": round(region_w, 4),
        "height": round(region_h, 4),
    }


def lower_face_motion(cv2, gray, previous_gray, face):
    if previous_gray is None:
        return 0
    x, y, w, h = [int(value) for value in face]
    frame_h, frame_w = gray.shape[:2]
    left = clamp(x, 0, frame_w - 1)
    right = clamp(x + w, left + 1, frame_w)
    top = clamp(int(y + h * 0.48), 0, frame_h - 1)
    bottom = clamp(y + h, top + 1, frame_h)
    current = gray[top:bottom, left:right]
    previous = previous_gray[top:bottom, left:right]
    if current.size == 0 or previous.size == 0:
        return 0
    current = cv2.resize(current, (48, 28))
    previous = cv2.resize(previous, (48, 28))
    diff = cv2.absdiff(current, previous)
    return round(clamp(float(diff.mean()) / 35.0, 0, 1), 4)


def face_to_detection(cv2, face, frame_width, frame_height, gray, previous_gray, confidence=1.0, provider="haar"):
    x, y, w, h = face
    return {
        **face_to_region(face, frame_width, frame_height),
        "faceX": round(clamp((x + w / 2) / frame_width, 0, 1), 4),
        "faceY": round(clamp((y + h / 2) / frame_height, 0, 1), 4),
        "faceWidth": round(clamp(w / frame_width, 0, 1), 4),
        "faceHeight": round(clamp(h / frame_height, 0, 1), 4),
        "mouthMotion": lower_face_motion(cv2, gray, previous_gray, face),
        "detectorConfidence": round(clamp(float(confidence), 0, 1), 4),
        "detectorProvider": provider,
    }


def plausible_detection(detection):
    return (
        0.04 <= detection.get("faceWidth", 0) <= 0.45
        and 0.06 <= detection.get("faceHeight", 0) <= 0.65
        and 0.08 <= detection.get("faceY", 0) <= 0.78
    )


def detect_faces(cv2, detector, frame, gray, previous_gray, width, height):
    detections = []
    if detector["type"] == "yunet":
        detector["detector"].setInputSize((int(width), int(height)))
        ok, faces = detector["detector"].detect(frame)
        if ok and faces is not None:
            for face in faces:
                x, y, w, h = [float(value) for value in face[:4]]
                score = float(face[-1])
                detection = face_to_detection(
                    cv2,
                    (x, y, w, h),
                    width,
                    height,
                    gray,
                    previous_gray,
                    confidence=score,
                    provider="opencv_yunet_cpu",
                )
                if plausible_detection(detection):
                    detections.append(detection)

    if not detections and (detector["fallback"] is not None or detector["type"] == "haar"):
        cascade = detector["fallback"] if detector["type"] == "yunet" else detector["detector"]
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=1.08,
            minNeighbors=5,
            minSize=(48, 48),
        )
        detections = [
            face_to_detection(cv2, face, width, height, gray, previous_gray, provider="opencv_haar_cpu")
            for face in sorted(faces, key=lambda box: box[2] * box[3], reverse=True)[:6]
        ]
        detections = [detection for detection in detections if plausible_detection(detection)]

    detections.sort(key=lambda item: (item.get("detectorConfidence", 0), area(item)), reverse=True)
    return detections[:6]


def assign_tracks(samples, max_distance=0.2, max_gap=4):
    tracks = []
    next_id = 1

    for sample_index, sample in enumerate(samples):
        used = set()
        for detection in sorted(sample["detections"], key=area, reverse=True):
            best_track = None
            best_distance = None
            for track in tracks:
                if track["id"] in used:
                    continue
                last = track["points"][-1]
                gap = sample_index - track["lastSampleIndex"]
                if gap > max_gap:
                    continue
                distance = detection_distance(last, detection)
                if distance <= max_distance and (best_distance is None or distance < best_distance):
                    best_track = track
                    best_distance = distance

            point = {
                **detection,
                "t": sample["t"],
                "sampleIndex": sample_index,
                "source": "opencv_haar_cpu_multi",
            }

            if best_track:
                previous = best_track["points"][-1]
                if point.get("mediaPipeValidated") and previous.get("mediaPipeValidated"):
                    mouth_delta = abs(
                        point.get("mediaPipeMouthOpen", 0) - previous.get("mediaPipeMouthOpen", 0)
                    )
                    jaw_delta = abs(
                        point.get("mediaPipeJawOpen", 0) - previous.get("mediaPipeJawOpen", 0)
                    )
                    point["mediaPipeMouthMotion"] = round(clamp(mouth_delta * 2.4 + jaw_delta * 0.8, 0, 1), 4)
                point["trackId"] = best_track["id"]
                best_track["points"].append(point)
                best_track["lastSampleIndex"] = sample_index
                best_track["totalArea"] += area(point)
                best_track["totalMouthMotion"] += point.get("mouthMotion", 0)
                used.add(best_track["id"])
            else:
                point["trackId"] = next_id
                tracks.append({
                    "id": next_id,
                    "points": [point],
                    "lastSampleIndex": sample_index,
                    "totalArea": area(point),
                    "totalMouthMotion": point.get("mouthMotion", 0),
                })
                used.add(next_id)
                next_id += 1

    return tracks


def speaker_motion(point):
    pixel_motion = point.get("mouthMotion", 0)
    if not point.get("mediaPipeValidated"):
        return pixel_motion
    landmark_motion = point.get("mediaPipeMouthMotion", 0)
    jaw_open = point.get("mediaPipeJawOpen", 0)
    return clamp(pixel_motion * 0.25 + landmark_motion * 0.6 + jaw_open * 0.15, 0, 1)


def point_for_sample(track, sample_index):
    for point in track["points"]:
        if point["sampleIndex"] == sample_index:
            return point
    return None


def point_score(point):
    center_bias = 1 - min(1, center_distance(point, {"x": 0.5, "y": 0.48}) / 0.7)
    confidence = point.get("detectorConfidence", 0.65)
    return (
        area(point) * 3.2
        + speaker_motion(point) * 0.55
        + confidence * 0.8
        + center_bias * 0.14
        + (0.08 if point.get("mediaPipeValidated") else 0)
        + point.get("mediaPipeFrontalScore", 0) * 0.04
        - (0.85 if point.get("mediaPipeAttempted") and not point.get("mediaPipeValidated") else 0)
    )


def score_track_for_segment(track, segment):
    points = [
        point
        for point in track["points"]
        if segment["start"] <= point["t"] <= segment["end"]
    ]
    if not points:
        return 0
    motion = sum(speaker_motion(point) for point in points) / len(points)
    size = sum(area(point) for point in points) / len(points)
    coverage = len(points) / max(1, (segment["end"] - segment["start"]))
    return motion * 2.4 + size * 3.2 + min(1, coverage / 3.0) * 0.35


def build_speaker_track_map(tracks, speaker_timeline):
    speakers = []
    for segment in speaker_timeline:
        if segment["speaker"] not in speakers:
            speakers.append(segment["speaker"])

    scored_by_speaker = {}
    for speaker in speakers:
        speaker_segments = [segment for segment in speaker_timeline if segment["speaker"] == speaker]
        scored = []
        for track in tracks:
            score = sum(score_track_for_segment(track, segment) for segment in speaker_segments)
            if score > 0:
                scored.append((track["id"], score))
        scored.sort(key=lambda item: item[1], reverse=True)
        scored_by_speaker[speaker] = scored

    # Diarized speakers represent different people. Assigning every label
    # independently allowed Speaker A and Speaker B to resolve to the same face
    # track, which later duplicated that person in both stacked panels. Find the
    # highest-scoring one-to-one assignment instead.
    best_assignment = {}
    best_total = -1

    def search(index, used_track_ids, current, total):
        nonlocal best_assignment, best_total
        if index >= len(speakers):
            if total > best_total:
                best_total = total
                best_assignment = dict(current)
            return
        speaker = speakers[index]
        candidates = scored_by_speaker.get(speaker, [])[:6]
        search(index + 1, used_track_ids, current, total)
        for track_id, score in candidates:
            if track_id in used_track_ids:
                continue
            current[speaker] = (track_id, score)
            search(index + 1, used_track_ids | {track_id}, current, total + score)
            current.pop(speaker, None)

    search(0, set(), {}, 0)

    mapping = {}
    assignments = []
    for speaker in speakers:
        selected = best_assignment.get(speaker)
        scored = scored_by_speaker.get(speaker, [])
        if not selected:
            continue
        best_id, best_score = selected
        alternatives = [(track_id, score) for track_id, score in scored if track_id != best_id]
        second_score = alternatives[0][1] if alternatives else 0
        mapping[speaker] = best_id
        ratio = best_score / max(0.001, second_score)
        assignment_confidence = round(min(1, max(0, ratio - 1) / 1.4), 3) if second_score else 1
        assignments.append({
            "speaker": speaker,
            "trackId": best_id,
            "score": round(best_score, 4),
            "confidence": assignment_confidence,
            "alternatives": [
                {"trackId": track_id, "score": round(score, 4)}
                for track_id, score in alternatives[:3]
            ],
        })

    return mapping, assignments


def visible_points_for_sample(samples, tracks, sample_index):
    visible = []
    for track in tracks:
        point = point_for_sample(track, sample_index)
        if point:
            visible.append(point)
    return visible


def choose_active_points(samples, tracks, speaker_timeline):
    active = []
    active_track_id = None
    previous_active_speaker = None
    speaker_map, speaker_assignments = build_speaker_track_map(tracks, speaker_timeline)
    speaker_confidence = {
        item["speaker"]: item.get("confidence", 0)
        for item in speaker_assignments
        if item.get("speaker")
    }

    for sample_index, sample in enumerate(samples):
        visible = visible_points_for_sample(samples, tracks, sample_index)

        if not visible:
            continue

        active_speaker = sample.get("activeTranscriptSpeaker")
        mapped_track_id = speaker_map.get(active_speaker)
        mapped_confidence = speaker_confidence.get(active_speaker, 0)
        mapped = next((point for point in visible if point["trackId"] == mapped_track_id), None)
        current = next((point for point in visible if point["trackId"] == active_track_id), None)
        best = max(visible, key=point_score)
        speaker_changed = bool(
            active_speaker
            and previous_active_speaker
            and active_speaker != previous_active_speaker
        )
        best_non_current = max(
            [point for point in visible if point["trackId"] != active_track_id],
            key=point_score,
            default=None,
        )

        if mapped and mapped_confidence >= MAPPED_TRACK_MIN_CONFIDENCE:
            chosen = mapped
        elif speaker_changed and best_non_current:
            chosen = best_non_current
        elif mapped and current is None:
            chosen = mapped
        elif current is None:
            chosen = best
        elif sample.get("speakerSwitchNear") and best["trackId"] != current["trackId"]:
            chosen = best
        else:
            chosen = current

        active_track_id = chosen["trackId"]
        if active_speaker:
            previous_active_speaker = active_speaker
        active.append({
            "t": chosen["t"],
            "x": chosen["x"],
            "y": chosen["y"],
            "width": chosen["width"],
            "height": chosen["height"],
            "faceX": chosen.get("faceX"),
            "faceY": chosen.get("faceY"),
            "faceWidth": chosen.get("faceWidth"),
            "faceHeight": chosen.get("faceHeight"),
            "mouthMotion": chosen.get("mouthMotion", 0),
            "mediaPipeMouthMotion": chosen.get("mediaPipeMouthMotion", 0),
            "mediaPipeMouthOpen": chosen.get("mediaPipeMouthOpen"),
            "mediaPipeJawOpen": chosen.get("mediaPipeJawOpen"),
            "mediaPipeFrontalScore": chosen.get("mediaPipeFrontalScore"),
            "mediaPipeValidated": bool(chosen.get("mediaPipeValidated")),
            "activeTranscriptSpeaker": active_speaker,
            "speakerSwitchNear": bool(sample.get("speakerSwitchNear")),
            "speakerTrackMapped": bool(mapped),
            "source": "opencv_haar_cpu_multitrack_av",
            "trackId": chosen["trackId"],
            "detectorConfidence": chosen.get("detectorConfidence"),
            "detectorProvider": chosen.get("detectorProvider"),
        })

    return active, speaker_assignments


def nearest_track_point(tracks, track_id, t, before=0.35, after=0.75):
    candidates = []
    for track in tracks:
        if track["id"] != track_id:
            continue
        for point in track["points"]:
            if t - before <= point["t"] <= t + after:
                candidates.append(point)
    if not candidates:
        return None
    return sorted(candidates, key=lambda point: (point["t"] < t, abs(point["t"] - t)))[0]


def median(values, fallback):
    clean = sorted(value for value in values if isinstance(value, (int, float)) and math.isfinite(value))
    if not clean:
        return fallback
    return clean[len(clean) // 2]


def stable_anchor(points, speaker=None, track_id=None, fallback=None):
    candidates = points
    if speaker:
        speaker_candidates = [point for point in candidates if point.get("activeTranscriptSpeaker") == speaker]
        if speaker_candidates:
            candidates = speaker_candidates
    if track_id:
        mapped_candidates = [point for point in candidates if point.get("trackId") == track_id]
        if mapped_candidates:
            candidates = mapped_candidates

    fallback = fallback or (candidates[0] if candidates else {})
    anchor = {
        "x": round(median([point.get("faceX") for point in candidates], fallback.get("faceX", fallback.get("x", 0.5))), 4),
        "y": round(clamp(
            median([point.get("faceY") for point in candidates], fallback.get("faceY", fallback.get("y", 0.5))) + 0.075,
            0.16,
            0.86,
        ), 4),
        "width": round(median([point.get("width") for point in candidates], fallback.get("width", 0.24)), 4),
        "height": round(median([point.get("height") for point in candidates], fallback.get("height", 0.52)), 4),
        "faceX": round(median([point.get("faceX") for point in candidates], fallback.get("faceX", fallback.get("x", 0.5))), 4),
        "faceY": round(median([point.get("faceY") for point in candidates], fallback.get("faceY", fallback.get("y", 0.5))), 4),
        "faceWidth": round(median([point.get("faceWidth") for point in candidates], fallback.get("faceWidth", 0.08)), 4),
        "faceHeight": round(median([point.get("faceHeight") for point in candidates], fallback.get("faceHeight", 0.14)), 4),
        "mouthMotion": round(median([point.get("mouthMotion") for point in candidates], fallback.get("mouthMotion", 0)), 4),
        "detectorConfidence": round(median([point.get("detectorConfidence") for point in candidates], fallback.get("detectorConfidence", 0)), 4),
        "detectorProvider": fallback.get("detectorProvider") or (candidates[0].get("detectorProvider") if candidates else None),
        "trackId": track_id or fallback.get("trackId"),
        "activeTranscriptSpeaker": speaker or fallback.get("activeTranscriptSpeaker"),
        "speakerTrackMapped": bool(track_id),
    }
    return apply_edge_safety(anchor)


def apply_edge_safety(anchor):
    face_x = anchor.get("faceX", anchor.get("x", 0.5))
    face_width = anchor.get("faceWidth", 0.08)
    face_height = anchor.get("faceHeight", 0.14)
    near_edge = face_x < 0.28 or face_x > 0.72
    if near_edge:
        # Keep the crop centered on the detected face. The FFmpeg crop expression
        # already clips the crop window to the source boundary. Moving an edge
        # face inward (for example x=.14 -> x=.28) moves the crop away from the
        # person and is what caused the rendered face to be cut off.
        anchor["x"] = round(clamp(face_x, 0, 1), 4)
        anchor["width"] = round(min(0.98, max(anchor["width"], face_width * 5.2, 0.42)), 4)
        anchor["height"] = round(min(0.99, max(anchor["height"], face_height * 5.3, 0.82)), 4)
        anchor["edgeSafeFallback"] = True
    return anchor


def assignment_map(speaker_assignments):
    return {
        item["speaker"]: item["trackId"]
        for item in speaker_assignments
        if item.get("speaker") and item.get("trackId")
    }


def assignment_confidence_map(speaker_assignments):
    return {
        item["speaker"]: float(item.get("confidence", 0))
        for item in speaker_assignments
        if item.get("speaker")
    }


def stable_point(t, anchor, source, speaker_switch=False):
    return {
        "t": round(max(0, t), 2),
        "x": anchor["x"],
        "y": anchor["y"],
        "width": anchor["width"],
        "height": anchor["height"],
        "faceX": anchor.get("faceX"),
        "faceY": anchor.get("faceY"),
        "faceWidth": anchor.get("faceWidth"),
        "faceHeight": anchor.get("faceHeight"),
        "mouthMotion": anchor.get("mouthMotion", 0),
        "activeTranscriptSpeaker": anchor.get("activeTranscriptSpeaker"),
        "speakerSwitchNear": speaker_switch,
        "speakerTrackMapped": bool(anchor.get("speakerTrackMapped")),
        "assignmentConfidence": anchor.get("assignmentConfidence"),
        "lowConfidenceFallback": bool(anchor.get("lowConfidenceFallback")),
        "edgeSafeFallback": bool(anchor.get("edgeSafeFallback")),
        "detectorConfidence": anchor.get("detectorConfidence"),
        "detectorProvider": anchor.get("detectorProvider"),
        "source": source,
        "trackId": anchor.get("trackId"),
    }


def stabilize_with_timeline(points, speaker_timeline, speaker_assignments, duration, epsilon=0.02):
    mapped = assignment_map(speaker_assignments)
    confidence_by_speaker = assignment_confidence_map(speaker_assignments)
    output = []
    previous_anchor = None

    for index, segment in enumerate(speaker_timeline):
        start = max(0, segment["start"])
        end = min(duration, segment["end"])
        if end <= start:
            continue

        speaker = segment["speaker"]
        mapped_track_id = mapped.get(speaker)
        assignment_confidence = confidence_by_speaker.get(speaker, 0)
        segment_points = [
            point
            for point in points
            if start - 0.35 <= point["t"] <= end + 0.35
            and (not speaker or point.get("activeTranscriptSpeaker") == speaker)
        ]
        if not segment_points:
            segment_points = [
                point
                for point in points
                if start - 0.75 <= point["t"] <= end + 0.75
            ]
        if not segment_points:
            continue

        # A diarized speaker can appear under several face track IDs when the
        # source cuts between cameras. Locking the entire audio segment to the
        # globally mapped track caused later shots to crop the old location (an
        # empty chair or hands). Stabilize each visible track run separately.
        runs = split_point_runs(sorted(segment_points, key=lambda point: point["t"]))
        for run_index, run in enumerate(runs):
            run_track_id = max(
                {point.get("trackId") for point in run if point.get("trackId") is not None},
                key=lambda track_id: len([point for point in run if point.get("trackId") == track_id]),
                default=None,
            )
            run_confidence = assignment_confidence if run_track_id == mapped_track_id else 0.5
            anchor = stable_anchor(run, speaker=speaker, track_id=run_track_id, fallback=previous_anchor)
            anchor["assignmentConfidence"] = run_confidence
            if run_confidence < 0.22:
                anchor["width"] = round(min(0.95, max(anchor["width"], anchor.get("faceWidth", 0.08) * 3.8)), 4)
                anchor["height"] = round(min(0.98, max(anchor["height"], anchor.get("faceHeight", 0.14) * 4.6)), 4)
                anchor["lowConfidenceFallback"] = True

            run_start = start if run_index == 0 else max(start, run[0]["t"])
            run_end = min(end, run[-1]["t"])
            if previous_anchor:
                output.append(stable_point(max(0, run_start - epsilon), previous_anchor, "opencv_haar_cpu_stable_camera_hold", True))
                output.append(stable_point(run_start + epsilon, anchor, "opencv_haar_cpu_stable_camera_cut", True))
            else:
                output.append(stable_point(run_start, anchor, "opencv_haar_cpu_stable_lock", False))
            output.append(stable_point(max(run_start, run_end), anchor, "opencv_haar_cpu_stable_hold", False))
            previous_anchor = anchor

    return output


def split_point_runs(points, max_gap=0.9):
    runs = []
    current = []
    for point in points:
        last = current[-1] if current else None
        if (
            last
            and (
                point["t"] - last["t"] > max_gap
                or point.get("activeTranscriptSpeaker") != last.get("activeTranscriptSpeaker")
                or point.get("trackId") != last.get("trackId")
            )
        ):
            runs.append(current)
            current = []
        current.append(point)
    if current:
        runs.append(current)
    return runs


def stabilize_without_timeline(points, duration):
    output = []
    previous_anchor = None
    for run in split_point_runs(points):
        start = run[0]["t"]
        end = run[-1]["t"]
        anchor = stable_anchor(run, fallback=previous_anchor)
        if previous_anchor and center_distance(previous_anchor, anchor) > 0.16:
            output.append(stable_point(max(0, start - 0.02), previous_anchor, "opencv_haar_cpu_stable_hold", True))
            output.append(stable_point(start + 0.02, anchor, "opencv_haar_cpu_stable_cut", True))
        else:
            output.append(stable_point(start, anchor, "opencv_haar_cpu_stable_lock", False))
        output.append(stable_point(end, anchor, "opencv_haar_cpu_stable_hold", False))
        previous_anchor = anchor

    if output and output[-1]["t"] < duration:
        output.append({**output[-1], "t": round(duration, 2)})
    return output


def stabilize_points(points, speaker_timeline, speaker_assignments, duration):
    if not points:
        return points
    sorted_points = sorted(points, key=lambda point: point["t"])
    if speaker_timeline:
        stable = stabilize_with_timeline(sorted_points, speaker_timeline, speaker_assignments, duration)
    else:
        stable = stabilize_without_timeline(sorted_points, duration)
    return stable or sorted_points


def finalize_track_points(points, duration):
    if not points:
        return points

    ordered = sorted(points, key=lambda point: point["t"])
    deduped = []
    for point in ordered:
        last = deduped[-1] if deduped else None
        if last and abs(last["t"] - point["t"]) < 0.01:
            if "cut" in str(point.get("source", "")) or "boundary" in str(point.get("source", "")):
                deduped[-1] = point
            continue
        deduped.append(point)

    if deduped[0]["t"] > 0:
        deduped.insert(0, {**deduped[0], "t": 0})
    if deduped[-1]["t"] < duration:
        deduped.append({**deduped[-1], "t": round(duration, 2)})

    return deduped


def enforce_speaker_boundary_cuts(points, tracks, speaker_timeline, speaker_assignments, epsilon=0.02):
    if not points or len(speaker_timeline) < 2:
        return points

    mapped = {
        item["speaker"]: item["trackId"]
        for item in speaker_assignments
        if item.get("speaker") and item.get("trackId")
    }
    additions = []
    suppressed = []

    for index in range(1, len(speaker_timeline)):
        previous_segment = speaker_timeline[index - 1]
        next_segment = speaker_timeline[index]
        if previous_segment["speaker"] == next_segment["speaker"]:
            continue

        boundary = next_segment["start"]
        target_track_id = mapped.get(next_segment["speaker"])
        if not target_track_id:
            continue

        target = nearest_track_point(tracks, target_track_id, boundary)
        previous = max(
            [point for point in points if point["t"] <= boundary],
            key=lambda point: point["t"],
            default=None,
        )
        if not target or not previous:
            continue

        before_t = round(max(0, boundary - epsilon), 2)
        after_t = round(boundary + epsilon, 2)
        suppressed.append({
            "start": after_t,
            "end": round(boundary + 0.5, 2),
            "speaker": next_segment["speaker"],
            "trackId": target_track_id,
        })
        additions.append({
            **previous,
            "t": before_t,
            "source": "opencv_haar_cpu_speaker_boundary_hold",
            "activeTranscriptSpeaker": previous_segment["speaker"],
            "speakerSwitchNear": True,
        })
        additions.append({
            "t": after_t,
            "x": target["x"],
            "y": target["y"],
            "width": target["width"],
            "height": target["height"],
            "faceX": target.get("faceX"),
            "faceY": target.get("faceY"),
            "faceWidth": target.get("faceWidth"),
            "faceHeight": target.get("faceHeight"),
            "mouthMotion": target.get("mouthMotion", 0),
            "activeTranscriptSpeaker": next_segment["speaker"],
            "speakerSwitchNear": True,
            "speakerTrackMapped": True,
            "source": "opencv_haar_cpu_speaker_boundary_cut",
            "trackId": target["trackId"],
        })

    filtered_points = []
    for point in points:
        should_suppress = any(
            rule["start"] <= point["t"] <= rule["end"]
            and point.get("activeTranscriptSpeaker") == rule["speaker"]
            and point.get("trackId") != rule["trackId"]
            for rule in suppressed
        )
        if not should_suppress:
            filtered_points.append(point)

    combined = filtered_points + additions
    combined.sort(key=lambda point: point["t"])

    deduped = []
    for point in combined:
        last = deduped[-1] if deduped else None
        if (
            last
            and abs(last["t"] - point["t"]) < 0.01
            and last.get("activeTranscriptSpeaker") == point.get("activeTranscriptSpeaker")
        ):
            deduped[-1] = point if "boundary" in str(point.get("source", "")) else last
            continue
        deduped.append(point)
    return deduped


def add_cut_points(points, duration, cut_distance=0.22, hard_cut_epsilon=0.02):
    if not points:
        return points

    output = []
    for index, point in enumerate(points):
        previous = points[index - 1] if index > 0 else None
        should_cut = previous and (
            center_distance(previous, point) > cut_distance
            or previous.get("activeTranscriptSpeaker") != point.get("activeTranscriptSpeaker")
        )
        if should_cut:
            before = max(previous["t"], round(point["t"] - hard_cut_epsilon, 2))
            if before > previous["t"]:
                output.append({**previous, "t": before, "source": "opencv_haar_cpu_hard_cut_hold"})
        output.append(point)

    first = output[0]
    last = output[-1]
    if first["t"] > 0:
        output.insert(0, {**first, "t": 0})
    if last["t"] < duration:
        output.append({**last, "t": round(duration, 2)})
    return output


def serialize_tracks(tracks):
    output = []
    for track in sorted(tracks, key=lambda item: len(item["points"]), reverse=True):
        points = track["points"]
        sample_indexes = {point["sampleIndex"] for point in points}
        co_visible = []
        for other in tracks:
            if other["id"] == track["id"]:
                continue
            other_indexes = {point["sampleIndex"] for point in other["points"]}
            shared_samples = len(sample_indexes & other_indexes)
            if shared_samples:
                co_visible.append({"trackId": other["id"], "samples": shared_samples})
        co_visible.sort(key=lambda item: item["samples"], reverse=True)
        output.append({
            "id": track["id"],
            "points": len(points),
            "averageArea": round(track["totalArea"] / max(1, len(points)), 4),
            "averageMouthMotion": round(track.get("totalMouthMotion", 0) / max(1, len(points)), 4),
            "averageSpeakerMotion": round(sum(speaker_motion(point) for point in points) / max(1, len(points)), 4),
            "mediaPipeValidatedPoints": len([point for point in points if point.get("mediaPipeValidated")]),
            "start": points[0]["t"],
            "end": points[-1]["t"],
            "faceX": round(median([point.get("faceX") for point in points], 0.5), 4),
            "faceY": round(median([point.get("faceY") for point in points], 0.48), 4),
            "faceWidth": round(median([point.get("faceWidth") for point in points], 0.08), 4),
            "faceHeight": round(median([point.get("faceHeight") for point in points], 0.14), 4),
            "detectorConfidence": round(median([point.get("detectorConfidence") for point in points], 0.65), 4),
            "coVisibleWith": co_visible,
        })
    return output


def prominent_face(detection):
    return (
        detection.get("faceWidth", 0) >= float(os.environ.get("DENSE_FACE_PROMINENT_MIN_WIDTH", "0.075"))
        and detection.get("faceHeight", 0) >= float(os.environ.get("DENSE_FACE_PROMINENT_MIN_HEIGHT", "0.14"))
        and detection.get("detectorConfidence", 0) >= float(os.environ.get("DENSE_FACE_PROMINENT_MIN_CONFIDENCE", "0.72"))
    )


def source_suppression_metadata(samples, duration):
    if not samples:
        return {"cleanSpeakerFrame": None, "speakerMissingIntervals": []}

    clean_candidates = []
    presence = []
    for sample in samples:
        prominent = [detection for detection in sample["detections"] if prominent_face(detection)]
        presence.append((sample["t"], bool(prominent)))
        for detection in prominent:
            clean_candidates.append({**detection, "t": sample["t"]})

    clean = max(
        clean_candidates,
        key=lambda item: item.get("detectorConfidence", 0) * 2 + area(item) + item.get("mouthMotion", 0) * 0.2,
        default=None,
    )
    clean_frame = None if not clean else {
        "t": clean["t"],
        "x": clean.get("faceX", clean.get("x", 0.5)),
        "y": clean.get("faceY", clean.get("y", 0.42)) + 0.075,
        "width": clean.get("width", 0.42),
        "height": clean.get("height", 0.82),
        "faceX": clean.get("faceX"),
        "faceY": clean.get("faceY"),
        "faceWidth": clean.get("faceWidth"),
        "faceHeight": clean.get("faceHeight"),
    }

    step = duration / max(1, len(samples))
    minimum_duration = float(os.environ.get("DENSE_FACE_SUPPRESS_MIN_SECONDS", "0.65"))
    intervals = []
    start = None
    for index, (t, visible) in enumerate(presence):
        if not visible and start is None:
            start = max(0, t - step / 2)
        next_t = presence[index + 1][0] if index + 1 < len(presence) else duration
        if start is not None and (visible or index == len(presence) - 1):
            end = min(duration, (t - step / 2) if visible else next_t)
            if end - start >= minimum_duration:
                intervals.append({"start": round(start, 2), "end": round(end, 2), "reason": "no_prominent_speaker_face"})
            start = None

    return {"cleanSpeakerFrame": clean_frame, "speakerMissingIntervals": intervals}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--fps", type=float, default=4.0)
    parser.add_argument("--max-points", type=int, default=24)
    parser.add_argument("--speaker-timeline", default="")
    args = parser.parse_args()
    speaker_timeline = load_speaker_timeline(args.speaker_timeline)

    cv2 = load_cv2()
    cap = cv2.VideoCapture(args.source)
    if not cap.isOpened():
        raise RuntimeError("Could not open source video for face tracking")

    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1
    height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1
    detector = create_face_detector(cv2, width, height)
    if detector["type"] == "haar" and detector["detector"].empty():
        raise RuntimeError("Could not initialize OpenCV face detector")
    media_pipe = MediaPipeFaceRefiner()

    sample_count = max(1, min(args.max_points, int(math.ceil(args.duration * args.fps))))
    step = args.duration / sample_count
    samples = []
    previous_gray = None

    for index in range(sample_count):
        t_abs = args.start + index * step
        t_rel = index * step
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(t_abs * source_fps)))
        ok, frame = cap.read()
        if not ok:
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detections = detect_faces(cv2, detector, frame, gray, previous_gray, width, height)
        detections = media_pipe.refine(frame, round(t_rel * 1000), detections)
        samples.append({
            "t": round(t_rel, 2),
            "detections": detections,
            "activeTranscriptSpeaker": active_speaker_at(t_rel, speaker_timeline),
            "speakerSwitchNear": speaker_switch_near(t_rel, speaker_timeline),
        })
        previous_gray = gray

    cap.release()
    media_pipe.close()
    detected_samples = [sample for sample in samples if sample["detections"]]
    tracks = assign_tracks(detected_samples)
    points, speaker_assignments = choose_active_points(detected_samples, tracks, speaker_timeline)
    points = enforce_speaker_boundary_cuts(points, tracks, speaker_timeline, speaker_assignments)
    raw_points_count = len(points)
    points = stabilize_points(points, speaker_timeline, speaker_assignments, args.duration)
    points = finalize_track_points(points, args.duration)
    suppression = source_suppression_metadata(samples, args.duration)
    confidence = 0 if sample_count == 0 else len(detected_samples) / sample_count
    print(json.dumps({
        "provider": "opencv_haar_cpu_multitrack_av",
        "faceDetector": detector["type"],
        "mediaPipeFaceLandmarker": media_pipe.status(),
        "sourceWidth": int(width),
        "sourceHeight": int(height),
        "sampleCount": sample_count,
        "detections": sum(len(sample["detections"]) for sample in samples),
        "detectedSamples": len(detected_samples),
        "confidence": round(min(1, confidence), 3),
        "tracks": serialize_tracks(tracks),
        "trackCount": len(tracks),
        "activeSpeakerMode": "mouth_motion_plus_diarization_switch_hints" if speaker_timeline else "mouth_motion_visual_only",
        "speakerTimelineSegments": len(speaker_timeline),
        "speakerTrackAssignments": speaker_assignments,
        "rawSpeakerTrackPoints": raw_points_count,
        "stabilizedSpeakerTrackPoints": len(points),
        "lowConfidenceFallbackPoints": len([point for point in points if point.get("lowConfidenceFallback")]),
        "edgeSafeFallbackPoints": len([point for point in points if point.get("edgeSafeFallback")]),
        "speakerTimelineAfterFiltering": speaker_timeline,
        "stabilizationMode": "locked_speaker_anchor",
        "speakerTrack": points,
        "cleanSpeakerFrame": suppression["cleanSpeakerFrame"],
        "speakerMissingIntervals": suppression["speakerMissingIntervals"],
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc), "speakerTrack": [], "confidence": 0}), file=sys.stderr)
        sys.exit(1)
