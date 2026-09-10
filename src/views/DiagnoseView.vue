<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import WorkspaceEmpty from "../components/WorkspaceEmpty.vue";
import ModelViewer from "../components/ModelViewer.vue";
import {
  baseName,
  diagnoseModel,
  fmtNum,
  readBytes,
  saveBytes,
  type DiagItem,
  type ModelStats,
} from "../lib/api";
import { resolveOutput } from "../lib/settings";
const props = defineProps<{ drop: string[] }>();
const viewer = useTemplateRef<InstanceType<typeof ModelViewer>>("viewer");
const inputPath = ref("");
const items = ref<DiagItem[]>([]);
const stats = ref<ModelStats | null>(null);
const busy = ref(false);
const error = ref("");
const stage = ref("拖入 GLB 开始诊断");
const elapsed = ref(0);
const exported = ref("");
const filter = ref("all");
const limit = ref(100);
const previewBusy = ref(false);
const previewLoaded = ref(false);
const previewError = ref("");
const resultState = ref("未开始");
const bytes = ref<ArrayBuffer | null>(null);
let controller: AbortController | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let generation = 0;
const filtered = computed(() =>
  items.value.filter((item) => filter.value === "all" || item.level === filter.value),
);
const visible = computed(() => filtered.value.slice(0, limit.value));
watch(filter, () => {
  limit.value = 100;
});
watch(
  () => props.drop,
  (paths) => {
    const glb = paths.find((p) => /\.glb$/i.test(p));
    if (glb) void diagnose(glb);
  },
);
async function diagnose(path: string) {
  controller?.abort();
  const token = ++generation;
  controller = new AbortController();
  if (timer) clearInterval(timer);
  inputPath.value = path;
  items.value = [];
  stats.value = null;
  bytes.value = null;
  error.value = "";
  previewError.value = "";
  previewLoaded.value = false;
  exported.value = "";
  stage.value = "正在读取文件";
  resultState.value = "分析中（部分结果）";
  busy.value = true;
  elapsed.value = 0;
  limit.value = 100;
  const started = Date.now();
  timer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - started) / 1000);
  }, 1000);
  try {
    const buffer = await readBytes(path);
    if (token !== generation) return;
    bytes.value = buffer;
    await diagnoseModel(
      buffer,
      (progress) => {
        if (token !== generation) return;
        stage.value = progress.stage;
        items.value.push(...progress.items);
        if (progress.stats) stats.value = progress.stats;
      },
      controller.signal,
    );
    if (token !== generation) return;
    resultState.value = "已完成";
    stage.value = "所有检查已完成";
  } catch (e) {
    if (token !== generation) return;
    const cancelled = e instanceof DOMException && e.name === "AbortError";
    resultState.value = cancelled ? "已取消（部分结果）" : "失败（部分结果）";
    stage.value = cancelled ? "已停止，已输出的信息保留" : "诊断失败，已输出的信息保留";
    if (!cancelled) error.value = String(e);
  } finally {
    if (token === generation) {
      busy.value = false;
      if (timer) clearInterval(timer);
      timer = null;
    }
  }
}
function cancelDiagnosis() {
  controller?.abort();
}
async function preview() {
  if (!bytes.value || previewBusy.value) return;
  previewBusy.value = true;
  try {
    await nextTick();
    await viewer.value?.load(bytes.value);
    previewLoaded.value = true;
  } catch (e) {
    previewError.value = `预览失败（不影响诊断）：${String(e)}`;
  } finally {
    previewBusy.value = false;
  }
}
async function exportReport(format: "json" | "txt") {
  try {
    const state = resultState.value;
    const report = {
      source: inputPath.value,
      exportedAt: new Date().toISOString(),
      status: state,
      stage: stage.value,
      elapsedSeconds: elapsed.value,
      stats: stats.value,
      error: error.value || null,
      items: items.value,
    };
    const text =
      format === "json"
        ? JSON.stringify(report, null, 2)
        : [
            inputPath.value,
            `状态：${state}；阶段：${stage.value}；耗时：${elapsed.value}s`,
            error.value,
            stats.value ? JSON.stringify(stats.value, null, 2) : "",
            ...items.value.map((it) => `[${it.level}][${it.category || "诊断"}] ${it.msg}`),
          ]
            .filter(Boolean)
            .join("\n");
    const path = await resolveOutput(
      inputPath.value,
      "export",
      `.${format}`,
      `${baseName(inputPath.value).replace(/\.glb$/i, "")}-diagnosis`,
    );
    if (!path) {
      exported.value = "导出已跳过：目标文件已存在";
      return;
    }
    await saveBytes(path, new TextEncoder().encode(text));
    exported.value = `已导出 ${state} 报告 → ${path}`;
  } catch (e) {
    exported.value = `导出失败：${String(e)}`;
  }
}
onBeforeUnmount(() => {
  generation++;
  controller?.abort();
  if (timer) clearInterval(timer);
});
</script>
<template>
  <div class="view workbench">
    <div class="page-heading">
      <div>
        <h2>模型诊断</h2>
        <p>{{ inputPath ? baseName(inputPath) : "拖入 GLB，检查模型结构与优化空间" }}</p>
      </div>
      <div class="page-actions">
        <button v-if="busy" class="ui-button" @click="cancelDiagnosis">停止诊断</button
        ><button
          class="ui-button"
          :disabled="!inputPath || !items.length"
          @click="exportReport('txt')"
        >
          导出文本</button
        ><button
          class="ui-button primary"
          :disabled="!inputPath || !items.length"
          @click="exportReport('json')"
        >
          导出 JSON
        </button>
      </div>
    </div>
    <div class="progress" role="status" :class="{ running: busy }">
      {{ stage }}<span v-if="inputPath"> · {{ elapsed }}s · 已输出 {{ items.length }} 条</span>
    </div>
    <div v-if="stats" class="metrics">
      <div>
        <b>{{ fmtNum(stats.vertices) }}</b
        ><span>顶点</span>
      </div>
      <div>
        <b>{{ fmtNum(stats.triangles) }}</b
        ><span>三角面</span>
      </div>
      <div>
        <b>{{ stats.meshes }}</b
        ><span>网格</span>
      </div>
      <div>
        <b>{{ stats.textures }}</b
        ><span>纹理</span>
      </div>
      <div>
        <b>{{ stats.nodes.length }}</b
        ><span>命名节点</span>
      </div>
      <div>
        <b>{{ stats.animations }}</b
        ><span>动画</span>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="exported" role="status">{{ exported }}</p>
    <div class="body">
      <section class="results">
        <div class="toolbar panel-heading">
          <b>检查结果</b>
          <label
            >显示
            <select v-model="filter">
              <option value="all">全部</option>
              <option value="error">错误</option>
              <option value="warn">警告</option>
              <option value="info">信息</option>
            </select></label
          ><span>{{ filtered.length }} 条</span>
        </div>
        <div class="list">
          <article v-for="(it, i) in visible" :key="i" class="item" :class="it.level">
            <small
              >{{ it.level === "error" ? "错误" : it.level === "warn" ? "警告" : "信息" }} ·
              {{ it.category }}</small
            >
            <p>{{ it.msg }}</p>
          </article>
          <button v-if="visible.length < filtered.length" @click="limit += 100">
            继续显示 {{ Math.min(100, filtered.length - limit) }} 条
          </button>
          <WorkspaceEmpty
            v-if="!visible.length"
            :title="busy ? '正在检查模型' : '暂无检查结果'"
            :description="
              busy
                ? '结果将按检查阶段陆续显示，无需等待全部完成。'
                : '拖入模型开始诊断，或切换筛选条件查看结果。'
            "
          />
        </div>
      </section>
      <section class="preview">
        <div class="toolbar panel-heading">
          <b>模型预览</b
          ><button class="ui-button" :disabled="!bytes || previewBusy" @click="preview">
            {{ previewBusy ? "加载中…" : "加载 3D 预览" }}
          </button>
        </div>
        <p v-if="previewError" class="error">{{ previewError }}</p>
        <div class="preview-stage">
          <WorkspaceEmpty
            v-if="!previewLoaded"
            class="preview-empty"
            title="按需预览"
            description="诊断无需等待 3D 加载。需要查看外观时，点击上方加载预览。"
          /><ModelViewer ref="viewer" label="诊断模型" />
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  font-size: var(--typography-label-size);
}
.toolbar label {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-left: auto;
  color: var(--color-text-muted);
}
.toolbar select {
  background: var(--color-bg-control);
  box-shadow: none;
}
.progress {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  font-size: var(--typography-body-size);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  border-radius: var(--radius-control);
}
.progress span {
  margin-left: auto;
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
}
.progress.running::before {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  content: "";
  border: 2px solid var(--color-border-default);
  border-top-color: var(--color-brand-primary);
  border-radius: 50%;
  animation: diagnostic-spin 1s linear infinite;
}
@keyframes diagnostic-spin {
  to {
    transform: rotate(360deg);
  }
}
.metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-4);
  padding: var(--space-5) var(--space-4);
  background: var(--color-bg-card);
  border-radius: var(--radius-panel);
}
.metrics div {
  padding-left: var(--space-2);
}
.metrics b,
.metrics span {
  display: block;
}
.metrics b {
  font-family: var(--font-family-display);
  font-size: var(--typography-display-size);
  font-weight: var(--typography-display-weight);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
}
.metrics span {
  margin-top: var(--space-2);
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
}
.body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(360px, 1.15fr) minmax(320px, 1fr);
  gap: var(--space-3);
  min-height: 0;
}
.results {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  padding: var(--space-4);
  background: var(--color-bg-card);
  border-radius: var(--radius-panel);
}
.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.item {
  padding: var(--space-4) var(--space-2);
  font-size: var(--typography-body-size);
  overflow-wrap: anywhere;
}
.item + .item {
  border-top: 1px solid var(--color-border-default);
}
.item small {
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
}
.item p {
  max-width: 68ch;
  margin: var(--space-2) 0 0;
  line-height: 1.65;
  color: var(--color-text-secondary);
}
.item.warn small {
  color: var(--color-status-warning);
}
.item.error small,
.error {
  color: var(--color-status-danger);
}
.error {
  margin: 0;
  font-size: var(--typography-body-size);
}
.preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding-top: var(--space-2);
}
.preview > .toolbar {
  padding: 0 var(--space-2);
}
.preview-stage {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.preview-empty {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
@media (max-width: 900px) {
  .body {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .results {
    min-height: 320px;
  }
  .preview {
    min-height: 360px;
  }
  .metrics {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
