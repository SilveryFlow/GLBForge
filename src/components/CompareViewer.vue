<script setup lang="ts">
import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  nextTick,
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

const props = defineProps<{
  labelA: string;
  labelB: string;
  srcA: ArrayBuffer | null;
  srcB: ArrayBuffer | null;
}>();

const rootRef = useTemplateRef<HTMLDivElement>("root");
const split = ref(50);
const dragging = ref(false);
const expanded = ref(false);

function toggleExpand(): void {
  expanded.value = !expanded.value;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && expanded.value) expanded.value = false;
}

let rendererA: THREE.WebGLRenderer | null = null;
let rendererB: THREE.WebGLRenderer | null = null;
let sceneA: THREE.Scene | null = null;
let sceneB: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let controls: OrbitControls | null = null;
let loader: GLTFLoader | null = null;
let observer: ResizeObserver | null = null;
let raf = 0;
let modelA: THREE.Object3D | null = null;
let modelB: THREE.Object3D | null = null;
const clock = new THREE.Clock();

function makeLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  const draco = new DRACOLoader();
  draco.setDecoderPath("draco/");
  l.setDRACOLoader(draco);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath("basis/");
  ktx2.detectSupport(renderer);
  l.setKTX2Loader(ktx2);
  return l;
}

function disposeModel(model: THREE.Object3D | null, scene: THREE.Scene | null) {
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
}

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

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
  const dir = new THREE.DirectionalLight(0xffffff, 2.0);
  dir.position.set(3, 5, 2);
  scene.add(dir);
}

function init() {
  if (rendererA || !rootRef.value) return;
  const hostA = rootRef.value.querySelector<HTMLDivElement>(".layerA")!;
  const hostB = rootRef.value.querySelector<HTMLDivElement>(".layerB")!;

  rendererA = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  rendererB = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  for (const r of [rendererA, rendererB]) r.setPixelRatio(window.devicePixelRatio);
  hostA.appendChild(rendererA.domElement);
  hostB.appendChild(rendererB.domElement);

  sceneA = new THREE.Scene();
  sceneB = new THREE.Scene();
  addLights(sceneA);
  addLights(sceneB);

  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(2, 1.5, 2.5);
  controls = new OrbitControls(
    camera,
    rootRef.value.querySelector<HTMLDivElement>(".interaction")!,
  );
  controls.enableDamping = true;

  loader = makeLoader(rendererA);

  observer = new ResizeObserver(() => {
    const el = rootRef.value!;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    rendererA!.setSize(w, h, false);
    rendererB!.setSize(w, h, false);
    camera!.aspect = w / h;
    camera!.updateProjectionMatrix();
  });
  observer.observe(rootRef.value);
  document.addEventListener("visibilitychange", onVisibility);

  startLoop();
}

let loopOn = false;

function startLoop() {
  if (loopOn || !rendererA || !rendererB || !sceneA || !sceneB || !camera || !controls) return;
  loopOn = true;
  const tick = () => {
    if (!loopOn) return;
    raf = requestAnimationFrame(tick);
    clock.getDelta();
    controls!.update();
    rendererA!.render(sceneA!, camera!);
    rendererB!.render(sceneB!, camera!);
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

function loadInto(which: "A" | "B", buffer: ArrayBuffer): Promise<void> {
  init();
  return new Promise((resolve) => {
    loader!.parse(
      buffer,
      "",
      (gltf: GLTF) => {
        const scene = which === "A" ? sceneA! : sceneB!;
        if (which === "A") {
          disposeModel(modelA, sceneA);
          modelA = gltf.scene;
          scene.add(modelA);
        } else {
          disposeModel(modelB, sceneB);
          modelB = gltf.scene;
          scene.add(modelB);
        }
        const ref = which === "A" ? modelA : modelB;
        if (ref) frameObject(ref);
        resolve();
      },
      () => resolve(),
    );
  });
}

watch(
  () => props.srcA,
  async (b) => {
    await nextTick();
    if (b) await loadInto("A", b);
  },
  { immediate: true },
);
watch(
  () => props.srcB,
  async (b) => {
    await nextTick();
    if (b) await loadInto("B", b);
  },
  { immediate: true },
);

function applySplit() {
  const hostB = rootRef.value?.querySelector<HTMLDivElement>(".layerB");
  if (hostB) hostB.style.clipPath = `inset(0 0 0 ${split.value}%)`;
}

watch(split, applySplit);

function onHandleDown(e: PointerEvent) {
  e.preventDefault();
  dragging.value = true;
  (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
  if (!rootRef.value) return;
  const rect0 = rootRef.value.getBoundingClientRect();
  const apply = (clientX: number) => {
    const x = ((clientX - rect0.left) / rect0.width) * 100;
    split.value = Math.max(0, Math.min(100, x));
  };
  apply(e.clientX);
  const move = (ev: PointerEvent) => apply(ev.clientX);
  const up = () => {
    dragging.value = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function onHandleKeydown(e: KeyboardEvent) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End")
    return;
  e.preventDefault();
  if (e.key === "Home") split.value = 0;
  else if (e.key === "End") split.value = 100;
  else split.value = Math.max(0, Math.min(100, split.value + (e.key === "ArrowRight" ? 1 : -1)));
}

onMounted(() => {
  init();
  applySplit();
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  stopLoop();
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("keydown", onKeydown);
  cancelAnimationFrame(raf);
  observer?.disconnect();
  controls?.dispose();
  disposeModel(modelA, sceneA);
  disposeModel(modelB, sceneB);
  rendererA?.dispose();
  rendererB?.dispose();
  rendererA?.domElement.remove();
  rendererB?.domElement.remove();
});
</script>

<template>
  <Teleport to="body" :disabled="!expanded">
    <div ref="root" class="cmp" :class="{ expanded }" @dblclick="toggleExpand">
      <div class="layerA"></div>
      <div class="layerB"></div>
      <div class="interaction"></div>
      <div
        class="line"
        :style="{ left: split + '%' }"
        role="slider"
        tabindex="0"
        :aria-valuenow="split"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="对比滑块"
        @pointerdown.stop.prevent="onHandleDown"
        @keydown="onHandleKeydown"
      ></div>
      <div class="tagA">{{ labelA }}</div>
      <div class="tagB">{{ labelB }}</div>
      <button
        class="fs"
        title="铺满应用窗口（双击画面或 Esc 退出）"
        @pointerdown.stop
        @dblclick.stop
        @click.stop="toggleExpand"
      >
        {{ expanded ? "✕ 退出铺满" : "⛶ 铺满" }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.cmp {
  position: relative;
  flex: 1;
  min-height: 220px;
  overflow: hidden;
  background: var(--color-bg-stage);
  border: none;
  border-radius: var(--radius-panel);
}
.cmp.expanded {
  position: fixed;
  inset: 0;
  z-index: 60;
  flex: none;
  border: none;
  border-radius: 0;
}
.interaction {
  position: absolute;
  inset: 0;
  z-index: 2;
  touch-action: none;
}
.layerA,
.layerB {
  position: absolute;
  inset: 0;
}
.layerB {
  z-index: 1;
}
.layerA :global(canvas),
.layerB :global(canvas) {
  display: block;
}
.capture {
  display: none;
}
.line {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
  width: 36px;
  margin-left: -18px;
  touch-action: none;
  cursor: ew-resize;
  background: transparent;
}
.line::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  margin-left: -1px;
  content: "";
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.35);
}
.line::after {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 0;
  color: #171717;
  content: "";
  background: #fff;
  border-radius: 50%;
  box-shadow:
    rgba(0, 0, 0, 0.16) 0 0 0 1px,
    rgba(0, 0, 0, 0.12) 0 2px 6px;
  transform: translate(-50%, -50%);
}
.line:focus-visible::after {
  outline: 2px solid var(--color-brand-primary);
  outline-offset: 2px;
}
.line:active::after {
  transform: translate(-50%, -50%) scale(1.08);
}
.tagA,
.tagB {
  position: absolute;
  top: 12px;
  z-index: 3;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
  pointer-events: none;
  background: var(--color-bg-card);
  border-radius: 6px;
  box-shadow: var(--color-border-hairline) 0 0 0 1px;
}
.tagA {
  left: 12px;
}
.tagB {
  right: 12px;
}
.fs {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 4;
  min-height: var(--control-height);
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  background: var(--color-bg-card);
  border: none;
  border-radius: var(--radius-control);
  box-shadow: var(--color-border-hairline) 0 0 0 1px;
}
.fs:hover {
  box-shadow: var(--color-border-hover) 0 0 0 1px;
}
</style>
