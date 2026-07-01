"""Numeric SMPL -> MMD retarget (rotation-only).

Converts SMPL per-joint LOCAL axis-angle rotations into MMD bone LOCAL rotation
keyframes:
  * global root translation is DISCARDED (character stays in place),
  * frames are resampled to TARGET_FPS (30),
  * output is rotation-only (+ optional センター vertical bob).

The hard parts -- SMPL T-pose vs MMD A-pose rest difference, and SMPL (right-handed,
Y-up) vs MMD (left-handed, Y-up) handedness -- are captured by the CALIBRATION
constants below. They are given sensible defaults and are the knobs to tune during
the Phase 0 visual check on the Miku model (see docs/motion-service plan).

Input `motion` dict (real HY-Motion, confirmed in Phase 0) is expected to look like:
    { "poses": ndarray[T, J*3] float (axis-angle, local per joint),
      "trans": ndarray[T, 3] float (root translation, discarded),
      "fps":   float }
`poses` may also arrive as [T, J, 3]; both are accepted.
"""
from __future__ import annotations

import math
from typing import Any

from bones import SMPL_JOINT_NAMES, SMPL_TO_MMD
from vmd_writer import BoneFrame, quat_from_axis_angle, quat_mul, quat_normalize

TARGET_FPS = 30

# ---- CALIBRATION (tuned visually on YYB Miku via PC-A __mmdBoneDirs) ----
# (b) Handedness/axis conversion applied to each SMPL local quaternion (x,y,z,w).
# X (left/right) matched on Miku (no mirror); the "arms cross behind the back"
# symptom = front/back (Z) inverted -> Z sign flipped. Order: apply (b) first,
# then enable (a) rest correction below and tune signs visually.
QUAT_AXIS_SIGN = (-1.0, -1.0, -1.0, 1.0)  # multiplies (x, y, z, w)

# (a) Rest-pose change-of-basis (SMPL T-pose horizontal -> MMD A-pose), per MMD
# bone, measured on YYB Miku (x,y,z,w). Applied by CONJUGATION (qr * q * qr^-1) so
# each arm bone's rotation is re-expressed in the tilted A-pose frame. Without it
# the front/back swing axis stays horizontal (SMPL), so a relaxed/low arm resolves
# BEHIND the body (skirt clip) while only strong gestures read correct in front.
# If front/back is reversed on Miku, swap to the inverse order (qr^-1 * q * qr).
APPLY_REST_CORRECTION = True
REST_CORRECTION = {
    "左肩": (0.0, 0.025, -0.138, 0.990),   # ~16 deg
    "左腕": (0.0, 0.0, -0.325, 0.946),     # ~38 deg (lower about Z)
    "左ひじ": (0.0, 0.0, -0.313, 0.950),   # ~37 deg
    "右肩": (0.0, -0.025, 0.138, 0.990),
    "右腕": (0.0, 0.0, 0.325, 0.946),
    "右ひじ": (0.0, 0.0, 0.313, 0.950),
}

# Arm-chain elevation verified INVERTED on Miku FK (PC-A): Qz came out positive
# (arm up) but A-pose wants negative (arm down). Flip ONLY the MMD-frame quaternion
# Z (elevation) for the arm chain. Qx (left/right) and Qy (front/back) are correct
# and untouched. A targeted per-bone flip (NOT global QUAT_AXIS_SIGN.Z, which would
# also re-break the front/back fix from step b).
ARM_ELEV_FLIP = {"左肩", "右肩", "左腕", "右腕", "左ひじ", "右ひじ"}

# If True, also discard the pelvis/センター *rotation* (lock facing direction).
DISCARD_ROOT_ROTATION = False


def _convert_quat(q):
    sx, sy, sz, sw = QUAT_AXIS_SIGN
    x, y, z, w = q
    return quat_normalize((x * sx, y * sy, z * sz, w * sw))


def _quat_conj(q):
    return (-q[0], -q[1], -q[2], q[3])


def _as_TJ3(poses: Any):
    """Normalize poses to a list of frames, each a list of (J) axis-angle triples."""
    import numpy as np  # local import; numpy is a hard dep of the runner anyway

    arr = np.asarray(poses, dtype=float)
    if arr.ndim == 2:  # [T, J*3]
        T = arr.shape[0]
        arr = arr.reshape(T, -1, 3)
    elif arr.ndim != 3:
        raise ValueError(f"unexpected poses shape {arr.shape}")
    return arr  # [T, J, 3]


def _resample_indices(n_src: int, src_fps: float, dst_fps: int) -> list[int]:
    if n_src <= 1 or src_fps <= 0 or abs(src_fps - dst_fps) < 1e-6:
        return list(range(n_src))
    dur = n_src / src_fps
    n_dst = max(1, int(round(dur * dst_fps)))
    return [min(n_src - 1, int(round(i * src_fps / dst_fps))) for i in range(n_dst)]


def retarget(motion: dict, model_name: str = "HY-Motion") -> list[BoneFrame]:
    poses = _as_TJ3(motion["poses"])  # [T, J, 3]
    src_fps = float(motion.get("fps") or motion.get("mocap_frame_rate") or TARGET_FPS)
    T, J, _ = poses.shape
    n_joints = min(J, len(SMPL_JOINT_NAMES))

    idx = _resample_indices(T, src_fps, TARGET_FPS)
    frames: list[BoneFrame] = []
    for out_f, src_i in enumerate(idx):
        for j in range(n_joints):
            jname = SMPL_JOINT_NAMES[j]
            mmd = SMPL_TO_MMD.get(jname)
            if mmd is None:
                continue
            if jname == "pelvis" and DISCARD_ROOT_ROTATION:
                continue
            ax = poses[src_i, j]
            angle = math.sqrt(float(ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2))
            q = quat_from_axis_angle((float(ax[0]), float(ax[1]), float(ax[2])), angle)
            qc = _convert_quat(q)
            if mmd in ARM_ELEV_FLIP:
                qc = (qc[0], qc[1], -qc[2], qc[3])  # elevation fix (gesture-correct)
            if APPLY_REST_CORRECTION and mmd in REST_CORRECTION:
                # change-of-basis into the tilted A-pose frame (fixes front/back at rest).
                qr = REST_CORRECTION[mmd]
                qc = quat_normalize(quat_mul(quat_mul(qr, qc), _quat_conj(qr)))
            frames.append(BoneFrame(bone=mmd, frame=out_f, rot=qc))
    return frames
