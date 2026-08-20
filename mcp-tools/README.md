# Nexus Tools - MCP server for Cline

An MCP (Model Context Protocol) stdio server that gives the model (e.g.
qwen3-coder via the gateway, used by Cline) a set of CPU/Network tools.

## Tools
| Tool | Backend | Notes |
|---|---|---|
| `list_files` | filesystem | recursive optional |
| `read_file` | filesystem | text, size-capped |
| `write_file` | filesystem | create/overwrite |
| `patch_file` | filesystem | first exact search→replace |
| `run_command` | shell | exit/stdout/stderr, timeout |
| `run_build` | shell | default `npm run build` |
| `run_lint` | shell | default `npm run lint` |
| `web_search` | DuckDuckGo (no key) | title/url/snippet JSON |
| `image_search` | DuckDuckGo (no key) | image URLs JSON |
| `fetch_url` | httpx | GET body text |
| `download_image` | httpx | save URL → file |
| `get_screenshot` | Playwright (Chromium) | PNG of a webpage |

## Setup (already scripted)
```bash
cd mcp-tools
python3 -m venv .venv
./.venv/bin/pip install mcp ddgs httpx playwright
./.venv/bin/python -m playwright install chromium   # for get_screenshot
# get_screenshot may also need system libs (once): sudo ./.venv/bin/python -m playwright install-deps
```

## Register in Cline
Cline → MCP Servers → "Configure MCP Servers" (or Settings → MCP), add:
```json
{
  "mcpServers": {
    "nexus-tools": {
      "command": "/home/ai-ccore/Documents/DEV/AICCORE-Nexus/mcp-tools/.venv/bin/python",
      "args": ["/home/ai-ccore/Documents/DEV/AICCORE-Nexus/mcp-tools/server.py"],
      "disabled": false
    }
  }
}
```
Then enable the server in Cline. The tools appear as `nexus-tools.<tool>` and the
model can call them.

## Caveats
- MCP tool descriptions are added to the model's system prompt → they consume
  context. Keep the server's tool set lean if context is tight (raise
  OLLAMA_CONTEXT_LENGTH accordingly).
- `web_search`/`image_search` use DuckDuckGo (no API key); rate limits may apply.
- `get_screenshot` needs Chromium installed (`playwright install chromium`) and
  possibly system libs (`playwright install-deps`, requires sudo).
- These tools execute shell commands and write files with this user's
  permissions — only enable in trusted local use.
