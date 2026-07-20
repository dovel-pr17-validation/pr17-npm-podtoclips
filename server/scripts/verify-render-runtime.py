import cv2
import mediapipe
import numpy
import sys


EXPECTED = {
    "python": "3.14.5",
    "opencv": "5.0.0",
    "mediapipe": "0.10.35",
    "numpy": "2.5.1",
}

actual = {
    "python": ".".join(map(str, sys.version_info[:3])),
    "opencv": cv2.__version__,
    "mediapipe": mediapipe.__version__,
    "numpy": numpy.__version__,
}

if actual != EXPECTED:
    raise SystemExit(f"Render runtime mismatch: expected {EXPECTED}, got {actual}")

print(f"Render runtime verified: {actual}")
