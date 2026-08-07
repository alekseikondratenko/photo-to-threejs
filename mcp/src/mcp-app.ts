/**
 * The MCP App panel: a thin frame around the real viewer.
 *
 * The viewer itself is served on localhost by the MCP server (open_viewer);
 * this View iframes it. That keeps ONE viewer implementation — the panel is a
 * window onto it, not a second engine that could drift.
 *
 * Failure honesty: the iframe only loads where the host honours the declared
 * frameDomains CSP AND the server won its preferred port. When either fails,
 * the panel says so and offers open-in-browser — never a silent blank.
 */
import { App, applyDocumentTheme, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import "./mcp-app.css";

const statusEl = document.getElementById("status")!;
const openBtn = document.getElementById("open-btn") as HTMLButtonElement;
const sizeBtn = document.getElementById("size-btn") as HTMLButtonElement;
const frame = document.getElementById("viewer") as HTMLIFrameElement;
const emptyEl = document.getElementById("empty")!;

const setStatus = (t: string) => { statusEl.textContent = t; };

let viewerUrl: string | undefined;

function showViewer(url: string) {
  viewerUrl = url;
  openBtn.hidden = false;
  emptyEl.hidden = true;
  frame.src = url;
  // A CSP-blocked iframe still fires `load` on an empty document, so blocking
  // is NOT detectable from in here (field-tested). Say so up front instead of
  // pretending to know.
  setStatus(`${url} — blank frame below? the host blocked embedding: use open in browser`);
}

const app = new App({ name: "photo-to-threejs viewer", version: "0.2.0" });

app.ontoolresult = (result) => {
  const url = (result.structuredContent as { viewerUrl?: string } | undefined)?.viewerUrl;
  if (url) showViewer(url);
};

app.onhostcontextchanged = (ctx: McpUiHostContext) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  const other = ctx.displayMode === "fullscreen" ? "inline" : "fullscreen";
  sizeBtn.hidden = !(ctx.availableDisplayModes?.includes(other) ?? false);
  sizeBtn.textContent = other;
};

openBtn.addEventListener("click", async () => {
  if (!viewerUrl) return;
  const { isError } = await app.openLink({ url: viewerUrl });
  if (isError) setStatus("host refused to open the link — copy it: " + viewerUrl);
});

sizeBtn.addEventListener("click", async () => {
  const target = sizeBtn.textContent as "inline" | "fullscreen";
  const { mode } = await app.requestDisplayMode({ mode: target });
  sizeBtn.textContent = mode === "fullscreen" ? "inline" : "fullscreen";
});

app.onerror = (e) => setStatus(`app error: ${String(e)}`);

app
  .connect()
  .then(() => {
    setStatus("connected — call open_viewer");
    const ctx = app.getHostContext();
    if (ctx?.theme) applyDocumentTheme(ctx.theme);
  })
  .catch(() => setStatus("no MCP host — standalone preview"));
