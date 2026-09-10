<script setup lang="ts">
import { computed, ref, watch } from "vue";
import SettingsPanel from "../components/SettingsPanel.vue";
import {
  DEFAULT_SETTINGS,
  cancelJob,
  fmtBytes,
  listModelFiles,
  runCompression,
  baseName,
  type CompressSettings,
  type ToolResult,
} from "../lib/api";
import { resolveOutput } from "../lib/settings";

const props = defineProps<{ drop: string[] }>();

interface Row {
  path: string;
  status: "待处理" | "处理中" | "完成" | "失败" | "取消" | "跳过";
  inSize: number;
  outSize: number;
  ms: number;
  note?: string;
}

const dir = ref("");
const rows = ref<Row[]>([]);
const batchSettings = ref<CompressSettings>(
  JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CompressSettings,
);
const running = ref(false);
const paused = ref(false);
const error = ref("");
const currentIdx = ref(0);

const jobId = 1;
let stopFlag = false;

watch(
  () => props.drop,
  async (paths) => {
    if (!paths.length) return;
    error.value = "";

    const files = paths.filter((p) => /\.(glb|gltf)$/i.test(p));
    if (files.length) {
      dir.value = "";
      rows.value = files.map((p) => ({
        path: p,
        status: "待处理" as const,
        inSize: 0,
        outSize: 0,
        ms: 0,
      }));
      return;
    }

    const d = paths[0];
    try {
      const list = await listModelFiles(d);
      dir.value = d;
      rows.value = list.map((p) => ({
        path: p,
        status: "待处理" as const,
        inSize: 0,
        outSize: 0,
        ms: 0,
      }));
      if (!list.length) error.value = "文件夹里没有 GLB/GLTF 文件";
    } catch {
      error.value = `无法读取「${d}」——请拖入文件夹，或直接拖入 .glb / .gltf 文件`;
    }
  },
);

async function start() {
  if (running.value || !rows.value.length) return;
  running.value = true;
  paused.value = false;
  stopFlag = false;
  error.value = "";
  const s = batchSettings.value;
  for (let i = 0; i < rows.value.length; i++) {
    if (stopFlag) {
      rows.value[i].status = "取消";
      continue;
    }
    while (paused.value && !stopFlag) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (stopFlag) {
      rows.value[i].status = "取消";
      continue;
    }
    const row = rows.value[i];
    currentIdx.value = i;
    row.status = "处理中";
    const out = await resolveOutput(row.path, s.engine);
    if (!out) {
      row.status = "跳过";
      row.note = "同名输出已存在";
      continue;
    }
    try {
      const r: ToolResult = await runCompression(row.path, out, s, jobId);
      row.status = "完成";
      row.inSize = r.input_size;
      row.outSize = r.output_size;
      row.ms = r.elapsed_ms;
    } catch (e) {
      row.status = "失败";
      row.note = String(e).slice(0, 120);
    }
  }
  running.value = false;
  currentIdx.value = 0;
}

async function cancelAll() {
  stopFlag = true;
  paused.value = false;
  await cancelJob(jobId);
}

const total = computed(() => {
  const done = rows.value.filter((r) => r.status === "完成");
  const inSum = done.reduce((n, r) => n + r.inSize, 0);
  const outSum = done.reduce((n, r) => n + r.outSize, 0);
  return {
    done: done.length,
    total: rows.value.length,
    inSum,
    outSum,
    saved: inSum ? Math.round((1 - outSum / inSum) * 100) : 0,
  };
});
</script>

<template>
  <div class="view">
    <div class="panel">
      <SettingsPanel :settings="batchSettings" />
      <div class="runbar">
        <button :disabled="running || !rows.length" @click="start">开始</button>
        <button :disabled="!running" @click="paused = !paused">
          {{ paused ? "继续" : "暂停" }}
        </button>
        <button :disabled="!running" @click="cancelAll">取消</button>
        <span v-if="running" class="prog">{{ currentIdx + 1 }} / {{ rows.length }}</span>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="total.done" class="ok">
      已完成 {{ total.done }}/{{ total.total }}，总体积 {{ fmtBytes(total.inSum) }} →
      {{ fmtBytes(total.outSum) }}（省 {{ total.saved }}%）
    </p>
    <div v-if="rows.length" class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>文件</th>
            <th>状态</th>
            <th>原始</th>
            <th>输出</th>
            <th>耗时</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.path">
            <td>{{ baseName(r.path) }}</td>
            <td :class="r.status">{{ r.status }}</td>
            <td>{{ r.inSize ? fmtBytes(r.inSize) : "—" }}</td>
            <td>{{ r.outSize ? fmtBytes(r.outSize) : "—" }}</td>
            <td>{{ r.ms ? `${r.ms}ms` : "—" }}</td>
            <td class="note">{{ r.note ?? "" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="hint">
      拖入文件夹批量处理其中模型，或直接拖入若干 .glb / .gltf
      文件（输出在原文件旁，位置可在设置页改）
    </div>
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
.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
}
.runbar {
  display: flex;
  gap: 10px;
  align-items: center;
}
.runbar button {
  padding: 4px 16px;
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  background: rgba(0, 0, 0, 0.05);
  border: none;
  border-radius: 7px;
}
.runbar button:first-child:not(:disabled) {
  font-weight: 500;
  color: #fff;
  background: var(--color-brand-primary);
}
.runbar button:first-child:not(:disabled):hover {
  background: var(--color-brand-hover);
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
.prog {
  color: var(--color-status-success);
}
.dir {
  font-size: 12px;
  color: var(--color-text-disabled);
  word-break: break-all;
}
.error {
  margin: 0;
  font-size: 13px;
  color: var(--color-status-danger);
}
.ok {
  margin: 0;
  font-size: 13px;
  color: var(--color-status-success);
}
.hint {
  font-size: 13px;
  color: var(--color-text-muted);
}
.tablewrap {
  font-size: 13px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 3px 10px;
  text-align: left;
  border: 1px solid var(--color-border-default);
}
th {
  position: sticky;
  top: 0;
  font-weight: normal;
  color: var(--color-text-muted);
  background: var(--color-bg-page);
}
td.完成 {
  color: var(--color-status-success);
}
td.失败 {
  color: var(--color-status-danger);
}
td.处理中 {
  color: var(--color-status-warning);
}
td.跳过,
td.取消 {
  color: var(--color-text-disabled);
}
.note {
  max-width: 300px;
  font-size: 11px;
  color: var(--color-text-disabled);
  word-break: break-all;
}
</style>
