/**
 * photo-to-threejs MCP server.
 *
 * The load-bearing fact: an MCP server cannot perform the reconstruction.
 * The modelling is an LLM writing TypeScript across many iterations; the
 * intelligence stays in the host client. This server wraps the method:
 *
 *   deterministic parts -> tools   (measure_reference, score_render)
 *   the method itself   -> prompt  (SKILL.md ships with the server)
 *   the viewer          -> panel   (MCP App) + localhost URL fallback
 *
 * Both acceptance-test runs independently rebuilt exactly these tools mid-run
 * — that convergent reinvention, not optimism, is why these two are the ones
 * shipped. A further meta-finding funds `score_render`: two runs self-scored
 * ~4–8 px with their own rulers and differed 5x under one ruler. Self-scores
 * are not comparable; a standard scorer is.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logHandshake } from "./log.ts";
import { measureImage, scoreImages } from "./src/scan.ts";
import { ensureViewerServer, PREFERRED_PORT } from "./viewer-server.ts";

const HERE = import.meta.dirname;
const DIST_DIR = path.join(HERE, "dist");
const PANEL_URI = "ui://photo-to-threejs/viewer-panel.html";

/** SKILL.md travels with the server: repo layout first, bundled copy second. */
function skillText(): string {
  const candidates = [
    path.join(HERE, "..", "skills", "photo-to-threejs-building", "SKILL.md"),
    path.join(HERE, "SKILL.md"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  }
  return "SKILL.md not found next to the server — fetch it from https://github.com/alekseikondratenko/photo-to-threejs";
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "photo-to-threejs", version: "0.2.0" });

  server.registerTool(
    "measure_reference",
    {
      title: "Measure a reference photograph",
      description:
        "Deterministic pixel measurement of a building photograph: per-row-sky silhouette, " +
        "floor-pitch autocorrelation per height band, lit/shadow bands. Run this before " +
        "hand-measuring anything. Reports measurements, not conclusions — a pitch that " +
        "drifts between bands means perspective is non-linear (use local ratios).",
      inputSchema: {
        image: z.string().describe("Absolute path to the photograph (png/jpg)"),
      },
    },
    async ({ image }) => {
      logHandshake("tools/call", { tool: "measure_reference", image });
      const result = measureImage(image);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "score_render",
    {
      title: "Score a render against the reference",
      description:
        "Scans render and reference photograph with the SAME silhouette detector and reports " +
        "edge error, area ratio, tip row, in-silhouette luma and sky gradient. Use the render " +
        "saved by the viewer's /__save-render endpoint (exact drawing-buffer size — never a " +
        "screenshot, they rescale). Identity features are not covered: target them separately.",
      inputSchema: {
        render: z.string().describe("Absolute path to the render png"),
        reference: z.string().describe("Absolute path to the reference photograph"),
      },
    },
    async ({ render, reference }) => {
      logHandshake("tools/call", { tool: "score_render", render, reference });
      const result = scoreImages(render, reference);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  registerAppTool(
    server,
    "open_viewer",
    {
      title: "Open the reconstruction viewer",
      description:
        "Serves a built viewer directory (one containing index.html — for a vite workspace, " +
        "`npm run build` first and pass dist/) on localhost and shows it in a panel where the " +
        "host supports MCP Apps. Always also returns the URL: hosts without panels open it in " +
        "a browser instead. During active modelling prefer the workspace's own dev server — " +
        "it hot-reloads; this panel refreshes per call.",
      inputSchema: {
        dir: z.string().describe("Absolute path to the built viewer directory (contains index.html)"),
      },
      _meta: {
        ui: {
          resourceUri: PANEL_URI,
          // CSP is declared statically but ports are dynamic: the server tries
          // PREFERRED_PORT first precisely so this allowance usually matches.
          // When it cannot (port taken), the iframe fails closed and the panel's
          // open-in-browser button is the path — never a silent wrong render.
          csp: { frameDomains: [`http://127.0.0.1:${PREFERRED_PORT}`] },
        },
      },
    },
    async ({ dir }) => {
      logHandshake("tools/call", { tool: "open_viewer", dir });
      const viewerUrl = await ensureViewerServer(dir);
      return {
        content: [{ type: "text", text: `Viewer serving at ${viewerUrl}` }],
        structuredContent: { viewerUrl },
      };
    },
  );

  registerAppResource(
    server,
    "Reconstruction viewer panel",
    PANEL_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fsp.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: PANEL_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  server.registerPrompt(
    "reconstruct_from_photo",
    {
      title: "Reconstruct a building from one photograph",
      description:
        "The full photo-to-threejs method: measurement-first workflow, scoring loop, and the " +
        "28-item bug checklist. Apply it to the photograph the user supplies.",
    },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "Follow this method to rebuild the building in the photograph I provide as a " +
              "procedural, measured Three.js model. Use the measure_reference and score_render " +
              "tools for the deterministic steps instead of writing your own scanners.\n\n" +
              skillText(),
          },
        },
      ],
    }),
  );

  return server;
}
