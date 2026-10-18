import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import { blenderToScene } from "./campus-graph";
import { lookAheadAt, pointAt, stopAt, type RoutePath } from "./route-path";

/**
 * The exhibit's replay: the campus at night, a walk drawn as a growing line
 * of light. Left canvas watches the whole campus from above with the
 * buildings faded so the line stays visible indoors; right canvas walks the
 * same line at eye height. One scene, two renderers, each with its own bloom.
 */
export interface PlayerOptions {
  overview: HTMLCanvasElement;
  firstPerson: HTMLCanvasElement;
  /** Seconds for the whole walk. */
  duration: number;
  onProgress?: (p: { s: number; length: number; stop: string; done: boolean }) => void;
}

export interface Player {
  play(path: RoutePath): void;
  dispose(): void;
}

const TRAIL_COLOR = new THREE.Color(0.35, 1.6, 2.2); // over 1, so bloom picks it up
/** Seen from eye height the line runs right under the camera, so the walk gets a dimmer one. */
const WALK_TRAIL_COLOR = TRAIL_COLOR.clone().multiplyScalar(0.4);
const EYE = 1.6;
const TRAIL_LIFT = 0.25;
const TRAIL_RADIUS = 0.35;
/** Blender metres: the same sky spot as the "13 斜めから" figure. */
const OVERVIEW_EYE = blenderToScene(-330, -190, 170);
const OVERVIEW_TARGET = blenderToScene(-150, -20, 0);

export async function createPlayer(opts: PlayerOptions): Promise<Player> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  scene.fog = new THREE.Fog(0x05070d, 80, 420);
  scene.add(new THREE.HemisphereLight(0x8899cc, 0x101018, 0.9));
  const moon = new THREE.DirectionalLight(0xaabbff, 0.6);
  moon.position.set(-120, 200, 80);
  scene.add(moon);

  const campus = await loadCampus();
  scene.add(campus.root);

  const trailMaterial = new THREE.MeshBasicMaterial({ color: TRAIL_COLOR, toneMapped: false });
  const headMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), toneMapped: false });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 12), headMaterial);
  scene.add(head);
  let trail: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial> | null = null;

  // The head marker sits just below the walking eye, so the walk hides it
  // (and blooms less) or it washes the whole view out.
  const views = [
    makeView(opts.overview, new THREE.PerspectiveCamera(32, 1, 1, 2000), 0.9, () => {
      campus.fadeForOverview();
      head.visible = true;
      trailMaterial.color.copy(TRAIL_COLOR);
    }),
    makeView(opts.firstPerson, new THREE.PerspectiveCamera(68, 1, 0.1, 1000), 0.3, () => {
      campus.solidForWalk();
      head.visible = false;
      trailMaterial.color.copy(WALK_TRAIL_COLOR);
    }),
  ];
  const [overview, walk] = views;
  overview.camera.position.set(...OVERVIEW_EYE);
  overview.camera.lookAt(...OVERVIEW_TARGET);

  let path: RoutePath | null = null;
  let start = 0;
  let last = 0;
  let frame = 0;
  const look = new THREE.Vector3();
  const resize = () => views.forEach((v) => v.resize());
  window.addEventListener("resize", resize);
  resize();

  function play(next: RoutePath) {
    path = next;
    if (trail) {
      scene.remove(trail);
      trail.geometry.dispose();
    }
    trail = new THREE.Mesh(buildTube(next), trailMaterial);
    trail.geometry.setDrawRange(0, 0);
    trail.renderOrder = 10;
    scene.add(trail);
    start = performance.now();
    last = start;
    look.set(...lookAheadAt(next, 0, 6)).y += EYE;
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (path && trail) {
      const t = Math.min(1, (now - start) / 1000 / opts.duration);
      const s = easeInOut(t) * path.length;
      const p = pointAt(path, s);
      head.position.set(p[0], p[1] + TRAIL_LIFT, p[2]);
      const segments = trail.geometry.parameters.tubularSegments;
      const radial = trail.geometry.parameters.radialSegments;
      trail.geometry.setDrawRange(0, Math.floor((s / path.length) * segments) * radial * 6);

      // Walk: eye on the line, gaze eased toward a point a few metres ahead so
      // the grid's square corners turn into a short swing instead of a snap.
      walk.camera.position.set(p[0], p[1] + EYE, p[2]);
      const ahead = lookAheadAt(path, s, 6);
      const target = new THREE.Vector3(ahead[0], ahead[1] + EYE, ahead[2]);
      look.lerp(target, 1 - Math.exp(-dt * 4));
      walk.camera.lookAt(look);
      opts.onProgress?.({ s, length: path.length, stop: stopAt(path, s), done: t >= 1 });
    }
    for (const v of views) v.render();
  }
  frame = requestAnimationFrame(tick);

  return {
    play,
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      views.forEach((v) => v.dispose());
      trail?.geometry.dispose();
      campus.dispose();
    },
  };

  function makeView(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera, bloomStrength: number, prepare: () => void) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), bloomStrength, 0.5, 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return {
      camera,
      resize() {
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      },
      render() {
        prepare();
        composer.render();
      },
      dispose() {
        composer.dispose();
        renderer.dispose();
      },
    };
  }
}

/** The line as a thin tube, ordered start to end so a draw range grows it. */
function buildTube(path: RoutePath): THREE.TubeGeometry {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  const pts = path.points.map((p) => new THREE.Vector3(p[0], p[1] + TRAIL_LIFT, p[2]));
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].distanceToSquared(pts[i - 1]) > 1e-6) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
  }
  return new THREE.TubeGeometry(curve, Math.max(64, Math.ceil(path.length / 0.5)), TRAIL_RADIUS, 6, false);
}

/**
 * campus.glb with every material darkened for the night look. The overview
 * fades the buildings so the line can be followed through them; the walk
 * needs them solid.
 */
async function loadCampus() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("/display/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync("/display/campus.glb");
  const materials = new Set<THREE.MeshStandardMaterial>();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (materials.has(std)) continue;
      std.color.multiplyScalar(0.45);
      std.emissive?.setScalar(0);
      std.transparent = true;
      std.side = THREE.DoubleSide;
      materials.add(std);
    }
  });
  draco.dispose();
  let faded: boolean | null = null;
  const setFaded = (on: boolean) => {
    if (faded === on) return;
    faded = on;
    for (const m of materials) {
      m.opacity = on ? 0.16 : 1;
      m.depthWrite = !on;
    }
  };
  return {
    root: gltf.scene,
    fadeForOverview: () => setFaded(true),
    solidForWalk: () => setFaded(false),
    dispose() {
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
    },
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
