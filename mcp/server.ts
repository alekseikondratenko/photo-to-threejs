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
import { inlineViewer } from "./src/bundle.ts";
import { solveCamera } from "./src/camera.ts";
import { BUNDLE_META } from "./src/protocol.ts";
import {
  classifyReference,
  compareImages,
  decodeImage,
  measureImage,
  measurePitch,
  scoreImages,
} from "./src/scan.ts";
import { initWorkspace } from "./src/workspace.ts";
import { ensureViewerServer, PREFERRED_PORT } from "./viewer-server.ts";

const HERE = import.meta.dirname;
const DIST_DIR = path.join(HERE, "dist");
const PANEL_URI = "ui://photo-to-threejs/viewer-panel.html";

/**
 * CSP for the panel. The primary rendering path no longer needs any of this:
 * the viewer is inlined and written into the frame with `srcdoc`, which has
 * no origin to allow. The declaration stays for the localhost fallback path
 * — and, having watched a pinned origin lose the race when the preferred port
 * was taken, it covers the whole probe range rather than one port.
 *
 * `data:` is the load-bearing entry now: an inlined viewer carries its
 * reference photograph and textures as data URIs, which is an img-src matter.
 */
const VIEWER_ORIGINS = Array.from({ length: 20 }, (_, i) => `http://127.0.0.1:${PREFERRED_PORT + i}`);
const PANEL_CSP = {
  frameDomains: VIEWER_ORIGINS,
  connectDomains: VIEWER_ORIGINS,
  resourceDomains: ["data:", "blob:"],
};

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

/**
 * Region-of-interest, shared by every scanning tool.
 *
 * The detectors are not blind because the measurement is wrong; they are
 * blind because nothing aimed them. Four of four real field photographs
 * defeated the sky-margin scan (dusk gradient, sea horizon, vegetation,
 * hero-crop margins), and in each case the agent had already cropped the
 * image by hand within minutes. Judgement in the agent, determinism in the
 * tool — this parameter is where the two meet.
 */
const CROP = z
  .object({
    x0: z.number().describe("Left edge, in ORIGINAL image pixels"),
    y0: z.number().describe("Top edge, in ORIGINAL image pixels"),
    x1: z.number().describe("Right edge, in ORIGINAL image pixels"),
    y1: z.number().describe("Bottom edge, in ORIGINAL image pixels"),
  })
  .optional()
  .describe(
    "Region to scan, in original-image pixels. Use it when foreground clutter " +
    "(trees, crowds, a tight crop) reaches the frame margins and the sky-bounded " +
    "detectors report few or no usable rows. Reported coordinates come back in " +
    "full-image space so they stay comparable across crops.",
  );

export function createServer(): McpServer {
  const server = new McpServer({ name: "photo-to-threejs", version: "0.4.0" });

  server.registerTool(
    "classify_reference",
    {
      title: "Classify a reference photograph (evidence, not verdict)",
      description:
        "Run FIRST, before measuring: reports vertical-edge slopes (tilt/parallel verticals), " +
        "per-band pitch drift (the linearity test), and end-pitch asymmetry across the facade " +
        "(the two-faces/frontality falsification) — with hints. Classification itself stays " +
        "the agent's Step 1 judgement; this grounds it in numbers in one call. If the " +
        "evidence comes back empty, the margins are occluded — re-run with `crop`.",
      inputSchema: {
        image: z.string().describe("Absolute path to the photograph (png/jpg)"),
        crop: CROP,
      },
    },
    async ({ image, crop }) => {
      logHandshake("tools/call", { tool: "classify_reference", image, crop });
      const result = classifyReference(image, crop);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "init_workspace",
    {
      title: "Scaffold a reconstruction workspace",
      description:
        "Copies the viewer template into <dir>/viewer (if absent), writes compilable " +
        "placeholder models/<id>.ts + scenes/<id>.ts stubs, and registers the subject in " +
        "main.ts. Placeholder numbers are loudly marked: replace them with measured values " +
        "before scoring — a converged score against invented targets is the false-100% trap.",
      inputSchema: {
        dir: z.string().describe("Absolute path of the workspace parent directory"),
        subject: z.string().describe("Subject id, e.g. 'flatiron' — letters/digits only"),
        referenceImage: z
          .string()
          .optional()
          .describe("Public path or URL the viewer HUD should show for the reference"),
      },
    },
    async ({ dir, subject, referenceImage }) => {
      logHandshake("tools/call", { tool: "init_workspace", dir, subject });
      const result = initWorkspace(dir, subject, referenceImage);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "measure_reference",
    {
      title: "Measure a reference photograph",
      description:
        "Deterministic pixel measurement of a building photograph: per-row-sky silhouette, " +
        "floor-pitch autocorrelation per height band, lit/shadow bands. Run this before " +
        "hand-measuring anything. Reports measurements, not conclusions — a pitch that " +
        "drifts between bands means perspective is non-linear (use local ratios). Pass " +
        "`crop` when foreground clutter reaches the margins.",
      inputSchema: {
        image: z.string().describe("Absolute path to the photograph (png/jpg)"),
        crop: CROP,
      },
    },
    async ({ image, crop }) => {
      logHandshake("tools/call", { tool: "measure_reference", image, crop });
      const result = measureImage(image, crop);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "solve_camera",
    {
      title: "Solve the camera from picked lines",
      description:
        "Give it 4–10 line segments you have picked along real-world parallel families " +
        "(vertical edges, eaves, sills, ridges) and it returns vanishing points with " +
        "per-line residuals, the horizon, focal length, tilt/roll/yaw, eye height, and a " +
        "ready-to-paste Three.js camera block including the setViewOffset arithmetic for " +
        "an off-centre principal point. Picking the lines is yours; the algebra is not — " +
        "hand-solving it is the single largest time sink in the method, and it is where " +
        "sign slips live. Includes a leave-one-out check: a vanishing point is refitted " +
        "WITHOUT each line and asked to predict it. Inconsistent input returns " +
        "'inconsistent' plus the offending line, never a forced number.",
      inputSchema: {
        image: z.string().describe("Absolute path to the photograph (png/jpg) — read for its size"),
        lines: z
          .array(
            z.object({
              x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number(),
              label: z
                .string()
                .optional()
                .describe(
                  "Family this line belongs to: lines PARALLEL IN THE WORLD share a label. " +
                  "Use 'vertical' for vertical edges; any names for the horizontal families " +
                  "(e.g. 'eave-left', 'eave-right'). Omit and families are guessed from " +
                  "direction, which is reported back so you can correct it.",
                ),
            }),
          )
          .min(4)
          .describe("Line segments in ORIGINAL image pixels. 3+ per family enables the real check."),
        known: z
          .object({
            height_m: z.number().optional().describe("True height spanned by the vertical lines, in metres"),
            pitch_deg: z.number().optional().describe("Roof pitch you already measured — echoed, not fitted"),
            principal_point: z
              .enum(["centre", "solve"])
              .optional()
              .describe(
                "Default 'centre' (right for an uncropped photograph, and measurably more " +
                "accurate under realistic pick noise). Use 'solve' only for a cropped or " +
                "shift-lens image: it is exact on perfect input but amplifies pick error.",
              ),
          })
          .optional()
          .describe("Supply height_m to turn ratios into metres (eye height and camera distance)"),
      },
    },
    async ({ image, lines, known }) => {
      logHandshake("tools/call", { tool: "solve_camera", image, lines: lines.length });
      const im = decodeImage(image);
      const result = solveCamera([im.w, im.h], lines, known);
      return {
        content: [{ type: "text", text: JSON.stringify({ image, ...result }, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "measure_pitch",
    {
      title: "Measure a repeating pitch in a chosen region",
      description:
        "Autocorrelation, aimed: point it at a crop and an axis and it returns the " +
        "repeating pitch in pixels. Use it for floor and course spacing, baluster and bay " +
        "rhythm, and the per-face end-pitch comparison (call twice with two crops — a " +
        "tighter pitch at one end means that end recedes). Warns when the pitch is at the " +
        "JPEG noise floor (~8 px) or when fewer than ~3 repeats were seen, which is a " +
        "coincidence rather than a rhythm.",
      inputSchema: {
        image: z.string().describe("Absolute path to the photograph (png/jpg)"),
        axis: z
          .enum(["vertical", "horizontal"])
          .describe("'vertical' = rhythm running down the image (floors, courses); 'horizontal' = across (bays, balusters)"),
        crop: CROP,
      },
    },
    async ({ image, axis, crop }) => {
      logHandshake("tools/call", { tool: "measure_pitch", image, axis, crop });
      const result = measurePitch(image, axis, crop);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "compare_images",
    {
      title: "Build the evidence pack for two images",
      description:
        "Writes overlay.png (50% blend), wipe.png (split) and edge_diff.png (both " +
        "silhouettes drawn on A) into out_dir, and returns the paths together with the " +
        "full score_render numbers. One call instead of the side-by-sides every run " +
        "hand-builds. Pass the photograph as imageA and the render as imageB; B is " +
        "resized to A. The pictures and the numbers come from the same detector, so a " +
        "defect visible in edge_diff is the defect the score is counting.",
      inputSchema: {
        imageA: z.string().describe("Absolute path to the base image — normally the reference photograph"),
        imageB: z.string().describe("Absolute path to the compared image — normally the render"),
        out_dir: z.string().describe("Absolute path of the directory to write the three PNGs into (created if absent)"),
      },
    },
    async ({ imageA, imageB, out_dir }) => {
      logHandshake("tools/call", { tool: "compare_images", imageA, imageB, out_dir });
      const result = compareImages(imageA, imageB, out_dir);
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
        "`npm run build` first and pass dist/) and shows it in a panel where the host supports " +
        "MCP Apps. In such hosts this is the way to put the reconstruction inline in the " +
        "conversation — prefer it whenever the user asks to see the result in chat. Always " +
        "also returns a localhost URL: hosts without panels open it in a browser instead. " +
        "During active modelling prefer the workspace's own dev server — it hot-reloads; this " +
        "panel refreshes per call. HOSTS MAY SILENTLY NOT RENDER THE PANEL (Claude Code as of " +
        "2.1.222 does not fetch the View at all): unless the user confirms seeing it, report " +
        "the URL and never state that a panel is visible.",
      inputSchema: {
        dir: z.string().describe("Absolute path to the built viewer directory (contains index.html)"),
      },
      // `csp` is deliberately NOT set here: the spec puts it on the UI
      // resource, hosts read it from the resources/read result, and the type
      // declares it `never` on a tool. It was set here too while the blank
      // frame was being chased; that was noise, and noise in a security
      // declaration is worse than nothing.
      _meta: { ui: { resourceUri: PANEL_URI } },
    },
    async ({ dir }) => {
      logHandshake("tools/call", { tool: "open_viewer", dir });
      const viewerUrl = await ensureViewerServer(dir);
      return {
        content: [{ type: "text", text: `Viewer serving at ${viewerUrl}` }],
        // `dir` travels so the panel can ask for the inlined bundle; the URL
        // travels so every host has a path that works without a panel.
        structuredContent: { viewerUrl, dir: path.resolve(dir) },
      };
    },
  );

  registerAppTool(
    server,
    "get_viewer_bundle",
    {
      title: "Inline a viewer directory into one self-contained document",
      description:
        "Panel-only: inlines a viewer directory into one self-contained document for the " +
        "panel to render. Not for the agent — call open_viewer instead. Calling this " +
        "yourself returns a summary only; the document is not in the agent-facing result.",
      inputSchema: {
        dir: z.string().describe("Absolute path to the built viewer directory"),
      },
      _meta: { ui: { resourceUri: PANEL_URI, visibility: ["app"] } },
    },
    async ({ dir }) => {
      logHandshake("tools/call", { tool: "get_viewer_bundle", dir });
      const bundle = inlineViewer(dir);
      const summary = {
        bytes: bundle.bytes,
        inlined: bundle.inlined,
        missing: bundle.missing,
        mapped: bundle.mapped,
        skipped: bundle.skipped,
      };
      return {
        // The document travels in `_meta` and NOWHERE else. `visibility: ["app"]`
        // is advisory — the SDK does not filter tools/list, and a host that
        // ignores it would otherwise let an agent call this and paste multiple
        // megabytes of HTML into its own context. `content` and
        // `structuredContent` are what a model sees, so they carry the summary;
        // `_meta` is protocol metadata, and the panel reads the payload there.
        content: [{ type: "text", text: JSON.stringify(summary) }],
        structuredContent: summary,
        _meta: { [BUNDLE_META]: { html: bundle.html, bytes: bundle.bytes } },
      };
    },
  );

  registerAppResource(
    server,
    "Reconstruction viewer panel",
    PANEL_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { csp: PANEL_CSP } } },
    async () => {
      const html = await fsp.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [
          {
            uri: PANEL_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            // Read-result metadata takes precedence over the listing entry.
            _meta: { ui: { csp: PANEL_CSP } },
          },
        ],
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
              "procedural, measured Three.js model. Use this server's tools for the " +
              "deterministic steps instead of writing your own: `classify_reference` and " +
              "`measure_reference` before measuring by hand (pass `crop` to aim them when " +
              "foreground clutter defeats the margins), `solve_camera` instead of deriving " +
              "vanishing points by hand, `measure_pitch` for any repeating rhythm, and " +
              "`compare_images` + `score_render` for each scoring pass.\n\n" +
              "When the reconstruction is done, build the workspace and call `open_viewer` " +
              "so the result appears in the conversation.\n\n" +
              skillText(),
          },
        },
      ],
    }),
  );

  return server;
}
