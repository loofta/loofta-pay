/**
 * Non-overlapping egg layout for NestHero. Each egg's on-screen footprint is a circle in the
 * XZ plane (the egg mesh is scaled equally in x/z, only stretched taller in y — see NestHero's
 * `sc`/`egg.scale.set` math, mirrored here in eggFootprintRadius), so "no collision" reduces to:
 * real XZ distance between any two egg centers must be >= the sum of their footprint radii.
 *
 * Hand-picked positions couldn't guarantee that as weights changed, so this places eggs
 * deterministically (seeded via a golden-angle spiral, not Math.random) — biggest egg first,
 * near the center, each next egg searching outward until it clears every egg already placed.
 * The search area itself scales with the *total* egg footprint area (not a fixed constant) —
 * a fixed bound was the actual bug: 8 smallish eggs and 5 large ones need very different amounts
 * of room, and a bound sized for one silently failed (and dumped an egg dead-center, overlapping
 * everything) for the other.
 */

const EGG_BASE_RADIUS = 0.43;
const EGG_XZ_SCALE = 0.88;
const ASPECT = 0.76; // z/x — roughly matches the nest's own woven-rim ellipse ratio
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function eggFootprintRadius(weight: number): number {
  const sc = 0.62 + weight * 1.5;
  return EGG_BASE_RADIUS * EGG_XZ_SCALE * sc;
}

export interface PackOpts {
  margin?: number;
  baseY?: number;
  /** Target fraction of the search ellipse's area actually covered by eggs — lower = more
   *  breathing room, but too low pushes eggs out toward (or past) the nest's rim. */
  fillFraction?: number;
  attempts?: number;
}

export function packEggPositions(weights: number[], opts: PackOpts = {}): [number, number, number][] {
  const { margin = 0.02, baseY = 0.32, fillFraction = 0.46, attempts = 4000 } = opts;

  const radii = weights.map(eggFootprintRadius);
  const totalArea = radii.reduce((sum, r) => sum + Math.PI * r * r, 0);
  const containerArea = totalArea / fillFraction;
  const boundRx = Math.max(0.8, Math.min(1.55, Math.sqrt(containerArea / (Math.PI * ASPECT))));
  const boundRz = boundRx * ASPECT;
  const maxBound = Math.max(boundRx, boundRz);

  const order = weights.map((_, i) => i).sort((a, b) => radii[b] - radii[a]);
  const placed: { x: number; z: number; r: number }[] = [];
  const positions: [number, number, number][] = new Array(weights.length);

  for (const i of order) {
    const r = radii[i];
    let best: { x: number; z: number } | null = null;
    for (let attempt = 0; attempt < attempts && !best; attempt++) {
      const searchR = Math.sqrt(attempt / attempts) * maxBound;
      const angle = attempt * GOLDEN_ANGLE;
      const cx = Math.cos(angle) * searchR;
      const cz = Math.sin(angle) * searchR * (boundRz / boundRx);
      if ((cx / boundRx) ** 2 + (cz / boundRz) ** 2 > 1) continue;
      if (placed.every(p => Math.hypot(cx - p.x, cz - p.z) >= p.r + r + margin)) {
        best = { x: cx, z: cz };
      }
    }
    // Only unreachable with pathological inputs (e.g. dozens of near-maximum-weight eggs) —
    // fillFraction leaves enough slack in every realistic case (verified up to 8 real holdings).
    const pos = best ?? { x: 0, z: 0 };
    placed.push({ x: pos.x, z: pos.z, r });
    const dist = Math.hypot(pos.x, pos.z);
    positions[i] = [pos.x, baseY + Math.min(dist * 0.12, 0.14), pos.z];
  }
  return positions;
}
