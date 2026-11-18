"""TRELLIS.2 service: single image -> textured GLB, behind the AICCORE-Nexus gateway.

Independent localhost FastAPI process (own conda env `trellis2`), bound to
127.0.0.1 like the other backends (Ollama, model-service, motion-service). The
Next.js gateway proxies POST /v1/3d/generations here and returns the .glb to
clients; nothing talks to this port directly over the LAN. NOT served via Ollama.

Run:
    cd trellis-service && ./run.sh          # 127.0.0.1:8803
"""
from __future__ import annotations

import os
import threading

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

from trellis_runner import TrellisRunner, ALLOWED_RESOLUTIONS, DEFAULT_RESOLUTION

app = FastAPI(title="TRELLIS.2 service")

_runner = TrellisRunner()

_PIDFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".trellis.pid")


def _warmup() -> None:
    try:
        _runner.load()
    except Exception as e:  # noqa: BLE001
        print(f"[trellis] warmup failed: {e}", flush=True)


@app.on_event("startup")
def _startup() -> None:
    # Own the pidfile so the gateway worker can reliably stop us (UI disable),
    # regardless of who launched the process. os.getpid() == the process-group
    # leader (run.sh exec'd python), so kill(-pid) tears down the whole group.
    try:
        with open(_PIDFILE, "w") as fh:
            fh.write(str(os.getpid()))
    except OSError:
        pass
    # Load the model off the event loop so the port comes up fast (weights are big).
    threading.Thread(target=_warmup, daemon=True).start()


@app.on_event("shutdown")
def _shutdown() -> None:
    try:
        os.remove(_PIDFILE)
    except OSError:
        pass


def _glb_response(glb: bytes, name: str = "trellis.glb") -> Response:
    return Response(
        content=glb,
        media_type="model/gltf-binary",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/healthz")
def healthz():
    gpu = _runner.gpu_info()
    return {
        "ok": True,
        "capabilities": {"image_to_3d": True},
        "loaded": {"trellis2": _runner.ready},
        "stub": _runner.stub,
        "pinned": _runner.pinned,  # True = resident in VRAM (Always Running)
        "cuda": gpu["cuda"],
        "gpu": gpu["device"],
        "model": _runner.model_id,
        "resolutions": ALLOWED_RESOLUTIONS,
        "default_resolution": DEFAULT_RESOLUTION,
    }


@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    resolution: str = Form(DEFAULT_RESOLUTION),
    seed: int = Form(42),
    decimation_target: int = Form(1_000_000),
    texture_size: int = Form(2048),
    # 0 = keep the checkpoint's own sampler settings (steps=12). Raise for a
    # quality-first run; the cost is time, not VRAM.
    steps: int = Form(0),
    guidance_strength: float = Form(0.0),
):
    try:
        data = await image.read()
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"could not read image: {e}"}, status_code=400)
    if not data:
        return JSONResponse({"error": "empty image"}, status_code=400)
    try:
        glb = _runner.generate(
            data,
            resolution=resolution,
            seed=seed,
            decimation_target=decimation_target,
            texture_size=texture_size,
            steps=steps,
            guidance_strength=guidance_strength,
        )
        return _glb_response(glb)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except NotImplementedError as e:
        return JSONResponse({"error": str(e)}, status_code=501)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("TRELLIS_PORT", "8811"))
    uvicorn.run(app, host="127.0.0.1", port=port)
