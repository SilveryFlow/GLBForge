<script setup lang="ts">
import { onMounted, ref } from "vue";
import { appDataDir, join } from "@tauri-apps/api/path";
import { fmtBytes, readLogs, saveBytes } from "../lib/api";

interface LogRow {
  time: string;
  engine: string;
  input: string;
  output: string;
  input_size: number;
  output_size: number;
  ratio: number;
  elapsed_ms: number;
}

const rows = ref<LogRow[]>([]);
const error = ref("");

onMounted(refresh);

async function refresh() {
  try {
    rows.value = (await readLogs())
      .slice()
      .reverse()
      .map((l) => JSON.parse(l) as LogRow)
      .filter((r) => r.time);
  } catch (e) {
    error.value = String(e);
  }
}

async function exportAll() {
  if (!rows.value.length) return;
  const text = rows.value.map((r) => JSON.stringify(r)).join("\n");
  const path = await join(await appDataDir(), `logs-export-${Date.now()}.jsonl`);
  await saveBytes(path, new TextEncoder().encode(text));
  error.value = `已导出 → ${path}`;
}
</script>

<template>
  <div class="view">
    <div class="bar">
      <button @click="refresh">刷新</button>
      <button :disabled="!rows.length" @click="exportAll">导出</button>
      <span class="hint">共 {{ rows.length }} 条操作记录</span>
    </div>
    <p v-if="error" class="msg">{{ error }}</p>
    <div class="tablewrap">
      <table v-if="rows.length">
        <thead>
          <tr>
            <th>时间</th>
            <th>引擎</th>
            <th>输入</th>
            <th>输出</th>
            <th>体积</th>
            <th>省</th>
            <th>耗时</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td>{{ r.time?.replace("T", " ").slice(0, 19) }}</td>
            <td>{{ r.engine }}</td>
            <td class="path">{{ r.input }}</td>
            <td class="path">{{ r.output }}</td>
            <td>{{ fmtBytes(r.input_size) }} → {{ fmtBytes(r.output_size) }}</td>
            <td>{{ r.ratio }}%</td>
            <td>{{ r.elapsed_ms }}ms</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="hint">暂无记录</div>
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
.bar {
  display: flex;
  gap: 10px;
  align-items: center;
}
button {
  padding: 4px 12px;
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: pointer;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
button:disabled {
  opacity: 0.4;
}
.hint {
  font-size: 13px;
  color: var(--color-text-muted);
}
.msg {
  margin: 0;
  font-size: 13px;
  color: var(--color-status-success);
  word-break: break-all;
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
td.path {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
