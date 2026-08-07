import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /__save-render  {name, dataUrl}  →  writes renders/<name>
 *
 * Scoring needs exact-size renders on disk, and screenshot pipelines rescale
 * (bug checklist item 27) — so the page must be able to save its own canvas.
 * Both acceptance-test runs independently built this endpoint mid-run before
 * it shipped here.
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
          try {
            const { name, dataUrl } = JSON.parse(body) as { name?: string; dataUrl: string };
            const safe = path.basename(String(name ?? 'render.png'));
            const dir = path.resolve(server.config.root, 'renders');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, safe), Buffer.from(dataUrl.split(',')[1], 'base64'));
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [saveRender()] });
