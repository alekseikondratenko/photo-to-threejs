/**
 * solve_camera: vanishing-point algebra, done once and checked.
 *
 * This is the single largest time sink in every observed run — not finding
 * the lines (the agent is good at that, and picking them is judgement that
 * stays with the agent) but the algebra afterwards: one run spent ~40 minutes
 * on a two-VP solve, another spiralled ~30 minutes through five
 * re-derivations with sign slips. That is a deterministic computation being
 * done by hand, repeatedly, with arithmetic errors. It belongs in code.
 *
 * Two commitments make the output trustworthy rather than merely confident:
 *
 *  - Residuals travel with every fit, and a leave-one-out pass predicts a
 *    line that was not used to fit its own vanishing point. A solve that
 *    cannot predict a line it did not see is reported as such.
 *  - The principal-point / focal-length ambiguity is stated, not hidden. Two
 *    vanishing points cannot pin both; three can. The result always says
 *    which case it was in and what was assumed.
 *
 * When the input is inconsistent the answer is "inconsistent, and here is the
 * line that disagrees" — never a forced number. An impossible answer means a
 * broken method, not a weird building.
 */

export interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Family name: lines sharing a real-world direction (eave, sill, ridge…). */
  label?: string;
}

export interface KnownScale {
  /** Real height of the subject spanned by the vertical lines, in metres. */
  height_m?: number;
  /** Roof pitch, if the agent already measured it — reported back, not fitted. */
  pitch_deg?: number;
  /**
   * How to treat the principal point.
   *
   * `"centre"` (the default) assumes the frame centre. That is right for an
   * uncropped photograph off a normal camera, and it is deliberately the
   * default because the alternative is noise-sensitive: the orthocentre of
   * three vanishing points is exact on perfect input but amplifies pick
   * error badly, and a picked line is accurate to a pixel or three at best.
   *
   * `"solve"` derives it from the three vanishing points. Use it only when
   * the image is known to be cropped or shot on a shift lens, and only with
   * carefully picked lines — the result reports which was used either way.
   */
  principal_point?: "centre" | "solve";
}

type Vec3 = [number, number, number];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const deg = (r: number) => (r * 180) / Math.PI;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Eigen-decomposition of a symmetric 3x3 by cyclic Jacobi rotation.
 * Small, exact enough, and — unlike a closed-form cubic — does not lose
 * precision when two eigenvalues are close, which is exactly what happens
 * when the supplied lines are nearly parallel.
 */
function jacobiEigen(m: number[][]): { values: number[]; vectors: number[][] } {
  const a = m.map((r) => [...r]);
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 64; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}

/** Homogeneous line through a segment's endpoints, scaled so that l·(x,y,1)
 *  is a signed distance in pixels. */
function lineOf(s: Segment): Vec3 {
  const l = cross([s.x0, s.y0, 1], [s.x1, s.y1, 1]);
  const n = Math.hypot(l[0], l[1]) || 1;
  return [l[0] / n, l[1] / n, l[2] / n];
}

/** Least-squares vanishing point: the direction minimising Σ(l·v)². */
function fitVp(lines: Vec3[]): Vec3 {
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const l of lines) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i][j] += l[i] * l[j];
  }
  const { values, vectors } = jacobiEigen(m);
  let k = 0;
  for (let i = 1; i < 3; i++) if (values[i] < values[k]) k = i;
  return unit([vectors[0][k], vectors[1][k], vectors[2][k]]);
}

/** Pixel distance from the (finite) vanishing point to a line. Infinite-ish
 *  vanishing points are reported as such rather than as a huge number. */
function residual(l: Vec3, v: Vec3): number | null {
  if (Math.abs(v[2]) < 1e-9) return null;
  return Math.abs(dot(l, v) / v[2]);
}

const med = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[n >> 1] : 0.5 * (s[(n >> 1) - 1] + s[n >> 1]);
};

interface Family {
  label: string;
  count: number;
  segments: Segment[];
  lines: Vec3[];
  vp: Vec3;
  finite: boolean;
  point: [number, number] | null;
  residuals: (number | null)[];
  maxResidual: number | null;
  medResidual: number | null;
  loo: { worst: number | null; median: number | null } | null;
  vertical: boolean;
}

/**
 * Auto-label when the agent supplies none: near-image-vertical lines are the
 * vertical family, the rest split by slope sign — the ordinary corner-view
 * case. Reported back explicitly so a wrong guess is visible, not silent.
 */
function autoLabel(s: Segment): string {
  const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
  if (Math.abs(dy) > Math.abs(dx) / Math.tan((25 * Math.PI) / 180)) return "vertical";
  return (dy / (dx || 1e-9)) < 0 ? "horizontal-a" : "horizontal-b";
}

export function solveCamera(
  size: [number, number],
  segments: Segment[],
  known?: KnownScale,
) {
  const [W, H] = size;
  const diag = Math.hypot(W, H);
  const warnings: string[] = [];

  if (segments.length < 4) {
    throw new Error(
      `solve_camera needs at least 4 line segments (got ${segments.length}) — ` +
      "two per family for two families, or it cannot fit anything to check.",
    );
  }

  const labelled = segments.map((s) => ({ ...s, label: s.label ?? autoLabel(s) }));
  if (segments.some((s) => !s.label)) {
    warnings.push(
      "some lines had no label, so families were guessed from direction " +
      "(near-vertical → 'vertical', others split by slope sign). Check the grouping " +
      "below before trusting the pose; supply labels to control it.",
    );
  }

  const byLabel = new Map<string, Segment[]>();
  for (const s of labelled) {
    const arr = byLabel.get(s.label!) ?? [];
    arr.push(s);
    byLabel.set(s.label!, arr);
  }

  const families: Family[] = [];
  for (const [label, segs] of byLabel) {
    if (segs.length < 2) {
      warnings.push(`family '${label}' has only ${segs.length} line — skipped (a vanishing point needs 2)`);
      continue;
    }
    const lines = segs.map(lineOf);
    const vp = fitVp(lines);
    // "Finite" has to mean practically finite, not merely non-zero in the
    // homogeneous coordinate. A frontal elevation produced a vanishing point
    // 472 image-diagonals away and reported it as a real point, which then
    // contradicted the refusal message right beneath it. Anything past ~50
    // diagonals is a parallel family.
    const far = Math.abs(vp[2]) < 1e-9 || Math.hypot(vp[0] / vp[2] - W / 2, vp[1] / vp[2] - H / 2) > 50 * diag;
    const finite = !far;
    const residuals = lines.map((l) => residual(l, vp));

    // Leave-one-out: refit without each line, then measure that line against
    // a vanishing point it did not help create. This is the cross-check the
    // method's Step 2.5 asks for, as code — a fit always explains its own
    // input, so only a withheld line tests it.
    let loo: Family["loo"] = null;
    if (segs.length >= 3) {
      const errs: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const rest = lines.filter((_, j) => j !== i);
        const r = residual(lines[i], fitVp(rest));
        if (r !== null) errs.push(r);
      }
      if (errs.length) loo = { worst: Math.max(...errs), median: med(errs) };
    } else {
      warnings.push(`family '${label}' has 2 lines: fitted exactly, so its residuals are 0 by construction and prove nothing — add a third line to get a real check`);
    }

    families.push({
      label,
      count: segs.length,
      segments: segs,
      lines,
      vp,
      finite,
      point: finite ? [vp[0] / vp[2], vp[1] / vp[2]] : null,
      residuals,
      maxResidual: residuals.some((r) => r === null) ? null : Math.max(...(residuals as number[])),
      medResidual: med(residuals.filter((r): r is number => r !== null)),
      loo,
      vertical: label.toLowerCase().startsWith("vert"),
    });
  }

  const verticalFam = families.find((f) => f.vertical);
  const horizontals = families.filter((f) => !f.vertical);

  if (horizontals.length < 1) {
    throw new Error("no horizontal family found — label at least one family of eave/sill/ridge lines");
  }

  // ---- Horizon: the join of two horizontal vanishing points. Homogeneous
  // coordinates handle a family that vanishes at infinity without a branch.
  let horizon: Vec3 | null = null;
  if (horizontals.length >= 2) {
    horizon = cross(horizontals[0].vp, horizontals[1].vp);
    const n = Math.hypot(horizon[0], horizon[1]) || 1;
    horizon = [horizon[0] / n, horizon[1] / n, horizon[2] / n];
  }
  const horizonY = (x: number) => (horizon && Math.abs(horizon[1]) > 1e-9 ? -(horizon[0] * x + horizon[2]) / horizon[1] : null);

  // ---- Intrinsics.
  const centre: [number, number] = [W / 2, H / 2];
  let pp = centre;
  let ppSource = "assumed image centre";
  let focal: number | null = null;
  let inconsistent: string | null = null;

  const h0 = horizontals[0], h1 = horizontals[1];

  if (known?.principal_point === "solve" && h0?.point && h1?.point && verticalFam?.point) {
    // Three finite vanishing points pin the principal point: it is the
    // orthocentre of their triangle. This is the only case where the
    // cx/f trade-off is actually resolved rather than assumed.
    const [ax, ay] = h0.point, [bx, by] = h1.point, [cx, cy] = verticalFam.point;
    // Altitude from A ⟂ BC and altitude from B ⟂ AC, as a 2x2 system.
    const a1 = cx - bx, b1 = cy - by, c1 = a1 * ax + b1 * ay;
    const a2 = cx - ax, b2 = cy - ay, c2 = a2 * bx + b2 * by;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) > 1e-6) {
      pp = [(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det];
      ppSource = "orthocentre of the three vanishing points (three finite VPs pin it)";
    }
  }

  if (h0?.point && h1?.point) {
    const f2 = -((h0.point[0] - pp[0]) * (h1.point[0] - pp[0]) + (h0.point[1] - pp[1]) * (h1.point[1] - pp[1]));
    if (f2 > 0) focal = Math.sqrt(f2);
    else {
      inconsistent =
        `focal length came out imaginary (f² = ${r2(f2)}): the two horizontal families ` +
        `'${h0.label}' and '${h1.label}' are not consistent with a 90° corner seen through ` +
        `a camera whose principal point is ${ppSource}. Either the two families are not ` +
        "perpendicular in the world, or a line is mis-assigned — check the residuals below.";
    }
  } else if (verticalFam?.point && h0?.point) {
    const f2 = -((verticalFam.point[0] - pp[0]) * (h0.point[0] - pp[0]) + (verticalFam.point[1] - pp[1]) * (h0.point[1] - pp[1]));
    if (f2 > 0) {
      focal = Math.sqrt(f2);
      warnings.push(
        "focal length came from the vertical + one horizontal family. That pair is " +
        "orthogonal, so the algebra is valid, but with only one horizontal direction the " +
        "yaw of the building around the vertical is NOT determined — supply a second " +
        "horizontal family to fix it.",
      );
    }
  }

  if (!focal && !inconsistent) {
    inconsistent =
      "not enough finite vanishing points to recover a focal length. Two families vanish " +
      "at infinity (their lines are parallel in the image), which means the camera is " +
      "square-on to them — a shifted-lens/orthographic-like view. Set the focal length " +
      "from the lens if you know it, or supply lines from a receding direction.";
  }

  // ---- Pose, in camera coordinates (x right, y down, z forward).
  const dirOf = (f: Family | undefined): Vec3 | null => {
    if (!f || !focal) return null;
    // K⁻¹v for a finite or infinite vanishing point alike.
    return unit([(f.vp[0] - pp[0] * f.vp[2]) / focal, (f.vp[1] - pp[1] * f.vp[2]) / focal, f.vp[2]]);
  };

  let tilt: number | null = null;
  let roll: number | null = null;
  const yawTo: Record<string, number> = {};
  let up: Vec3 | null = null;

  const dV = dirOf(verticalFam);
  if (dV) {
    // World-up in camera coords: the sign that points up the image.
    up = dV[1] > 0 ? ([-dV[0], -dV[1], -dV[2]] as Vec3) : dV;
    const fwd: Vec3 = [0, 0, 1];
    // Angle of the optical axis above the horizontal plane.
    tilt = deg(Math.asin(Math.max(-1, Math.min(1, dot(fwd, up)))));
    roll = deg(Math.atan2(up[0], -up[1]));
    const fh = unit([fwd[0] - dot(fwd, up) * up[0], fwd[1] - dot(fwd, up) * up[1], fwd[2] - dot(fwd, up) * up[2]]);
    for (const f of horizontals) {
      const d = dirOf(f);
      if (!d) continue;
      const dh = unit([d[0] - dot(d, up) * up[0], d[1] - dot(d, up) * up[1], d[2] - dot(d, up) * up[2]]);
      yawTo[f.label] = r2(deg(Math.atan2(dot(cross(fh, dh), up), dot(fh, dh))));
    }
  } else {
    // Be accurate about WHY. Saying "no vertical family" when three vertical
    // lines were supplied sends the caller to fix the wrong thing.
    warnings.push(
      verticalFam
        ? "tilt/roll/yaw need a focal length, and none could be recovered — fix the cause " +
          "given in `inconsistent` first; the vertical family itself is fine"
        : "no vertical family, so tilt/roll/yaw are not recoverable — label 2–3 vertical edges 'vertical'",
    );
  }

  // ---- Orthogonality cross-check: the recovered directions must be mutually
  // perpendicular. This is independent of the residuals (a family can fit its
  // own lines perfectly and still sit in the wrong place).
  const orthoError: { pair: string; deg_from_90: number }[] = [];
  if (focal) {
    const withDir = families
      .map((f) => ({ f, d: dirOf(f) }))
      .filter((x): x is { f: Family; d: Vec3 } => x.d !== null);
    for (let i = 0; i < withDir.length; i++) {
      for (let j = i + 1; j < withDir.length; j++) {
        const a = deg(Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(withDir[i].d, withDir[j].d))))));
        orthoError.push({ pair: `${withDir[i].f.label} ⟂ ${withDir[j].f.label}`, deg_from_90: r2(90 - a) });
      }
    }
  }

  // ---- Eye height: the horizon cuts a standing vertical at the camera's eye
  // height. Each vertical segment therefore reports it as a fraction of its
  // own height, with no extra input.
  let eye: {
    per_line: number[];
    fraction: number | null;
    height_m?: number;
    /** From the horizon + cross-ratio: eye height as a share of the height. */
    eye_height_m?: number;
    /** Solved metrically from the rays; agreement with the above is a check. */
    eye_height_m_metric?: number;
    horizontal_distance_m?: number;
  } | null = null;
  if (verticalFam && horizon) {
    const fracs: number[] = [];
    const bases: [number, number][] = [];
    const tops: [number, number][] = [];
    for (const s of verticalFam.segments) {
      const top: [number, number] = s.y0 < s.y1 ? [s.x0, s.y0] : [s.x1, s.y1];
      const bot: [number, number] = s.y0 < s.y1 ? [s.x1, s.y1] : [s.x0, s.y0];
      const x = (s.x0 + s.x1) / 2;
      const yh = horizonY(x);
      if (yh === null || bot[1] - top[1] < 1) continue;
      // Cross-ratio, not linear interpolation. The horizon cuts a standing
      // vertical at eye height, but image distance is not proportional to
      // world distance — the vertical vanishing point is the fourth point
      // that makes the ratio exact. Ignoring it biased this by ~7% on a
      // 12°-tilt synthetic camera, and the bias grows with tilt.
      const lin = (bot[1] - yh) / (bot[1] - top[1]);
      const yv = verticalFam.point?.[1];
      const exact =
        yv !== undefined && Math.abs(yh - yv) > 1e-6
          ? lin * ((top[1] - yv) / (yh - yv))
          : lin;
      fracs.push(exact);
      bases.push(bot);
      tops.push(top);
    }
    const fraction = med(fracs);
    if (fraction !== null) {
      eye = { per_line: fracs.map(r4), fraction: r4(fraction) };
      if (known?.height_m && known.height_m > 0) {
        eye.height_m = known.height_m;
        eye.eye_height_m = r2(fraction * known.height_m);
        // Metric placement, solved rather than approximated. A vertical edge
        // of known height fixes the scale outright: with rays through its two
        // endpoints and the world-up direction, λ_top·r_top − λ_base·r_base =
        // height·up is three equations in two unknowns. Least-squares it.
        if (focal && up && bases.length) {
          const ray = (p: [number, number]): Vec3 =>
            unit([(p[0] - pp[0]) / focal!, (p[1] - pp[1]) / focal!, 1]);
          const dists: number[] = [];
          const heights: number[] = [];
          for (let i = 0; i < bases.length; i++) {
            const rB = ray(bases[i]), rT = ray(tops[i]);
            const target: Vec3 = [known.height_m * up[0], known.height_m * up[1], known.height_m * up[2]];
            // Normal equations for [rT, -rB]·[λT, λB]ᵀ = target.
            const a11 = dot(rT, rT), a12 = -dot(rT, rB), a22 = dot(rB, rB);
            const b1 = dot(rT, target), b2 = -dot(rB, target);
            const det = a11 * a22 - a12 * a12;
            if (Math.abs(det) < 1e-9) continue;
            const lT = (b1 * a22 - a12 * b2) / det;
            const lB = (a11 * b2 - a12 * b1) / det;
            if (!(lB > 0) || !(lT > 0)) continue;
            const P: Vec3 = [lB * rB[0], lB * rB[1], lB * rB[2]];
            const toCam: Vec3 = [-P[0], -P[1], -P[2]];
            const hgt = dot(toCam, up);
            const horiz = Math.hypot(toCam[0] - hgt * up[0], toCam[1] - hgt * up[1], toCam[2] - hgt * up[2]);
            heights.push(hgt);
            dists.push(horiz);
          }
          const dm = med(dists), hm = med(heights);
          if (dm !== null) eye.horizontal_distance_m = r2(dm);
          if (hm !== null) eye.eye_height_m_metric = r2(hm);
        }
      }
      if (fraction < 0 || fraction > 1.2) {
        warnings.push(
          `the horizon falls outside the vertical segments (eye-height fraction ${r4(fraction)}). ` +
          "That is possible (looking down from above, or up from below the base) but it is " +
          "also what a mis-picked vertical or a wrong horizon looks like — verify by eye.",
        );
      }
    }
  }

  // ---- The camera block: the thing the agent actually needs to paste.
  let cameraBlock: Record<string, unknown> | null = null;
  if (focal) {
    const vfov = r2(deg(2 * Math.atan(H / (2 * focal))));
    const offCentre = Math.hypot(pp[0] - centre[0], pp[1] - centre[1]);
    // A principal point away from the frame centre is an asymmetric frustum.
    // Three.js expresses that as a symmetric frustum over a larger virtual
    // frame, cropped back to the render size — this is the setViewOffset
    // arithmetic runs have repeatedly rederived by hand.
    const fullW = 2 * Math.max(pp[0], W - pp[0]);
    const fullH = 2 * Math.max(pp[1], H - pp[1]);
    const offX = fullW / 2 - pp[0];
    const offY = fullH / 2 - pp[1];
    const fullFov = r2(deg(2 * Math.atan(fullH / (2 * focal))));
    const needsOffset = offCentre > 0.5;

    cameraBlock = {
      render_size: [W, H],
      fov_deg: needsOffset ? fullFov : vfov,
      aspect: needsOffset ? r4(fullW / fullH) : r4(W / H),
      set_view_offset: needsOffset
        ? { fullWidth: r2(fullW), fullHeight: r2(fullH), x: r2(offX), y: r2(offY), width: W, height: H }
        : null,
      orientation_deg: { tilt_above_horizontal: tilt === null ? null : r2(tilt), roll: roll === null ? null : r2(roll), yaw_to_family: yawTo },
      snippet: [
        `// focal ${r2(focal)} px, principal point ${ppSource}`,
        `const camera = new THREE.PerspectiveCamera(${needsOffset ? fullFov : vfov}, ${needsOffset ? r4(fullW / fullH) : r4(W / H)}, 0.1, 5000);`,
        needsOffset
          ? `camera.setViewOffset(${r2(fullW)}, ${r2(fullH)}, ${r2(offX)}, ${r2(offY)}, ${W}, ${H}); // principal point is off-centre`
          : `// principal point is within 0.5 px of centre — no setViewOffset needed`,
        eye?.horizontal_distance_m !== undefined
          ? `camera.position.set(0, ${eye.eye_height_m_metric ?? eye.eye_height_m}, ${eye.horizontal_distance_m}); // solved from the known height; place the subject's near vertical edge at the origin`
          : `camera.position.set(0, EYE_HEIGHT, DISTANCE); // supply known.height_m to get these`,
        tilt === null
          ? `camera.lookAt(0, TARGET_Y, 0);`
          : `camera.lookAt(0, ${
              eye?.horizontal_distance_m !== undefined
                ? r2((eye.eye_height_m_metric ?? eye.eye_height_m ?? 0) + eye.horizontal_distance_m * Math.tan((tilt * Math.PI) / 180))
                : "TARGET_Y"
            }, 0); // ${r2(tilt)}° above horizontal`,
      ].join("\n"),
    };
  }

  // ---- Verdict. Thresholds are stated so a caller can disagree with them.
  const allLoo = families.map((f) => f.loo?.worst).filter((v): v is number => v !== undefined && v !== null);
  const worstLoo = allLoo.length ? Math.max(...allLoo) : null;

  // Name the single worst line. "Check the residuals" is a chore; "line 3 of
  // 'eave-a', the one from (648,690) to (1090,700), misses by 2470 px" is an
  // instruction — and re-picking one line is nearly always the actual fix.
  let culprit: string | null = null;
  {
    let worst = -1;
    for (const f of families) {
      f.residuals.forEach((r, i) => {
        if (r !== null && r > worst) {
          worst = r;
          const s = f.segments[i];
          culprit =
            `line ${i + 1} of ${f.count} in family '${f.label}' — ` +
            `(${Math.round(s.x0)},${Math.round(s.y0)})→(${Math.round(s.x1)},${Math.round(s.y1)}), ` +
            `missing its own vanishing point by ${r2(r)} px`;
        }
      });
    }
  }
  if (inconsistent && culprit) inconsistent += ` Worst offender: ${culprit}.`;
  const worstOrtho = orthoError.length ? Math.max(...orthoError.map((o) => Math.abs(o.deg_from_90))) : null;
  const verdict = inconsistent
    ? "inconsistent"
    : worstLoo !== null && worstLoo > diag * 0.02
      ? "weak"
      : worstOrtho !== null && worstOrtho > 8
        ? "weak"
        : "usable";

  if (verdict === "weak") {
    warnings.push(
      "the fit is weak: either a withheld line missed its own vanishing point by more than " +
      "2% of the image diagonal, or the recovered axes are more than 8° from perpendicular. " +
      "This is common with hand-picked lines and it is worth acting on — over randomised " +
      "cameras, 'usable' fits kept focal error under ~12% while 'weak' ones reached 48%. " +
      "The fix is nearly always the picking, not the solver: use the LONGEST runs of each " +
      "family you can see, spread them apart rather than clustering them, and re-pick the " +
      "worst line named in cross_check.worst_line. Endpoint accuracy is what matters — a " +
      "short line pinned to two fuzzy pixels aims its vanishing point badly.",
    );
  }

  return {
    size: [W, H],
    families: families.map((f) => ({
      label: f.label,
      lines: f.count,
      vanishing_point: f.point ? [r2(f.point[0]), r2(f.point[1])] : null,
      at_infinity: !f.finite,
      residual_px: {
        per_line: f.residuals.map((r) => (r === null ? null : r2(r))),
        max: f.maxResidual === null ? null : r2(f.maxResidual),
        median: f.medResidual === null ? null : r2(f.medResidual),
      },
      leave_one_out_px: f.loo ? { worst: r2(f.loo.worst!), median: r2(f.loo.median!) } : null,
    })),
    horizon: horizon
      ? {
          line_abc: [r4(horizon[0]), r4(horizon[1]), r4(horizon[2])],
          y_at_x0: horizonY(0) === null ? null : r2(horizonY(0)!),
          y_at_centre: horizonY(W / 2) === null ? null : r2(horizonY(W / 2)!),
          y_at_xmax: horizonY(W) === null ? null : r2(horizonY(W)!),
        }
      : null,
    intrinsics: focal
      ? {
          focal_px: r2(focal),
          fov_vertical_deg: r2(deg(2 * Math.atan(H / (2 * focal)))),
          principal_point: [r2(pp[0]), r2(pp[1])],
          principal_point_source: ppSource,
          ambiguity:
            ppSource.startsWith("assumed")
              ? "The frame centre was assumed. Principal point and focal length cannot be " +
                "separated from two vanishing points — a lens shift and a longer lens make " +
                "nearly the same image — and this is the default on purpose: measured over " +
                "randomised cameras with ±1.5 px pick noise, assuming the centre halved the " +
                "95th-percentile focal error against solving the orthocentre (11% vs 25%), " +
                "because the orthocentre is exact on perfect input but amplifies pick error. " +
                "If the image is cropped or shot on a shift lens, re-run with " +
                "known.principal_point = 'solve'."
              : "Solved as the orthocentre of three finite vanishing points, on request. " +
                "This is the right choice for a cropped or shifted image, but it is " +
                "noise-sensitive: check that it landed plausibly near the frame centre " +
                "unless you know the image was cropped.",
        }
      : null,
    pose: {
      tilt_above_horizontal_deg: tilt === null ? null : r2(tilt),
      roll_deg: roll === null ? null : r2(roll),
      yaw_to_family_deg: yawTo,
      known_pitch_deg: known?.pitch_deg ?? null,
    },
    // Derived quantities are withheld when the solve is inconsistent. They
    // are computable from a broken horizon — an eye height of −17 m is
    // arithmetic, not a measurement — and printing them next to a refusal
    // invites someone to use them anyway. The diagnostics below stay: those
    // are what fixes the input.
    eye_height: inconsistent ? null : eye,
    cross_check: {
      leave_one_out_worst_px: worstLoo === null ? null : r2(worstLoo),
      leave_one_out_threshold_px: r2(diag * 0.02),
      orthogonality: orthoError,
      worst_line: culprit,
      verdict,
    },
    camera_block: cameraBlock,
    inconsistent,
    warnings,
    notes:
      "Vanishing points are fitted, not assumed: residual_px is how far each supplied line " +
      "misses the point it was fitted to, and leave_one_out_px is how far a line misses a " +
      "point fitted WITHOUT it — only the second is a real test. Angles are in degrees, " +
      "lengths in original-image pixels. The distance estimate (if any) is first-order: " +
      "refine it with the scoring loop, do not trust it to better than ~10%.",
  };
}
