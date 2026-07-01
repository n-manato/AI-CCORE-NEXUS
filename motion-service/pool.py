"""Emotion warm-pool kept full by a single persistent background maintainer.

Design (fixes the "pool not warm" drain):
  * ONE maintainer thread generates clips, serialized (single GPU worker) and
    error-resilient (a failed clip is logged + retried, never kills the loop).
  * It tops every emotion up to DEPTH, emptiest-first, so each emotion always has
    >= 1 warm clip and a just-served emotion refills promptly.
  * `next(emotion)` returns instantly when warm; when momentarily empty it BLOCKS
    until the maintainer produces a clip (so the endpoint returns a real .vmd, not
    a 503) up to wait_timeout, then falls back to None.
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque

from hy_motion_runner import HYMotionRunner
from pipeline import generate_motion
from prompts import EMOTIONS, prompt_for, DEFAULT_DURATION

POOL_DIR = os.path.join(os.path.dirname(__file__), "pool_cache")
DEPTH = max(1, int(os.environ.get("MOTION_POOL_DEPTH", "2")))


class MotionPool:
    def __init__(self, runner: HYMotionRunner) -> None:
        self.runner = runner
        self._cv = threading.Condition()
        # Cache the RAW motion dict (format-agnostic: served as SMPL JSON or .vmd).
        self._pool: dict[str, deque[dict]] = {e: deque() for e in EMOTIONS}
        self._started = False
        self._seed = 0
        os.makedirs(POOL_DIR, exist_ok=True)

    def start(self) -> None:
        with self._cv:
            if self._started:
                return
            self._started = True
        threading.Thread(target=self._maintainer, daemon=True).start()

    def counts(self) -> dict[str, int]:
        with self._cv:
            return {e: len(q) for e, q in self._pool.items()}

    def _neediest(self) -> str | None:
        # Emptiest emotion still below DEPTH (emptiest-first => every emotion
        # reaches 1 before any reaches DEPTH). None when all are full.
        target, best = None, DEPTH
        for e in EMOTIONS:
            n = len(self._pool[e])
            if n < best:
                best, target = n, e
        return target

    def _maintainer(self) -> None:
        while True:
            with self._cv:
                target = self._neediest()
                if target is None:
                    self._cv.wait(timeout=2.0)  # all full; re-check periodically
                    continue
                self._seed += 1
                seed = self._seed
            try:
                motion = generate_motion(self.runner, prompt_for(target), DEFAULT_DURATION, seed)
            except Exception as ex:  # noqa: BLE001 - never let one failure kill the loop
                print(f"[pool] generate failed for {target}: {ex}")
                time.sleep(1.0)
                continue
            with self._cv:
                if len(self._pool[target]) < DEPTH:
                    self._pool[target].append(motion)
                self._cv.notify_all()

    def next(self, emotion: str, wait_timeout: float = 18.0) -> dict | None:
        """Pop a warm motion (instant), or block until the maintainer makes one."""
        if emotion not in self._pool:
            return None
        with self._cv:
            if self._pool[emotion]:
                vmd = self._pool[emotion].popleft()
                self._cv.notify_all()  # wake the maintainer to refill
                return vmd
            # Momentarily empty: nudge the maintainer and wait for a clip.
            self._cv.notify_all()
            end = time.monotonic() + wait_timeout
            while not self._pool[emotion]:
                remaining = end - time.monotonic()
                if remaining <= 0:
                    return None
                self._cv.wait(timeout=remaining)
            vmd = self._pool[emotion].popleft()
            self._cv.notify_all()
            return vmd
