"""
SpikeSense — Ball Tracking Processor using YOLO.

Processes video frames from WebRTC, detects the ball, segments rallies,
and emits scoring events for the Gemini agent to announce.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

import numpy as np

logger = logging.getLogger(__name__)

try:
    import cv2
except Exception:
    cv2 = None

try:
    from vision_agents.core.processors import VideoProcessor
    from vision_agents.core.processors.base_processor import VideoForwarder

    HAS_SDK = True
except ImportError:
    HAS_SDK = False


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class BallPosition:
    x: float
    y: float
    confidence: float
    timestamp: float
    side: str = "unknown"  # left | right | unknown


@dataclass
class TrackerState:
    positions: list[BallPosition] = field(default_factory=list)
    rally_active: bool = False
    rally_start_time: float = 0.0
    rally_hit_count: int = 0
    last_detected_time: float = 0.0
    frames_without_ball: int = 0
    net_x: float = 0.5
    max_positions: int = 40
    min_confidence: float = 0.24
    miss_threshold_frames: int = 14
    use_trajectory_prediction: bool = True


# ---------------------------------------------------------------------------
# Trajectory Predictor — physics-inspired occlusion bridging
# ---------------------------------------------------------------------------


class TrajectoryPredictor:
    """Predict next ball position using weighted regression on recent observations."""

    def __init__(self, max_history: int = 8) -> None:
        self._history: list[tuple[float, float, float]] = []
        self._max_history = max_history

    def update(self, x: float, y: float, t: float) -> None:
        self._history.append((x, y, t))
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

    def predict_next(self, dt: float = 0.033) -> tuple[float, float] | None:
        if len(self._history) < 3:
            return None
        pts = self._history[-5:]
        n = len(pts)
        weights = np.array([2.0 ** i for i in range(n)])
        weights /= weights.sum()
        xs = np.array([p[0] for p in pts])
        ys = np.array([p[1] for p in pts])
        ts = np.array([p[2] for p in pts])
        t_ref = ts[-1]
        ts_rel = ts - t_ref
        try:
            vx = np.average(np.diff(xs) / (np.diff(ts_rel) + 1e-9), weights=weights[1:])
            coeffs_y = np.polyfit(ts_rel, ys, deg=min(2, n - 1), w=weights)
            poly_y = np.poly1d(coeffs_y)
            pred_x = float(np.clip(xs[-1] + vx * dt, 0.0, 1.0))
            pred_y = float(np.clip(poly_y(dt), 0.0, 1.0))
            return (pred_x, pred_y)
        except Exception:
            return None

    def clear(self) -> None:
        self._history.clear()


# ---------------------------------------------------------------------------
# Frame Difference Detector — fast pre-filter before YOLO
# ---------------------------------------------------------------------------


class FrameDifferenceDetector:
    """Three-frame differencing to find candidate ball regions."""

    def __init__(self, min_area: int = 20, max_area: int = 800) -> None:
        self._prev_frames: list[np.ndarray] = []
        self._min_area = min_area
        self._max_area = max_area

    def get_candidates(self, frame: np.ndarray) -> list[tuple[float, float, float, float]]:
        if cv2 is None:
            return []
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        candidates: list[tuple[float, float, float, float]] = []
        if len(self._prev_frames) >= 2:
            diff1 = cv2.absdiff(self._prev_frames[-1], gray)
            diff2 = cv2.absdiff(self._prev_frames[-2], self._prev_frames[-1])
            motion = cv2.bitwise_and(diff1, diff2)
            _, thresh = cv2.threshold(motion, 25, 255, cv2.THRESH_BINARY)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            h, w = gray.shape
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if self._min_area <= area <= self._max_area:
                    bx, by, bw, bh = cv2.boundingRect(cnt)
                    aspect = max(bw, bh) / (min(bw, bh) + 1e-6)
                    if aspect < 2.5:
                        candidates.append((
                            (bx + bw / 2) / w,
                            (by + bh / 2) / h,
                            bw / w,
                            bh / h,
                        ))
        self._prev_frames.append(gray)
        if len(self._prev_frames) > 3:
            self._prev_frames.pop(0)
        return candidates


# ---------------------------------------------------------------------------
# Kalman / EMA Smoother
# ---------------------------------------------------------------------------


class BallSmoother:
    def __init__(self):
        self.kf = None
        self.ema_x = None
        self.ema_y = None
        if cv2 is not None:
            self.kf = cv2.KalmanFilter(4, 2)
            self.kf.measurementMatrix = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], np.float32)
            self.kf.transitionMatrix = np.array(
                [[1, 0, 1, 0], [0, 1, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]], np.float32
            )
            self.kf.processNoiseCov = np.eye(4, dtype=np.float32) * 0.02
            self.kf.measurementNoiseCov = np.eye(2, dtype=np.float32) * 0.08

    def update(self, x: float, y: float) -> tuple[float, float]:
        if self.kf is not None:
            self.kf.predict()
            measurement = np.array([[np.float32(x)], [np.float32(y)]])
            estimated = self.kf.correct(measurement)
            return float(estimated[0]), float(estimated[1])
        alpha = 0.5
        if self.ema_x is None:
            self.ema_x, self.ema_y = x, y
        else:
            self.ema_x = alpha * x + (1 - alpha) * self.ema_x
            self.ema_y = alpha * y + (1 - alpha) * self.ema_y
        return float(self.ema_x), float(self.ema_y)


# ---------------------------------------------------------------------------
# Rally Segmenter — detects rally start/end and side changes
# ---------------------------------------------------------------------------


class RallySegmenter:
    def __init__(self, state: TrackerState):
        self.state = state

    def process(self, ball: BallPosition | None) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        if ball is not None:
            self.state.frames_without_ball = 0
            self.state.last_detected_time = ball.timestamp
            self.state.positions.append(ball)
            if len(self.state.positions) > self.state.max_positions:
                self.state.positions = self.state.positions[-self.state.max_positions:]

            if not self.state.rally_active:
                self.state.rally_active = True
                self.state.rally_start_time = ball.timestamp
                self.state.rally_hit_count = 0
                events.append({"type": "RALLY_START", "timestamp": ball.timestamp})

            if len(self.state.positions) >= 2:
                prev = self.state.positions[-2]
                if prev.side != ball.side and prev.side != "unknown" and ball.side != "unknown":
                    self.state.rally_hit_count += 1
                    events.append({
                        "type": "BALL_HIT",
                        "side": ball.side,
                        "hit_count": self.state.rally_hit_count,
                        "timestamp": ball.timestamp,
                    })

            events.append({
                "type": "BALL_DETECTED",
                "position": {"x": ball.x, "y": ball.y},
                "side": ball.side,
                "confidence": ball.confidence,
                "timestamp": ball.timestamp,
            })
            return events

        self.state.frames_without_ball += 1
        if self.state.rally_active and self.state.frames_without_ball >= self.state.miss_threshold_frames:
            loser_side = self._determine_rally_loser()
            duration = time.time() - self.state.rally_start_time
            events.append({
                "type": "RALLY_END",
                "loser_side": loser_side,
                "rally_length": self.state.rally_hit_count,
                "duration": round(duration, 2),
                "timestamp": time.time(),
            })
            self.state.rally_active = False
            self.state.rally_hit_count = 0
            self.state.positions.clear()
        return events

    def _determine_rally_loser(self) -> str:
        if not self.state.positions:
            return "unknown"
        sides = [p.side for p in self.state.positions[-4:] if p.side != "unknown"]
        return sides[-1] if sides else "unknown"


# ---------------------------------------------------------------------------
# Scoring — converts RALLY_END into POINT_SCORED
# ---------------------------------------------------------------------------


class ScoringProcessor:
    def score_from_events(self, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for evt in events:
            if evt.get("type") != "RALLY_END":
                continue
            loser = evt.get("loser_side")
            if loser not in ("left", "right"):
                continue
            out.append({
                "type": "POINT_SCORED",
                "winner_side": "right" if loser == "left" else "left",
                "rally_length": evt.get("rally_length", 0),
                "timestamp": evt.get("timestamp", time.time()),
            })
        return out


# ---------------------------------------------------------------------------
# BallTrackingProcessor — Vision Agents VideoProcessor
# ---------------------------------------------------------------------------


if HAS_SDK:
    import aiortc

    class BallTrackingProcessor(VideoProcessor):
        """YOLO + frame-differencing + trajectory prediction ball tracker."""

        def __init__(
            self,
            model_path: str = "yolov8n.pt",
            event_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        ):
            self.model_path = model_path
            self.state = TrackerState()
            self._model = None
            self._model_attempted = False
            self._frame_count = 0
            self._running = False
            self._events: list[dict[str, Any]] = []
            self._latest_tracking: dict[str, Any] = {}
            self._event_callback = event_callback

            self._smoother = BallSmoother()
            self._trajectory = TrajectoryPredictor()
            self._frame_diff = FrameDifferenceDetector()
            self._segmenter = RallySegmenter(self.state)
            self._scorer = ScoringProcessor()
            self._last_frame_gray = None

        @property
        def name(self) -> str:
            return "ball-tracker"

        async def process_video(
            self,
            track: aiortc.VideoStreamTrack,
            participant_id: Optional[str],
            shared_forwarder: Optional[VideoForwarder] = None,
        ) -> None:
            self._running = True
            logger.info("Ball tracker started for participant %s", participant_id)
            try:
                while self._running:
                    try:
                        frame = await asyncio.wait_for(track.recv(), timeout=5.0)
                    except asyncio.TimeoutError:
                        continue
                    except Exception:
                        break

                    img = frame.to_ndarray(format="bgr24")
                    events = self._process_frame(img)
                    for evt in events:
                        self._events.append(evt)
                        if self._event_callback:
                            asyncio.create_task(self._event_callback(evt))
            except Exception as exc:
                logger.error("Ball tracker error: %s", exc)
            finally:
                logger.info("Ball tracker stopped")

        async def stop_processing(self) -> None:
            self._running = False

        async def close(self) -> None:
            self._running = False
            self._model = None

        def get_pending_events(self) -> list[dict[str, Any]]:
            events = self._events[:]
            self._events.clear()
            return events

        def get_tracking_summary(self) -> dict[str, Any]:
            return self._latest_tracking

        def reset(self):
            self.state = TrackerState()
            self._segmenter = RallySegmenter(self.state)
            self._trajectory.clear()
            self._frame_count = 0
            self._latest_tracking = {}

        def _load_model(self):
            if self._model is not None or self._model_attempted:
                return
            self._model_attempted = True
            try:
                from ultralytics import YOLO
                self._model = YOLO(self.model_path)
                logger.info("YOLO model loaded: %s", self.model_path)
            except Exception as exc:
                logger.warning("Failed to load YOLO model: %s", exc)
                self._model = None

        def _detect_ball(self, frame: np.ndarray) -> BallPosition | None:
            self._load_model()
            best: BallPosition | None = None

            # Step 1: Frame-differencing candidates
            diff_candidates = self._frame_diff.get_candidates(frame)

            # Step 2: YOLO detection
            if self._model is not None:
                try:
                    frame_h, frame_w = frame.shape[:2]
                    scale = 320.0 / frame_w if frame_w > 320 else 1.0
                    if scale < 1.0 and cv2 is not None:
                        small = cv2.resize(frame, (int(frame_w * scale), int(frame_h * scale)))
                    else:
                        small = frame
                    results = self._model(small, verbose=False, conf=self.state.min_confidence)
                    small_h, small_w = small.shape[:2]
                    for result in results:
                        for box in result.boxes:
                            if int(box.cls[0]) != 32:  # sports ball
                                continue
                            x1, y1, x2, y2 = box.xyxy[0].tolist()
                            cx = (x1 + x2) / 2 / small_w
                            cy = (y1 + y2) / 2 / small_h
                            conf = float(box.conf[0])

                            # Boost confidence if near a frame-diff candidate
                            for dc in diff_candidates:
                                dist = ((cx - dc[0]) ** 2 + (cy - dc[1]) ** 2) ** 0.5
                                if dist < 0.1:
                                    conf = min(conf * 1.3, 1.0)
                                    break

                            if best is not None and conf <= best.confidence:
                                continue

                            sx, sy = self._smoother.update(cx, cy)
                            side = "left" if sx < self.state.net_x else "right"
                            best = BallPosition(
                                x=float(np.clip(sx, 0.0, 1.0)),
                                y=float(np.clip(sy, 0.0, 1.0)),
                                confidence=conf,
                                timestamp=time.time(),
                                side=side,
                            )
                except Exception as exc:
                    logger.debug("Ball detection failed: %s", exc)

            # Step 3: Trajectory prediction fallback
            if best is None and diff_candidates and self.state.use_trajectory_prediction:
                predicted = self._trajectory.predict_next()
                if predicted:
                    pred_x, pred_y = predicted
                    closest = min(diff_candidates, key=lambda c: (c[0] - pred_x) ** 2 + (c[1] - pred_y) ** 2)
                    dist = ((closest[0] - pred_x) ** 2 + (closest[1] - pred_y) ** 2) ** 0.5
                    if dist < 0.15:
                        sx, sy = self._smoother.update(closest[0], closest[1])
                        side = "left" if sx < self.state.net_x else "right"
                        best = BallPosition(
                            x=float(np.clip(sx, 0.0, 1.0)),
                            y=float(np.clip(sy, 0.0, 1.0)),
                            confidence=0.22,
                            timestamp=time.time(),
                            side=side,
                        )

            # Update trajectory history
            if best is not None:
                self._trajectory.update(best.x, best.y, best.timestamp)

            return best

        def _process_frame(self, frame: np.ndarray) -> list[dict[str, Any]]:
            self._frame_count += 1
            if self._frame_count % 8 != 0:
                return []

            ball = self._detect_ball(frame)

            # Optical flow fallback if no ball and we have history
            if ball is None and self.state.positions and cv2 is not None:
                ball = self._bridge_with_optical_flow(frame, self.state.positions[-1])

            segmented = self._segmenter.process(ball)
            scored = self._scorer.score_from_events(segmented)
            events = segmented + scored

            if ball:
                self._latest_tracking = {
                    "ball_position": {"x": ball.x, "y": ball.y},
                    "ball_side": ball.side,
                    "confidence": ball.confidence,
                    "rally_hits": self.state.rally_hit_count,
                    "is_rally_active": self.state.rally_active,
                }
            else:
                self._latest_tracking = {
                    "is_rally_active": self.state.rally_active,
                    "rally_hits": self.state.rally_hit_count,
                }

            return events

        def _bridge_with_optical_flow(self, frame: np.ndarray, last_ball: BallPosition) -> BallPosition | None:
            try:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                if self._last_frame_gray is None:
                    self._last_frame_gray = gray
                    return None
                p0 = np.array([[[last_ball.x * gray.shape[1], last_ball.y * gray.shape[0]]]], dtype=np.float32)
                p1, st, _ = cv2.calcOpticalFlowPyrLK(self._last_frame_gray, gray, p0, None)
                self._last_frame_gray = gray
                if st is None or int(st[0][0]) != 1:
                    return None
                nx = float(p1[0][0][0] / gray.shape[1])
                ny = float(p1[0][0][1] / gray.shape[0])
                side = "left" if nx < self.state.net_x else "right"
                return BallPosition(
                    x=float(np.clip(nx, 0.0, 1.0)),
                    y=float(np.clip(ny, 0.0, 1.0)),
                    confidence=0.18,
                    timestamp=time.time(),
                    side=side,
                )
            except Exception:
                return None

else:
    # Stub when Vision Agents SDK is not installed
    class BallTrackingProcessor:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs):
            pass
