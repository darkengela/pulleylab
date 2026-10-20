import { beforeAll, describe, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { measureShapeVolumeProperties } from 'replicad';
import { createPulley, generateFiles } from '../src/cad/model';
import { DEFAULTS, dimensions, filename, parseBuild, shareHash, validate } from '../src/cad/parameters';
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
describe('parameters and human-readable filenames', () => {
  it('rejects unsafe dimensions', () => {
    for (const p of [
      { teeth: 2 },
      { teeth: 22.2 },
      { bore: 100 },
      { chamfer: 5 },
      { hub_length: 5, hub_diameter: 1 },
      { profile: 'GT2' },
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
  it('omits inactive dimensions, avoids invalid filename characters', () => {
    const name = filename({ ...DEFAULTS, flanges: 'none', hub_length: 8, hub_diameter: 20 }, 'stl');
    expect(name).toContain('NoFlanges_20x8mmHub.stl');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name.length).toBeLessThan(240);
  });
});
