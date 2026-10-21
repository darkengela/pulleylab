/* GPL-3.0-or-later. HTD and GT tooth geometry adapted from FreeCAD Gears:
 * https://github.com/looooo/freecad.gears/blob/master/freecad/gears/timinggear.py
 * HTD uses the offset = 0 tangent arcs. GT uses the offset ≠ 0 three-arc profile.
 * Dimensions are millimeters.
 */
import {
  assembleWire,
  basicFaceExtrusion,
  draw,
  makeFace,
  makeThreePointArc,
  makeBox,
  makeCylinder,
  sketchHelix,
  Vector,
  getOC,
  measureVolume,
  exportSTEP,
} from 'replicad';
import type { Edge, Shape3D, Deletable } from 'replicad';
import {
  PROFILES,
  validate,
  dimensions,
  filename,
  holeDiameter,
  extension,
  lighteningStatus,
  splitClampLayout,
  threadProfile,
} from './parameters';
import type { Parameters } from './parameters';
type Point2 = [number, number];
type Point3 = [number, number, number];
const rotate = ([x, y]: Point2, a: number): Point2 => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
];
const mirror = ([x, y]: Point2): Point2 => [-x, y];
const xyz = ([x, y]: Point2): Point3 => [x, y, 0];
const reflectAcross = ([x, y]: Point2, alpha: number): Point2 => {
  const c = Math.cos(2 * alpha),
    s = Math.sin(2 * alpha);
  return [c * x + s * y, s * x - c * y];
};

export function createPulley(raw: unknown) {
  const p = validate(raw),
    d = dimensions(p),
    s = PROFILES[p.profile],
    R = d.outside / 2;
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
    if (s.family === 'HTD') {
      const r = s.radius,
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
      for (let i = 0; i < p.teeth; i++) {
        const t = (v: Point2) => rotate(v, (i * 2 * Math.PI) / p.teeth);
        edges.push(
          arc(t(rt), t(rx), t(rc)),
          keep(makeThreePointArc(xyz(t(rx)), xyz(t([0, root])), xyz(t(tangent)))),
          arc(t(tangent), t(tip), t(left)),
          arc(t(tip), rotate(rt, ((i + 1) * 2 * Math.PI) / p.teeth), [0, 0]),
        );
      }
    } else {
      const r0 = s.radius,
        r1 = s.side,
        rs = s.fillet,
        sideOffset = s.sideOffset;
      const rOut = R,
        rootY = rOut - s.depth;
      const k = (r0 - r1) / sideOffset;
      if (k * k <= 1) throw Error('This tooth count cannot form a valid GT profile.');
      const phi12 = Math.atan(Math.sqrt(1 / (k * k - 1)));
      const m12: Point2 = [0, rootY + r0];
      const m23: Point2 = [sideOffset, sideOffset / Math.tan(phi12) + m12[1]];
      const m23y = m23[1];
      const inner =
        -(m23y ** 4) -
        2 * m23y ** 2 * sideOffset ** 2 +
        2 * m23y ** 2 * rOut ** 2 -
        4 * m23y ** 2 * rOut * rs +
        2 * m23y ** 2 * r1 ** 2 +
        4 * m23y ** 2 * r1 * rs +
        4 * m23y ** 2 * rs ** 2 -
        sideOffset ** 4 +
        2 * sideOffset ** 2 * rOut ** 2 -
        4 * sideOffset ** 2 * rOut * rs +
        2 * sideOffset ** 2 * r1 ** 2 +
        4 * sideOffset ** 2 * r1 * rs +
        4 * sideOffset ** 2 * rs ** 2 -
        rOut ** 4 +
        4 * rOut ** 3 * rs +
        2 * rOut ** 2 * r1 ** 2 +
        4 * rOut ** 2 * r1 * rs -
        4 * rOut ** 2 * rs ** 2 -
        4 * rOut * r1 ** 2 * rs -
        8 * rOut * r1 * rs ** 2 -
        r1 ** 4 -
        4 * r1 ** 3 * rs -
        4 * r1 ** 2 * rs ** 2;
      if (inner <= 0) throw Error('This tooth count cannot form a valid GT profile.');
      const num = -2 * sideOffset * rOut + 2 * sideOffset * rs + Math.sqrt(inner);
      const den =
        m23y ** 2 +
        2 * m23y * rOut -
        2 * m23y * rs +
        sideOffset ** 2 +
        rOut ** 2 -
        2 * rOut * rs -
        r1 ** 2 -
        2 * r1 * rs;
      const phi4 = 2 * Math.atan(num / den);
      const m34: Point2 = [(rOut - rs) * -Math.sin(phi4), (rOut - rs) * Math.cos(phi4)];
      const x2: Point2 = [-r0 * Math.sin(phi12), m12[1] - r0 * Math.cos(phi12)];
      const x3: Point2 = [
        m34[0] + (rs / (rs + r1)) * (m23[0] - m34[0]),
        m34[1] + (rs / (rs + r1)) * (m23[1] - m34[1]),
      ];
      const x4: Point2 = [rOut * -Math.sin(phi4), rOut * Math.cos(phi4)];
      const phi5 = Math.PI / p.teeth;
      const x6 = reflectAcross(x4, Math.PI / 2 + phi5);
      const xn2 = mirror(x2),
        xn3 = mirror(x3),
        xn4 = mirror(x4),
        mn23 = mirror(m23),
        mn34 = mirror(m34);
      if (Math.atan2(xn4[0], xn4[1]) >= phi5)
        throw Error('Tooth grooves overlap. Increase the tooth count.');
      for (let i = 0; i < p.teeth; i++) {
        const t = (v: Point2) => rotate(v, (i * 2 * Math.PI) / p.teeth);
        edges.push(
          arc(t(xn4), t(xn3), t(mn34)),
          arc(t(xn3), t(xn2), t(mn23)),
          keep(makeThreePointArc(xyz(t(xn2)), xyz(t([0, rootY])), xyz(t(x2)))),
          arc(t(x2), t(x3), t(m23)),
          arc(t(x3), t(x4), t(m34)),
          arc(t(x4), t(x6), [0, 0]),
        );
      }
    }
    const wire = keep(assembleWire(edges));
    if (!wire.isClosed) throw Error('The tooth profile is not closed.');
    let body: Shape3D = keep(
      basicFaceExtrusion(keep(makeFace(wire)), keep(new Vector([0, 0, d.face]))),
    );
    const disk = (z: number) => {
      const rawDisk = keep(makeCylinder(d.flange / 2, p.flange_thickness, [0, 0, z]));
      return p.chamfer ? keep(rawDisk.chamfer(p.chamfer, (e) => e.ofCurveType('CIRCLE'))) : rawDisk;
    };
    const bottom = p.flanges === 'none' ? 0 : -p.flange_thickness;
    if (p.flanges !== 'none') body = keep(body.fuse(disk(bottom)));
    if (p.flanges === 'both') body = keep(body.fuse(disk(d.face)));
    const boss = extension(p);
    if (boss.length > 0)
      body = keep(
        body.fuse(keep(makeCylinder(boss.diameter / 2, boss.length, [0, 0, bottom - boss.length]))),
      );
    body = lighten(body, p, d, bottom, keep);
    if (p.split_clamp) body = keep(body.fuse(splitClampBody(p, bottom, keep)));
    const hole = holeDiameter(p);
    const clampLength = p.split_clamp ? p.split_clamp_length : 0;
    if (hole > 0) {
      const radius = hole / 2,
        z = bottom - boss.length - clampLength - 1,
        height = d.total + 2;
      // Bore axis is Z. A D-shaft keeps one flat facing +X: the flat plane is at
      // x = flat - radius, and the opposite point on the circle is at x = -radius.
      let tool: Shape3D = keep(makeCylinder(radius, height, [0, 0, z]));
      if (p.d_shaft) {
        const profile = tool.cutPlane('YZ', p.d_flat - radius, 'negative');
        if (!profile) throw Error('The D-shaft flat did not cut a valid bore.');
        tool = keep(profile);
      }
      body = keep(body.cut(tool));
    }
    if (p.set_screw) {
      const cut = setScrewCut(p, bottom, boss.length);
      const [pilot, groove] = internalThread(threadProfile(p.set_screw_size), cut.origin, cut.axis, cut.length, keep);
      body = keep(body.cut(pilot));
      body = keep(body.cut(groove));
    }
    if (p.split_clamp) body = cutSplitClamp(body, p, bottom, keep);
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

function lighten(
  body: Shape3D,
  p: Parameters,
  d: ReturnType<typeof dimensions>,
  bottom: number,
  keep: <T extends Deletable>(x: T) => T,
) {
  if (p.lightening === 'off' || lighteningStatus(p)) return body;
  const wall = p.wall;
  const holeR = holeDiameter(p) / 2;
  const inner = holeR + wall;
  const outer = d.root / 2 - wall;
  const topFlange = p.flanges === 'both' ? p.flange_thickness : 0;
  const bottomFlange = p.flanges === 'none' ? 0 : p.flange_thickness;
  const boss = extension(p);
  const bossR = boss.length > 0 ? boss.diameter / 2 : 0;
  const bottomInner = Math.max(inner, bossR > 0 ? bossR + wall : inner);
  const bleed = 0.2;
  const depth = (d.face - wall) / 2;
  const spans: { z0: number; height: number; innerR: number }[] = [];
  if (bottomInner < outer - 0.2 && depth > 0.15)
    spans.push({
      z0: bottom - bleed,
      height: depth + bottomFlange + bleed,
      innerR: bottomInner,
    });
  const topZ0 = spans.length ? d.face - depth : wall;
  const topHeight = d.face + topFlange + bleed - topZ0;
  if (topHeight > 0.3) spans.push({ z0: topZ0, height: topHeight, innerR: inner });
  const cutters: Shape3D[] = [];
  for (const span of spans) {
    if (p.lightening === 'shell') cutters.push(annulus(span.innerR, outer, span.z0, span.height, keep));
    else {
      const ribs = 4;
      const step = (Math.PI * 2) / ribs;
      const rib = wall / Math.max(span.innerR, 0.25);
      const pocket = step - rib;
      for (let i = 0; i < ribs; i++)
        cutters.push(
          sector(span.innerR, outer, i * step + rib / 2, pocket, span.z0, span.height, keep),
        );
    }
  }
  for (const tool of cutters) body = keep(body.cut(tool));
  return body;
}

function annulus(
  inner: number,
  outer: number,
  z0: number,
  height: number,
  keep: <T extends Deletable>(x: T) => T,
) {
  const tube = keep(makeCylinder(outer, height, [0, 0, z0]));
  const core = keep(makeCylinder(inner, height + 0.4, [0, 0, z0 - 0.2]));
  return keep(tube.cut(core));
}

function sector(
  inner: number,
  outer: number,
  a0: number,
  span: number,
  z0: number,
  height: number,
  keep: <T extends Deletable>(x: T) => T,
) {
  const at = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];
  const a1 = a0 + span;
  const mid = (a0 + a1) / 2;
  return keep(
    draw(at(inner, a0))
      .lineTo(at(outer, a0))
      .threePointsArcTo(at(outer, a1), at(outer, mid))
      .lineTo(at(inner, a1))
      .threePointsArcTo(at(inner, a0), at(inner, mid))
      .close()
      .sketchOnPlane('XY', [0, 0, z0])
      .extrude(height) as Shape3D,
  );
}

/**
 * Set-screw hole. A round bore keeps a radial +Y hole. A D-shaft puts the hole
 * on the +X flat: the flat is the YZ plane at x = flat − radius, and the screw
 * axis is +X so it is perpendicular to that face.
 */
function setScrewCut(p: Parameters, bottom: number, bossLength: number) {
  const hole = holeDiameter(p);
  const outerR = extension(p).diameter / 2;
  const z = bottom - bossLength + p.set_screw_height / 2;
  if (p.d_shaft) {
    const flatX = p.d_flat - hole / 2;
    const x0 = flatX - 0.35;
    return {
      origin: [x0, 0, z] as Point3,
      axis: [1, 0, 0] as Point3,
      length: outerR + 0.35 - x0,
    };
  }
  const y0 = hole / 2 - 0.35;
  return {
    origin: [0, y0, z] as Point3,
    axis: [0, 1, 0] as Point3,
    length: outerR - y0 + 0.35,
  };
}
/** ISO internal thread. The sketch +Y is radially outward on the helix. */
function internalThread(
  screw: ReturnType<typeof threadProfile>,
  origin: Point3,
  axis: Point3,
  length: number,
  keep: <T extends Deletable>(x: T) => T,
) {
  const pilot = keep(makeCylinder(screw.minor / 2, length, origin, axis));
  const innerHalf = (7 * screw.pitch) / 16;
  const outerHalf = screw.pitch / 8;
  let groove: Shape3D;
  try {
    groove = sketchHelix(screw.pitch, length, screw.minor / 2, origin, axis).sweepSketch(
      (plane) =>
        draw([-innerHalf, -0.05])
          .lineTo([-outerHalf, screw.radial])
          .lineTo([outerHalf, screw.radial])
          .lineTo([innerHalf, -0.05])
          .close()
          .sketchOnPlane(plane) as never,
      { withContact: true },
    );
  } catch {
    throw Error('The thread could not be built for this screw.');
  }
  if (groove.solids.length !== 1) throw Error('The thread could not be built for this screw.');
  return [pilot, keep(groove)] as const;
}
/** Solid collar and ears, before the shaft bore is cut. Starts on the pulley face. */
function splitClampBody(p: Parameters, bottom: number, keep: <T extends Deletable>(x: T) => T) {
  const layout = splitClampLayout(p);
  const z1 = bottom;
  const z0 = z1 - p.split_clamp_length;
  let clamp: Shape3D = keep(makeCylinder(layout.outerR, p.split_clamp_length, [0, 0, z0]));
  const half = layout.slot / 2;
  const ears = [
    [half, half + layout.earThick],
    [-half - layout.earThick, -half],
  ] as const;
  for (const [x0, x1] of ears)
    clamp = keep(
      clamp.fuse(keep(makeBox([x0, layout.earOuter, z0], [x1, layout.earInner, z1]))),
    );
  return clamp;
}
function cutSplitClamp(
  body: Shape3D,
  p: Parameters,
  bottom: number,
  keep: <T extends Deletable>(x: T) => T,
) {
  const layout = splitClampLayout(p);
  const z1 = bottom;
  const z0 = z1 - p.split_clamp_length;
  const half = layout.slot / 2;
  const slot = keep(
    makeBox(
      [-half, layout.yCenter - layout.head, z0 - 0.2],
      [half, -(layout.hole / 2) + 0.25, z1],
    ),
  );
  body = keep(body.cut(slot));
  const zMid = (z0 + z1) / 2;
  const clearance = keep(
    makeCylinder(
      layout.clearance / 2,
      layout.earThick + 0.5,
      [half - 0.15, layout.yCenter, zMid],
      [1, 0, 0],
    ),
  );
  body = keep(body.cut(clearance));
  const [pilot, groove] = internalThread(
    layout.screw,
    [-half - layout.earThick - 0.2, layout.yCenter, zMid],
    [1, 0, 0],
    layout.earThick + 0.55,
    keep,
  );
  body = keep(body.cut(pilot));
  body = keep(body.cut(groove));
  return body;
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
