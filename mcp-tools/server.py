"""Nexus Tools - an MCP (Model Context Protocol) stdio server.

Exposes a set of CPU/Network tools so an MCP client (e.g. Cline) can let the
model call them: filesystem, shell/build/lint, web/image search (key-free via
DuckDuckGo), URL fetch, image download, and webpage screenshots (Playwright).

Run (stdio): python server.py   (configured as an MCP server in the client)

Notes:
- Tool docstrings are sent to the model as descriptions, so they are kept short.
- Optional deps (ddgs, playwright) degrade gracefully: the tool returns a clear
  message telling you how to enable it instead of crashing the server.
- Output is size-capped to avoid blowing the model's context window.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

mcp = FastMCP("nexus-tools")
# The SSE endpoint is reached over the tailnet by Cline (not a browser), so the
# default localhost-only DNS-rebinding host check would 421 tailnet requests.
# Disable it; the real boundary is the bind address + the trusted tailnet.
mcp.settings.transport_security = TransportSecuritySettings(enable_dns_rebinding_protection=False)

MAX_OUT = 12000  # cap tool text output (chars) to protect the context window


def _cap(text: str, limit: int = MAX_OUT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...[truncated {len(text) - limit} chars]"


# ---------------- filesystem ----------------
def list_files(path: str = ".", recursive: bool = False) -> str:
    """List files/dirs under a path. Set recursive=true to walk subdirectories."""
    root = Path(path).expanduser()
    if not root.exists():
        return f"error: path not found: {path}"
    out = []
    if recursive:
        for p in sorted(root.rglob("*")):
            if any(part in {".git", "node_modules", ".next", ".venv", "__pycache__"} for part in p.parts):
                continue
            out.append(("d " if p.is_dir() else "f ") + str(p))
    else:
        for p in sorted(root.iterdir()):
            out.append(("d " if p.is_dir() else "f ") + str(p))
    return _cap("\n".join(out) or "(empty)")


def read_file(path: str, max_chars: int = MAX_OUT) -> str:
    """Read a text file's contents."""
    p = Path(path).expanduser()
    if not p.is_file():
        return f"error: not a file: {path}"
    try:
        return _cap(p.read_text(encoding="utf-8", errors="replace"), max_chars)
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def write_file(path: str, content: str) -> str:
    """Create or overwrite a file with the given text content."""
    p = Path(path).expanduser()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"wrote {len(content)} chars to {p}"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def patch_file(path: str, search: str, replace: str) -> str:
    """Replace the first exact occurrence of `search` with `replace` in a file."""
    p = Path(path).expanduser()
    if not p.is_file():
        return f"error: not a file: {path}"
    try:
        text = p.read_text(encoding="utf-8")
        if search not in text:
            return "error: `search` text not found (must match exactly)"
        p.write_text(text.replace(search, replace, 1), encoding="utf-8")
        return f"patched {p}"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


# ---------------- shell ----------------
def _run(command: str, cwd: str, timeout: int) -> str:
    try:
        r = subprocess.run(
            command, shell=True, cwd=os.path.expanduser(cwd), capture_output=True,
            text=True, timeout=timeout,
        )
        return _cap(f"exit={r.returncode}\n--- stdout ---\n{r.stdout}\n--- stderr ---\n{r.stderr}")
    except subprocess.TimeoutExpired:
        return f"error: command timed out after {timeout}s"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def run_command(command: str, cwd: str = ".", timeout: int = 120) -> str:
    """Run a shell command and return exit code, stdout and stderr."""
    return _run(command, cwd, timeout)


def run_build(cwd: str = ".", command: str = "npm run build", timeout: int = 600) -> str:
    """Run the project build (default `npm run build`). Override `command` as needed."""
    return _run(command, cwd, timeout)


def run_lint(cwd: str = ".", command: str = "npm run lint", timeout: int = 300) -> str:
    """Run the project linter (default `npm run lint`). Override `command` as needed."""
    return _run(command, cwd, timeout)


# ---------------- network ----------------
def _ddgs():
    try:
        from ddgs import DDGS  # newer package name
        return DDGS
    except Exception:
        try:
            from duckduckgo_search import DDGS  # older package name
            return DDGS
        except Exception:
            return None


def web_search(query: str, max_results: int = 5) -> str:
    """Web search (key-free, DuckDuckGo). Returns title/url/snippet as JSON."""
    DDGS = _ddgs()
    if DDGS is None:
        return "error: search backend not installed (pip install ddgs)"
    try:
        with DDGS() as d:
            res = list(d.text(query, max_results=max_results))
        items = [{"title": r.get("title"), "url": r.get("href") or r.get("url"), "snippet": r.get("body")} for r in res]
        return _cap(json.dumps(items, ensure_ascii=False, indent=2))
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def image_search(query: str, max_results: int = 5) -> str:
    """Image search (key-free, DuckDuckGo). Returns image URLs + thumbnails as JSON."""
    DDGS = _ddgs()
    if DDGS is None:
        return "error: search backend not installed (pip install ddgs)"
    try:
        with DDGS() as d:
            res = list(d.images(query, max_results=max_results))
        items = [{"title": r.get("title"), "image": r.get("image"), "thumbnail": r.get("thumbnail"), "url": r.get("url")} for r in res]
        return _cap(json.dumps(items, ensure_ascii=False, indent=2))
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def fetch_url(url: str, max_chars: int = MAX_OUT) -> str:
    """HTTP GET a URL and return the response body text (capped)."""
    try:
        import httpx
        r = httpx.get(url, follow_redirects=True, timeout=30, headers={"User-Agent": "nexus-tools/1.0"})
        return _cap(f"status={r.status_code} content-type={r.headers.get('content-type','')}\n\n{r.text}", max_chars)
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def download_image(url: str, path: str) -> str:
    """Download a file/image from a URL to a local path."""
    try:
        import httpx
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        with httpx.stream("GET", url, follow_redirects=True, timeout=60, headers={"User-Agent": "nexus-tools/1.0"}) as r:
            r.raise_for_status()
            with open(p, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        return f"downloaded {p.stat().st_size} bytes to {p}"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def get_screenshot(url: str, path: str = "screenshot.png", full_page: bool = True) -> str:
    """Screenshot a webpage to a PNG file (headless Chromium via Playwright)."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return "error: playwright not installed. Run: pip install playwright && playwright install chromium"
    try:
        p = Path(path).expanduser()
        p.parent.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
            page = browser.new_page()
            page.goto(url, wait_until="networkidle", timeout=45000)
            page.screenshot(path=str(p), full_page=full_page)
            browser.close()
        return f"screenshot saved to {p}"
    except Exception as e:  # noqa: BLE001
        return f"error: {e} (if chromium missing: playwright install chromium)"


# ---------------- project understanding ----------------
_SKIP = {".git", "node_modules", ".next", ".venv", "__pycache__", "dist", "build", ".turbo"}


def search_files(query: str, path: str = ".", max_results: int = 100) -> str:
    """Find files whose name/path contains `query` (case-insensitive)."""
    root = Path(path).expanduser()
    q = query.lower()
    out = []
    for p in root.rglob("*"):
        if any(x in _SKIP for x in p.parts):
            continue
        if p.is_file() and q in str(p).lower():
            out.append(str(p))
            if len(out) >= max_results:
                break
    return _cap("\n".join(out) or "(no matches)")


def grep_code(pattern: str, path: str = ".", glob: str = "", max_results: int = 200) -> str:
    """Regex-search file CONTENTS. Returns `file:line: text`. Optional glob like *.ts."""
    import re
    import fnmatch
    try:
        rx = re.compile(pattern)
    except re.error as e:
        return f"error: bad regex: {e}"
    root = Path(path).expanduser()
    out = []
    for p in root.rglob("*"):
        if any(x in _SKIP for x in p.parts) or not p.is_file():
            continue
        if glob and not fnmatch.fnmatch(p.name, glob):
            continue
        try:
            for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if rx.search(line):
                    out.append(f"{p}:{i}: {line.strip()[:200]}")
                    if len(out) >= max_results:
                        return _cap("\n".join(out))
        except Exception:  # noqa: BLE001
            continue
    return _cap("\n".join(out) or "(no matches)")


def get_project_tree(path: str = ".", max_depth: int = 3) -> str:
    """ASCII tree of the project (skips node_modules/.git/etc.), depth-limited."""
    root = Path(path).expanduser()
    lines = [str(root)]

    def walk(d: Path, prefix: str, depth: int):
        if depth > max_depth:
            return
        try:
            entries = sorted([e for e in d.iterdir() if e.name not in _SKIP], key=lambda e: (e.is_file(), e.name.lower()))
        except Exception:  # noqa: BLE001
            return
        for i, e in enumerate(entries):
            last = i == len(entries) - 1
            lines.append(f"{prefix}{'└─ ' if last else '├─ '}{e.name}{'/' if e.is_dir() else ''}")
            if e.is_dir():
                walk(e, prefix + ("   " if last else "│  "), depth + 1)

    walk(root, "", 1)
    return _cap("\n".join(lines))


def _pkg(path: str) -> Path | None:
    p = Path(path).expanduser() / "package.json"
    return p if p.is_file() else None


def read_package_json(path: str = ".") -> str:
    """Return the project's package.json contents."""
    p = _pkg(path)
    return _cap(p.read_text(encoding="utf-8", errors="replace")) if p else "error: package.json not found"


def read_package_scripts(path: str = ".") -> str:
    """Return just the npm scripts from package.json as JSON."""
    p = _pkg(path)
    if not p:
        return "error: package.json not found"
    try:
        return _cap(json.dumps(json.loads(p.read_text(encoding="utf-8")).get("scripts", {}), indent=2, ensure_ascii=False))
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def detect_framework(path: str = ".") -> str:
    """Detect the project stack from package.json deps + config files."""
    root = Path(path).expanduser()
    deps = {}
    p = _pkg(path)
    if p:
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            deps = {**d.get("dependencies", {}), **d.get("devDependencies", {})}
        except Exception:  # noqa: BLE001
            pass
    sig = {"next": "Next.js", "react": "React", "vue": "Vue", "svelte": "Svelte", "@angular/core": "Angular",
           "express": "Express", "fastify": "Fastify", "@prisma/client": "Prisma", "prisma": "Prisma",
           "tailwindcss": "Tailwind", "vite": "Vite", "typescript": "TypeScript"}
    hits = [f"{name} ({deps[k]})" for k, name in sig.items() if k in deps]
    for f, name in {"next.config.mjs": "Next.js", "next.config.js": "Next.js", "vite.config.ts": "Vite",
                    "tsconfig.json": "TypeScript", "tailwind.config.ts": "Tailwind", "go.mod": "Go", "Cargo.toml": "Rust",
                    "pyproject.toml": "Python", "requirements.txt": "Python"}.items():
        if (root / f).is_file():
            hits.append(f"{name} (config: {f})")
    return _cap("Detected: " + (", ".join(dict.fromkeys(hits)) if hits else "unknown"))


# ---------------- browser (Playwright, persistent headless session) ----------------
import queue


class _Browser:
    """Owns a headless Chromium in a dedicated thread (sync Playwright is not
    thread-safe across FastMCP's per-call worker threads) and runs commands
    submitted via a queue. Chromium is launched with --disable-gpu (CPU only)."""

    def __init__(self):
        self._cmd: queue.Queue = queue.Queue()
        self._res: queue.Queue = queue.Queue()
        self._started = False

    def _run(self):
        try:
            from playwright.sync_api import sync_playwright
        except Exception as e:  # noqa: BLE001
            self._res.put(f"error: playwright not available: {e}")
            return
        console: list[str] = []
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True, args=["--disable-gpu", "--no-sandbox"])
                page = browser.new_page()
                page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
                page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
                page.on("requestfailed", lambda r: console.append(f"requestfailed: {r.url}"))
                self._res.put("browser ready")
                while True:
                    action, args = self._cmd.get()
                    try:
                        if action == "open":
                            console.clear()
                            page.goto(args["url"], wait_until="networkidle", timeout=45000)
                            self._res.put(f"opened {args['url']} (title: {page.title()})")
                        elif action == "click":
                            page.click(args["selector"], timeout=10000)
                            self._res.put(f"clicked {args['selector']}")
                        elif action == "type":
                            page.fill(args["selector"], args["text"], timeout=10000)
                            self._res.put(f"typed into {args['selector']}")
                        elif action == "errors":
                            self._res.put("\n".join(console[-80:]) or "(no console errors/warnings)")
                        elif action == "close":
                            browser.close()
                            self._started = False
                            self._res.put("closed")
                            return
                    except Exception as e:  # noqa: BLE001
                        self._res.put(f"error: {e}")
        except Exception as e:  # noqa: BLE001
            self._started = False
            self._res.put(f"error: browser launch failed: {e} (system libs may be missing: sudo .venv/bin/python -m playwright install-deps)")

    def cmd(self, action: str, **args) -> str:
        if not self._started:
            threading.Thread(target=self._run, daemon=True).start()
            self._started = True
            ready = self._res.get(timeout=60)
            if ready.startswith("error"):
                self._started = False
                return ready
        self._cmd.put((action, args))
        try:
            return self._res.get(timeout=90)
        except Exception:  # noqa: BLE001
            return "error: browser command timed out"


_browser = _Browser()


def browser_open(url: str) -> str:
    """Open a URL in a persistent headless browser (starts a testing session)."""
    return _browser.cmd("open", url=url)


def browser_click(selector: str) -> str:
    """Click an element (CSS selector) in the open browser page."""
    return _browser.cmd("click", selector=selector)


def browser_type(selector: str, text: str) -> str:
    """Type text into an element (CSS selector) in the open browser page."""
    return _browser.cmd("type", selector=selector, text=text)


def browser_get_console_errors() -> str:
    """Console errors/warnings, page errors and failed requests since browser_open."""
    return _browser.cmd("errors")


def browser_close() -> str:
    """Close the headless browser session."""
    return _browser.cmd("close")


# ---------------- image / asset (Pillow) ----------------
def resize_image(path: str, width: int, height: int, out: str = "") -> str:
    """Resize an image to width x height (to `out`, or overwrite if omitted)."""
    try:
        from PIL import Image
        img = Image.open(Path(path).expanduser()).resize((int(width), int(height)))
        dst = Path(out).expanduser() if out else Path(path).expanduser()
        img.save(dst)
        return f"resized -> {dst} ({width}x{height})"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def convert_image_format(path: str, out_path: str) -> str:
    """Convert an image to another format (by out_path extension, e.g. .webp/.png)."""
    try:
        from PIL import Image
        img = Image.open(Path(path).expanduser())
        dst = Path(out_path).expanduser()
        if dst.suffix.lower() in (".jpg", ".jpeg") and img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(dst)
        return f"converted -> {dst}"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def compress_image(path: str, out: str = "", quality: int = 80) -> str:
    """Re-save an image with compression (quality 1-95)."""
    try:
        from PIL import Image
        img = Image.open(Path(path).expanduser())
        dst = Path(out).expanduser() if out else Path(path).expanduser()
        if dst.suffix.lower() in (".jpg", ".jpeg") and img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(dst, optimize=True, quality=int(quality))
        return f"compressed -> {dst} ({dst.stat().st_size} bytes)"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def create_favicon(path: str, out: str = "favicon.ico") -> str:
    """Create a multi-size favicon.ico from an image."""
    try:
        from PIL import Image
        img = Image.open(Path(path).expanduser()).convert("RGBA")
        dst = Path(out).expanduser()
        img.save(dst, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
        return f"favicon -> {dst}"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


# ---------------- diagnostics ----------------
def run_typecheck(cwd: str = ".", command: str = "npx tsc --noEmit") -> str:
    """Run a TypeScript typecheck (default `npx tsc --noEmit`) and return diagnostics."""
    return _run(command, cwd, 300)


def lsp_get_diagnostics(cwd: str = ".") -> str:
    """Aggregate diagnostics: run tsc --noEmit and the linter, return combined output."""
    tc = _run("npx tsc --noEmit", cwd, 300)
    lint = _run("npm run lint --silent", cwd, 300)
    return _cap(f"=== typecheck (tsc) ===\n{tc}\n\n=== lint ===\n{lint}")


# Tool registration. The REMOTE (SSE) endpoint defaults to NETWORK-only tools so
# nothing exposes a shell or local file edits over the network. Local stdio
# (MCP_TOOLSET unset/"all") exposes every tool for use on this machine.
_REMOTE_SAFE = [web_search, image_search, fetch_url]  # read-only: safe to expose remotely
_WRITE = [download_image, get_screenshot]             # write files on THIS host -> local only
_LOCAL = [list_files, read_file, search_files, grep_code, get_project_tree, detect_framework,
          read_package_json, read_package_scripts, write_file, patch_file, run_command, run_build, run_lint,
          run_typecheck, lsp_get_diagnostics,
          browser_open, browser_click, browser_type, browser_get_console_errors, browser_close,
          resize_image, convert_image_format, compress_image, create_favicon]
_toolset = os.environ.get("MCP_TOOLSET", "all")
_tools = _REMOTE_SAFE if _toolset == "network" else _REMOTE_SAFE + _WRITE + _LOCAL
for _fn in _tools:
    mcp.add_tool(_fn)

if __name__ == "__main__":
    # stdio (local, default) or sse (remote over the tailnet).
    mcp.settings.host = os.environ.get("MCP_HOST", "127.0.0.1")
    mcp.settings.port = int(os.environ.get("MCP_PORT", "8765"))
    mcp.run(transport=os.environ.get("MCP_TRANSPORT", "stdio"))
