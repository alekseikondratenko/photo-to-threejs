/**
 * Phase 0 spike View: a spinning, orbit-controllable Three.js cube.
 *
 * The only question this file exists to answer is whether a host will run
 * WebGL inside the MCP App sandbox. Everything here is deliberately minimal —
 * one mesh, one light rig, OrbitControls, and enough on-screen status text
 * that a screenshot alone proves what happened.
 */
import { App, applyDocumentTheme, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import "./mcp-app.css";

const statusEl = document.getElementById("status")!;
const spinBtn = document.getElementById("spin-btn")!;
const sizeBtn = document.getElementById("size-btn") as HTMLButtonElement;
const openBtn = document.getElementById("open-btn") as HTMLButtonElement;
const stage = document.getElementById("stage")!;
const canvas = document.getElementById("gl") as HTMLCanvasElement;

function setStatus(text: string) {
  statusEl.textContent = text;
}

// ---------------------------------------------------------------- Three.js

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  // Acceptance criterion for the wider project: canvas readback must work,
  // because the whole measurement harness reads pixels back off the canvas.
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(3.2, 2.4, 4.2);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 1.6, 1.6),
  new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.45, metalness: 0.1 }),
);
scene.add(cube);

const grid = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
grid.position.y = -1.2;
(grid.material as THREE.Material).opacity = 0.35;
(grid.material as THREE.Material).transparent = true;
scene.add(grid);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 6, 3);
scene.add(key);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

let spinning = true;
spinBtn.addEventListener("click", () => {
  spinning = !spinning;
  spinBtn.textContent = spinning ? "pause spin" : "resume spin";
});

// Acceptance criterion 2: does dragging inside the sandboxed iframe reach
// OrbitControls at all? Report it on screen rather than to the console.
let drags = 0;
controls.addEventListener("start", () => {
  drags += 1;
  setStatus(`orbit drag #${drags} — controls live`);
});

function resize() {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

const timer = new THREE.Timer();
let frames = 0;
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  if (spinning) {
    cube.rotation.x += dt * 0.6;
    cube.rotation.y += dt * 0.9;
  }
  controls.update();
  renderer.render(scene, camera);
  frames += 1;
  if (frames === 1) {
    const gl = renderer.getContext();
    setStatus(`WebGL live — ${gl.getParameter(gl.VERSION)}`);
  }
});

// ------------------------------------------------------------- MCP wiring

const app = new App({ name: "Three.js Cube Spike", version: "0.0.1" });

function applyHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    scene.background = null;
  }

  // Panel size is negotiated, not fixed. `fullscreen` is only offered if the
  // host says it supports it — `availableDisplayModes` varies per host.
  const other = ctx.displayMode === "fullscreen" ? "inline" : "fullscreen";
  const canResize = ctx.availableDisplayModes?.includes(other) ?? false;
  sizeBtn.hidden = !canResize;
  sizeBtn.textContent = other;
  stage.style.setProperty("--stage-h", ctx.displayMode === "fullscreen" ? "100vh" : "560px");
}

sizeBtn.addEventListener("click", async () => {
  const target = sizeBtn.textContent as "inline" | "fullscreen";
  const { mode } = await app.requestDisplayMode({ mode: target });
  // Trust the host's answer, not the request — it may refuse.
  sizeBtn.textContent = mode === "fullscreen" ? "inline" : "fullscreen";
  stage.style.setProperty("--stage-h", mode === "fullscreen" ? "100vh" : "560px");
});

let viewerUrl: string | undefined;
openBtn.addEventListener("click", async () => {
  if (!viewerUrl) return;
  // The panel cannot navigate the user anywhere itself; it asks the host to,
  // and the host decides. This is the whole "open in a real browser" path.
  const { isError } = await app.openLink({ url: viewerUrl });
  if (isError) setStatus("host refused to open the link");
});

// Set handlers before connect(), or the initial tool result is missed.
app.ontoolresult = (result) => {
  const data = result.structuredContent as
    | { color?: string; viewerUrl?: string }
    | undefined;
  if (data?.color) {
    (cube.material as THREE.MeshStandardMaterial).color.set(data.color);
  }
  if (data?.viewerUrl) {
    viewerUrl = data.viewerUrl;
    openBtn.hidden = false;
  }
};
app.onhostcontextchanged = applyHostContext;
app.onerror = (e) => setStatus(`app error: ${String(e)}`);

app
  .connect()
  .then(() => {
    const ctx = app.getHostContext();
    if (ctx) applyHostContext(ctx);
  })
  .catch(() => {
    // Standalone in a plain browser tab there is no host to connect to. The
    // cube must still render — that separates "WebGL is blocked" from
    // "the MCP handshake failed", which are very different findings.
    setStatus(`${statusEl.textContent} (no MCP host — standalone)`);
  });
