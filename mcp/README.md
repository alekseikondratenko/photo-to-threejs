# MCP server

The deterministic half of the method, as tools. The modelling intelligence stays in the
host agent — an MCP server cannot perform the reconstruction (the White House run took
190 tool calls of an LLM writing TypeScript). The server wraps what *is* deterministic:

| Tool | What it does |
|---|---|
| `measure_reference` | Pixel measurement of a photograph: per-row-sky silhouette (gradient-proof in both axes), floor-pitch autocorrelation per height band, lit/shadow bands |
| `score_render` | Scans render and reference with the **same** detector: silhouette edge error (with per-band breakdown), area ratio, tip row, in-silhouette luma, sky gradient |
| `open_viewer` | Serves a built viewer directory on localhost; shows it in an MCP App panel where the host supports one, and always returns the URL for a real browser |

Plus the method itself as an MCP prompt: `reconstruct_from_photo` ships the full
SKILL.md, wired to prefer these tools over hand-written scanners.

Why exactly these tools: two independent acceptance-test runs (one bare agent, one with
the skill) each spent real time rebuilding exactly this trio mid-run. And the two runs
self-scored ~4–8 px with their own rulers while differing 5× under one ruler — *self-scores
are not comparable across runs*, which is the whole case for a standard `score_render`.
Its output has been validated against those runs' renders: rankings and magnitudes agree
with the independent Python scorer they were first judged by.

## What the panel is

A thin frame around the real viewer — `open_viewer` serves the viewer over localhost and
the panel iframes it, so there is one viewer implementation, not a panel fork that can
drift. Host support varies (per-client, not per-vendor): Claude Desktop renders panels,
Claude Code 2.1.x does not — which is why every result also carries the plain URL. The
iframe needs the host to honour the declared `frameDomains` CSP for
`http://127.0.0.1:5199`; when it doesn't, the panel says so and the open-in-browser
button is the path.

## Install

```bash
npm install && npm run build
```

The panel bundle must be built before the server runs — the `ui://` resource is read from
`dist/mcp-app.html` at request time.

Client config (Claude Desktop `claude_desktop_config.json`, or `claude mcp add` for
Claude Code):

```json
{
  "mcpServers": {
    "photo-to-threejs": {
      "command": "node",
      "args": ["<abs-path>/mcp/node_modules/tsx/dist/cli.mjs",
               "<abs-path>/mcp/main.ts", "--stdio"]
    }
  }
}
```

> Use an **absolute** path to `node` if you manage Node with nvm — desktop clients launch
> with a minimal `PATH`. Restart the client fully afterwards; MCP servers load at startup.

## Typical loop

1. `measure_reference` on the photograph — pitch per band, silhouette, bands.
2. Agent authors `models/<id>.ts` + `scenes/<id>.ts` in a viewer workspace
   (the skill's `assets/viewer-template/`, or this repo's `viewer/`).
3. Save an exact-size render: the workspace dev server accepts
   `POST /__save-render {name, dataUrl}` (never score a screenshot — they rescale).
4. `score_render` render-vs-photo; fix the largest error; repeat. Identity features are
   not covered by the metrics — target them separately and check them by eye.
5. `open_viewer` on the built workspace (`npm run build` → pass `dist/`).

## Run standalone

```bash
npm run serve   # Streamable HTTP on :3001 — the port the ext-apps basic-host probes
```
