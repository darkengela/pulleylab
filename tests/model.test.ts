import { beforeAll, describe, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPulley, generateFiles } from '../src/cad/model';
import { DEFAULTS, filename, validate } from '../src/cad/parameters';
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
    ])
      expect(filename({ ...DEFAULTS, ...change } as typeof DEFAULTS)).not.toBe(filename(DEFAULTS));
  });
  it('omits inactive dimensions, avoids invalid filename characters', () => {
    const name = filename({ ...DEFAULTS, flanges: 'none', hub_length: 8, hub_diameter: 20 }, 'stl');
    expect(name).toContain('NoFlanges_20x8mmHub.stl');
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name.length).toBeLessThan(240);
  });
});
