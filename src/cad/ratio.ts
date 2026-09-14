import { dimensions, PROFILES, validate } from './parameters';
import type { Parameters } from './parameters';
export type RatioRequirements = {
  target: number;
  tolerance: number;
  driveMin: number;
  driveMax: number;
  drivenMin: number;
  drivenMax: number;
  drivenBore: number;
  driveMaxOD: number;
  drivenMaxOD: number;
  beltLength: number;
  centerMin: number;
  centerMax: number;
};
export const DEFAULT_RATIO: RatioRequirements = {
  target: 3,
  tolerance: 1,
  driveMin: 12,
  driveMax: 48,
  drivenMin: 12,
  drivenMax: 160,
  drivenBore: 8,
  driveMaxOD: 0,
  drivenMaxOD: 0,
  beltLength: 0,
  centerMin: 0,
  centerMax: 0,
};
export type PulleyPair = {
  drive: Parameters;
  driven: Parameters;
  ratio: number;
  error: number;
  centerDistance?: number;
  beltLength?: number;
  engagedTeeth?: number;
};
// Exact open-belt pitch-line length: two external tangents and two pitch arcs.
export function beltPitchLength(r1: number, r2: number, center: number) {
  const delta = Math.abs(r2 - r1);
  if (center <= delta) return Infinity;
  const angle = Math.asin(delta / center);
  return 2 * Math.sqrt(center * center - delta * delta) + Math.PI * (r1 + r2) + 2 * delta * angle;
}
export function centerForBelt(r1: number, r2: number, length: number, minCenter: number) {
  let lo = Math.max(minCenter, Math.abs(r2 - r1) + 1e-6),
    hi = length / 2;
  if (hi < lo || beltPitchLength(r1, r2, lo) > length + 1e-7) return undefined;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (beltPitchLength(r1, r2, mid) > length) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
export function findPairs(
  p: Parameters,
  q: RatioRequirements,
): { pairs: PulleyPair[]; total: number } {
  if (Object.values(q).some((v) => !Number.isFinite(v)))
    throw Error('Fill in the ratio requirements with numbers.');
  if (q.target < 0.05 || q.target > 20) throw Error('Target ratio must be between 0.05 and 20.');
  if (q.tolerance < 0 || q.tolerance > 25)
    throw Error('Ratio tolerance must be between 0 and 25%.');
  for (const [min, max] of [
    [q.driveMin, q.driveMax],
    [q.drivenMin, q.drivenMax],
  ])
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 12 || max > 240 || min > max)
      throw Error('Use whole-tooth ranges from 12 to 240, with minimum no greater than maximum.');
  if (q.drivenBore < 0 || q.drivenBore > 1000)
    throw Error('Driven bore must be between 0 and 1000 mm.');
  for (const v of [q.driveMaxOD, q.drivenMaxOD, q.beltLength, q.centerMin, q.centerMax])
    if (v < 0 || v > 20000) throw Error('Optional size limits must be between 0 and 20,000 mm.');
  if (q.centerMax > 0 && q.centerMin > q.centerMax)
    throw Error('Minimum shaft spacing cannot exceed maximum spacing.');
  if (!q.beltLength && (q.centerMin || q.centerMax))
    throw Error('Enter belt pitch length to filter shaft spacing.');
  const pitch = PROFILES[p.profile].pitch;
  if (q.beltLength && Math.abs(q.beltLength / pitch - Math.round(q.beltLength / pitch)) > 1e-6)
    throw Error(`Belt pitch length must be a multiple of ${pitch} mm for HTD ${p.profile}.`);
  const candidates = (min: number, max: number, bore: number, maxOD: number) => {
    const out: Parameters[] = [];
    for (let teeth = min; teeth <= max; teeth++)
      try {
        const candidate = validate({ ...p, teeth, bore });
        if (!maxOD || dimensions(candidate).flange <= maxOD + 1e-8) out.push(candidate);
      } catch {
        /* Filter dimensions that cannot form a valid pulley. */
      }
    return out;
  };
  const drives = candidates(q.driveMin, q.driveMax, p.bore, q.driveMaxOD),
    drivens = candidates(q.drivenMin, q.drivenMax, q.drivenBore, q.drivenMaxOD),
    pairs: PulleyPair[] = [];
  for (const drive of drives)
    for (const driven of drivens) {
      const ratio = driven.teeth / drive.teeth,
        error = Math.abs(ratio / q.target - 1) * 100;
      if (error > q.tolerance + 1e-8) continue;
      const pair: PulleyPair = { drive, driven, ratio, error };
      if (q.beltLength) {
        const d1 = dimensions(drive),
          d2 = dimensions(driven),
          r1 = d1.pitch / 2,
          r2 = d2.pitch / 2;
        const minCenter = Math.max((d1.flange + d2.flange) / 2 + 1, q.centerMin);
        const center = centerForBelt(r1, r2, q.beltLength, minCenter);
        if (center === undefined || (q.centerMax > 0 && center > q.centerMax + 1e-7)) continue;
        const wrap = Math.PI - 2 * Math.asin(Math.abs(r2 - r1) / center);
        const engaged = (Math.min(drive.teeth, driven.teeth) * wrap) / (2 * Math.PI);
        if (engaged < 6 - 1e-7) continue;
        pair.centerDistance = center;
        pair.beltLength = q.beltLength;
        pair.engagedTeeth = engaged;
      }
      pairs.push(pair);
    }
  pairs.sort(
    (a, b) =>
      Math.round(a.error * 1e8) - Math.round(b.error * 1e8) ||
      a.drive.teeth + a.driven.teeth - (b.drive.teeth + b.driven.teeth) ||
      a.drive.teeth - b.drive.teeth,
  );
  return { pairs: pairs.slice(0, 60), total: pairs.length };
}
