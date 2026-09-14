export const PROFILES = {
  '3M': { pitch: 3, offset: 0.381, depth: 1.21, radius: 0.89, fillet: 0.26 },
  '5M': { pitch: 5, offset: 0.5715, depth: 2.16, radius: 1.6, fillet: 0.48 },
  '8M': { pitch: 8, offset: 0.686, depth: 3.45, radius: 2.46, fillet: 0.7 },
} as const;
export type Profile = keyof typeof PROFILES;
export type Parameters = {
  profile: Profile;
  teeth: number;
  belt_width: number;
  clearance: number;
  bore: number;
  flanges: 'none' | 'bottom' | 'both';
  flange_thickness: number;
  flange_overhang: number;
  chamfer: number;
  hub_diameter: number;
  hub_length: number;
};
export const DEFAULTS: Parameters = {
  profile: '8M',
  teeth: 24,
  belt_width: 20,
  clearance: 1,
  bore: 8,
  flanges: 'both',
  flange_thickness: 1.5,
  flange_overhang: 2,
  chamfer: 0.4,
  hub_diameter: 0,
  hub_length: 0,
};
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
    total: p.belt_width + p.clearance + count * p.flange_thickness + p.hub_length,
    flange: outside + (count ? 2 * p.flange_overhang : 0),
  };
}
export const LIMITS = {
  teeth: [12, 240],
  belt_width: [0.5, 200],
  clearance: [0, 10],
  bore: [0, 1000],
  flange_thickness: [0.2, 15],
  flange_overhang: [0.2, 20],
  chamfer: [0, 5],
  hub_diameter: [0, 1000],
  hub_length: [0, 100],
} as const;
export function validate(raw: unknown): Parameters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Choose a PulleyLab settings file.');
  if (Object.keys(raw).some((k) => !Object.hasOwn(DEFAULTS, k)))
    throw Error('This file includes unsupported settings.');
  const p = { ...DEFAULTS, ...raw } as Parameters;
  if (typeof p.profile !== 'string' || !Object.hasOwn(PROFILES, p.profile))
    throw Error('Choose an HTD 3M, 5M, or 8M profile.');
  if (!['none', 'bottom', 'both'].includes(p.flanges))
    throw Error('Choose a valid flange arrangement.');
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const value = p[key as keyof typeof LIMITS];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi)
      throw Error(
        `${key.replaceAll('_', ' ')} must be between ${lo} and ${hi} mm${key === 'teeth' ? ' (whole teeth)' : ''}.`.replace(
          '240 mm',
          '240',
        ),
      );
    if (Math.abs(value * 10000 - Math.round(value * 10000)) > 1e-5)
      throw Error('Use no more than four decimal places for dimensions.');
  }
  if (!Number.isInteger(p.teeth)) throw Error('Number of teeth must be a whole number.');
  const d = dimensions(p);
  if (p.bore > d.root - 2)
    throw Error(
      `The bore is too large for this pulley. Use ${Math.max(0, d.root - 2).toFixed(2)} mm or less to leave material below the teeth.`,
    );
  if (
    p.flanges !== 'none' &&
    p.chamfer > Math.min(p.flange_thickness / 2 - 0.01, p.flange_overhang - 0.01)
  )
    throw Error(
      'Reduce the chamfer to less than half the flange thickness and less than the overhang.',
    );
  if (p.hub_length > 0 && (p.hub_diameter < p.bore + 2 || p.hub_diameter > d.root))
    throw Error(
      `For this bore, hub diameter must be between ${(p.bore + 2).toFixed(2)} and ${d.root.toFixed(2)} mm.`,
    );
  return p;
}
const num = (n: number) => Number(n.toFixed(4)).toString();
export function filename(p: Parameters, extension?: 'step' | 'stl' | 'json') {
  const parts = [
    'pulleylabs',
    'HTD',
    p.profile,
    `${p.teeth}Teeth`,
    `${num(p.belt_width)}mmBelt`,
    `${num(p.bore)}mmBore`,
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
  return parts.join('_') + (extension ? '.' + extension : '');
}
export function shareHash(p: Parameters) {
  return '#p=' + encodeURIComponent(JSON.stringify(p));
}
export function readInitial(): { parameters: Parameters; message?: string } {
  try {
    if (location.hash.startsWith('#p=')) {
      if (location.hash.length > 6000) throw Error('Shared settings are too large.');
      return { parameters: validate(JSON.parse(decodeURIComponent(location.hash.slice(3)))) };
    }
  } catch {
    return {
      parameters: DEFAULTS,
      message: 'This shared configuration could not be loaded. Showing the 8M starter instead.',
    };
  }
  try {
    const stored = localStorage.getItem('pulleylab:settings:v1');
    if (stored) return { parameters: validate(JSON.parse(stored)) };
  } catch {}
  return { parameters: DEFAULTS };
}
