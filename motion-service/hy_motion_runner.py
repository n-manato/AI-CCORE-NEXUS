"""HY-Motion runner: resident model load + text -> motion generation.

Two modes:
  * STUB (default until HY-Motion 1.0 is installed): returns a clean, hand-authored
    MMD "wave" so the whole gateway -> .vmd -> Miku pipeline can be validated end to
    end WITHOUT the heavy model. Marked `format="mmd_frames"`.
  * REAL (Phase 0+): loads Tencent HY-Motion 1.0 ONCE onto the pinned GPU and returns
    SMPL motion `format="smpl"` -> retargeted by smpl_to_mmd.

The model is loaded a single time and kept resident (no per-request load). One
runner == one GPU worker (CUDA_VISIBLE_DEVICES set by run.sh).
"""
from __future__ import annotations

import math
import os
import threading

from vmd_writer import BoneFrame, quat_from_axis_angle
from bones import ARM, ELBOW, UPPER_BODY, CENTER

TARGET_FPS = 30


class HYMotionRunner:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._model = None
        self.joint_names: list[str] = []
        self.home = os.environ.get("HY_MOTION_HOME", "")
        self.smpl_dir = os.environ.get("SMPL_MODELS_DIR", "")
        # Stay in stub mode until the real model is explicitly wired (HYM_REAL=1)
        # AND its repo is present. Cloning the repo alone must NOT flip to real,
        # since _load_real/_generate_real are not implemented yet (Phase 0).
        self.stub = os.environ.get("HYM_REAL", "0") != "1" or not (self.home and os.path.isdir(self.home))

    # ---- lifecycle ----
    def load(self) -> None:
        """Load the model once (resident). No-op in stub mode."""
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            if not self.stub:
                self._load_real()
            self._loaded = True

    def _load_real(self) -> None:
        # Build Tencent HY-Motion 1.0 once on cuda:0 (= the GPU pinned via
        # CUDA_VISIBLE_DEVICES in run.sh). The text encoders (Qwen3-8B + CLIP) are
        # read from <home>/ckpts via relative paths, so we run with cwd=home.
        import sys
        os.environ.setdefault("USE_HF_MODELS", "0")  # load encoders from local ckpts/
        if self.home not in sys.path:
            sys.path.insert(0, self.home)
        os.chdir(self.home)
        from hymotion.utils.t2m_runtime import T2MRuntime

        model_dir = os.path.join(self.home, "ckpts", "tencent", "HY-Motion-1.0")
        cfg = os.path.join(model_dir, "config.yml")
        # load_in_demo does os.path.exists(ckpt_name) relative to cwd, so pass the
        # ABSOLUTE path or the real DiT weights are silently skipped (random init).
        ckpt = os.path.join(model_dir, "latest.ckpt")
        self._model = T2MRuntime(
            config_path=cfg,
            ckpt_name=ckpt,
            device_ids=[0],                 # cuda:0 under CUDA_VISIBLE_DEVICES (freed GPU)
            disable_prompt_engineering=True,  # we supply our own prompt + duration
        )
        # 52 SMPL-H joint names (first 22 = body, in SMPL order) for the raw output.
        import json
        jn = os.path.join(self.home, "scripts", "gradio", "static", "assets", "dump_wooden", "joint_names.json")
        try:
            with open(jn) as fh:
                self.joint_names = json.load(fh)
        except Exception:  # noqa: BLE001
            self.joint_names = []

    @property
    def ready(self) -> bool:
        return self._loaded

    def gpu_info(self) -> dict:
        try:
            import torch  # type: ignore
            if torch.cuda.is_available():
                return {"cuda": True, "device": torch.cuda.get_device_name(0)}
        except Exception:
            pass
        return {"cuda": False, "device": None}

    # ---- generation ----
    def generate(self, prompt: str, duration: float = 4.0, seed: int = 1) -> dict:
        """Generate one clip. Returns a motion dict consumed by server.py."""
        self.load()
        duration = max(0.5, min(5.0, float(duration)))
        if self.stub:
            return {"format": "mmd_frames", "frames": _stub_wave(duration)}
        return self._generate_real(prompt, duration, seed)

    def _generate_real(self, prompt: str, duration: float, seed: int) -> dict:
        import tempfile
        import numpy as np
        from hymotion.pipeline.body_model import construct_smpl_data_dict

        out_dir = tempfile.mkdtemp(prefix="hym_")
        # output_format="dict" -> no FBX SDK needed; returns the raw model output.
        _html, _fbx, model_output = self._model.generate_motion(
            text=prompt,
            seeds_csv=str(int(seed)),
            duration=float(duration),
            cfg_scale=5.0,
            output_format="dict",
            output_dir=out_dir,
            output_filename="clip",
        )
        # model_output keys: rot6d [B,T,J,6], transl [B,T,3], keypoints3d [B,T,J,3]
        # (world joint coords, floor-aligned). Take the first seed.
        smpl = construct_smpl_data_dict(model_output["rot6d"][0].clone(), model_output["transl"][0].clone())
        poses = np.asarray(smpl["poses"])  # [T, 52*3] axis-angle, pelvis at index 0
        trans = np.asarray(smpl["trans"])  # [T, 3]
        joints = np.asarray(model_output["keypoints3d"][0])  # [T, J, 3] world coords
        T = int(poses.shape[0])
        fps = T / float(duration) if duration > 0 else float(smpl.get("mocap_framerate", 30))
        return {"format": "smpl", "poses": poses, "trans": trans, "fps": fps,
                "joints": joints, "joint_names": self.joint_names,
                "mocap_frame_rate": int(smpl.get("mocap_framerate", 30))}


def _stub_wave(duration: float) -> list[BoneFrame]:
    """Hand-authored 'wave hello': raise the right arm, oscillate the elbow, gentle
    upper-body sway + center bob. Guaranteed-valid placeholder motion."""
    n = max(2, int(round(duration * TARGET_FPS)))
    frames: list[BoneFrame] = []
    for f in range(n):
        t = f / TARGET_FPS
        ease = min(1.0, t / 0.5)  # raise over first 0.5 s

        # 右腕: raise (rotate about Z)
        raise_a = -1.3 * ease
        frames.append(BoneFrame(ARM["right"], f, rot=quat_from_axis_angle((0, 0, 1), raise_a)))
        # 右ひじ: wave (oscillate about Y ~2 Hz)
        wave_a = 0.5 * ease * math.sin(2 * math.pi * 2.0 * t)
        frames.append(BoneFrame(ELBOW["right"], f, rot=quat_from_axis_angle((0, 1, 0), wave_a)))
        # 上半身: subtle sway about Z
        sway = 0.05 * math.sin(2 * math.pi * 0.5 * t)
        frames.append(BoneFrame(UPPER_BODY, f, rot=quat_from_axis_angle((0, 0, 1), sway)))
        # センター: small vertical bob (position only)
        bob = 0.3 * math.sin(2 * math.pi * 1.0 * t)
        frames.append(BoneFrame(CENTER, f, pos=(0.0, bob, 0.0)))
    return frames
