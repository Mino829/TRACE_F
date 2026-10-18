import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import { EDGES, GRID_THETA, NODES, toScene } from "./campus-graph";
import { lookAheadAt, pointAt, stopAt, type RoutePath } from "./route-path";

/**
 * The exhibit's replay: the campus at night, a walk drawn as a growing line
 * of light over the faint walkable network. Left canvas is the map: the whole
 * network fitted into view from above, road side at the top. Right canvas
 * is a drone following the head of the line from behind and above. Buildings
 * are drawn as outlines over almost clear faces, so overlapping floors never
 * wash out and the line stays visible indoors. One scene, two renderers, each
 * with its own bloom.
 */
export interface PlayerOptions {
  overview: HTMLCanvasElement;
  follow: HTMLCanvasElement;
  /** Seconds for the whole walk. */
  duration: number;
  onProgress?: (p: { s: number; length: number; stop: string; done: boolean }) => void;
}

export interface Player {
  play(path: RoutePath): void;
  /** Clears the line and stops drawing until the next play (the top screen covers the canvases). */
  stop(): void;
  dispose(): void;
}

// RAY is black and white: the line is paper-white light, over 1 so bloom picks it up.
const TRAIL_COLOR = new THREE.Color(2.1, 2.15, 2.1);
const NETWORK_COLOR = new THREE.Color(0.22, 0.23, 0.23);
const TRAIL_LIFT = 0.4;
const TRAIL_RADIUS = 0.45;
/** How far down the map looks (0 = from the side, 90 = straight down). */
const MAP_PITCH = THREE.MathUtils.degToRad(58);
/** The drone sits this far from the head of the line, looking down at FOLLOW_PITCH. */
const FOLLOW_DISTANCE = 100;
const FOLLOW_PITCH = THREE.MathUtils.degToRad(48);
/** Anything closer to the drone than this is clipped, so it never flies into a wall. */
const FOLLOW_NEAR = 55;
const FACE_OPACITY = 0.05;
const OUTLINE_COLOR = new THREE.Color(0.55, 0.56, 0.56);

/** Campus grid directions in the scene: u along the classroom building, v toward the road. */
const U = new THREE.Vector3(Math.cos(GRID_THETA), 0, -Math.sin(GRID_THETA));
const V = new THREE.Vector3(-Math.sin(GRID_THETA), 0, -Math.cos(GRID_THETA));

export async function createPlayer(opts: PlayerOptions): Promise<Player> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0c0d); // RAY ink
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x202030, 1.6));
  const moon = new THREE.DirectionalLight(0xdde6ff, 1.2);
  moon.position.set(-120, 200, 80);
  scene.add(moon);

  const campus = await loadCampus();
  scene.add(campus.root);
  scene.add(buildNetworkLines());

  const trailMaterial = new THREE.MeshBasicMaterial({ color: TRAIL_COLOR, toneMapped: false });
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 20, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5), toneMapped: false }),
  );
  scene.add(head);
  let trail: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial> | null = null;

  const mapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
  const followCamera = new THREE.PerspectiveCamera(36, 1, FOLLOW_NEAR, 2000);
  const views = [
    makeView(opts.overview, mapCamera, 0.8, fitMap),
    makeView(opts.follow, followCamera, 0.8, (w, h) => {
      followCamera.aspect = w / h;
      followCamera.updateProjectionMatrix();
    }),
  ];

  let path: RoutePath | null = null;
  let start = 0;
  let last = 0;
  let frame = 0;
  const followPos = new THREE.Vector3();
  const followLook = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const resize = () => views.forEach((v) => v.resize());
  window.addEventListener("resize", resize);
  resize();

  function clearTrail() {
    if (!trail) return;
    scene.remove(trail);
    trail.geometry.dispose();
    trail = null;
  }

  function play(next: RoutePath) {
    path = next;
    head.visible = true;
    clearTrail();
    trail = new THREE.Mesh(buildTube(next), trailMaterial);
    trail.geometry.setDrawRange(0, 0);
    scene.add(trail);
    start = performance.now();
    last = start;
    // Start the follow camera already in place instead of flying in.
    const p = new THREE.Vector3(...pointAt(next, 0));
    heading.copy(headingAt(next, 0));
    followLook.copy(p);
    followPos.copy(droneSpot(p, heading));
  }

  function tick(now: number) {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (path && trail) {
      const t = Math.min(1, (now - start) / 1000 / opts.duration);
      const s = easeInOut(t) * path.length;
      const p = new THREE.Vector3(...pointAt(path, s));
      head.position.copy(p).y += TRAIL_LIFT;
      const { tubularSegments, radialSegments } = trail.geometry.parameters;
      trail.geometry.setDrawRange(0, Math.floor((s / path.length) * tubularSegments) * radialSegments * 6);

      // Follow: ease the heading and the camera so the grid's square corners
      // become a slow swing around the head instead of a snap.
      heading.lerp(headingAt(path, s), 1 - Math.exp(-dt * 2)).normalize();
      followPos.lerp(droneSpot(p, heading), 1 - Math.exp(-dt * 3));
      followLook.lerp(p, 1 - Math.exp(-dt * 6));
      followCamera.position.copy(followPos);
      followCamera.lookAt(followLook);
      opts.onProgress?.({ s, length: path.length, stop: stopAt(path, s), done: t >= 1 });
    }
    if (path) for (const v of views) v.render();
  }
  frame = requestAnimationFrame(tick);

  return {
    play,
    stop() {
      path = null;
      head.visible = false;
      clearTrail();
    },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      views.forEach((v) => v.dispose());
      clearTrail();
      campus.dispose();
    },
  };

  /**
   * Map: look across the campus toward the road side, tilted down, and size
   * the orthographic frame so every point of the network fits with a margin.
   */
  function fitMap(w: number, h: number) {
    const pts = [...NODES.values()].map((n) => new THREE.Vector3(...toScene(n.threeD)));
    const box = new THREE.Box3().setFromPoints(pts);
    const center = box.getCenter(new THREE.Vector3());
    const forward = V.clone().multiplyScalar(Math.cos(MAP_PITCH)).add(new THREE.Vector3(0, -Math.sin(MAP_PITCH), 0));
    mapCamera.position.copy(center).addScaledVector(forward, -1000);
    mapCamera.lookAt(center);
    mapCamera.updateMatrixWorld();
    const inv = mapCamera.matrixWorldInverse;
    let halfW = 0;
    let halfH = 0;
    for (const p of pts) {
      const c = p.clone().applyMatrix4(inv);
      halfW = Math.max(halfW, Math.abs(c.x));
      halfH = Math.max(halfH, Math.abs(c.y));
    }
    const margin = 1.08;
    halfW = Math.max(halfW, (halfH * w) / h) * margin;
    halfH = (halfW * h) / w;
    Object.assign(mapCamera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    mapCamera.updateProjectionMatrix();
  }

  function makeView(canvas: HTMLCanvasElement, camera: THREE.Camera, bloomStrength: number, onResize: (w: number, h: number) => void) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), bloomStrength, 0.45, 0.9));
    composer.addPass(new OutputPass());
    return {
      resize() {
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        renderer.setSize(w, h, false);
        composer.setSize(w, h);
        onResize(w, h);
      },
      render() {
        composer.render();
      },
      dispose() {
        composer.dispose();
        renderer.dispose();
      },
    };
  }
}

function droneSpot(head: THREE.Vector3, heading: THREE.Vector3): THREE.Vector3 {
  return head
    .clone()
    .addScaledVector(heading, -FOLLOW_DISTANCE * Math.cos(FOLLOW_PITCH))
    .add(new THREE.Vector3(0, FOLLOW_DISTANCE * Math.sin(FOLLOW_PITCH), 0));
}

/** Horizontal direction of travel a few metres ahead of s. */
function headingAt(path: RoutePath, s: number): THREE.Vector3 {
  const here = new THREE.Vector3(...pointAt(path, s));
  const ahead = new THREE.Vector3(...lookAheadAt(path, s, 8));
  const d = ahead.sub(here).setY(0);
  return d.lengthSq() > 1e-6 ? d.normalize() : U.clone();
}

/** Every edge of the walkable network as faint lines: the map the trail is drawn on. */
function buildNetworkLines(): THREE.LineSegments {
  const pos: number[] = [];
  for (const e of EDGES) {
    const a = toScene(NODES.get(e.from)!.threeD);
    const b = toScene(NODES.get(e.to)!.threeD);
    pos.push(a[0], a[1] + TRAIL_LIFT, a[2], b[0], b[1] + TRAIL_LIFT, b[2]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: NETWORK_COLOR, toneMapped: false }));
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

/** campus.glb as outlines over almost clear faces. */
async function loadCampus() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("/display/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync("/display/campus.glb");
  const materials = new Set<THREE.MeshStandardMaterial>();
  const outline = new THREE.LineBasicMaterial({ color: OUTLINE_COLOR, transparent: true, opacity: 0.2, depthWrite: false });
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (materials.has(std)) continue;
      std.emissive?.setScalar(0);
      std.transparent = true;
      std.opacity = FACE_OPACITY;
      std.depthWrite = false;
      std.side = THREE.DoubleSide;
      materials.add(std);
    }
    // Only creases sharper than 30° become lines, so flat walls stay quiet.
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), outline));
  }
  draco.dispose();
  return {
    root: gltf.scene,
    dispose() {
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) (o as THREE.Mesh).geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
      outline.dispose();
    },
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
