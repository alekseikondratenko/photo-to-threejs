import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

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
              const { name, dataUrl, reference } = JSON.parse(body) as {
                name?: string; dataUrl: string; reference?: string;
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
                const { scoreImages } = await import('./scripts/score.mjs');
                const silhouette = scoreImages(renderPath, refPath);
                payload = { saved: `renders/${safe}`, scored: true, reference: path.relative(root, refPath), silhouette };
                fs.writeFileSync(`${renderPath}.score.json`, JSON.stringify(payload, null, 2));
                // Into the server log too — visible to anyone tailing the dev server.
                server.config.logger.info(
                  `[score] ${safe} vs ${path.basename(refPath)}: mean_edge ${silhouette.mean_edge_error_px} px, ` +
                  `area ${silhouette.area_ratio}, bands ${JSON.stringify(silhouette.edge_error_by_band)}`,
                );
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

export default defineConfig({ plugins: [saveRender()] });
