"""Glue: prompt -> runner -> raw SMPL motion, and converters to .vmd / SMPL JSON.

Retargeting now happens on PC-A from the raw SMPL output; the .vmd path is kept for
backward compatibility / local inspection only.
"""
from __future__ import annotations

from hy_motion_runner import HYMotionRunner
from smpl_to_mmd import retarget
from vmd_writer import write_vmd


def generate_motion(runner: HYMotionRunner, prompt: str, duration: float = 4.0,
                    seed: int = 1) -> dict:
    """Raw motion dict from the runner (real: SMPL; stub: mmd_frames)."""
    return runner.generate(prompt, duration, seed)


def motion_to_smpl_json(motion: dict) -> dict:
    """JSON-serializable raw SMPL motion for PC-A's retargeter.

    { fps, joint_names, joints:[T][J][3] (world coords), poses:[T][156] (axis-angle),
      trans:[T][3] }. `joints` is the easy path (direction matching); `poses`/`trans`
      let PC-A run its own SMPL FK if preferred.
    """
    import numpy as np

    out: dict = {
        "format": "smpl",
        "fps": float(motion.get("fps", 30.0)),
        "joint_names": list(motion.get("joint_names", [])),
    }
    for key in ("joints", "poses", "trans"):
        if key in motion and motion[key] is not None:
            out[key] = np.asarray(motion[key], dtype=float).round(6).tolist()
    return out


def motion_to_vmd(motion: dict, model_name: str = "HY-Motion") -> bytes:
    """Deprecated local path: SMPL -> MMD retarget -> .vmd bytes."""
    if motion.get("format") == "smpl":
        frames = retarget(motion, model_name=model_name)
    else:  # "mmd_frames" (stub)
        frames = motion["frames"]
    return write_vmd(frames, model_name=model_name)


# Backward-compat wrapper.
def generate_vmd(runner: HYMotionRunner, prompt: str, duration: float = 4.0,
                 seed: int = 1, model_name: str = "HY-Motion") -> bytes:
    return motion_to_vmd(generate_motion(runner, prompt, duration, seed), model_name)
