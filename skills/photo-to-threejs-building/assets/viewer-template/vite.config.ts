import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs, shared with the regression suite
import { GateState } from './scripts/gate-state.mjs';

/** One per dev server: pass history, deltas, and the converged verdict. */
const gate = new GateState();

/**
 * POST /__save-render  {name, dataUrl, reference?}
 *   → writes renders/<name>
 *   → SCORES it against the reference photograph, automatically
 *   → writes renders/<name>.score.json and returns the score in the response
 *
 * Scoring needs exact-size renders on disk, and screenshot pipelines rescale
 * (bug checklist item 27) — so the page must be able to save its own canvas.
 * Both acceptance-test runs independently built this endpoint mid-run before
 * it shipped here.
 *
 * Why scoring is IN the endpoint and not a separate step: a field run made
 * exactly one scored pass and then eyeballed for an hour — the discipline
 * decayed with the context. A rule in instructions can be forgotten; a rule
 * in the only door cannot. Saving a render and being graded are one action.
 *
 * The reference is found in this order: `reference` in the POST body (path
 * relative to the workspace, e.g. "public/house.jpg"), else the single
 * jpg/png in public/. If none is found the render still saves — but the
 * response says loudly that it was NOT scored and why.
 */
function saveRender(): Plugin {
  return {
    name: 'save-render',
    configureServer(server) {
      server.middlewares.use('/__save-render', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          void (async () => {
            try {
              const { name, dataUrl, reference, span } = JSON.parse(body) as {
                name?: string; dataUrl: string; reference?: string;
                span?: { x0: number; x1: number };
              };
              const root = server.config.root;
              const safe = path.basename(String(name ?? 'render.png'));
              const dir = path.resolve(root, 'renders');
              fs.mkdirSync(dir, { recursive: true });
              const renderPath = path.join(dir, safe);
              fs.writeFileSync(renderPath, Buffer.from(dataUrl.split(',')[1], 'base64'));

              const refPath = findReference(root, reference);
              let payload: Record<string, unknown>;
              if (!refPath) {
                payload = {
                  saved: `renders/${safe}`,
                  scored: false,
                  warning:
                    'NOT SCORED: no reference image found. Put the photograph in public/ ' +
                    '(one jpg/png) or pass {reference: "public/<file>"} in this POST. ' +
                    'An unscored render proves nothing.',
                };
              } else {
                const { scoreImages, decodeImage, isDegenerate } = await import('./scripts/score.mjs');
                // A uniform frame is a page error or a canvas read before a
                // paint (bug checklist #9). Three appeared across two field
                // runs, each scored as a mute null the agent had to diagnose
                // from nothing. Say it outright instead of scoring noise.
                if (isDegenerate(decodeImage(renderPath))) {
                  payload = {
                    saved: `renders/${safe}`,
                    scored: false,
                    warning:
                      'RENDER IS UNIFORM (blank/black) — nothing was scored. THE SCORING ' +
                      'PIPELINE IS HEALTHY; the PAGE produced a black frame. Do not debug ' +
                      'the scorer or read its source — read the BROWSER CONSOLE for the ' +
                      'exception. The page is erroring, or the canvas was read before a ' +
                      'frame painted (bug checklist #9: needs preserveDrawingBuffer and a ' +
                      'painted frame). Fix the page, then re-save.',
                  };
                } else {
                  const silhouette = scoreImages(renderPath, refPath, span);
                  // Deltas, the unchanged-re-save note and the converged verdict
                  // all come from the gate's own memory — see scripts/gate-state.mjs
                  // for why each of the three exists.
                  const extras = gate.record(safe, silhouette);
                  const delta = (extras as { delta_vs_previous?: unknown }).delta_vs_previous ?? null;
                  payload = {
                    saved: `renders/${safe}`,
                    scored: true,
                    reference: path.relative(root, refPath),
                    silhouette,
                    ...extras,
                  };
                  fs.writeFileSync(`${renderPath}.score.json`, JSON.stringify(payload, null, 2));
                  appendReconRow(root, safe, silhouette);
                  const sk = silhouette.skyline;
                  server.config.logger.info(
                    `[score] ${safe}: skyline ${sk ? sk.mean_top_error_px : 'n/a'} px, ` +
                    `row-edge ${silhouette.mean_edge_error_px} px, area ${silhouette.area_ratio}` +
                    (delta ? ` | Δ ${JSON.stringify(delta)}` : '') +
                    ((extras as { converged?: unknown }).converged ? ' | CONVERGED — geometry has not moved in 2 passes' : ''),
                  );
                }
              }
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify(payload));
            } catch (e) {
              res.statusCode = 500;
              res.end(String(e));
            }
          })();
        });
      });
    },
  };
}



/**
 * Append the pass to RECON.md's Score history. Both field runs left that table
 * empty — the .score.json files made manual logging feel redundant, and the
 * ledger lost its trend. The row lands automatically; the agent still writes
 * the "what changed" column.
 */
function appendReconRow(root: string, name: string, s: any) {
  try {
    const recon = path.resolve(root, '..', 'RECON.md');
    if (!fs.existsSync(recon)) return;
    const txt = fs.readFileSync(recon, 'utf-8');
    if (!txt.includes('## Score history')) return;
    const sk = s?.skyline;
    const row =
      `| ${name} | ${sk ? sk.mean_top_error_px : '—'} | ${sk?.top_error_by_band?.middle ?? '—'} | ` +
      `${s?.mean_edge_error_px ?? '—'} | ${s?.area_ratio ?? '—'} | _(what changed?)_ |`;
    // Insert INTO the table (after its header separator or the last existing
    // row), not at the end of the file — a score history that lands under the
    // footer is not a table anyone reads.
    const lines = txt.split('\n');
    const head = lines.findIndex((l) => l.trim().startsWith('## Score history'));
    if (head < 0) return;
    let at = head;
    for (let i = head + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('|')) at = i;
      else if (lines[i].trim().startsWith('#')) break;
    }
    if (at === head) return; // no table skeleton; leave the ledger alone
    lines.splice(at + 1, 0, row);
    fs.writeFileSync(recon, lines.join('\n'));
  } catch {
    /* the ledger is the agent's; never fail a save over it */
  }
}

function findReference(root: string, explicit?: string): string | null {
  if (explicit) {
    const p = path.resolve(root, explicit);
    return fs.existsSync(p) ? p : null;
  }
  const pub = path.resolve(root, 'public');
  if (!fs.existsSync(pub)) return null;
  const imgs = fs
    .readdirSync(pub)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(pub, f));
  return imgs.length === 1 ? imgs[0] : imgs.length > 1
    ? imgs.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0]
    : null;
}

/**
 * POST /__render {view, name, context?, span?}  → queue a render
 * GET  /__render-queue                          → the page picks the job up
 *
 * The page polls the queue once a second (dev only) and posts the result to
 * /__save-render itself, so an agent's scoring pass is one curl instead of a
 * browser-driving sequence. Twenty-one passes in one field run each paid that
 * overhead.
 */
function renderTrigger(): Plugin {
  let queued: unknown = null;
  return {
    name: 'render-trigger',
    configureServer(server) {
      server.middlewares.use('/__render-queue', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(queued));
        queued = null; // one-shot: the page has it now
      });
      server.middlewares.use('/__render', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const job = JSON.parse(body) as { name?: string };
            if (!job.name) throw new Error('name is required');
            queued = job;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              queued: job,
              note: 'The page renders and saves within ~1-2 s; read renders/<name>.score.json ' +
                    'or watch the dev-server log for the [score] line.',
            }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [saveRender(), renderTrigger()] });
