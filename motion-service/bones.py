"""MMD bone names (Japanese) and the SMPL -> MMD joint mapping.

VMD stores bone names as CP932 (Shift-JIS) byte strings, max 15 bytes. The names
below MUST match the target .pmx exactly (YYB Hatsune Miku uses the de-facto
standard MMD bone names) or the tracks are silently dropped by MMD.

SMPL has 24 body joints; their *local* axis-angle rotations are remapped onto the
MMD bone skeleton. Hands/fingers and face are intentionally NOT mapped (SMPL body
is poor there; PC-A owns the face/lip-sync).
"""
from __future__ import annotations

# --- Standard SMPL 24-joint order (body model output) ---
SMPL_JOINT_NAMES = [
    "pelvis",        # 0
    "left_hip",      # 1
    "right_hip",     # 2
    "spine1",        # 3
    "left_knee",     # 4
    "right_knee",    # 5
    "spine2",        # 6
    "left_ankle",    # 7
    "right_ankle",   # 8
    "spine3",        # 9
    "left_foot",     # 10
    "right_foot",    # 11
    "neck",          # 12
    "left_collar",   # 13
    "right_collar",  # 14
    "head",          # 15
    "left_shoulder", # 16
    "right_shoulder",# 17
    "left_elbow",    # 18
    "right_elbow",   # 19
    "left_wrist",    # 20
    "right_wrist",   # 21
    "left_hand",     # 22
    "right_hand",    # 23
]
SMPL_JOINT_INDEX = {name: i for i, name in enumerate(SMPL_JOINT_NAMES)}

# --- MMD standard bone names (the de-facto names used by YYB Miku etc.) ---
CENTER = "センター"
LOWER_BODY = "下半身"
UPPER_BODY = "上半身"
UPPER_BODY2 = "上半身2"
NECK = "首"
HEAD = "頭"

# Per-side: shoulder(肩) / arm(腕=upper arm) / elbow(ひじ) / wrist(手首)
# leg: 足(thigh) / ひざ(knee) / 足首(ankle)
def _lr(base_l: str, base_r: str):
    return {"left": base_l, "right": base_r}

SHOULDER = _lr("左肩", "右肩")
ARM = _lr("左腕", "右腕")
ELBOW = _lr("左ひじ", "右ひじ")
WRIST = _lr("左手首", "右手首")
LEG = _lr("左足", "右足")
KNEE = _lr("左ひざ", "右ひざ")
ANKLE = _lr("左足首", "右足首")

# SMPL joint name -> MMD bone name. Rotation-only mapping.
#  - pelvis rotation -> センター (whole-body facing); its translation is discarded.
#  - spine1 -> 上半身, spine2 -> 上半身2 (spine3 is folded in / ignored).
#  - collars -> 肩, shoulders -> 腕, elbows -> ひじ, wrists -> 手首.
SMPL_TO_MMD: dict[str, str] = {
    "pelvis": CENTER,
    "spine1": UPPER_BODY,
    "spine2": UPPER_BODY2,
    "neck": NECK,
    "head": HEAD,
    "left_collar": SHOULDER["left"],
    "right_collar": SHOULDER["right"],
    "left_shoulder": ARM["left"],
    "right_shoulder": ARM["right"],
    "left_elbow": ELBOW["left"],
    "right_elbow": ELBOW["right"],
    "left_wrist": WRIST["left"],
    "right_wrist": WRIST["right"],
    "left_hip": LEG["left"],
    "right_hip": LEG["right"],
    "left_knee": KNEE["left"],
    "right_knee": KNEE["right"],
    "left_ankle": ANKLE["left"],
    "right_ankle": ANKLE["right"],
}

# All MMD bone names we may emit (handy for validation against a .pmx bone list).
ALL_MMD_BONES = sorted(set(SMPL_TO_MMD.values()) | {LOWER_BODY})


def encode_bone_name(name: str) -> bytes:
    """Encode an MMD bone name to a 15-byte CP932 (Shift-JIS), null-padded field."""
    raw = name.encode("cp932", errors="replace")[:15]
    return raw + b"\x00" * (15 - len(raw))
