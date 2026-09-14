import { describe, expect, it } from 'vitest';
import { DEFAULTS, buildData, dimensions, parseBuild, shareHash } from '../src/cad/parameters';
import { DEFAULT_RATIO, findPairs, beltPitchLength, centerForBelt } from '../src/cad/ratio';
describe('drive ratio planning', () => {
  it('finds exact 3:1 pairs within independent tooth ranges', () => {
    const found = findPairs(DEFAULTS, {
      ...DEFAULT_RATIO,
      driveMin: 24,
      driveMax: 30,
      drivenMin: 72,
      drivenMax: 90,
      tolerance: 0,
    });
    expect(found.total).toBe(7);
    expect(found.pairs[0].drive.teeth).toBe(24);
    expect(found.pairs[0].driven.teeth).toBe(72);
    for (const pair of found.pairs) expect(pair.ratio).toBe(3);
  });
  it('supports speed-up ratios and reports relative error', () => {
    const p = findPairs(DEFAULTS, {
      ...DEFAULT_RATIO,
      target: 1 / 3,
      driveMin: 72,
      driveMax: 72,
      drivenMin: 24,
      drivenMax: 24,
      tolerance: 0,
    }).pairs[0];
    expect(p.ratio).toBe(1 / 3);
    expect(p.error).toBe(0);
  });
  it('applies bores and flange-inclusive OD limits to both pulleys', () => {
    const q = {
      ...DEFAULT_RATIO,
      driveMin: 24,
      driveMax: 40,
      drivenMin: 72,
      drivenMax: 120,
      tolerance: 0,
      driveMaxOD: dimensions({ ...DEFAULTS, teeth: 24 }).flange + 0.001,
      drivenMaxOD: dimensions({ ...DEFAULTS, teeth: 72 }).flange + 0.001,
      drivenBore: 20,
    };
    const found = findPairs(DEFAULTS, q);
    expect(found.total).toBe(1);
    expect(found.pairs[0].driven.bore).toBe(20);
    expect(findPairs(DEFAULTS, { ...q, drivenBore: 200 }).total).toBe(0);
    expect(findPairs(DEFAULTS, { ...q, driveMaxOD: 30 }).total).toBe(0);
  });
  it('finds the exact equal-pulley shaft spacing', () => {
    const r = (24 * 8) / (2 * Math.PI);
    expect(centerForBelt(r, r, 800, 70)).toBeCloseTo(304, 6);
    expect(beltPitchLength(r, r, 304)).toBeCloseTo(800, 6);
  });
  it('fits unequal pulleys to a known belt and shaft range', () => {
    const q = {
      ...DEFAULT_RATIO,
      driveMin: 24,
      driveMax: 24,
      drivenMin: 72,
      drivenMax: 72,
      beltLength: 1200,
      centerMin: 350,
      centerMax: 450,
    };
    const pair = findPairs(DEFAULTS, q).pairs[0];
    expect(pair).toBeDefined();
    expect(
      beltPitchLength(
        dimensions(pair.drive).pitch / 2,
        dimensions(pair.driven).pitch / 2,
        pair.centerDistance!,
      ),
    ).toBeCloseTo(1200, 6);
    expect(pair.engagedTeeth).toBeGreaterThan(6);
    expect(findPairs(DEFAULTS, { ...q, centerMax: 360 }).total).toBe(0);
    expect(findPairs(DEFAULTS, { ...q, beltLength: 200 }).total).toBe(0);
  });
  it('rejects invalid ranges, fractional belt teeth, and unsupported spacing requests', () => {
    for (const q of [
      { target: 0 },
      { driveMin: 40, driveMax: 12 },
      { driveMax: 241 },
      { driveMin: 12.5 },
      { tolerance: NaN },
      { beltLength: 1001 },
      { centerMin: 10 },
      { centerMin: 200, centerMax: 100, beltLength: 1200 },
    ])
      expect(() => findPairs(DEFAULTS, { ...DEFAULT_RATIO, ...q })).toThrow();
  });
});
describe('appearance and shared pair builds', () => {
  it('round-trips nylon and a pulley pair without changing CAD parameters', () => {
    const driven = { ...DEFAULTS, teeth: 72, bore: 20 },
      appearance = { finish: 'nylon' as const, mode: 'solid' as const };
    const hash = shareHash(DEFAULTS, appearance, driven, 400);
    const restored = parseBuild(JSON.parse(decodeURIComponent(hash.slice(3))));
    expect(restored).toEqual({ parameters: DEFAULTS, appearance, driven, centerDistance: 400 });
  });
  it('keeps legacy links and settings compatible', () =>
    expect(parseBuild(DEFAULTS)).toEqual({
      parameters: DEFAULTS,
      appearance: { finish: 'silver', mode: 'solid' },
    }));
  it('rejects unknown materials, incompatible belts, and invalid spacing', () => {
    expect(() => buildData(DEFAULTS, { finish: 'red' as never, mode: 'solid' })).toThrow();
    expect(() => buildData(DEFAULTS, undefined, { ...DEFAULTS, profile: '5M' })).toThrow();
    expect(() => buildData(DEFAULTS, undefined, { ...DEFAULTS, teeth: 72 }, 10)).toThrow();
  });
});
