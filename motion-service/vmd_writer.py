"""Minimal MMD .vmd (Vocaloid Motion Data 0002) writer.

Writes bone keyframes only (no morph/camera/light). Layout per the well-known VMD
spec used by Nuthouse01/PMX-VMD-Scripting-Tools:

  header:  30-byte signature "Vocaloid Motion Data 0002" (null-padded)
           20-byte model name (CP932, null-padded)
  uint32   bone keyframe count
  per key (111 bytes):
           15  bone name (CP932, null-padded)
            4  frame number (uint32, little-endian)
           12  position x,y,z (3x float32)   -- 0 for rotation-only bones
           16  rotation quaternion x,y,z,w (4x float32)
           64  interpolation curve bytes (linear default)
  uint32   morph count (0)
  uint32   camera count (0)
  uint32   light count (0)
  uint32   self-shadow count (0)
  uint32   ik/show count (0)

Quaternions are stored as (x, y, z, w).
"""
from __future__ import annotations

import math
import struct
from dataclasses import dataclass, field

from bones import encode_bone_name

_SIGNATURE = b"Vocaloid Motion Data 0002"

# Canonical MMD "linear" interpolation curve (64 bytes). 0x14=20, 0x6B=107.
DEFAULT_INTERP = bytes([
    20, 20,  0,  0,  20, 20, 20, 20, 107,107,107,107, 107,107,107,107,
    20, 20, 20, 20,  20, 20,107,107, 107,107,107,107, 107,107,107,  0,
    20, 20, 20, 20, 107,107,107,107, 107,107,107,107, 107,107,  0,  0,
    20, 20,107,107, 107,107,107,107, 107,107,107,  0,   0,  0,  0,  0,
])
assert len(DEFAULT_INTERP) == 64


@dataclass
class BoneFrame:
    bone: str                       # MMD bone name (Japanese)
    frame: int                      # frame number (30 fps)
    rot: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)  # x,y,z,w
    pos: tuple[float, float, float] = (0.0, 0.0, 0.0)


def write_vmd(frames: list[BoneFrame], model_name: str = "HY-Motion") -> bytes:
    out = bytearray()
    out += _SIGNATURE + b"\x00" * (30 - len(_SIGNATURE))
    name = model_name.encode("cp932", errors="replace")[:20]
    out += name + b"\x00" * (20 - len(name))

    out += struct.pack("<I", len(frames))
    for f in frames:
        out += encode_bone_name(f.bone)
        out += struct.pack("<I", int(f.frame))
        out += struct.pack("<3f", *f.pos)
        out += struct.pack("<4f", *f.rot)
        out += DEFAULT_INTERP

    # morph / camera / light / self-shadow / ik-show counts (all zero)
    out += struct.pack("<I", 0)  # morphs
    out += struct.pack("<I", 0)  # cameras
    out += struct.pack("<I", 0)  # lights
    out += struct.pack("<I", 0)  # self shadow
    out += struct.pack("<I", 0)  # ik/show
    return bytes(out)


# ---- small quaternion helpers (x,y,z,w), no scipy dependency ----

def quat_from_axis_angle(axis: tuple[float, float, float], angle_rad: float):
    x, y, z = axis
    n = math.sqrt(x * x + y * y + z * z)
    if n < 1e-9:
        return (0.0, 0.0, 0.0, 1.0)
    s = math.sin(angle_rad / 2.0) / n
    return (x * s, y * s, z * s, math.cos(angle_rad / 2.0))


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def quat_normalize(q):
    x, y, z, w = q
    n = math.sqrt(x * x + y * y + z * z + w * w)
    if n < 1e-9:
        return (0.0, 0.0, 0.0, 1.0)
    return (x / n, y / n, z / n, w / n)
