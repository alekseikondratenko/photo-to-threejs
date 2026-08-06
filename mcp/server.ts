/**
 * Phase 0 spike server — the smallest possible MCP App.
 *
 * One tool, one UI resource, tied together by `_meta.ui.resourceUri`. No
 * measurement, no scoring, no viewer: this exists only to answer whether a
 * host will run WebGL in the App sandbox.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logHandshake } from "./log.ts";
import { ensureViewerServer } from "./viewer-server.ts";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://threejs-cube/mcp-app.html";

export function createServer(): McpServer {
  const server = new McpServer({ name: "Three.js Cube Spike", version: "0.0.1" });

  registerAppTool(
    server,
    "show_cube",
    {
      title: "Show Three.js Cube",
      description:
        "Renders a spinning, orbit-controllable Three.js cube in an MCP App panel. " +
        "A WebGL capability spike — it models nothing.",
      inputSchema: {
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional()
          .describe("Cube colour as a #rrggbb hex string. Defaults to #ff6b35."),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ color }) => {
      logHandshake("tools/call", { color, client: server.server.getClientVersion() });
      const hex = color ?? "#ff6b35";
      // The View needs a real URL for its "open in browser" button. Hand it
      // over in structuredContent rather than hardcoding a port in the bundle.
      const viewerUrl = await ensureViewerServer();
      return {
        content: [{ type: "text", text: `Rendering a ${hex} cube. Viewer: ${viewerUrl}` }],
        structuredContent: { color: hex, viewerUrl },
      };
    },
  );

  registerAppResource(
    server,
    "Three.js Cube",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      // The decisive line: if this appears, the host knows the tool has a View
      // and went to fetch it. If it never appears, the host ignored the UI
      // metadata entirely.
      logHandshake("resources/read", { uri: RESOURCE_URI });
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
