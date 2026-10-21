import { beforeAll, describe, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { makeCylinder, measureShapeVolumeProperties, measureVolume } from 'replicad';
import { createPulley, generateFiles } from '../src/cad/model';
import {
  DEFAULTS,
  cylindersCollide,
  dimensions,
  filename,
  lighteningStatus,
  parseBuild,
  shareHash,
  threadProfile,
  validate,
} from '../src/cad/parameters';
const require = createRequire(import.meta.url);
beforeAll(async () => {
  setOC(
    await initOpenCascade({
      wasmBinary: readFileSync(require.resolve('replicad-opencascadejs/wasm')),
    }),
  );
}, 30000);
describe('analytic HTD solids', () => {
  for (const profile of ['3M', '5M', '8M'] as const) {
    for (const teeth of [12, 24, 60, 240]) {
      it(`${profile}, ${teeth} teeth`, () => {
        const result = createPulley({ ...DEFAULTS, profile, teeth, bore: 0, flanges: 'none' });
        expect(result.volume).toBeGreaterThan(0);
        expect(result.shape.solids).toHaveLength(1);
        result.shape.delete();
      }, 30000);
    }
  }
  it('cuts the complete bore through both flanges and hub', () => {
    const p = { ...DEFAULTS, hub_length: 8, hub_diameter: 20 };
    const hole = createPulley(p),
      solid = createPulley({ ...p, bore: 0 });
    expect(solid.volume - hole.volume).toBeCloseTo(Math.PI * 16 * 32, 3);
    hole.shape.delete();
    solid.shape.delete();
  }, 30000);
  it('cuts a D-shaft bore and keeps a circular bore when D mode is off', () => {
    const p = { ...DEFAULTS, hub_length: 8, hub_diameter: 20 };
    const length = dimensions(p).total;
    const round = createPulley(p);
    const solid = createPulley({ ...p, bore: 0 });
    const dShaft = createPulley({ ...p, d_shaft: true, d_diameter: 8, d_flat: 7 });
    const radius = 4;
    const sagitta = 1;
    const segment =
      radius ** 2 * Math.acos((radius - sagitta) / radius) -
      (radius - sagitta) * Math.sqrt(2 * radius * sagitta - sagitta ** 2);
    expect(solid.volume - dShaft.volume).toBeCloseTo((Math.PI * radius ** 2 - segment) * length, 2);
    expect(dShaft.volume).toBeGreaterThan(round.volume);
    const mass = measureShapeVolumeProperties(dShaft.shape);
    expect(mass.centerOfMass[0]).toBeGreaterThan(0);
    expect(mass.centerOfMass[1]).toBeCloseTo(0, 2);
    mass.delete();
    const ignored = createPulley({ ...p, d_shaft: false, d_diameter: 12, d_flat: 12 });
    expect(ignored.volume).toBeCloseTo(round.volume, 3);
    for (const result of [round, solid, dShaft, ignored]) result.shape.delete();
  }, 30000);
  it('exports a D-shaft bore as STEP and STL', async () => {
    const r = generateFiles({
      ...DEFAULTS,
      d_shaft: true,
      d_diameter: 8,
      d_flat: 7,
      flanges: 'none',
      hub_length: 0,
    });
    const text = await r.step.text();
    expect(text).toContain('ISO-10303-21');
    expect(text).toContain('MANIFOLD_SOLID_BREP');
    expect(text).toContain('CYLINDRICAL_SURFACE');
    expect(text).toContain('PLANE');
    expect(r.stl.size).toBeGreaterThan(1000);
    expect(r.parameters.d_shaft).toBe(true);
  }, 30000);
  it('exports an analytic STEP file and a binary STL', async () => {
    const r = generateFiles(DEFAULTS);
    const text = await r.step.text();
    expect(text).toContain('ISO-10303-21');
    expect(text).toContain('MANIFOLD_SOLID_BREP');
    expect(text).toContain('CYLINDRICAL_SURFACE');
    expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect(r.mesh.triangles.length).toBeGreaterThan(100);
    expect(r.stl.size).toBeGreaterThan(1000);
    expect(r.volume).toBeGreaterThan(0);
  }, 30000);
});
describe('GT, larger HTD, lightening, and clamp solids', () => {
  for (const profile of ['GT2', 'GT3', 'GT5', '14M', '20M'] as const)
    it(`builds ${profile}`, () => {
      const result = createPulley({ ...DEFAULTS, profile, teeth: 20, bore: 5, flanges: 'none' });
      expect(result.volume).toBeGreaterThan(0);
      expect(result.shape.solids).toHaveLength(1);
      result.shape.delete();
    }, 30000);
  it('removes material for a shell and for fins, and skips a web that is already too thin', () => {
    const base = { ...DEFAULTS, flanges: 'none', hub_length: 0, bore: 8 };
    const solid = createPulley(base);
    const shell = createPulley({ ...base, lightening: 'shell', wall: 2 });
    const fins = createPulley({ ...base, lightening: 'fins', wall: 2 });
    const blocked = createPulley({ ...base, lightening: 'shell', wall: 20 });
    expect(shell.volume).toBeLessThan(solid.volume - 10);
    expect(fins.volume).toBeLessThan(solid.volume - 10);
    expect(fins.volume).not.toBeCloseTo(shell.volume, 0);
    expect(blocked.volume).toBeCloseTo(solid.volume, 3);
    for (const result of [solid, shell, fins, blocked]) {
      expect(result.shape.solids).toHaveLength(1);
      result.shape.delete();
    }
  }, 30000);
  it('cuts a helical set-screw thread and leaves the hub unchanged when the set screw is off', async () => {
    const collar = { flanges: 'none' as const, hub_length: 10, hub_diameter: 16, bore: 8 };
    const plain = createPulley({ ...DEFAULTS, ...collar, set_screw: false });
    const threaded = createPulley({
      ...DEFAULTS,
      ...collar,
      set_screw: true,
      set_screw_height: 10,
      set_screw_wall: 4,
      set_screw_size: 'M3',
    });
    const screw = threadProfile('M3');
    const removed = plain.volume - threaded.volume;
    const throughWall = 4;
    const minorHole = Math.PI * (screw.minor / 2) ** 2 * throughWall;
    const majorHole = Math.PI * (screw.major / 2) ** 2 * throughWall;
    expect(removed).toBeGreaterThan(minorHole * 1.08);
    expect(removed).toBeLessThan(majorHole);
    expect(threaded.shape.solids).toHaveLength(1);
    const off = createPulley({ ...DEFAULTS, hub_length: 8, hub_diameter: 20, set_screw: false });
    const legacy = createPulley({ ...DEFAULTS, hub_length: 8, hub_diameter: 20 });
    expect(off.volume).toBeCloseTo(legacy.volume, 3);
    const files = generateFiles({
      ...DEFAULTS,
      flanges: 'none',
      set_screw: true,
      set_screw_height: 10,
      set_screw_wall: 4,
      set_screw_size: 'M3',
      teeth: 16,
    });
    const text = await files.step.text();
    expect(text).toContain('ISO-10303-21');
    expect(text).toContain('MANIFOLD_SOLID_BREP');
    expect(text).toMatch(/B_SPLINE_SURFACE|B_SPLINE_CURVE/);
    expect(files.stl.size).toBeGreaterThan(1000);
    for (const result of [plain, threaded, off, legacy]) result.shape.delete();
  }, 30000);
  it('puts the set screw on the D-shaft flat and builds a split clamp', () => {
    const base = {
      ...DEFAULTS,
      flanges: 'none' as const,
      teeth: 20,
      bore: 8,
      d_shaft: true,
      d_diameter: 8,
      d_flat: 7,
      set_screw: true,
      set_screw_height: 10,
      set_screw_wall: 4,
      set_screw_size: 'M3' as const,
    };
    const screwed = createPulley(base);
    const flatHole = makeCylinder(0.3, 2, [4.2, 0, -5], [1, 0, 0]);
    const roundSide = makeCylinder(0.3, 2, [0, 4.2, -5], [0, 1, 0]);
    const flatHit = screwed.shape.intersect(flatHole);
    const sideHit = screwed.shape.intersect(roundSide);
    expect(measureVolume(flatHit)).toBeLessThan(0.05);
    expect(measureVolume(sideHit)).toBeGreaterThan(0.2);
    flatHit.delete();
    sideHit.delete();
    flatHole.delete();
    roundSide.delete();
    const plain = createPulley({ ...DEFAULTS, flanges: 'none', teeth: 16, bore: 8 });
    const clamped = createPulley({
      ...DEFAULTS,
      flanges: 'none',
      teeth: 16,
      bore: 8,
      split_clamp: true,
      split_clamp_length: 12,
      split_clamp_wall: 3,
      split_clamp_screw: 'M3',
    });
    expect(clamped.volume).toBeGreaterThan(plain.volume + 40);
    expect(clamped.shape.solids).toHaveLength(1);
    const both = createPulley({
      ...DEFAULTS,
      flanges: 'none',
      teeth: 16,
      bore: 8,
      set_screw: true,
      set_screw_height: 10,
      set_screw_wall: 4,
      set_screw_size: 'M3',
      split_clamp: true,
      split_clamp_length: 12,
      split_clamp_wall: 3,
      split_clamp_screw: 'M4',
    });
    expect(both.shape.solids).toHaveLength(1);
    for (const result of [screwed, plain, clamped, both]) result.shape.delete();
  }, 30000);
});
describe('parameters and human-readable filenames', () => {
  it('rejects unsafe dimensions', () => {
    for (const p of [
      { teeth: 2 },
      { teeth: 22.2 },
      { bore: 100 },
      { chamfer: 5 },
      { hub_length: 5, hub_diameter: 1 },
      { profile: 'MXL' },
      { teeth: NaN },
      { teeth: '24' },
      { bore: 0.123456 },
    ])
      expect(() => validate({ ...DEFAULTS, ...p })).toThrow();
  });
  it('captures every active build setting in the filename', () => {
    expect(filename(DEFAULTS, 'step')).toBe(
      'pulleylabs_HTD_8M_24Teeth_20mmBelt_8mmBore_1mmClearance_2Flanges_1.5mmThick_2mmOverhang_0.4mmChamfer_NoHub.step',
    );
    for (const change of [
      { teeth: 25 },
      { bore: 9 },
      { belt_width: 21 },
      { clearance: 2 },
      { flanges: 'bottom' },
      { flange_thickness: 2 },
      { flange_overhang: 3 },
      { chamfer: 0.5 },
      { hub_length: 8, hub_diameter: 20 },
      { d_shaft: true, d_diameter: 8, d_flat: 7 },
    ])
      expect(filename({ ...DEFAULTS, ...change } as typeof DEFAULTS)).not.toBe(filename(DEFAULTS));
  });
  it('rejects a D-shaft flat that is not shorter than the diameter', () => {
    for (const d_flat of [0, 8, 9])
      expect(() => validate({ ...DEFAULTS, d_shaft: true, d_diameter: 8, d_flat })).toThrow(
        /less than the diameter/,
      );
    const ok = validate({ ...DEFAULTS, d_shaft: true, d_diameter: 8, d_flat: 7, bore: 5 });
    expect(ok).toMatchObject({ d_shaft: true, d_diameter: 8, d_flat: 7, bore: 5 });
    expect(filename(ok)).toContain('8mmD7mmFlat');
    expect(filename(ok)).not.toContain('mmBore');
  });
  it('keeps a circular bore when D-shaft mode is off, including older settings', () => {
    const legacy = {
      profile: '8M' as const,
      teeth: 24,
      belt_width: 20,
      clearance: 1,
      bore: 6,
      flanges: 'both' as const,
      flange_thickness: 1.5,
      flange_overhang: 2,
      chamfer: 0.4,
      hub_diameter: 0,
      hub_length: 0,
    };
    expect(validate(legacy)).toMatchObject({ d_shaft: false, bore: 6, d_diameter: 8, d_flat: 7 });
    expect(validate({ ...DEFAULTS, d_shaft: false, d_diameter: 8, d_flat: 8 }).d_shaft).toBe(false);
    const shared = { ...DEFAULTS, d_shaft: true, d_diameter: 8, d_flat: 7 };
    expect(parseBuild(JSON.parse(decodeURIComponent(shareHash(shared).slice(3)))).parameters).toEqual(
      shared,
    );
  });
  it('accepts GT and larger HTD profiles, lightening, and a clamp in the share hash', () => {
    for (const profile of ['GT2', 'GT3', 'GT5', '14M', '20M'] as const) {
      const saved = validate({ ...DEFAULTS, profile, teeth: 20 });
      expect(saved.profile).toBe(profile);
      expect(filename(saved)).toContain(profile);
    }
    const lit = validate({ ...DEFAULTS, lightening: 'shell', wall: 2.5 });
    expect(filename(lit)).toContain('Shell2.5mmWall');
    expect(filename({ ...DEFAULTS, lightening: 'fins', wall: 2 })).toContain('Fins2mmWall');
    expect(filename(DEFAULTS)).not.toContain('Shell');
    const screwed = validate({
      ...DEFAULTS,
      set_screw: true,
      set_screw_height: 10,
      set_screw_wall: 4,
      set_screw_size: 'M4',
    });
    expect(filename(screwed)).toContain('10x4mmSetScrewM4');
    expect(parseBuild(JSON.parse(decodeURIComponent(shareHash(screwed).slice(3)))).parameters).toEqual(
      screwed,
    );
    const legacy = validate({
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
      clamp: true,
      clamp_height: 10,
      clamp_thickness: 4,
      clamp_screw: 'M4',
    });
    expect(legacy.set_screw).toBe(true);
    expect(legacy.set_screw_size).toBe('M4');
    expect(legacy.split_clamp).toBe(false);
    const split = validate({
      ...DEFAULTS,
      split_clamp: true,
      split_clamp_length: 12,
      split_clamp_wall: 3.5,
      split_clamp_screw: 'M5',
    });
    expect(filename(split)).toContain('12x3.5mmSplitClampM5');
    expect(parseBuild(JSON.parse(decodeURIComponent(shareHash(split).slice(3)))).parameters).toEqual(
      split,
    );
    expect(lighteningStatus({ ...DEFAULTS, lightening: 'shell', wall: 30 })).toMatch(/Not enough material/);
    expect(lighteningStatus(DEFAULTS)).toBe('');
    expect(() =>
      validate({ ...DEFAULTS, set_screw: true, set_screw_wall: 1, set_screw_size: 'M5' }),
    ).toThrow(/set screw wall/i);
    expect(() =>
      validate({
        ...DEFAULTS,
        set_screw: true,
        set_screw_height: 3,
        set_screw_wall: 8,
        set_screw_size: 'M6',
      }),
    ).toThrow(/set screw height/i);
    expect(() =>
      validate({ ...DEFAULTS, split_clamp: true, split_clamp_length: 2, split_clamp_screw: 'M4' }),
    ).toThrow(/at least 8.00 mm/);
    expect(cylindersCollide({ y: 0, z: 0, r: 2 }, { y: 1, z: 0, r: 2 })).toBe(true);
    expect(cylindersCollide({ y: 0, z: 0, r: 1 }, { y: 5, z: 0, r: 1 })).toBe(false);
    const hub = validate({ ...DEFAULTS, set_screw: false, hub_length: 8, hub_diameter: 20 });
    expect(hub.set_screw).toBe(false);
    expect(hub.split_clamp).toBe(false);
    expect(dimensions(hub).total).toBe(dimensions({ ...DEFAULTS, hub_length: 8, hub_diameter: 20 }).total);
  });
  it('omits inactive dimensions, avoids invalid filename characters', () => {
    const name = filename({ ...DEFAULTS, flanges: 'none', hub_length: 8, hub_diameter: 20 }, 'stl');
    expect(name).toContain('NoFlanges_20x8mmHub.stl');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name.length).toBeLessThan(240);
  });
});
