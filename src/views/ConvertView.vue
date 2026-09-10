<script setup lang="ts">
import { ref, useTemplateRef, watch } from "vue";
import ModelViewer from "../components/ModelViewer.vue";
import { extOf, isConvertible, loadAny, exportGlb } from "../lib/formats";
import { readBytes, saveBytes, statModel, logOp } from "../lib/api";
import { resolveOutput } from "../lib/settings";
import type { ModelStats } from "../lib/api";
import type * as THREE from "three";

const props = defineProps<{ drop: string[] }>();
const viewer = useTemplateRef<InstanceType<typeof ModelViewer>>("viewer");

const inputPath = ref("");
const busy = ref(false);
const error = ref("");
const resultPath = ref("");
const stats = ref<ModelStats | null>(null);

watch(
  () => props.drop,
  (paths) => {
    const f = paths.find(isConvertible);
    if (f) {
      inputPath.value = f;
      resultPath.value = "";
      stats.value = null;
      error.value = "";
    }
  },
);

async function convert() {
  const path = inputPath.value;
  if (!path || busy.value) return;
  error.value = "";
  resultPath.value = "";
  stats.value = null;
  busy.value = true;
  try {
    const bytes = await readBytes(path);
    const { object, animations } = await loadAny(path, bytes);
    viewer.value?.loadObject(object as THREE.Object3D, animations);
    const glb = await exportGlb(object, animations);
    const out = await resolveOutput(path, "convert");
    if (!out) {
      error.value = "已跳过：同名输出文件已存在（可在 设置 页调整冲突策略）";
      return;
    }
    await saveBytes(out, new Uint8Array(glb));
    resultPath.value = out;
    stats.value = await statModel(glb);
    await logOp(`convert(${extOf(path)}→glb)`, path, {
      tool: "three/GLTFExporter",
      output_path: out,
      input_size: bytes.byteLength,
      output_size: glb.byteLength,
      elapsed_ms: 0,
    });
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="view">
    <div class="hint">
      支持 GLB / glTF / FBX / OBJ / STL / DAE / PLY 拖入，点击转换后输出单文件 GLB（贴图内嵌）
    </div>
    <div class="bar">
      <span v-if="inputPath" class="file">{{ inputPath }}</span>
      <span v-else class="hint">尚未拖入文件</span>
      <button :disabled="!inputPath || busy" @click="convert">
        {{ busy ? "转换中…" : "转换为 GLB" }}
      </button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="resultPath" class="ok">
      ✓ {{ resultPath }}
      <span v-if="stats"
        >（{{ stats.meshes }} 网格 · {{ stats.materials }} 材质 · {{ stats.textures }} 纹理）</span
      >
    </div>
    <ModelViewer ref="viewer" label="转换结果" />
  </div>
</template>

<style scoped>
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.bar {
  display: flex;
  gap: 12px;
  align-items: center;
}
.file {
  flex: 1;
  font-size: 13px;
  color: var(--color-text-secondary);
  word-break: break-all;
}
button {
  flex-shrink: 0;
  padding: 6px 20px;
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
}
button:not(:disabled) {
  border-color: var(--color-status-success);
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
.hint {
  font-size: 13px;
  color: var(--color-text-muted);
}
.error {
  margin: 0;
  font-size: 13px;
  color: var(--color-status-danger);
}
.ok {
  font-size: 13px;
  color: var(--color-status-success);
  word-break: break-all;
}
</style>
