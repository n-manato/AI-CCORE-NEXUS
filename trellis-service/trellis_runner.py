"""TRELLIS.2 image-to-3D runner (single image -> textured GLB).

Wraps Trellis2ImageTo3DPipeline behind a tiny load()/generate() surface so the
FastAPI layer stays dumb. Mirrors motion-service/hy_motion_runner.py:

  - Heavy weights load lazily off the event loop (server calls load() in a thread).
  - If the `trellis2` package / weights are not installed yet, the runner comes up
    in STUB mode: /healthz answers, but generate() raises NotImplementedError so the
    gateway returns 501 instead of the port being dead. Install then restart.

Only ONE GPU is used (the gateway pins trellis-2 to a single 24GB card). Resolution
defaults to 512 so the render/GLB-extraction peak stays under 24GB on an RTX 3090;
1024/1536 are available for the 2nd (larger) card when the admin raises the cap.

Env:
  TRELLIS_REPO   path to the cloned microsoft/TRELLIS.2 checkout (added to sys.path).
                 Defaults to <this dir>/TRELLIS.2 (where install_trellis.sh clones it).
  TRELLIS_MODEL  HF repo id for the weights (default microsoft/TRELLIS.2-4B).
  TRELLIS_DEVICE CUDA device (default cuda; e.g. cuda:1 to pin the larger card).
"""
from __future__ import annotations

import io
import os
import sys
import tempfile
import threading

# The canonical resolution knob. app.py maps the UI radio to pipeline_type; we do
# the same. "512" is the single-stage (lowest VRAM) path; the others cascade.
PIPELINE_TYPE = {
    "512": "512",
    "1024": "1024_cascade",
    "1536": "1536_cascade",
}
DEFAULT_RESOLUTION = os.environ.get("TRELLIS_RESOLUTION", "512")

# Cap the OFFERED resolution to what the GPU can actually finish. On a 24GB card
# 1536 OOMs during CuMesh remeshing, and that failed CUDA op poisons the process
# (the very next request also errors) — so a request we can't complete is worse
# than one we refuse. Default max 1024; a >24GB card can re-enable 1536 with
# TRELLIS_MAX_RESOLUTION=1536.
_MAX_RESOLUTION = int(os.environ.get("TRELLIS_MAX_RESOLUTION", "1024"))
ALLOWED_RESOLUTIONS = [r for r in PIPELINE_TYPE if int(r) <= _MAX_RESOLUTION]


def _sampler_overrides(steps: int, guidance_strength: float) -> dict:
    """Per-request sampler overrides for pipeline.run().

    The shipped pipeline.json pins steps=12 on all three samplers — tuned for
    throughput. Quality-first callers (Genesis3D's face track) would rather
    trade time for detail. 0 means "leave the checkpoint default alone", so an
    omitted field reproduces the previous behaviour byte for byte.
    """
    if steps <= 0 and guidance_strength <= 0:
        return {}
    params: dict = {}
    if steps > 0:
        params["steps"] = int(steps)
    if guidance_strength > 0:
        params["guidance_strength"] = float(guidance_strength)
    return {
        key: dict(params)
        for key in ("sparse_structure_sampler_params",
                    "shape_slat_sampler_params",
                    "tex_slat_sampler_params")
    }


# nvdiffrast index limit used verbatim by the official example.
_SIMPLIFY_LIMIT = 16777216
_AABB = [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]]


def _repo_dir() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.environ.get("TRELLIS_REPO", os.path.join(here, "TRELLIS.2"))


class TrellisRunner:
    def __init__(self) -> None:
        self.pipeline = None
        self.ready = False
        self.stub = True  # flips to False once the real pipeline loads
        self._lock = threading.Lock()  # serialize generation on the single GPU
        self._load_lock = threading.Lock()  # one loader at a time
        self.model_id = os.environ.get("TRELLIS_MODEL", "microsoft/TRELLIS.2-4B")
        self.device = os.environ.get("TRELLIS_DEVICE", "cuda")
        # TRELLIS_PIN_VRAM=1 -> keep the whole pipeline resident on the GPU
        # (low_vram=False). The gateway sets this for the "Always Running" policy;
        # "On Demand" leaves it 0 so the pipeline offloads each stage to CPU RAM
        # between uses (near-zero idle VRAM).
        self.pin_vram = os.environ.get("TRELLIS_PIN_VRAM", "0") == "1"
        self.pinned = False  # actual residency after load (mirrors pin_vram)

    # ---- lifecycle ----------------------------------------------------------
    def load(self) -> None:
        """Import trellis2 + load the pipeline onto the GPU. Idempotent + threadsafe:
        the startup warmup thread and the first /generate can both call this."""
        if self.ready:
            return
        with self._load_lock:
            if self.ready:
                return
            self._load()

    def _load(self) -> None:
        # Prefer expandable segments (the official example sets this) to fit 24GB.
        os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")

        repo = _repo_dir()
        if os.path.isdir(repo) and repo not in sys.path:
            sys.path.insert(0, repo)

        try:
            from trellis2.pipelines import Trellis2ImageTo3DPipeline  # type: ignore
            import o_voxel  # noqa: F401  # type: ignore

            pipeline = Trellis2ImageTo3DPipeline.from_pretrained(self.model_id)
            if self.pin_vram:
                # Always Running: pin every component on the GPU (no per-stage CPU
                # offload). ~16GB persistent VRAM; skips the CPU<->GPU copy each
                # request. On a 24GB card keep resolution=512 (peak can be tight).
                pipeline.low_vram = False
                pipeline.cuda()  # overridden to(): low_vram=False moves ALL models to GPU
            else:
                # On Demand: default low_vram=True -> weights live in CPU RAM and
                # each stage is moved to the GPU only while it runs (near-zero idle VRAM).
                pipeline.cuda()
            self.pipeline = pipeline
            self.pinned = bool(self.pin_vram)
            self.ready = True
            self.stub = False
            print(f"[trellis] loaded {self.model_id} on {self.device} (pin_vram={self.pin_vram})", flush=True)
        except Exception as e:  # noqa: BLE001
            # Stay up in stub mode so /healthz works and the gateway shows the model.
            self.stub = True
            self.ready = False
            print(f"[trellis] stub mode (pipeline not available): {e}", flush=True)

    def gpu_info(self) -> dict:
        try:
            import torch  # type: ignore

            cuda = bool(torch.cuda.is_available())
            device = torch.cuda.get_device_name(0) if cuda else None
            return {"cuda": cuda, "device": device}
        except Exception:  # noqa: BLE001
            return {"cuda": False, "device": None}

    # ---- inference ----------------------------------------------------------
    def generate(
        self,
        image_bytes: bytes,
        resolution: str = DEFAULT_RESOLUTION,
        seed: int = 42,
        decimation_target: int = 1_000_000,
        texture_size: int = 2048,
        steps: int = 0,
        guidance_strength: float = 0.0,
    ) -> bytes:
        """Single image -> GLB bytes. Raises NotImplementedError in stub mode."""
        if resolution not in PIPELINE_TYPE:
            raise ValueError(f"resolution must be one of {list(PIPELINE_TYPE)}")
        # Refuse — before touching CUDA — any resolution this GPU can't finish, so a
        # doomed request can never OOM mid-run and poison the process.
        if resolution not in ALLOWED_RESOLUTIONS:
            raise ValueError(
                f"resolution {resolution} is not enabled on this deployment "
                f"(max {_MAX_RESOLUTION}: higher OOMs on a 24GB GPU). "
                f"Allowed: {ALLOWED_RESOLUTIONS}."
            )
        # A request arriving during warmup (or before the first load) blocks here
        # until the pipeline is ready, instead of failing fast.
        if not self.ready:
            self.load()
        if not self.ready or self.pipeline is None:
            raise NotImplementedError(
                "TRELLIS.2 weights are not installed. Run trellis-service/install_trellis.sh."
            )

        from PIL import Image  # local import: not needed in stub mode
        import o_voxel  # type: ignore

        image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")

        # One request at a time: the pipeline + GLB extraction own the whole GPU.
        with self._lock:
            try:
                mesh = self.pipeline.run(
                    image,
                    seed=seed,
                    preprocess_image=True,
                    pipeline_type=PIPELINE_TYPE[resolution],
                    **_sampler_overrides(steps, guidance_strength),
                )[0]
                mesh.simplify(_SIMPLIFY_LIMIT)  # nvdiffrast limit
                glb = o_voxel.postprocess.to_glb(
                    vertices=mesh.vertices,
                    faces=mesh.faces,
                    attr_volume=mesh.attrs,
                    coords=mesh.coords,
                    attr_layout=getattr(mesh, "layout", None) or self.pipeline.pbr_attr_layout,
                    voxel_size=mesh.voxel_size,
                    aabb=_AABB,
                    decimation_target=decimation_target,
                    texture_size=texture_size,
                    remesh=True,
                    remesh_band=1,
                    remesh_project=0,
                )
                # o_voxel exports via trimesh/pygltflib to a path; round-trip through a
                # temp file to get bytes back for the HTTP response.
                with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as fh:
                    tmp = fh.name
                try:
                    glb.export(tmp, extension_webp=True)
                    with open(tmp, "rb") as f:
                        data = f.read()
                finally:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
            finally:
                # Always reclaim GPU memory — including after a mid-run failure such
                # as an OOM at high resolution. Without this, a failed request leaves
                # ~20GB of allocator-reserved VRAM stranded, which starves the next
                # request (and, in offload mode, breaks the near-zero idle invariant).
                # gc.collect() first so dropped tensors are freed before empty_cache().
                try:
                    import gc
                    import torch  # type: ignore

                    gc.collect()
                    torch.cuda.empty_cache()
                except Exception:  # noqa: BLE001
                    pass

        return data
