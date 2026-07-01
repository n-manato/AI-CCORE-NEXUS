"""Motion-service: HY-Motion 1.0 text -> MMD .vmd, behind the AICCORE Nexus gateway.

Independent localhost FastAPI process (own venv), bound to 127.0.0.1 like the other
backends (Ollama, model-service). The Next.js gateway proxies /v1/motion/* here and
returns the .vmd to clients; nothing talks to this port directly over the LAN.

Run:
    cd motion-service && ./run.sh           # 127.0.0.1:8801
"""
from __future__ import annotations

import os
import threading

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from hy_motion_runner import HYMotionRunner
from pipeline import generate_motion, motion_to_vmd, motion_to_smpl_json
from pool import MotionPool
from prompts import EMOTIONS, prompt_for, DEFAULT_DURATION

app = FastAPI(title="HY-Motion service")

_runner = HYMotionRunner()
_pool = MotionPool(_runner)


def _warmup() -> None:
    try:
        _runner.load()
        _pool.start()  # persistent background maintainer keeps every emotion warm
    except Exception as e:  # noqa: BLE001
        print(f"[motion] warmup failed: {e}")


_PIDFILE = os.path.join(os.path.dirname(__file__), ".motion.pid")


@app.on_event("startup")
def _startup() -> None:
    # Own the pidfile so the gateway worker can reliably stop us (UI disable),
    # regardless of who launched the process. os.getpid() == the process-group
    # leader (run.sh exec'd uvicorn), so kill(-pid) tears down the whole group.
    try:
        with open(_PIDFILE, "w") as fh:
            fh.write(str(os.getpid()))
    except OSError:
        pass
    # Load the model + build the warm pool off the event loop so the port comes up fast.
    threading.Thread(target=_warmup, daemon=True).start()


@app.on_event("shutdown")
def _shutdown() -> None:
    try:
        os.remove(_PIDFILE)
    except OSError:
        pass


class GenerateBody(BaseModel):
    prompt: str | None = None
    emotion: str | None = None
    duration: float = DEFAULT_DURATION
    seed: int = 1


def _vmd_response(vmd: bytes, name: str = "motion.vmd") -> Response:
    return Response(
        content=vmd,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/healthz")
def healthz():
    gpu = _runner.gpu_info()
    return {
        "ok": True,
        "capabilities": {"motion": True},
        "loaded": {"hy_motion": _runner.ready},
        "stub": _runner.stub,
        "cuda": gpu["cuda"],
        "gpu": gpu["device"],
        "emotions": EMOTIONS,
        "pool": _pool.counts(),
    }


@app.post("/generate")
def generate(body: GenerateBody, format: str = "vmd"):
    prompt = body.prompt or (prompt_for(body.emotion) if body.emotion else prompt_for("neutral"))
    try:
        motion = generate_motion(_runner, prompt, body.duration, body.seed)
        if format == "smpl":
            return JSONResponse(motion_to_smpl_json(motion))  # raw SMPL for PC-A retarget
        return _vmd_response(motion_to_vmd(motion))
    except NotImplementedError as e:
        return JSONResponse({"error": str(e)}, status_code=501)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/pool/{emotion}")
def pool_next(emotion: str, format: str = "vmd"):
    if emotion not in EMOTIONS:
        return JSONResponse({"error": f"unknown emotion {emotion}"}, status_code=404)
    motion = _pool.next(emotion)
    if motion is None:
        # Pool not yet warm -> 503 so PC-A falls back to its idle animation.
        return JSONResponse({"error": "pool empty"}, status_code=503)
    if format == "smpl":
        return JSONResponse(motion_to_smpl_json(motion))
    return _vmd_response(motion_to_vmd(motion), name=f"{emotion}.vmd")


@app.get("/pool")
def pool_counts():
    return {"depth": _pool.counts()}
