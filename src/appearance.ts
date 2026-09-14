export const FINISHES = {
  silver: { name: 'Silver', color: 0xb8c7d0, metalness: 0.92, roughness: 0.27, clearcoat: 0.22 },
  graphite: {
    name: 'Graphite',
    color: 0x454d58,
    metalness: 0.92,
    roughness: 0.27,
    clearcoat: 0.22,
  },
  copper: { name: 'Copper', color: 0xb87346, metalness: 0.92, roughness: 0.27, clearcoat: 0.22 },
  nylon: { name: 'Matte nylon', color: 0x1c1e21, metalness: 0, roughness: 0.96, clearcoat: 0 },
} as const;
export type Finish = keyof typeof FINISHES;
export type DisplayMode = 'solid' | 'xray' | 'wireframe' | 'clay';
export type Appearance = { finish: Finish; mode: DisplayMode };
export const DEFAULT_APPEARANCE: Appearance = { finish: 'silver', mode: 'solid' };
export function validateAppearance(raw: unknown): Appearance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('Invalid preview appearance.');
  const p = raw as Appearance;
  if (
    !Object.hasOwn(FINISHES, p.finish) ||
    !['solid', 'xray', 'wireframe', 'clay'].includes(p.mode)
  )
    throw Error('Choose a supported preview finish and display style.');
  return { finish: p.finish, mode: p.mode };
}
