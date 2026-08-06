import { createWhiteHouseModel, TOTAL_H, DIM, CAM_D } from '../models/whiteHouse';
import type { BuildingModel } from '../lib/types';

const WALL_Z = DIM.depth / 2;
/** Camera stand-off from the world origin, on the solved 95 m from the wall plane. */
const REF_Z = WALL_Z + CAM_D;
const EYE = 1.7;

export const whiteHouse: BuildingModel = {
  id: 'whitehouse',
  label: 'White House',
  blurb: 'Procedural Three.js reconstruction from one photograph',
  referenceImage: '/reference-whitehouse.svg',
  heightM: TOTAL_H,
  build: (o) => createWhiteHouseModel(o),

  /**
   * The `ref` view is a SOLVED reproduction of the photograph, not a posed one.
   *
   * The reference is a LEVEL camera: the facade is parallel to the sensor, which is why
   * the window bay pitch measures the same (104.0 / 104.5 px) at both storeys with no
   * keystone at all. So the frame cannot be reproduced by tilting up — a tilt would
   * converge the verticals. It needs a shifted lens, which is what `shift` is:
   * render a sub-window of a taller frustum.
   *
   * Numbers behind the three parameters:
   *  - position z: the fountain ring's ellipse (1358 px wide, 36 px tall -> axis ratio
   *    0.0265 = eye height / distance) puts the ring 64 m out and the facade at 95 m.
   *  - fov 38.9 with fullScale 1.6: the sub-window's vertical half-extent at 95 m is
   *    95*tan(fov/2)/fullScale = 21.0 m, i.e. a 42.0 m tall frame over 1067 reference
   *    rows = 0.0394 m/px, which is the measured wall scale. The frame is then 63.0 m
   *    wide and the 51.9 m facade fills 0.82 of it, as it does in the photograph.
   *  - offsetYFrac 0.0615 = fullScale/2 - 788/1067: it drops the horizon onto reference
   *    row 788, where the fountain ellipse says it is.
   * The other four views are free-camera and show INVENTED geometry (see the model
   * header) — only `ref` is constrained by the photograph.
   */
  views: {
    ref: {
      pos: [0, EYE, REF_Z],
      target: [0, EYE, 0],
      fov: 38.9,
      shift: { fullScale: 1.6, offsetYFrac: 0.0615 },
    },
    q34: { pos: [66, 30, 82], target: [0, 8.5, 4], fov: 34 },
    side: { pos: [104, 14, 10], target: [0, 9.0, 0], fov: 30 },
    rear: { pos: [-42, 24, -100], target: [0, 9.0, 0], fov: 32 },
    top: { pos: [48, 70, 66], target: [0, 6.0, 0], fov: 40 },
  },

  /**
   * HARD SUNLIGHT — a fourth archetype after AM271's soft archviz (ratio 1.60),
   * Taipei's tropical sun (2.09) and the Empire State's overcast (1.27). Measured here:
   * a sunlit wall pier reads L = 192 while the portico recess reads L = 87, a ratio of
   * 2.16, the highest of the four. The sun sits to the RIGHT of frame and fairly high:
   * that is fixed by the left wing's piers darkening as they approach the portico
   * (164 -> 159 -> 145) while the right wing's do not (192 -> 189 -> 183), which is the
   * portico throwing its shadow leftward.
   */
  lighting: {
    // Sun azimuth 37 deg off the facade normal and 44 deg up. That throws the portico's
    // shadow LEFT and low across the inner bays of the left wing, which is the shadow
    // the reference's 145/159/164 pier gradient is recording. A more oblique sun draws
    // a hard diagonal across the whole wing, which the photograph plainly does not show.
    sun: { color: 0xfff6ec, intensity: 3.6, position: [118, 190, 155] },
    // The ground half of the hemisphere is a WARM grey, not lawn green. The reference's
    // portico recess is (90,88,69) — warm, red and green together and blue below. Bounce
    // off the stone drive dominates in there; feeding it grass green renders the recess
    // at (40,48,17), far too dark and visibly the wrong hue.
    hemi: { sky: 0xc6dcf6, ground: 0x8f8a70, intensity: 1.12 },
    // Sky gradient sampled off the reference: zenith #c3d3ec (L 210) washing out to
    // #e2f2fb (L 239) at the horizon.
    skyStops: [
      [0.00, '#a9c2e8'], [0.30, '#c3d3ec'], [0.62, '#dbeaf8'],
      [0.80, '#e2f2fb'], [1.00, '#a8a893'],
    ],
    exposure: 0.95,
    shadowExtent: 78,
  },

  /**
   * Targets are the __measure() harness algorithm run on the reference photograph
   * itself, with a clean blue-sky reference pixel (the render has sky in the top-left
   * corner where the photograph has tree). The `ref` view reproduces the photograph's
   * framing, so the harness samples the same parts of the same building in both.
   *
   * READ THE LABELS WITH CARE. The harness assumes a corner view and calls its left
   * band "lit" and its right band "shadow". This subject is square-on and symmetric, so
   * that is not what those bands are: the left band (x 330..824) is the left wing plus
   * the deeply shaded portico recess, and the right band (x 1126..1433) is plain sunlit
   * right-wing wall. Hence a ratio BELOW 1. It is still a real and useful measurement —
   * it is precisely "how dark is the portico against the open wall" — but it is not a
   * lit-face/shadow-face ratio.
   *
   * widthFrac is degenerate here and is a FRAMING check only: at this framing the
   * building overruns the harness's 0.20W..0.90W scan window at both ends, so the
   * measurement clips to 0.699 for the photograph and will clip identically for any
   * render that reproduces the framing. The honest geometry check is `notes`:
   *   silhouetteWH  facade width : (pediment apex -> 2nd-floor sill) = 1317 : 299 px
   *   wallVsPortico  sunlit wall pier L 188.4 / portico recess L 87.1
   *
   * CONVERGED at a 1050x700 viewport (1.500, matching the reference's 1.4995):
   *   litLuma 126.8/124.7 = 102%   shadowLuma 172.4/168.3 = 102%
   *   ratio    0.74/0.741 =  99%   widthFrac    0.700/0.699 = 100%
   *   bandingContrast 1.02/1.00 = 102%
   * And, sampling the render at the same image coordinates as the reference patches:
   *   sunlit wall pier 190.9/188.4 = 101%   left wing in portico shade 138.5/144.8 = 96%
   *   portico recess    82.6/ 87.1 =  95%   column shaft            167.3/157.6 = 106%
   *   tympanum         148.6/161.1 =  92%   entablature frieze      110.4/110.3 = 100%
   *   window glass      47.5/ 45.6 = 104%   sky zenith              217.0/209.7 = 103%
   *   lawn             130.0/128.1 = 101%   hedge                    35.6/ 35.9 =  99%
   *   wall/portico ratio 2.31/2.16 = 107%
   * Geometry verified independently of luma, by scanning the render the same way the
   * reference was scanned: baluster pitch 9.14 render px against 9.0 measured (102%),
   * and window bay centres at 1075/1178/1280/1383 against 1072.5/1176.5/1280/1384.5,
   * a bay pitch of 102.6 against 104.0 (99%).
   */
  targets: {
    litLuma: 124.7,
    shadowLuma: 168.3,
    ratio: 0.741,
    widthFrac: 0.699,
    notes: {
      bandingContrast: 1.00,
      silhouetteWH: 4.405,
      wallVsPortico: 2.16,
      bayPitchPx: 104.0,
      balusterPitchPx: 9.0,
    },
  },
};
