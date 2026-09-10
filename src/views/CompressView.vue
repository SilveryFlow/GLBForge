<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import ModelViewer from "../components/ModelViewer.vue";
import CompareViewer from "../components/CompareViewer.vue";
import SettingsPanel from "../components/SettingsPanel.vue";
import {
  DEFAULT_SETTINGS,
  baseName,
  fmtBytes,
  fmtNum,
  readBytes,
  runCompression,
  statModel,
  type CompressSettings,
  type ModelStats,
  type ToolResult,
} from "../lib/api";
import { appSettings, resolveOutput } from "../lib/settings";

const props = defineProps<{ drop: string[] }>();

const viewer = useTemplateRef<InstanceType<typeof ModelViewer>>("viewer");

const inputPath = ref("");
const inStats = ref<ModelStats | null>(null);
const outStats = ref<ModelStats | null>(null);
const result = ref<ToolResult | null>(null);
const settings = ref<CompressSettings>(
  JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CompressSettings,
);
const busy = ref(false);
const loading = ref(false);
const loadMsg = ref("");
const error = ref("");
const srcA = ref<ArrayBuffer | null>(null);
const srcB = ref<ArrayBuffer | null>(null);
const displaySource = ref<"original" | "optimized">("original");
const switchingPreview = ref(false);

async function changeDisplay(source: "original" | "optimized") {
  const bytes = source === "original" ? srcA.value : srcB.value;
  if (!bytes || !viewer.value || switchingPreview.value) return;
  switchingPreview.value = true;
  try {
    await viewer.value.load(bytes);
    displaySource.value = source;
  } catch (e) {
    error.value = `预览失败：${String(e)}`;
  } finally {
    switchingPreview.value = false;
  }
}

const viewMode = ref<"model" | "swipe">("model");
const outputName = ref("");
const runStatus = ref("");

function defaultOutputName(): string {
  const stem = baseName(inputPath.value).replace(/\.glb$/i, "");
  const suffix = appSettings.value.suffixes[settings.value.engine] ?? "";
  return `${stem}${suffix}.glb`;
}

watch([inputPath, () => settings.value.engine], () => {
  outputName.value = inputPath.value ? defaultOutputName() : "";
});

watch(
  () => props.drop,
  (paths) => {
    const glb = paths.find((p) => /\.glb$/i.test(p));
    if (glb && !busy.value && !loading.value) void loadInput(glb);
  },
);

async function loadInput(path: string) {
  loading.value = true;
  loadMsg.value = "正在读取模型…";
  error.value = "";
  runStatus.value = "";
  displaySource.value = "original";
  inputPath.value = path;
  result.value = null;
  inStats.value = null;
  outStats.value = null;
  srcA.value = null;
  srcB.value = null;
  viewMode.value = "model";
  try {
    await nextTick();
    const bytes = await readBytes(path);
    loadMsg.value = `正在解析模型（${fmtBytes(bytes.byteLength)}）…`;
    if (!viewer.value) throw new Error("模型查看器未就绪");
    await viewer.value.load(bytes);
    srcA.value = bytes;
    void statModel(bytes)
      .then((stats) => {
        inStats.value = stats;
      })
      .catch(() => {});
  } catch (e) {
    error.value = `模型加载失败：${String(e)}`;
  } finally {
    loading.value = false;
    loadMsg.value = "";
  }
}

async function compress() {
  if (!srcA.value || busy.value || loading.value) return;
  busy.value = true;
  runStatus.value = "正在准备压缩…";
  error.value = "";
  result.value = null;
  srcB.value = null;
  outStats.value = null;
  viewMode.value = "model";
  try {
    await changeDisplay("original");
    await nextTick();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const out = await resolveOutput(
      inputPath.value,
      settings.value.engine,
      ".glb",
      outputName.value,
    );
    if (!out) {
      runStatus.value = "已跳过：同名输出文件已存在";
      return;
    }
    runStatus.value = "正在压缩，请稍候…";
    const completed = await runCompression(inputPath.value, out, settings.value);
    result.value = completed;
    runStatus.value = "文件已写出，正在加载优化后模型…";
    const bytes = await readBytes(completed.output_path);
    if (!viewer.value) throw new Error("模型查看器未就绪");
    await viewer.value.load(bytes);
    srcB.value = bytes;
    displaySource.value = "optimized";
    runStatus.value = "压缩完成，可查看模型或滑动对比";
    void statModel(bytes)
      .then((stats) => {
        outStats.value = stats;
      })
      .catch(() => {});
  } catch (e) {
    runStatus.value = result.value ? "文件已写出，但结果预览失败" : "压缩失败";
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

const grew = computed(() =>
  result.value ? result.value.output_size >= result.value.input_size : false,
);

const rows = computed(() => {
  const r = result.value;
  const a = inStats.value;
  const b = outStats.value;
  return [
    {
      label: "体积",
      before: r ? fmtBytes(r.input_size) : null,
      after: r
        ? `${fmtBytes(r.output_size)}（−${Math.max(0, 100 - (r.output_size / r.input_size) * 100).toFixed(1)}%）`
        : null,
    },
    { label: "顶点", before: a ? fmtNum(a.vertices) : null, after: b ? fmtNum(b.vertices) : null },
    {
      label: "三角面",
      before: a ? fmtNum(a.triangles) : null,
      after: b ? fmtNum(b.triangles) : null,
    },
    {
      label: "材质",
      before: a ? fmtNum(a.materials) : null,
      after: b ? fmtNum(b.materials) : null,
    },
    { label: "纹理", before: a ? fmtNum(a.textures) : null, after: b ? fmtNum(b.textures) : null },
    { label: "引擎/耗时", before: null, after: r ? `${r.tool} · ${r.elapsed_ms} ms` : null },
  ];
});
</script>

<template>
  <div class="view workbench">
    <div class="head">
      <div class="drop" :class="{ loaded: !!inputPath }">
        <template v-if="!inputPath">拖入 .glb 文件</template>
        <template v-else>
          <div class="path">{{ inputPath }}</div>
          <div v-if="inStats" class="meta">
            {{ fmtNum(inStats.vertices) }} 顶点 · {{ fmtNum(inStats.triangles) }} 三角面 ·
            {{ fmtNum(inStats.textures) }} 纹理
          </div>
        </template>
      </div>

      <div class="panel">
        <SettingsPanel :settings="settings" :input-path="inputPath" />
        <div class="runrow">
          <label
            class="outlabel"
            title="输出文件名（可编辑；扩展名固定 .glb，目录与冲突策略见设置页）"
          >
            输出名
            <input v-model="outputName" class="outname" spellcheck="false" />
          </label>
          <button
            class="run"
            :class="{ running: busy }"
            :disabled="!srcA || busy || loading"
            @click="compress"
          >
            <span v-if="busy" class="spin">◐</span>{{ busy ? "压缩中…" : "压缩" }}
          </button>
          <span class="runstatus" role="status" aria-live="polite" :class="{ failed: !!error }">{{
            loading ? loadMsg : runStatus
          }}</span>
        </div>
      </div>
    </div>

    <div v-if="busy" class="busybar"><div class="busybar-fill"></div></div>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="loading" class="loadmsg"><span class="spin">◐</span> {{ loadMsg }}</div>

    <div v-if="result" class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>模型</th>
            <th v-for="row in rows" :key="row.label">{{ row.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>原始</th>
            <td v-for="row in rows" :key="row.label">{{ row.before ?? "—" }}</td>
          </tr>
          <tr>
            <th>优化后</th>
            <td v-for="row in rows" :key="row.label">{{ row.after ?? "—" }}</td>
          </tr>
        </tbody>
      </table>
      <div class="outpath">→ {{ result.output_path }}</div>
      <div v-if="grew" class="grew">
        ⚠
        输出比原始文件还大——输入可能已经被更紧地压缩过。建议：换"均衡/激进"预设、降低量化位数，或保留现有文件。
      </div>
    </div>

    <div class="preview-toolbar">
      <div class="viewmode ui-segment">
        <button :class="{ on: viewMode === 'model' }" @click="viewMode = 'model'">模型展示</button>
        <button
          :disabled="!srcB || busy"
          :class="{ on: viewMode === 'swipe' }"
          @click="viewMode = 'swipe'"
        >
          滑动对比
        </button>
      </div>
      <div
        v-if="viewMode === 'model' && srcB"
        class="source-choice ui-segment"
        role="group"
        aria-label="展示模型来源"
      >
        <button
          :disabled="switchingPreview || busy"
          :aria-pressed="displaySource === 'original'"
          @click="changeDisplay('original')"
        >
          原始模型
        </button>
        <button
          :disabled="switchingPreview || busy"
          :aria-pressed="displaySource === 'optimized'"
          @click="changeDisplay('optimized')"
        >
          压缩后模型
        </button>
        <span v-if="switchingPreview" role="status">正在切换模型…</span>
      </div>
    </div>
    <div v-show="viewMode === 'model'" class="singleviewer">
      <ModelViewer
        ref="viewer"
        :label="displaySource === 'optimized' ? '压缩后模型' : '原始模型'"
      />
    </div>
    <CompareViewer
      v-if="viewMode === 'swipe' && srcA && srcB"
      label-a="原始"
      label-b="优化后"
      :src-a="srcA"
      :src-b="srcB"
    />
  </div>
</template>

<style scoped>
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: auto;
}
.head {
  display: flex;
  gap: 10px;
  align-items: stretch;
}
.drop {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  justify-content: center;
  width: 260px;
  padding: 12px;
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
  user-select: none;
  border: 1.5px dashed var(--color-border-hover);
  border-radius: 12px;
}
.drop.loaded {
  color: var(--color-text-secondary);
  border-color: var(--color-border-default);
}
.drop .path {
  font-size: 12px;
  word-break: break-all;
}
.drop .meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-disabled);
}
.prevbtn {
  padding: 3px 12px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px 12px;
  background: var(--color-bg-card);
  border: none;
  border-radius: var(--radius-panel);
}
.runrow {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
}
.outlabel {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--color-text-muted);
}
.outname {
  width: 220px;
  font-family: var(--font-family-number);
  font-size: 12px;
}
.run {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 6px 24px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  cursor: pointer;
  background: var(--color-brand-primary);
  border: none;
  border-radius: 980px;
  box-shadow: none;
  transition: background 0.15s ease;
}
.run:not(:disabled):hover {
  background: var(--color-brand-hover);
}
.run:disabled {
  cursor: default;
  opacity: 0.4;
}
.run.running {
  background: var(--color-brand-primary);
}
.spin {
  display: inline-block;
  font-size: 12px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.error {
  margin: 0;
  font-size: 13px;
  color: var(--color-status-danger);
  white-space: pre-wrap;
}
.busybar {
  height: 3px;
  overflow: hidden;
  background: var(--color-border-default);
  border-radius: 2px;
}
.runstatus.failed {
  color: var(--color-status-danger);
}
.runstatus {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 24px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.busybar-fill {
  width: 40%;
  height: 100%;
  background: var(--color-brand-primary);
  border-radius: 2px;
  animation: busy-slide 1.1s ease-in-out infinite;
}
@keyframes busy-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}
.loadmsg {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--color-status-warning);
}
.loadmsg button {
  padding: 3px 12px;
  font-size: 12px;
  color: var(--color-text-primary);
  cursor: pointer;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tablewrap {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4);
  overflow-x: auto;
  font-size: 13px;
  background: var(--color-bg-card);
  border-radius: var(--radius-panel);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 4px 12px;
  text-align: left;
  white-space: nowrap;
  border: none;
}
th {
  font-weight: normal;
  color: var(--color-text-muted);
}
.outpath {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-muted);
  word-break: break-all;
}
.grew {
  margin-top: 2px;
  font-size: 12px;
  color: var(--color-status-warning);
}
.preview-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) 0;
}
.viewmode,
.source-choice {
  font-size: var(--typography-body-size);
}
.singleviewer {
  display: flex;
  flex: 1;
  min-height: 320px;
}
.splitter {
  flex: 0 0 8px;
  margin: 0 5px;
  cursor: col-resize;
  background: var(--color-border-default);
  border-radius: 4px;
}
.splitter:hover {
  background: var(--color-status-success);
}
</style>
