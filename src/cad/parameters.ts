import { DEFAULT_APPEARANCE, validateAppearance } from '../appearance.js';
import type { Appearance } from '../appearance.js';

/**
 * Tooth specs, millimeters.
 *
 * HTD 3M/5M/8M match FreeCAD Gears `timinggear.py` (offset 0: one valley arc
 * and a tip fillet). HTD 14M and 20M use that same construction with the
 * pulley-groove table published for circular-arc HTD pulleys (groove depth,
 * clearance-circle radius, and the low end of the tip-radius range):
 * https://wellpowerbelt.com/timing-belt-pulleys/
 * Radial pitch-line offset is half of (pitch diameter − outside diameter)
 * from the Pfeifer HTD PD/OD charts: 2.794 mm (0.110 in) for 14M and
 * 4.318 mm (0.170 in) for 20M.
 *
 * GT2/GT3/GT5 are the FreeCAD Gears modified-curvilinear profile (side arc
 * offset ≠ 0), not renamed HTD teeth. Pitch-line offset `u` matches SDP-SI
 * D265 Table 4 (0.254, 0.381, 0.5715 mm). Groove depth matches the published
 * G2M/G3M/G5M tooth heights 0.75, 1.14, and 1.93 mm; SDP-SI nominal GT2
 * groove depths are 0.76, 1.14, and 1.93 mm.
 * https://github.com/looooo/freecad.gears/blob/master/freecad/gears/timinggear.py
 */
export const PROFILES = {
  '3M': { family: 'HTD', pitch: 3, offset: 0.381, depth: 1.21, radius: 0.89, fillet: 0.26, side: 0.89, sideOffset: 0 },
  '5M': { family: 'HTD', pitch: 5, offset: 0.5715, depth: 2.16, radius: 1.6, fillet: 0.48, side: 1.6, sideOffset: 0 },
  '8M': { family: 'HTD', pitch: 8, offset: 0.686, depth: 3.45, radius: 2.46, fillet: 0.7, side: 2.46, sideOffset: 0 },
  '14M': { family: 'HTD', pitch: 14, offset: 1.397, depth: 6.2, radius: 4.65, fillet: 1.36, side: 4.65, sideOffset: 0 },
  '20M': { family: 'HTD', pitch: 20, offset: 2.159, depth: 8.6, radius: 6.84, fillet: 1.95, side: 6.84, sideOffset: 0 },
  GT2: { family: 'GT', pitch: 2, offset: 0.254, depth: 0.75, radius: 0.555, fillet: 0.15, side: 1, sideOffset: 0.4 },
  GT3: { family: 'GT', pitch: 3, offset: 0.381, depth: 1.14, radius: 0.85, fillet: 0.25, side: 1.52, sideOffset: 0.61 },
  GT5: { family: 'GT', pitch: 5, offset: 0.5715, depth: 1.93, radius: 1.44, fillet: 0.416, side: 2.57, sideOffset: 1.03 },
} as const;
export type Profile = keyof typeof PROFILES;
export type BeltFamily = (typeof PROFILES)[Profile]['family'];
/** ISO 724 coarse metric threads. Major diameter is the nominal size. */
export const SCREWS = {
  M2: { major: 2, pitch: 0.4 },
  'M2.5': { major: 2.5, pitch: 0.45 },
  M3: { major: 3, pitch: 0.5 },
  M4: { major: 4, pitch: 0.7 },
  M5: { major: 5, pitch: 0.8 },
  M6: { major: 6, pitch: 1 },
} as const;
export type ScrewSize = keyof typeof SCREWS;
export type Parameters = {
  profile: Profile;
  teeth: number;
  belt_width: number;
  clearance: number;
  bore: number;
  /** When true, the bore is a D-shaft profile instead of a circle. */
  d_shaft: boolean;
  /** Full round diameter of the D-shaft, in mm. Used only when `d_shaft` is true. */
  d_diameter: number;
  /**
   * Across-flat distance of the D-shaft, in mm: from the flat face to the
   * opposite point on the circle. Must be greater than 0 and less than
   * `d_diameter`. Used only when `d_shaft` is true.
   */
  d_flat: number;
  flanges: 'none' | 'bottom' | 'both';
  flange_thickness: number;
  flange_overhang: number;
  chamfer: number;
  hub_diameter: number;
  hub_length: number;
  /** Web lightening between the bore and the tooth roots. Off leaves a solid web. */
  lightening: 'off' | 'shell' | 'fins';
  /** Minimum wall left at the bore and under the tooth roots, in mm. */
  wall: number;
  /** Bottom collar with one radial set screw. Off leaves the hub unchanged. */
  set_screw: boolean;
  /** How far the set-screw collar extends from the pulley, in mm. */
  set_screw_height: number;
  /** Radial wall thickness of the set-screw collar, in mm. */
  set_screw_wall: number;
  set_screw_size: ScrewSize;
  /** Split shaft collar beyond the hub. Off adds nothing. */
  split_clamp: boolean;
  /** Axial length of the split clamp collar, in mm. */
  split_clamp_length: number;
  /** Radial wall thickness of the split clamp collar, in mm. Ears are sized from the screw. */
  split_clamp_wall: number;
  split_clamp_screw: ScrewSize;
};
export const DEFAULTS: Parameters = {
  profile: '8M',
  teeth: 24,
  belt_width: 20,
  clearance: 1,
  bore: 8,
  d_shaft: false,
  d_diameter: 8,
  d_flat: 7,
  flanges: 'both',
  flange_thickness: 1.5,
  flange_overhang: 2,
  chamfer: 0.4,
  hub_diameter: 0,
  hub_length: 0,
  lightening: 'off',
  wall: 2,
  set_screw: false,
  set_screw_height: 8,
  set_screw_wall: 4,
  set_screw_size: 'M3',
  split_clamp: false,
  split_clamp_length: 10,
  split_clamp_wall: 3,
  split_clamp_screw: 'M3',
};
/** Circular bore diameter, or the D-shaft's full round diameter when that mode is on. */
export function holeDiameter(p: Parameters) {
  return p.d_shaft ? p.d_diameter : p.bore;
}
export function profileLabel(id: Profile) {
  const spec = PROFILES[id];
  return spec.family === 'HTD' ? `HTD ${id}` : id;
}
/**
 * One bottom boss. A set screw uses the hub side: the collar is the longer of
 * the hub length and the set-screw height, and the wider of the hub diameter
 * and the bore plus two set-screw walls. Set screw off keeps the hub as entered.
 * The split clamp is a separate collar that starts on this same face.
 */
export function extension(p: Parameters) {
  if (!p.set_screw) return { length: p.hub_length, diameter: p.hub_diameter };
  const hole = holeDiameter(p);
  return {
    length: Math.max(p.hub_length, p.set_screw_height),
    diameter: Math.max(p.hub_diameter, hole + 2 * p.set_screw_wall),
  };
}
/** ISO 4762 socket-head diameter, used only to size split-clamp ears. */
export const SCREW_HEAD: Record<ScrewSize, number> = {
  M2: 3.8,
  'M2.5': 4.5,
  M3: 5.5,
  M4: 7,
  M5: 8.5,
  M6: 10,
};
/** ISO 273 medium clearance hole. */
export const SCREW_CLEARANCE: Record<ScrewSize, number> = {
  M2: 2.4,
  'M2.5': 2.9,
  M3: 3.4,
  M4: 4.5,
  M5: 5.5,
  M6: 6.6,
};
export function splitClampLayout(p: Parameters) {
  const screw = threadProfile(p.split_clamp_screw);
  const head = SCREW_HEAD[p.split_clamp_screw];
  const clearance = SCREW_CLEARANCE[p.split_clamp_screw];
  const hole = holeDiameter(p);
  const outerR = hole / 2 + p.split_clamp_wall;
  const earThick = Math.max(Number((screw.major * 1.15).toFixed(4)), 2.4);
  const slot = Math.max(1, screw.pitch);
  // Ears sit on −Y so a round-bore set screw (+Y) and a D-flat set screw (+X) stay clear.
  const yCenter = -(outerR + head / 2 + 0.4);
  const bite = Math.min(p.split_clamp_wall * 0.4, 1);
  const earInner = -(outerR - bite);
  const earOuter = yCenter - head / 2 - 0.6;
  return { screw, head, clearance, hole, outerR, earThick, slot, yCenter, earInner, earOuter };
}
/** ISO 68-1 basic metric profile: H = (√3/2) P, depth 5H/8, crest flat P/8, root flat P/4. */
export function threadProfile(size: ScrewSize) {
  const { major, pitch } = SCREWS[size];
  const H = (Math.sqrt(3) / 2) * pitch;
  const radial = (5 / 8) * H;
  return { major, pitch, radial, minor: major - 2 * radial };
}
export function dimensions(p: Parameters) {
  const s = PROFILES[p.profile],
    pitch = (p.teeth * s.pitch) / Math.PI,
    outside = pitch - 2 * s.offset;
  const count = { none: 0, bottom: 1, both: 2 }[p.flanges];
  return {
    pitch,
    outside,
    root: outside - 2 * s.depth,
    face: p.belt_width + p.clearance,
    total:
      p.belt_width +
      p.clearance +
      count * p.flange_thickness +
      Math.max(extension(p).length, p.split_clamp ? p.split_clamp_length : 0),
    flange: outside + (count ? 2 * p.flange_overhang : 0),
  };
}
/** Empty when lightening is off or the web can be cut. Otherwise a short status and no cut. */
export function lighteningStatus(p: Parameters) {
  if (p.lightening === 'off') return '';
  const d = dimensions(p);
  const inner = holeDiameter(p) / 2 + p.wall;
  const outer = d.root / 2 - p.wall;
  if (!(outer > inner + 0.2) || d.face <= p.wall + 0.2)
    return 'Not enough material for this minimum wall.';
  if (p.lightening === 'fins' && (4 * p.wall) / Math.max(inner, 0.2) >= Math.PI * 2 - 0.15)
    return 'Not enough material for this minimum wall.';
  return '';
}
/** Empty when the set screw is off or the thread fits in the collar. */
export function setScrewError(p: Parameters) {
  if (!p.set_screw) return '';
  const hole = holeDiameter(p);
  if (!(hole > 0)) return 'A set screw needs a bore so it can reach the shaft.';
  const screw = SCREWS[p.set_screw_size];
  const wall = (extension(p).diameter - hole) / 2;
  const needHeight = screw.major + 2 * screw.pitch;
  if (wall < screw.major - 1e-9)
    return `${p.set_screw_size} needs a set screw wall of at least ${screw.major} mm so the thread stays inside the collar.`;
  if (p.set_screw_height < needHeight - 1e-9)
    return `${p.set_screw_size} needs a set screw height of at least ${needHeight.toFixed(2)} mm so the thread stays inside the collar.`;
  if (screw.major >= hole - 0.2)
    return `${p.set_screw_size} is too large for a ${hole.toFixed(2)} mm bore. Use a smaller screw or a larger bore.`;
  return '';
}
/** Empty when the split clamp is off or the collar, ears, and screw fit. */
export function splitClampError(p: Parameters) {
  if (!p.split_clamp) return '';
  const hole = holeDiameter(p);
  if (!(hole > 0)) return 'A split clamp needs a bore so the collar can close on the shaft.';
  if (p.split_clamp_wall < 1.2 - 1e-9)
    return 'Split clamp wall must be at least 1.20 mm.';
  const layout = splitClampLayout(p);
  const needLength = layout.head + 1;
  if (p.split_clamp_length < needLength - 1e-9)
    return `Split clamp length must be at least ${needLength.toFixed(2)} mm so the ear surrounds the ${p.split_clamp_screw} screw head.`;
  const boltR = layout.clearance / 2;
  if (Math.abs(layout.yCenter) - boltR < hole / 2 + 0.4)
    return `${p.split_clamp_screw} would enter the shaft bore. Increase the split clamp wall or use a smaller screw.`;
  return '';
}
/** Cylinder centerlines closer than the sum of their radii. */
export function cylindersCollide(
  a: { y: number; z: number; r: number },
  b: { y: number; z: number; r: number },
) {
  return Math.hypot(a.y - b.y, a.z - b.z) < a.r + b.r - 1e-6;
}
/**
 * Both features start at the pulley face. This reports when the set-screw hole
 * and the clamp bolt still intersect.
 */
export function featuresCollide(p: Parameters) {
  if (!p.set_screw || !p.split_clamp) return '';
  const layout = splitClampLayout(p);
  const set = SCREWS[p.set_screw_size];
  const boss = extension(p);
  const setScrew = {
    y: p.d_shaft ? 0 : holeDiameter(p) / 2,
    z: boss.length - p.set_screw_height / 2,
    r: set.major / 2,
  };
  const bolt = { y: layout.yCenter, z: p.split_clamp_length / 2, r: layout.clearance / 2 };
  if (cylindersCollide(setScrew, bolt))
    return 'The set screw and the split clamp screw occupy the same space. Increase the set screw height or the clamp length, or turn one of them off.';
  return '';
}
export function shaftFeatureError(p: Parameters) {
  return featuresCollide(p) || setScrewError(p) || splitClampError(p);
}
export const LIMITS = {
  teeth: [12, 240],
  belt_width: [0.5, 200],
  clearance: [0, 10],
  bore: [0, 1000],
  d_diameter: [0, 1000],
  d_flat: [0, 1000],
  flange_thickness: [0.2, 15],
  flange_overhang: [0.2, 20],
  chamfer: [0, 5],
  hub_diameter: [0, 1000],
  hub_length: [0, 100],
  wall: [0.2, 40],
  set_screw_height: [0.2, 80],
  set_screw_wall: [0.2, 40],
  split_clamp_length: [0.2, 80],
  split_clamp_wall: [0.2, 40],
} as const;
const LEGACY_KEYS: Record<string, keyof Parameters> = {
  clamp: 'set_screw',
  clamp_height: 'set_screw_height',
  clamp_thickness: 'set_screw_wall',
  clamp_screw: 'set_screw_size',
};
function normalizeInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (Object.hasOwn(LEGACY_KEYS, key)) continue;
    out[key] = value;
  }
  for (const [key, value] of Object.entries(src)) {
    const next = LEGACY_KEYS[key];
    if (next && !Object.hasOwn(out, next)) out[next] = value;
  }
  return out;
}
export function validate(raw: unknown): Parameters {
  const input = normalizeInput(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Choose a PulleyLab settings file.');
  if (Object.keys(input).some((k) => !Object.hasOwn(DEFAULTS, k)))
    throw Error('This file includes unsupported settings.');
  const p = { ...DEFAULTS, ...input } as Parameters;
  if (typeof p.profile !== 'string' || !Object.hasOwn(PROFILES, p.profile))
    throw Error('Choose an HTD 3M, 5M, 8M, 14M, or 20M profile, or GT2, GT3, or GT5.');
  if (!['none', 'bottom', 'both'].includes(p.flanges))
    throw Error('Choose a valid flange arrangement.');
  if (!['off', 'shell', 'fins'].includes(p.lightening))
    throw Error('Choose solid, shell, or fin lightening.');
  if (typeof p.set_screw !== 'boolean') throw Error('Choose whether to add a set screw.');
  if (typeof p.split_clamp !== 'boolean') throw Error('Choose whether to add a split clamp.');
  if (typeof p.set_screw_size !== 'string' || !Object.hasOwn(SCREWS, p.set_screw_size))
    throw Error('Choose an M2, M2.5, M3, M4, M5, or M6 set screw.');
  if (typeof p.split_clamp_screw !== 'string' || !Object.hasOwn(SCREWS, p.split_clamp_screw))
    throw Error('Choose an M2, M2.5, M3, M4, M5, or M6 split clamp screw.');
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const value = p[key as keyof typeof LIMITS];
    const label =
      key === 'd_diameter'
        ? 'D-shaft diameter'
        : key === 'd_flat'
          ? 'D-shaft flat'
          : key === 'wall'
            ? 'Minimum wall'
            : key === 'set_screw_height'
              ? 'Set screw height'
              : key === 'set_screw_wall'
                ? 'Set screw wall'
                : key === 'split_clamp_length'
                  ? 'Split clamp length'
                  : key === 'split_clamp_wall'
                    ? 'Split clamp wall'
                    : key.replaceAll('_', ' ');
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi)
      throw Error(
        `${label} must be between ${lo} and ${hi} mm${key === 'teeth' ? ' (whole teeth)' : ''}.`.replace(
          '240 mm',
          '240',
        ),
      );
    if (Math.abs(value * 10000 - Math.round(value * 10000)) > 1e-5)
      throw Error('Use no more than four decimal places for dimensions.');
  }
  if (!Number.isInteger(p.teeth)) throw Error('Number of teeth must be a whole number.');
  if (typeof p.d_shaft !== 'boolean') throw Error('Choose a circular bore or a D-shaft bore.');
  if (p.d_shaft && !(p.d_flat > 0 && p.d_flat < p.d_diameter))
    throw Error(
      `D-shaft flat must be greater than 0 mm and less than the diameter (${p.d_diameter} mm). The flat is the distance from the flat face to the opposite point on the circle.`,
    );
  const hole = holeDiameter(p);
  const d = dimensions(p);
  if (hole > d.root - 2)
    throw Error(
      `The ${p.d_shaft ? 'D-shaft diameter' : 'bore'} is too large for this pulley. Use ${Math.max(0, d.root - 2).toFixed(2)} mm or less to leave material below the teeth.`,
    );
  if (
    p.flanges !== 'none' &&
    p.chamfer > Math.min(p.flange_thickness / 2 - 0.01, p.flange_overhang - 0.01)
  )
    throw Error(
      'Reduce the chamfer to less than half the flange thickness and less than the overhang.',
    );
  if (p.hub_length > 0 && (p.hub_diameter < hole + 2 || p.hub_diameter > d.root))
    throw Error(
      `For this ${p.d_shaft ? 'D-shaft' : 'bore'}, hub diameter must be between ${(hole + 2).toFixed(2)} and ${d.root.toFixed(2)} mm.`,
    );
  const shaft = shaftFeatureError(p);
  if (shaft) throw Error(shaft);
  return p;
}
const num = (n: number) => Number(n.toFixed(4)).toString();
/** Bore token for filenames. A D-shaft uses diameter and flat; a round bore uses `bore`. */
export function boreLabel(p: Parameters, role?: 'Drive' | 'Driven') {
  if (p.d_shaft) {
    const base = `${num(p.d_diameter)}mmD${num(p.d_flat)}mmFlat`;
    return role ? `${base}${role}` : base;
  }
  return role ? `${num(p.bore)}mm${role}Bore` : `${num(p.bore)}mmBore`;
}
export function filename(p: Parameters, extensionName?: 'step' | 'stl' | 'json') {
  const parts = [
    'pulleylabs',
    PROFILES[p.profile].family,
    p.profile,
    `${p.teeth}Teeth`,
    `${num(p.belt_width)}mmBelt`,
    boreLabel(p),
    `${num(p.clearance)}mmClearance`,
  ];
  if (p.flanges === 'none') parts.push('NoFlanges');
  else
    parts.push(
      p.flanges === 'both' ? '2Flanges' : 'BottomFlange',
      `${num(p.flange_thickness)}mmThick`,
      `${num(p.flange_overhang)}mmOverhang`,
      `${num(p.chamfer)}mmChamfer`,
    );
  parts.push(p.hub_length > 0 ? `${num(p.hub_diameter)}x${num(p.hub_length)}mmHub` : 'NoHub');
  if (p.lightening !== 'off')
    parts.push(`${p.lightening === 'shell' ? 'Shell' : 'Fins'}${num(p.wall)}mmWall`);
  if (p.set_screw)
    parts.push(
      `${num(p.set_screw_height)}x${num(p.set_screw_wall)}mmSetScrew${p.set_screw_size}`,
    );
  if (p.split_clamp)
    parts.push(
      `${num(p.split_clamp_length)}x${num(p.split_clamp_wall)}mmSplitClamp${p.split_clamp_screw}`,
    );
  return parts.join('_') + (extensionName ? '.' + extensionName : '');
}

export type SavedBuild = {
  parameters: Parameters;
  appearance: Appearance;
  driven?: Parameters;
  centerDistance?: number;
};
export function parseBuild(raw: unknown): SavedBuild {
  if (raw && typeof raw === 'object' && 'version' in raw) {
    const data = raw as {
      version: number;
      parameters: unknown;
      appearance: unknown;
      driven?: unknown;
      centerDistance?: number;
    };
    if (data.version !== 2) throw Error('This build version is not supported.');
    const parameters = validate(data.parameters),
      appearance = validateAppearance(data.appearance);
    const driven = data.driven === undefined ? undefined : validate(data.driven);
    if (
      driven &&
      (driven.profile !== parameters.profile || driven.belt_width !== parameters.belt_width)
    )
      throw Error('Both pulleys must use the same belt pitch and width.');
    if (
      data.centerDistance !== undefined &&
      (!driven ||
        !Number.isFinite(data.centerDistance) ||
        data.centerDistance < (dimensions(parameters).flange + dimensions(driven).flange) / 2 ||
        data.centerDistance > 20000)
    )
      throw Error('Invalid pair spacing.');
    return { parameters, appearance, driven, centerDistance: data.centerDistance };
  }
  return { parameters: validate(raw), appearance: { ...DEFAULT_APPEARANCE } };
}
export function buildData(
  p: Parameters,
  appearance: Appearance = DEFAULT_APPEARANCE,
  driven?: Parameters,
  centerDistance?: number,
) {
  const data = { version: 2, parameters: p, appearance, driven, centerDistance };
  parseBuild(data);
  return data;
}
export function shareHash(
  p: Parameters,
  appearance: Appearance = DEFAULT_APPEARANCE,
  driven?: Parameters,
  centerDistance?: number,
) {
  return (
    '#p=' + encodeURIComponent(JSON.stringify(buildData(p, appearance, driven, centerDistance)))
  );
}
export function readInitial(): SavedBuild & { message?: string } {
  try {
    if (location.hash.startsWith('#p=')) {
      if (location.hash.length > 10000) throw Error('Shared settings are too large.');
      return parseBuild(JSON.parse(decodeURIComponent(location.hash.slice(3))));
    }
  } catch {
    return {
      parameters: DEFAULTS,
      appearance: { ...DEFAULT_APPEARANCE },
      message: 'This shared configuration could not be loaded. Showing the 8M starter instead.',
    };
  }
  let appearance = { ...DEFAULT_APPEARANCE };
  try {
    const value = localStorage.getItem('pulleylab:appearance:v1');
    if (value) appearance = validateAppearance(JSON.parse(value));
  } catch {}
  try {
    const stored = localStorage.getItem('pulleylab:settings:v1');
    if (stored) return { parameters: validate(JSON.parse(stored)), appearance };
  } catch {}
  return { parameters: DEFAULTS, appearance };
}
