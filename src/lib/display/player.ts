import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import { EDGES, GRID_THETA, NODES, toScene, type Vec3 } from "./campus-graph";
import { lookAheadAt, placeAt, pointAt, stopAt, type RoutePath } from "./route-path";

/**
 * The exhibit's replay: a walk drawn as a growing line of light on the
 * campus at night. One scene, two renderers, each with its own bloom.
 *
 * - Map (left): a clean plan. Buildings are dark roofs with their outlines
 *   only (no interiors, no neighbours), and the line, the network, the stops
 *   and the labels are drawn over them so the walk shows even indoors. The
 *   frame fits the whole network and drifts slowly so the picture lives.
 * - Drone (right): follows the head of the line from behind and above, with
 *   every floor drawn as see-through outlines.
 */
export interface PlayerOptions {
  overview: HTMLCanvasElement;
  follow: HTMLCanvasElement;
  /** Labels on the map are DOM nodes laid over its canvas. */
  mapLabels: HTMLElement;
  /** Seconds for the whole walk. */
  duration: number;
  onProgress?: (p: { s: number; length: number; stop: string; place: string; done: boolean }) => void;
}

export interface Player {
  play(path: RoutePath): void;
  /** Clears the line and stops drawing until the next play (the top screen covers the canvases). */
  stop(): void;
  dispose(): void;
}

const INK = new THREE.Color(0x0c0c0d);
// RAY is black and white: the line is paper-white light, over 1 so bloom picks it up.
const TRAIL_COLOR = new THREE.Color(2.1, 2.15, 2.1);
const NETWORK_COLOR = new THREE.Color(0.2, 0.21, 0.21);
const TRAIL_LIFT = 0.4;
const TRAIL_RADIUS = 0.45;
/** How far down the map looks (0 = from the side, 90 = straight down). */
const MAP_PITCH = THREE.MathUtils.degToRad(62);
/** The map turns this far either way and back, once every MAP_DRIFT_SECONDS. */
const MAP_DRIFT = THREE.MathUtils.degToRad(5);
const MAP_DRIFT_SECONDS = 70;
/** The drone sits this far from the head of the line, looking down at FOLLOW_PITCH. */
const FOLLOW_DISTANCE = 100;
const FOLLOW_PITCH = THREE.MathUtils.degToRad(48);
/** Anything closer to the drone than this is clipped, so it never flies into a wall. */
const FOLLOW_NEAR = 55;
const FACE_OPACITY = 0.05;

/** What campus.glb's objects are (userData.trace_layer, from scripts/export_web.py), as camera layers. */
const LAYER = { exterior: 1, interior: 2, site: 3, surroundings: 4, exteriorLines: 5, otherLines: 6 } as const;

/** Map labels: building names at roof height (Blender metres, buildings/配置.json). */
const BUILDING_LABELS: { name: string; at: Vec3 }[] = [
  { name: "研究棟", at: toScene({ x: -97.2, y: 24.8, z: 66 }) },
  { name: "教室棟", at: toScene({ x: -160.1, y: 36.1, z: 34 }) },
  { name: "交流棟", at: toScene({ x: -212.5, y: -36.7, z: 33 }) },
  { name: "本部棟", at: toScene({ x: -172.1, y: -83.6, z: 68 }) },
  { name: "交流プラザ", at: toScene({ x: -116, y: -35, z: 7 }) },
];

/** Campus grid directions in the scene: u along the classroom building, v toward the road. */
const U = new THREE.Vector3(Math.cos(GRID_THETA), 0, -Math.sin(GRID_THETA));
const V = new THREE.Vector3(-Math.sin(GRID_THETA), 0, -Math.cos(GRID_THETA));

export async function createPlayer(opts: PlayerOptions): Promise<Player> {
  const scene = new THREE.Scene();
  // No scene.background: a colour background clears on every render call,
  // which would wipe the map's earlier passes. The renderers clear to ink instead.
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
  const stopMarks = new THREE.Group();
  scene.add(stopMarks);
  const goal = buildGoalMark();
  scene.add(goal);
  let trail: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial> | null = null;

  const map = makeMap();
  const followCamera = new THREE.PerspectiveCamera(36, 1, FOLLOW_NEAR, 2000);
  for (const l of Object.values(LAYER)) followCamera.layers.enable(l);
  followCamera.layers.disable(LAYER.surroundings);
  const drone = makeView(opts.follow, 0.8, (composer) => composer.addPass(new RenderPass(scene, followCamera)), (w, h) => {
    followCamera.aspect = w / h;
    followCamera.updateProjectionMatrix();
  });
  const views = [map.view, drone];
  const labels = makeLabels(opts.mapLabels);

  let path: RoutePath | null = null;
  let start = 0;
  let last = 0;
  let frame = 0;
  const followPos = new THREE.Vector3();
  const followLook = new THREE.Vector3();
  const heading = new THREE.Vector3();
  const observer = new ResizeObserver(() => views.forEach((v) => v.resize()));
  observer.observe(opts.overview);
  observer.observe(opts.follow);
  views.forEach((v) => v.resize());

  function clearTrail() {
    if (!trail) return;
    scene.remove(trail);
    trail.geometry.dispose();
    trail = null;
    stopMarks.clear();
  }

  function play(next: RoutePath) {
    path = next;
    head.visible = true;
    clearTrail();
    trail = new THREE.Mesh(buildTube(next), trailMaterial);
    trail.geometry.setDrawRange(0, 0);
    scene.add(trail);
    for (const stop of next.stops) stopMarks.add(buildStopMark(stop.at));
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
    if (!path || !trail) return;
    const t = Math.min(1, (now - start) / 1000 / opts.duration);
    const s = easeInOut(t) * path.length;
    const p = new THREE.Vector3(...pointAt(path, s));
    head.position.copy(p).y += TRAIL_LIFT;
    const { tubularSegments, radialSegments } = trail.geometry.parameters;
    trail.geometry.setDrawRange(0, Math.floor((s / path.length) * tubularSegments) * radialSegments * 6);
    path.stops.forEach((stop, i) => (stopMarks.children[i].visible = stop.s <= s));
    const pulse = 1 + 0.25 * Math.sin(now / 300);
    goal.scale.set(pulse, 1, pulse);

    // Follow: ease the heading and the camera so the grid's square corners
    // become a slow swing around the head instead of a snap.
    heading.lerp(headingAt(path, s), 1 - Math.exp(-dt * 2)).normalize();
    followPos.lerp(droneSpot(p, heading), 1 - Math.exp(-dt * 3));
    followLook.lerp(p, 1 - Math.exp(-dt * 6));
    followCamera.position.copy(followPos);
    followCamera.lookAt(followLook);

    const place = placeAt(path, s);
    map.drift(now / 1000);
    labels.update(map.camera, opts.overview, head.position, place);
    for (const v of views) v.render();
    opts.onProgress?.({ s, length: path.length, stop: stopAt(path, s), place, done: t >= 1 });
  }
  frame = requestAnimationFrame(tick);

  return {
    play,
    stop() {
      path = null;
      head.visible = false;
      clearTrail();
      labels.hide();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      views.forEach((v) => v.dispose());
      clearTrail();
      labels.dispose();
      campus.dispose();
    },
  };

  /**
   * The map draws in four passes on one camera: the ground, the building
   * roofs (both flat colours), the roof outlines tested against them, then the
   * line, network, stops and head over everything with the depth cleared.
   */
  function makeMap() {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    const ground = new THREE.MeshBasicMaterial({ color: 0x141517 });
    const roofs = new THREE.MeshBasicMaterial({
      color: 0x2a2b2f,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const pass = (layer: number, override?: THREE.Material, clearDepth = false) => {
      const cam = camera.clone();
      cam.layers.set(layer);
      cams.push(cam);
      const rp = new RenderPass(scene, cam, override);
      rp.clear = cams.length === 1;
      rp.clearDepth = clearDepth;
      return rp;
    };
    const cams: THREE.OrthographicCamera[] = [];
    const view = makeView(opts.overview, 0.9, (composer) => {
      composer.addPass(pass(LAYER.site, ground));
      composer.addPass(pass(LAYER.exterior, roofs));
      composer.addPass(pass(LAYER.exteriorLines));
      composer.addPass(pass(0, undefined, true));
    }, fit);
    let base = { center: new THREE.Vector3(), halfW: 1, halfH: 1 };

    /** Size the frame so every point of the network fits, with room for the drift. */
    function fit(w: number, h: number) {
      const pts = [...NODES.values()].map((n) => new THREE.Vector3(...toScene(n.threeD)));
      const center = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
      place(center, 0);
      camera.updateMatrixWorld();
      let halfW = 0;
      let halfH = 0;
      for (const p of pts) {
        const c = p.applyMatrix4(camera.matrixWorldInverse);
        halfW = Math.max(halfW, Math.abs(c.x));
        halfH = Math.max(halfH, Math.abs(c.y));
      }
      const margin = 1.08;
      halfW = Math.max(halfW, (halfH * w) / h) * margin;
      halfH = (halfW * h) / w;
      base = { center, halfW, halfH };
      apply();
    }

    function place(center: THREE.Vector3, yaw: number) {
      const v = V.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const forward = v.multiplyScalar(Math.cos(MAP_PITCH)).add(new THREE.Vector3(0, -Math.sin(MAP_PITCH), 0));
      camera.position.copy(center).addScaledVector(forward, -1000);
      camera.lookAt(center);
    }

    function apply() {
      Object.assign(camera, { left: -base.halfW, right: base.halfW, top: base.halfH, bottom: -base.halfH });
      camera.updateProjectionMatrix();
      for (const c of cams) {
        c.position.copy(camera.position);
        c.quaternion.copy(camera.quaternion);
        Object.assign(c, { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom });
        c.updateProjectionMatrix();
      }
    }

    return {
      camera,
      view,
      drift(seconds: number) {
        place(base.center, MAP_DRIFT * Math.sin((seconds / MAP_DRIFT_SECONDS) * Math.PI * 2));
        camera.updateMatrixWorld();
        apply();
      },
    };
  }

  function makeView(
    canvas: HTMLCanvasElement,
    bloomStrength: number,
    addPasses: (composer: EffectComposer) => void,
    onResize: (w: number, h: number) => void,
  ) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(INK);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const composer = new EffectComposer(renderer);
    addPasses(composer);
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

/**
 * Building names, the goal and a "where now" tag (building and floor) next to
 * the head, as DOM laid over the map canvas and moved every frame.
 */
function makeLabels(root: HTMLElement) {
  const make = (cls: string, text: string) => {
    const el = document.createElement("p");
    el.className = cls;
    el.textContent = text;
    root.appendChild(el);
    return el;
  };
  const buildings = BUILDING_LABELS.map((b) => ({ ...b, el: make("dsp-label", b.name) }));
  const goalAt = toScene(NODES.get("shibalab")!.threeD);
  const goal = make("dsp-label dsp-label--goal", "SHIBALAB 301");
  const here = make("dsp-label dsp-label--here", "");
  const v = new THREE.Vector3();
  const put = (el: HTMLElement, at: THREE.Vector3, camera: THREE.Camera, canvas: HTMLCanvasElement) => {
    v.copy(at).project(camera);
    el.style.transform = `translate(${((v.x + 1) / 2) * canvas.clientWidth}px, ${((1 - v.y) / 2) * canvas.clientHeight}px)`;
  };
  return {
    update(camera: THREE.Camera, canvas: HTMLCanvasElement, head: THREE.Vector3, place: string) {
      root.hidden = false;
      for (const b of buildings) put(b.el, new THREE.Vector3(...b.at), camera, canvas);
      put(goal, new THREE.Vector3(...goalAt), camera, canvas);
      put(here, head, camera, canvas);
      here.textContent = place;
    },
    hide() {
      root.hidden = true;
    },
    dispose() {
      root.replaceChildren();
    },
  };
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

/** A passed stop: a small bright square, flat on its floor. */
function buildStopMark(at: Vec3): THREE.Mesh {
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false, side: THREE.DoubleSide }),
  );
  mark.position.set(at[0], at[1] + TRAIL_LIFT + 0.1, at[2]);
  mark.visible = false;
  return mark;
}

/** The goal: a ring around ShibaLab that breathes. */
function buildGoalMark(): THREE.Mesh {
  const at = toScene(NODES.get("shibalab")!.threeD);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(5, 6, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.4, 1.4), toneMapped: false, side: THREE.DoubleSide }),
  );
  ring.position.set(at[0], at[1] + TRAIL_LIFT, at[2]);
  return ring;
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
 * campus.glb, each object on the camera layer of its kind, faces almost clear
 * and outlines drawn on top. Only creases sharper than 30° become lines, so
 * flat walls stay quiet.
 */
async function loadCampus() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("/display/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync("/display/campus.glb");
  const materials = new Set<THREE.MeshStandardMaterial>();
  const exteriorLines = new THREE.LineBasicMaterial({ color: 0x8c8e8e, transparent: true, opacity: 0.55, depthWrite: false });
  const otherLines = new THREE.LineBasicMaterial({ color: 0x8c8e8e, transparent: true, opacity: 0.2, depthWrite: false });
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const kind = (mesh.userData.trace_layer ?? mesh.parent?.userData.trace_layer ?? "site") as keyof typeof LAYER;
    mesh.layers.set(LAYER[kind] ?? LAYER.site);
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
    if (kind === "surroundings") continue;
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 30),
      kind === "exterior" ? exteriorLines : otherLines,
    );
    lines.layers.set(kind === "exterior" ? LAYER.exteriorLines : LAYER.otherLines);
    mesh.add(lines);
  }
  draco.dispose();
  return {
    root: gltf.scene,
    dispose() {
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) (o as THREE.Mesh).geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
      exteriorLines.dispose();
      otherLines.dispose();
    },
  };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
