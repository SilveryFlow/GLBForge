<script lang="ts">
export interface NodeTreeItem {
  name: string;
  named: boolean;
  children: NodeTreeItem[];
}
</script>

<script setup lang="ts">
import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";
import { saveBytes } from "../lib/api";

const props = defineProps<{ label: string; pickable?: boolean }>();

interface CamPose {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}

const emit = defineEmits<{ pick: [index: number]; cammove: [pose: CamPose] }>();

let applyingPose = false;

const hostRef = useTemplateRef<HTMLDivElement>("host");
const clips = ref<string[]>([]);
const clipIndex = ref(0);
const clipEnabled = ref(false);
const clipValue = ref(50);
const clipAxis = ref<"x" | "y" | "z">("y");
const lightPreset = ref<"studio" | "sunset" | "dim">("studio");
const lightIntensity = ref(1);
const recording = ref(false);
const status = ref("");
const expanded = ref(false);

function toggleExpand(): void {
  expanded.value = !expanded.value;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && expanded.value) expanded.value = false;
}

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let loader: GLTFLoader | null = null;
let observer: ResizeObserver | null = null;
let raf = 0;
let model: THREE.Object3D | null = null;
let nodeObjects = new Map<number, THREE.Object3D[]>();
let objectNodes = new Map<THREE.Object3D, number>();
let selectionBox: THREE.Box3Helper | null = null;
let pointerStart: { x: number; y: number } | null = null;
let modelAnimations: THREE.AnimationClip[] = [];
let mixer: THREE.AnimationMixer | null = null;
const clock = new THREE.Clock();
const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
let modelBox = new THREE.Box3();
let hemi: THREE.HemisphereLight | null = null;
let dir: THREE.DirectionalLight | null = null;
let recorder: MediaRecorder | null = null;
let recordChunks: Blob[] = [];

function init() {
  if (renderer || !hostRef.value) return;
  const host = hostRef.value;

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(2, 1.5, 2.5);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.addEventListener("change", () => {
    if (applyingPose || !camera || !controls) return;
    emit("cammove", {
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      tx: controls.target.x,
      ty: controls.target.y,
      tz: controls.target.z,
    });
  });

  hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 2.2);
  scene.add(hemi);
  dir = new THREE.DirectionalLight(0xffffff, 2.0);
  dir.position.set(3, 5, 2);
  scene.add(dir);

  loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const draco = new DRACOLoader();
  draco.setDecoderPath("draco/");
  loader.setDRACOLoader(draco);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath("basis/");
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);

  observer = new ResizeObserver(() => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (!w || !h) return;
    renderer!.setSize(w, h, false);
    camera!.aspect = w / h;
    camera!.updateProjectionMatrix();
  });
  observer.observe(host);

  renderer.domElement.addEventListener("pointerdown", (event) => {
    pointerStart = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener("pointerup", onPointerDown);
  host.addEventListener("dblclick", toggleExpand);
  window.addEventListener("keydown", onKeydown);
  document.addEventListener("visibilitychange", onVisibility);

  startLoop();
}

let loopOn = false;

function startLoop() {
  if (loopOn || !renderer || !scene || !camera || !controls) return;
  loopOn = true;
  const tick = () => {
    if (!loopOn) return;
    raf = requestAnimationFrame(tick);
    const dt = clock.getDelta();
    mixer?.update(dt);
    if (lightPreset.value === "sunset" && dir) {
      const t = (performance.now() / 6000) % (Math.PI * 2);
      dir.position.set(Math.cos(t) * 6, 0.6 + Math.sin(t) * 2.4, Math.sin(t) * 3);
      dir.color.setHSL(0.09, 0.75, 0.45 + Math.max(0, Math.sin(t)) * 0.25);
      dir.intensity = (0.7 + Math.max(0, Math.sin(t)) * 1.6) * lightIntensity.value;
    }
    controls!.update();
    renderer!.render(scene!, camera!);
  };
  raf = requestAnimationFrame(tick);
}

function stopLoop() {
  loopOn = false;
  cancelAnimationFrame(raf);
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    startLoop();
  } else {
    stopLoop();
  }
}

onActivated(startLoop);
onDeactivated(stopLoop);

function applyLights() {
  if (!hemi || !dir) return;
  if (lightPreset.value === "studio") {
    hemi.intensity = 2.2 * lightIntensity.value;
    dir.intensity = 2.0 * lightIntensity.value;
    dir.color.set(0xffffff);
    dir.position.set(3, 5, 2);
  } else if (lightPreset.value === "dim") {
    hemi.intensity = 0.6 * lightIntensity.value;
    dir.intensity = 0.8 * lightIntensity.value;
    dir.color.set(0xbfd4ff);
    dir.position.set(-3, 4, -2);
  }
}

watch(lightIntensity, applyLights);
watch(lightPreset, applyLights);

function applyClip() {
  if (!renderer) return;
  if (clipEnabled.value && !modelBox.isEmpty()) {
    const axis = clipAxis.value;
    const min = modelBox.min[axis];
    const max = modelBox.max[axis];
    const cut = min + ((max - min) * clipValue.value) / 100;
    clipPlane.normal.set(axis === "x" ? -1 : 0, axis === "y" ? -1 : 0, axis === "z" ? -1 : 0);
    clipPlane.constant = cut;
    renderer.clippingPlanes = [clipPlane];
  } else {
    renderer.clippingPlanes = [];
  }
}

watch(clipEnabled, applyClip);
watch(clipValue, applyClip);
watch(clipAxis, applyClip);

function frameObject(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const dist = maxDim * 1.8;

  camera!.near = maxDim / 100;
  camera!.far = maxDim * 100;
  camera!.updateProjectionMatrix();
  camera!.position.set(center.x + dist * 0.6, center.y + dist * 0.45, center.z + dist * 0.7);
  controls!.target.copy(center);
  controls!.update();
}

function disposeModel() {
  if (!model || !scene) return;
  scene.remove(model);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      (Array.isArray(mat) ? mat : [mat]).forEach((x) => {
        Object.values(x).forEach((v) => {
          if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        });
        x.dispose();
      });
    }
  });
  model = null;
  mixer?.stopAllAction();
  mixer = null;
  modelAnimations = [];
  clips.value = [];
  clipIndex.value = 0;
}

function setModel(object: THREE.Object3D, animations: THREE.AnimationClip[]) {
  highlightNodeIndex(null);
  nodeObjects.clear();
  objectNodes.clear();
  disposeModel();
  model = object;
  scene!.add(model);
  modelBox = new THREE.Box3().setFromObject(model);
  frameObject(model);
  modelAnimations = animations;
  if (animations.length) {
    mixer = new THREE.AnimationMixer(model);
    clips.value = animations.map((a, i) => a.name || `clip ${i + 1}`);
    clipIndex.value = 0;
    playClip(0);
  }
  applyClip();
}

function playClip(i: number) {
  if (!mixer) return;
  mixer.stopAllAction();
  const clip = modelAnimations[i];
  if (clip) {
    mixer.clipAction(clip).play();
  }
}

function load(buffer: ArrayBuffer): Promise<void> {
  init();
  return new Promise((resolve, reject) => {
    loader!.parse(
      buffer,
      "",
      (gltf: GLTF) => {
        setModel(gltf.scene, gltf.animations);
        for (const [object, association] of gltf.parser.associations) {
          if (association?.nodes === undefined || !(object instanceof THREE.Object3D)) continue;
          objectNodes.set(object, association.nodes);
          const list = nodeObjects.get(association.nodes) ?? [];
          list.push(object);
          nodeObjects.set(association.nodes, list);
        }
        resolve();
      },
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

function loadObject(object: THREE.Object3D, animations: THREE.AnimationClip[]) {
  init();
  setModel(object, animations);
}

function onPointerDown(e: PointerEvent) {
  if (!props.pickable || !renderer || !camera || !model || !pointerStart || e.button !== 0) return;
  if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 5) {
    pointerStart = null;
    return;
  }
  pointerStart = null;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(model, true);
  if (!hits.length) return;
  let obj: THREE.Object3D | null = hits[0].object;
  while (obj && !objectNodes.has(obj)) obj = obj.parent;
  if (obj) emit("pick", objectNodes.get(obj)!);
}

async function screenshot() {
  if (!renderer) return;
  const blob = await new Promise<Blob | null>((r) => renderer!.domElement.toBlob(r, "image/png"));
  if (!blob) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dir = await join(await appDataDir(), "screenshots");
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  const path = await join(dir, `${Date.now()}.png`);
  await saveBytes(path, bytes);
  status.value = `截图已保存 → ${path}`;
}

function toggleRecord() {
  if (recording.value) {
    recorder?.stop();
    return;
  }
  const stream = renderer!.domElement.captureStream(30);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  recorder = new MediaRecorder(stream, { mimeType: mime });
  recordChunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) recordChunks.push(e.data);
  };
  recorder.onstop = async () => {
    recording.value = false;
    const blob = new Blob(recordChunks, { type: "video/webm" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dir = await join(await appDataDir(), "records");
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    const path = await join(dir, `${Date.now()}.webm`);
    await saveBytes(path, bytes);
    status.value = `录屏已保存 → ${path}`;
  };
  recorder.start();
  recording.value = true;
  status.value = "录屏中…";
}

onMounted(init);
onBeforeUnmount(() => {
  stopLoop();
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener("visibilitychange", onVisibility);
  if (recorder?.state === "recording") recorder.stop();
  cancelAnimationFrame(raf);
  observer?.disconnect();
  controls?.dispose();
  highlightNodeIndex(null);
  disposeModel();
  renderer?.dispose();
  renderer?.domElement.remove();
});

function highlightNodeIndex(index: number | null) {
  if (selectionBox) {
    scene?.remove(selectionBox);
    selectionBox.geometry.dispose();
    for (const material of Array.isArray(selectionBox.material)
      ? selectionBox.material
      : [selectionBox.material])
      material.dispose();
    selectionBox = null;
  }
  if (index === null || !scene) return;
  const objects = nodeObjects.get(index) ?? [];
  const box = new THREE.Box3();
  for (const object of objects) box.union(new THREE.Box3().setFromObject(object));
  if (box.isEmpty()) return;
  selectionBox = new THREE.Box3Helper(box, 0x0071e3);
  for (const material of Array.isArray(selectionBox.material)
    ? selectionBox.material
    : [selectionBox.material])
    material.depthTest = false;
  selectionBox.renderOrder = 100;
  scene.add(selectionBox);
}
function focusNode(index: number) {
  const object = nodeObjects.get(index)?.[0];
  if (object && !new THREE.Box3().setFromObject(object).isEmpty()) frameObject(object);
}

function listNodeTree(): NodeTreeItem[] {
  const build = (obj: THREE.Object3D): NodeTreeItem => ({
    name: obj.name,
    named: !!obj.name,
    children: obj.children
      .filter((child) => !(child as THREE.Light).isLight && !(child as THREE.Camera).isCamera)
      .map(build),
  });
  if (!model) return [];
  const roots = model.children.filter(
    (child) => !(child as THREE.Light).isLight && !(child as THREE.Camera).isCamera,
  );
  if (model.name) return [build(model)];
  return roots.map(build);
}

interface Highlighted {
  mat: THREE.MeshStandardMaterial;
  hex: number;
  intensity: number;
}
let highlighted: Highlighted[] = [];

function clearHighlight(): void {
  for (const h of highlighted) {
    h.mat.emissive.setHex(h.hex);
    h.mat.emissiveIntensity = h.intensity;
  }
  highlighted = [];
}

function highlightNode(name: string | null): void {
  clearHighlight();
  if (!name || !model) return;
  let found: THREE.Object3D | null = null;
  model.traverse((o: THREE.Object3D) => {
    if (found === null && o.name === name) found = o;
  });
  const target = found as THREE.Object3D | null;
  if (!target) return;
  target.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.emissive) {
        highlighted.push({
          mat: std,
          hex: std.emissive.getHex(),
          intensity: std.emissiveIntensity,
        });
        std.emissive.setHex(0x0071e3);
        std.emissiveIntensity = 0.35;
      }
    }
  });
}

function applyPose(p: {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
}): void {
  if (!camera || !controls) return;
  applyingPose = true;
  camera.position.set(p.px, p.py, p.pz);
  controls.target.set(p.tx, p.ty, p.tz);
  controls.update();
  applyingPose = false;
}

defineExpose({
  load,
  loadObject,
  listNodeTree,
  highlightNode,
  highlightNodeIndex,
  focusNode,
  applyPose,
});
</script>

<template>
  <div class="viewer" :class="{ expanded }">
    <div class="tag">{{ label }}</div>
    <div ref="host" class="host"></div>
    <div class="bar">
      <select
        v-if="clips.length"
        v-model.number="clipIndex"
        @change="playClip(clipIndex)"
        title="动画"
      >
        <option v-for="(c, i) in clips" :key="i" :value="i">{{ c }}</option>
      </select>
      <label title="剖切">
        剖切
        <input type="checkbox" v-model="clipEnabled" />
        <select v-show="clipEnabled" v-model="clipAxis" title="剖切轴向">
          <option value="x">X 轴</option>
          <option value="y">Y 轴</option>
          <option value="z">Z 轴</option>
        </select>
        <input v-show="clipEnabled" type="range" min="0" max="100" v-model.number="clipValue" />
      </label>
      <select v-model="lightPreset" title="光照">
        <option value="studio">棚光</option>
        <option value="sunset">日出日落</option>
        <option value="dim">冷光</option>
      </select>
      <input
        type="range"
        min="0.2"
        max="2.5"
        step="0.1"
        v-model.number="lightIntensity"
        title="亮度"
      />
      <button @click="screenshot">截图</button>
      <button @click="toggleRecord">{{ recording ? "停止" : "录屏" }}</button>
      <button title="铺满应用窗口（双击画面或 Esc 退出）" @click="toggleExpand">
        {{ expanded ? "✕ 退出铺满" : "⛶ 铺满" }}
      </button>
      <span class="status">{{ status }}</span>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 200px;
  overflow: hidden;
  background: var(--color-bg-stage);
  border: none;
  border-radius: var(--radius-panel);
}
.viewer.expanded {
  position: fixed;
  inset: 0;
  z-index: 60;
  flex: none;
  border: none;
  border-radius: 0;
}
.tag {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  border-radius: 6px;
  box-shadow: none;
}
.host {
  flex: 1;
  min-height: 0;
}
.host :global(canvas) {
  display: block;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-bg-surface);
}
.bar select,
.bar button {
  min-height: var(--control-height);
  padding: 6px 10px;
  font-size: 12px;
  color: var(--color-text-primary);
  background: var(--color-bg-control);
  border: none;
  border-radius: var(--radius-control);
}
.bar button:hover {
  background: var(--color-bg-control-hover);
}
.bar label {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.bar input[type="range"] {
  width: 70px;
}
.status {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-status-success);
  white-space: nowrap;
}
</style>
