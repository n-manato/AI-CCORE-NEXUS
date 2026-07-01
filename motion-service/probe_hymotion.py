"""Phase 0 probe: load real HY-Motion once, generate one clip, report the actual
output shape/fps + wall-clock timing, and write a real .vmd. Run AFTER the weights
are downloaded (install_hymotion.sh produced .phase0_install_done).

    cd motion-service && CUDA_VISIBLE_DEVICES=1 HYM_REAL=1 .venv/bin/python probe_hymotion.py
"""
from __future__ import annotations

import os
import time

os.environ["HYM_REAL"] = "1"  # force the real path
os.environ.setdefault(
    "HY_MOTION_HOME",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "HY-Motion-1.0"),
)

import numpy as np  # noqa: E402
from hy_motion_runner import HYMotionRunner  # noqa: E402
from pipeline import generate_vmd  # noqa: E402

POOL_DIR = os.path.join(os.path.dirname(__file__), "pool_cache")


def main():
    r = HYMotionRunner()
    print(f"stub={r.stub} home={r.home}")
    assert not r.stub, "runner is in stub mode (set HYM_REAL=1 and ensure ckpts present)"

    t0 = time.time()
    r.load()
    t_load = time.time() - t0
    print(f">>> model load: {t_load:.1f}s")

    t0 = time.time()
    motion = r.generate("a person waving hello", duration=4.0, seed=1)
    t_gen = time.time() - t0
    poses = np.asarray(motion["poses"])
    print(f">>> generate: {t_gen:.2f}s  | poses={poses.shape} dtype={poses.dtype} fps={motion['fps']:.2f}")
    print(f">>> trans={np.asarray(motion['trans']).shape}  mocap_frame_rate={motion.get('mocap_frame_rate')}")

    # full pipeline -> real .vmd
    t0 = time.time()
    vmd = generate_vmd(r, "a person waving hello", duration=4.0, seed=1)
    t_full = time.time() - t0
    os.makedirs(POOL_DIR, exist_ok=True)
    out = os.path.join(POOL_DIR, "_probe_real.vmd")
    with open(out, "wb") as f:
        f.write(vmd)
    print(f">>> full prompt->.vmd: {t_full:.2f}s  | {len(vmd)} bytes -> {out}")
    print(">>> PROBE OK")


if __name__ == "__main__":
    main()
