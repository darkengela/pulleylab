/* GPL-3.0-or-later. HTD geometry adapted from FreeCAD Gears contributors:
 * https://github.com/looooo/freecad.gears/blob/master/freecad/gears/timinggear.py
 * Exact tangent circular arcs, with all dimensions in millimeters.
 */
import {
  assembleWire,
  basicFaceExtrusion,
  makeFace,
  makeThreePointArc,
  makeCylinder,
  Vector,
  getOC,
  measureVolume,
  exportSTEP,
} from 'replicad';
import type { Edge, Shape3D, Deletable } from 'replicad';
import { PROFILES, validate, dimensions, filename } from './parameters';
type Point2 = [number, number];
const rotate = ([x, y]: Point2, a: number): Point2 => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
];
const mirror = ([x, y]: Point2): Point2 => [-x, y];
const xyz = ([x, y]: Point2): [number, number, number] => [x, y, 0];
export function createPulley(raw: unknown) {
  const p = validate(raw),
    d = dimensions(p),
    s = PROFILES[p.profile],
    R = d.outside / 2,
    r = s.radius,
    f = s.fillet,
    root = R - s.depth,
    cy = root + r;
  const a = (cy * cy + (r + f) ** 2 - (R - f) ** 2) / (2 * cy),
    disc = (r + f) ** 2 - a * a;
  if (disc <= 0) throw Error('This tooth count cannot form a valid HTD profile.');
  const left: Point2 = [-Math.sqrt(disc), cy - a],
    tangent: Point2 = [(r * left[0]) / (r + f), cy + (r * (left[1] - cy)) / (r + f)],
    tip: Point2 = [(R * left[0]) / (R - f), (R * left[1]) / (R - f)];
  const rt = mirror(tip),
    rx = mirror(tangent),
    rc = mirror(left);
  if (Math.atan2(rt[0], rt[1]) >= Math.PI / p.teeth)
    throw Error('Tooth grooves overlap. Increase the tooth count.');
  const owned: Deletable[] = [];
  const keep = <T extends Deletable>(x: T): T => {
    owned.push(x);
    return x;
  };
  let final: Shape3D | undefined;
  try {
    const arc = (start: Point2, end: Point2, center: Point2) => {
      const aa = Math.atan2(start[1] - center[1], start[0] - center[0]),
        bb = Math.atan2(end[1] - center[1], end[0] - center[0]);
      const delta =
        ((((bb - aa + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const radius = Math.hypot(start[0] - center[0], start[1] - center[1]),
        mid = aa + delta / 2;
      return keep(
        makeThreePointArc(
          xyz(start),
          xyz([center[0] + radius * Math.cos(mid), center[1] + radius * Math.sin(mid)]),
          xyz(end),
        ),
      );
    };
    const edges: Edge[] = [];
    for (let i = 0; i < p.teeth; i++) {
      const t = (v: Point2) => rotate(v, (i * 2 * Math.PI) / p.teeth);
      edges.push(
        arc(t(rt), t(rx), t(rc)),
        keep(makeThreePointArc(xyz(t(rx)), xyz(t([0, root])), xyz(t(tangent)))),
        arc(t(tangent), t(tip), t(left)),
        arc(t(tip), rotate(rt, ((i + 1) * 2 * Math.PI) / p.teeth), [0, 0]),
      );
    }
    const wire = keep(assembleWire(edges));
    if (!wire.isClosed) throw Error('The tooth profile is not closed.');
    let body: Shape3D = keep(
      basicFaceExtrusion(keep(makeFace(wire)), keep(new Vector([0, 0, d.face]))),
    );
    const disk = (z: number) => {
      const raw = keep(makeCylinder(d.flange / 2, p.flange_thickness, [0, 0, z]));
      return p.chamfer ? keep(raw.chamfer(p.chamfer, (e) => e.ofCurveType('CIRCLE'))) : raw;
    };
    const bottom = p.flanges === 'none' ? 0 : -p.flange_thickness;
    if (p.flanges !== 'none') body = keep(body.fuse(disk(bottom)));
    if (p.flanges === 'both') body = keep(body.fuse(disk(d.face)));
    if (p.hub_length > 0)
      body = keep(
        body.fuse(
          keep(makeCylinder(p.hub_diameter / 2, p.hub_length, [0, 0, bottom - p.hub_length])),
        ),
      );
    if (p.bore > 0)
      body = keep(
        body.cut(keep(makeCylinder(p.bore / 2, d.total + 2, [0, 0, bottom - p.hub_length - 1]))),
      );
    const solids = body.solids;
    solids.forEach(keep);
    const oc = getOC();
    const check = keep(new oc.BRepCheck_Analyzer(body.wrapped, true, false));
    const volume = measureVolume(body);
    if (!check.IsValid() || solids.length !== 1 || !Number.isFinite(volume) || volume <= 0)
      throw Error('These dimensions did not produce a valid single solid.');
    final = body;
    return { shape: body, parameters: p, dimensions: d, volume };
  } finally {
    for (const x of owned.reverse())
      if (x !== final) {
        try {
          x.delete();
        } catch {
          /* Some kernel operations consume their input wrappers. */
        }
      }
  }
}
export function generateFiles(raw: unknown) {
  const start = performance.now(),
    result = createPulley(raw);
  try {
    const mesh = result.shape.mesh({ tolerance: 0.035, angularTolerance: 0.12 });
    const step = exportSTEP([{ shape: result.shape, name: filename(result.parameters) }], {
      unit: 'MM',
      modelUnit: 'MM',
    });
    const stl = result.shape.blobSTL({ tolerance: 0.035, angularTolerance: 0.12, binary: true });
    return {
      parameters: result.parameters,
      dimensions: result.dimensions,
      volume: result.volume,
      mesh,
      step,
      stl,
      seconds: (performance.now() - start) / 1000,
    };
  } finally {
    result.shape.delete();
  }
}
export type PulleyResult = ReturnType<typeof generateFiles>;
