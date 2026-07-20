#!/usr/bin/env python3
import importlib.util
import os
import unittest


MODULE_PATH = os.path.join(os.path.dirname(__file__), "faceTrack.py")
SPEC = importlib.util.spec_from_file_location("face_track", MODULE_PATH)
face_track = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(face_track)


class FaceTrackSafetyTests(unittest.TestCase):
    def test_edge_safety_does_not_move_crop_away_from_face(self):
        anchor = {
            "x": 0.28,
            "y": 0.4,
            "width": 0.2,
            "height": 0.4,
            "faceX": 0.13,
            "faceWidth": 0.1,
            "faceHeight": 0.2,
        }
        safe = face_track.apply_edge_safety(anchor)
        self.assertEqual(safe["x"], 0.13)
        self.assertTrue(safe["edgeSafeFallback"])
        self.assertGreaterEqual(safe["height"], 0.82)

    def test_diarized_speakers_receive_unique_tracks(self):
        tracks = [
            {
                "id": 1,
                "points": [{"t": 0, "width": 0.2, "height": 0.3, "mouthMotion": 0.8, "sampleIndex": 0}],
                "totalArea": 0.06,
                "totalMouthMotion": 0.8,
            },
            {
                "id": 2,
                "points": [{"t": 0, "width": 0.2, "height": 0.3, "mouthMotion": 0.4, "sampleIndex": 0}],
                "totalArea": 0.06,
                "totalMouthMotion": 0.4,
            },
        ]
        timeline = [
            {"speaker": "Speaker A", "start": 0, "end": 1},
            {"speaker": "Speaker B", "start": 0, "end": 1},
        ]
        mapping, _ = face_track.build_speaker_track_map(tracks, timeline)
        self.assertEqual(len(mapping), len(set(mapping.values())))

    def test_stabilization_keeps_camera_cut_face_tracks(self):
        base = {
            "width": 0.4,
            "height": 0.8,
            "faceWidth": 0.12,
            "faceHeight": 0.28,
            "faceY": 0.32,
            "y": 0.4,
            "mouthMotion": 0.5,
            "detectorConfidence": 0.92,
            "detectorProvider": "test",
            "activeTranscriptSpeaker": "Speaker A",
        }
        points = [
            {**base, "t": 0, "x": 0.25, "faceX": 0.25, "trackId": 1},
            {**base, "t": 1, "x": 0.25, "faceX": 0.25, "trackId": 1},
            {**base, "t": 2, "x": 0.72, "faceX": 0.72, "trackId": 2},
            {**base, "t": 3, "x": 0.72, "faceX": 0.72, "trackId": 2},
        ]
        timeline = [{"speaker": "Speaker A", "start": 0, "end": 3}]
        assignments = [{"speaker": "Speaker A", "trackId": 2, "confidence": 0.8}]
        stabilized = face_track.stabilize_with_timeline(points, timeline, assignments, 3)
        self.assertEqual({point["trackId"] for point in stabilized}, {1, 2})

    def test_missing_prominent_face_produces_suppression_interval(self):
        samples = [
            {"t": 0, "detections": []},
            {"t": 1, "detections": []},
            {"t": 2, "detections": [{
                "x": 0.5, "y": 0.4, "width": 0.4, "height": 0.8,
                "faceX": 0.5, "faceY": 0.3, "faceWidth": 0.12, "faceHeight": 0.25,
                "detectorConfidence": 0.92, "mouthMotion": 0.5,
            }]},
        ]
        metadata = face_track.source_suppression_metadata(samples, 3)
        self.assertIsNotNone(metadata["cleanSpeakerFrame"])
        self.assertTrue(metadata["speakerMissingIntervals"])

    def test_mediapipe_motion_is_preferred_when_available(self):
        point = {
            "mouthMotion": 0.1,
            "mediaPipeValidated": True,
            "mediaPipeMouthMotion": 0.9,
            "mediaPipeJawOpen": 0.5,
        }
        self.assertGreater(face_track.speaker_motion(point), 0.6)

    def test_pixel_motion_remains_the_fallback(self):
        point = {"mouthMotion": 0.42, "mediaPipeValidated": False}
        self.assertEqual(face_track.speaker_motion(point), 0.42)

    def test_unvalidated_yunet_box_is_penalized_after_landmark_check(self):
        base = {
            "x": 0.5, "y": 0.5, "width": 0.2, "height": 0.3,
            "faceX": 0.5, "faceY": 0.5, "detectorConfidence": 0.9,
            "mouthMotion": 0.2, "mediaPipeAttempted": True,
        }
        validated = {**base, "mediaPipeValidated": True, "mediaPipeFrontalScore": 0.8}
        rejected = {**base, "mediaPipeValidated": False}
        self.assertGreater(face_track.point_score(validated), face_track.point_score(rejected))


if __name__ == "__main__":
    unittest.main()
