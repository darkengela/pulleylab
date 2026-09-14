import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Box, Grid2X2, RotateCcw, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import type { ShapeMesh } from 'replicad';
type View = 'perspective' | 'top' | 'side';
type Props = {
  mesh: ShapeMesh | null;
  busy: boolean;
  stage: string;
  dirty: boolean;
  label: string;
};
export default function Viewer({ mesh, busy, stage, dirty, label }: Props) {
  const host = useRef<HTMLDivElement>(null),
    api = useRef<{
      view: (v: View) => void;
      grid: () => void;
      wire: () => void;
      zoom: (n: number) => void;
      material: (c: number) => void;
    } | null>(null);
  const [failed, setFailed] = useState(false),
    [grid, setGrid] = useState(false),
    [wire, setWire] = useState(false),
    [view, setView] = useState<View>('perspective'),
    [finish, setFinish] = useState(0xb8c7d0);
  useEffect(() => {
    if (!host.current || !mesh) return;
    setFailed(false);
    const node = host.current;
    let dispose = () => {};
    try {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.4;
      node.appendChild(renderer.domElement);
      const scene = new THREE.Scene(),
        camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
      camera.up.set(0, 0, 1);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      const pmrem = new THREE.PMREMGenerator(renderer),
        room = new RoomEnvironment(),
        env = pmrem.fromScene(room, 0.04);
      scene.environment = env.texture;
      const key = new THREE.DirectionalLight(0xe1f7ff, 4);
      key.position.set(-60, -100, 140);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xf8b886, 2.8);
      rim.position.set(80, 70, 40);
      scene.add(rim);
      scene.add(new THREE.AmbientLight(0xe6f4ff, 0.6));
      const geometry = new THREE.BufferGeometry();
      let size = 70;
      if (mesh) {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
        geometry.setIndex(mesh.triangles);
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        geometry.boundingBox!.getCenter(center);
        geometry.translate(-center.x, -center.y, -center.z);
        const bounds = new THREE.Vector3();
        geometry.boundingBox!.getSize(bounds);
        size = Math.max(bounds.x, bounds.y, bounds.z);
      }
      const material = new THREE.MeshPhysicalMaterial({
        color: finish,
        metalness: 0.92,
        roughness: 0.27,
        clearcoat: 0.22,
        clearcoatRoughness: 0.26,
      });
      const solid = new THREE.Mesh(geometry, material);
      solid.visible = !!mesh;
      scene.add(solid);
      const wireGeo = new THREE.EdgesGeometry(geometry, 28),
        wireMat = new THREE.LineBasicMaterial({
          color: 0xaddcf2,
          transparent: true,
          opacity: 0.43,
        }),
        edges = new THREE.LineSegments(wireGeo, wireMat);
      edges.visible = wire && !!mesh;
      scene.add(edges);
      const ground = new THREE.GridHelper(size * 2.7, 24, 0x546474, 0x354150);
      ground.rotation.x = Math.PI / 2;
      ground.position.z = -size * 0.31;
      ground.visible = grid;
      (ground.material as THREE.Material).transparent = true;
      (ground.material as THREE.Material).opacity = 0.28;
      scene.add(ground);
      let frame = 0;
      const resize = () => {
        const width = node.clientWidth,
          height = node.clientHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const selectView = (v: View) => {
        const distance = size * (node.clientWidth / node.clientHeight < 1 ? 2.3 : 1.6);
        camera.position.copy(
          v === 'top'
            ? new THREE.Vector3(0.001, 0, distance)
            : v === 'side'
              ? new THREE.Vector3(0, -distance, 0.001)
              : new THREE.Vector3(distance * 0.75, -distance * 0.95, distance * 0.74),
        );
        controls.target.set(0, 0, 0);
        controls.minDistance = size * 0.7;
        controls.maxDistance = size * 8;
        controls.update();
      };
      selectView(view);
      const observer = new ResizeObserver(resize);
      observer.observe(node);
      resize();
      const render = () => {
        controls.update();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(render);
      };
      render();
      api.current = {
        view: selectView,
        grid: () => {
          ground.visible = !ground.visible;
        },
        wire: () => {
          edges.visible = !edges.visible;
        },
        zoom: (factor) => {
          camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);
          controls.update();
        },
        material: (c) => {
          material.color.setHex(c);
        },
      };
      dispose = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        geometry.dispose();
        material.dispose();
        wireGeo.dispose();
        wireMat.dispose();
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
        env.dispose();
        pmrem.dispose();
        room.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        api.current = null;
      };
    } catch (e) {
      console.error('Preview initialization failed', e);
      node.replaceChildren();
      dispose();
      setFailed(true);
    }
    return dispose;
    // Rebuild only when the generated geometry changes; toolbar state updates through api.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh]);
  const changeView = (v: View) => {
    setView(v);
    api.current?.view(v);
  };
  return (
    <div className="viewer">
      <div className="viewer-top">
        <div className="viewer-caption">
          <span className="eyebrow">YOUR PULLEY</span>
          <h2>{label}</h2>
        </div>
        <span className={`status-pill ${dirty ? 'is-dirty' : ''}`}>
          <span className="status-light" />
          {busy
            ? 'Generating'
            : dirty
              ? 'Changes pending'
              : mesh
                ? 'Solid ready'
                : 'Ready to build'}
        </span>
      </div>
      <div
        ref={host}
        className="render-host"
        aria-label="Interactive 3D pulley preview. Drag to rotate, scroll to zoom."
        role="img"
      />
      {(!mesh || failed) && (
        <div className="viewer-empty">
          <div className={busy ? 'loading-ring' : 'empty-ring'}>
            <Box size={28} strokeWidth={1} />
          </div>
          <p>{failed ? '3D preview unavailable' : busy ? stage : 'Your next part starts here.'}</p>
          <span>
            {failed
              ? 'You can still generate and download the STEP file.'
              : busy
                ? 'Preparing precise geometry on your device.'
                : 'Choose dimensions, then generate your pulley.'}
          </span>
        </div>
      )}
      {busy && mesh && (
        <div className="generation-overlay">
          <span className="mini-spinner" />
          {stage}…
        </div>
      )}
      <div className="view-tabs glass">
        <button
          className={view === 'perspective' ? 'active' : ''}
          onClick={() => changeView('perspective')}
          aria-pressed={view === 'perspective'}
        >
          3D
        </button>
        <button
          className={view === 'top' ? 'active' : ''}
          onClick={() => changeView('top')}
          aria-pressed={view === 'top'}
        >
          Top
        </button>
        <button
          className={view === 'side' ? 'active' : ''}
          onClick={() => changeView('side')}
          aria-pressed={view === 'side'}
        >
          Side
        </button>
      </div>
      <div className="viewer-tools glass">
        <button title="Zoom in" aria-label="Zoom in" onClick={() => api.current?.zoom(0.85)}>
          <ZoomIn size={17} />
        </button>
        <button title="Zoom out" aria-label="Zoom out" onClick={() => api.current?.zoom(1.18)}>
          <ZoomOut size={17} />
        </button>
        <span />
        <button
          className={grid ? 'active' : ''}
          aria-pressed={grid}
          title="Show reference grid"
          aria-label="Show reference grid"
          onClick={() => {
            setGrid(!grid);
            api.current?.grid();
          }}
        >
          <Grid2X2 size={17} />
        </button>
        <button
          className={wire ? 'active' : ''}
          aria-pressed={wire}
          title="Show edges"
          aria-label="Show edges"
          onClick={() => {
            setWire(!wire);
            api.current?.wire();
          }}
        >
          <Scan size={17} />
        </button>
        <span />
        <button
          title="Reset view"
          aria-label="Reset view"
          onClick={() => changeView('perspective')}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="viewer-bottom">
        <span>
          Drag to orbit <span className="divider-dot">·</span> Scroll to zoom
        </span>
        <div className="finish-picker" aria-label="Preview material">
          <span>Finish</span>
          {[
            { name: 'Silver', color: 0xb8c7d0 },
            { name: 'Graphite', color: 0x454d58 },
            { name: 'Copper', color: 0xb87346 },
          ].map((c) => (
            <button
              key={c.name}
              title={`${c.name} preview`}
              aria-label={`${c.name} preview`}
              aria-pressed={finish === c.color}
              className={finish === c.color ? 'selected' : ''}
              style={{ background: '#' + c.color.toString(16).padStart(6, '0') }}
              onClick={() => {
                setFinish(c.color);
                api.current?.material(c.color);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
