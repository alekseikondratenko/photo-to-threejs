# MCP server

**Status: working spike.** It renders an interactive Three.js scene inside an MCP App panel
and proves the whole panel path works end to end. The measurement and scoring tools
(`measure_reference`, `score_render`, `init_workspace`) are not in it yet — that is the next
piece of work.

## Why it exists

An MCP server cannot perform the reconstruction. The modelling is an LLM writing TypeScript
across many iterations; MCP exposes *tools*, and the intelligence stays in the host client.
So the server does not replace the method — it wraps it:

- deterministic parts → **tools**
- the method itself → an **MCP prompt** (`SKILL.md` travels with the server)
- the viewer → an **MCP App panel**, with a localhost URL as the fallback

## What was established

WebGL runs inside the MCP App sandbox. This was genuinely uncertain — sources disagreed on
whether panels could contain arbitrary HTML at all — so it was tested before anything was
built on top of it.

| Question | Answer |
|---|---|
| Does a WebGL canvas render in the panel? | Yes — `WebGL 2.0 (OpenGL ES 3.0 Chromium)` |
| Does `OrbitControls` respond to drag inside the sandbox? | Yes |
| Is a ~890 KB single-file bundle rejected? | No |
| Does Three.js need custom CSP? | **No.** The default sandbox CSP already grants `worker-src blob:` and `script-src 'unsafe-eval' blob:` |
| Does `preserveDrawingBuffer` survive the sandbox? | Yes — canvas readback works, which the scoring harness depends on |

**Host support is per-client, not per-vendor.** Claude Desktop renders the panel. Claude
Code 2.1.221 renders nothing for the identical server — it never fetches the View at all.
That is why any viewer-opening tool should return a localhost URL *as well as* a panel.

One more constraint worth knowing: the panel is cross-origin with a `srcdoc` inner frame, so
**the host cannot reach into it**. Browser automation gets no DOM access to panel content.
A scoring loop therefore cannot drive `window.__measure()` from outside — the View has to
call back out via `app.callServerTool()` instead.

## Shape

```
server.ts         one tool + one ui:// resource, tied by _meta.ui.resourceUri
main.ts           --stdio for client config; Streamable HTTP otherwise
viewer-server.ts  lazy localhost static server, probes upward from 5199
mcp-app.html      the View's shell
src/mcp-app.ts    Three.js scene, OrbitControls, MCP App handshake
```

## Install

```bash
npm install && npm run build
```

The View must be built before the server runs — the `ui://` resource is read from
`dist/mcp-app.html` at request time.

Then add to your MCP client config:

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

> Use an **absolute** path to `node` if you manage Node with nvm. Desktop clients launch
> from the OS shell with a minimal `PATH` and will not otherwise find it.

Restart the client fully afterwards — MCP servers are spawned at startup, so adding one
mid-session does nothing.

## Run it standalone

```bash
npm run serve
```

Serves Streamable HTTP on `:3001`, which is the port the
[ext-apps `basic-host`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host)
harness probes by default — the quickest way to see the panel without a desktop client.
