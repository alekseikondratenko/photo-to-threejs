import type { ReferenceTargets } from './types';

/**
 * Render-vs-reference measurement harness.
 *
 * This is the single most valuable part of the pipeline. Judging a facade by eye
 * is unreliable: an inverted triangle winding made one tower render exactly 2x too
 * dark and it read as "the materials didn't load". Numbers caught it immediately.
 *
 * Call window.__measure() from the console (or a driving agent) after a frame has
 * painted. Readback needs `preserveDrawingBuffer: true` on the renderer AND a
 * painted frame — right after navigation it returns all zeros.
 */
export function installMeasureHarness(getTargets: () => ReferenceTargets) {
  (window as unknown as { __measure: () => string }).__measure = () => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const tmp = document.createElement('canvas');
    tmp.width = c.width; tmp.height = c.height;
    tmp.getContext('2d')!.drawImage(c, 0, 0);
    const ctx = tmp.getContext('2d')!;
    const W = tmp.width, H = tmp.height;
    const img = ctx.getImageData(0, 0, W, H).data;
    const at = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      return [img[i], img[i + 1], img[i + 2]] as [number, number, number];
    };
    const L = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const hex = (a: number[]) => `#${a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

    const sky = at(Math.round(W * 0.04), Math.round(H * 0.04));
    const far = (p: number[]) =>
      Math.abs(p[0] - sky[0]) + Math.abs(p[1] - sky[1]) + Math.abs(p[2] - sky[2]) > 55;

    const yMid = Math.round(H * 0.45);
    let l = -1, r = -1;
    for (let x = Math.round(W * 0.20); x < Math.round(W * 0.90); x += 1) {
      if (far(at(x, yMid))) { if (l < 0) l = x; r = x; }
    }
    const w = r - l;
    const cx = Math.round((l + r) / 2);
    let top = -1;
    for (let y = 0; y < H; y += 1) if (far(at(cx, y))) { top = y; break; }

    const avg = (x0: number, x1: number, ya: number, yb: number) => {
      let r0 = 0, g = 0, b = 0, n = 0;
      for (let y = ya; y < yb; y += 2) for (let x = x0; x < x1; x += 2) {
        const p = at(x, y); r0 += p[0]; g += p[1]; b += p[2]; n += 1;
      }
      return n ? [r0 / n, g / n, b / n] : [0, 0, 0];
    };
    const lit = avg(l + 10, l + Math.round(w * 0.45), Math.round(H * 0.42), Math.round(H * 0.56));
    const shd = avg(l + Math.round(w * 0.72), r - 6, Math.round(H * 0.42), Math.round(H * 0.56));

    // vertical banding contrast down the lit face
    const prof: number[] = [];
    for (let y = Math.round(H * 0.30); y < Math.round(H * 0.70); y += 1) {
      let s = 0, n = 0;
      for (let x = l + Math.round(w * 0.10); x < l + Math.round(w * 0.40); x += 1) { s += L(at(x, y)); n += 1; }
      prof.push(s / n);
    }
    const mx = Math.max(...prof), mn = Math.min(...prof);
    const mean = prof.reduce((a, b) => a + b, 0) / prof.length;

    const t = getTargets();
    const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
    return JSON.stringify({
      measured: {
        litLuma: +L(lit).toFixed(1), lit: hex(lit),
        shadowLuma: +L(shd).toFixed(1), shadow: hex(shd),
        ratio: +(L(lit) / L(shd)).toFixed(2),
        widthFrac: +(w / W).toFixed(3),
        topFrac: +(top / H).toFixed(3),
        bandingContrast: +((mx - mn) / mean).toFixed(2),
      },
      target: t,
      vsTarget: {
        litLuma: pct(L(lit), t.litLuma),
        shadowLuma: pct(L(shd), t.shadowLuma),
        ratio: pct(L(lit) / L(shd), t.ratio),
        widthFrac: pct(w / W, t.widthFrac),
      },
    }, null, 1);
  };
}
