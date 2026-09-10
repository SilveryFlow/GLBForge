<script setup lang="ts">
import { onActivated, ref } from "vue";
import { appDataDir, join } from "@tauri-apps/api/path";
import { clearLogs, fmtBytes, readLogs, saveBytes } from "../lib/api";

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
const message = ref("");
const busy = ref(false);
const confirming = ref(false);

onActivated(refresh);

async function refresh() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  confirming.value = false;
  try {
    rows.value = (await readLogs())
      .slice()
      .reverse()
      .map((l) => JSON.parse(l) as LogRow)
      .filter((r) => r.time);
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function clearAll() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await clearLogs();
    rows.value = [];
    confirming.value = false;
    message.value = "日志已清空";
  } catch (e) {
    error.value = `清空失败：${String(e)}`;
  } finally {
    busy.value = false;
  }
}

async function exportAll() {
  if (!rows.value.length || busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    const text = rows.value.map((r) => JSON.stringify(r)).join("\n");
    const path = await join(await appDataDir(), `logs-export-${Date.now()}.jsonl`);
    await saveBytes(path, new TextEncoder().encode(text));
    message.value = `已导出 → ${path}`;
  } catch (e) {
    error.value = `导出失败：${String(e)}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="view workbench">
    <div class="bar">
      <button class="ui-button" :disabled="busy" @click="refresh">刷新</button>
      <button class="ui-button" :disabled="busy || !rows.length" @click="exportAll">导出</button>
      <button class="ui-button" :disabled="busy || !rows.length" @click="confirming = true">
        清空日志
      </button>
      <span class="hint">共 {{ rows.length }} 条操作记录</span>
    </div>
    <div v-if="confirming" class="confirm" role="group" aria-label="确认清空日志">
      <span>清空全部操作记录？此操作无法撤销，模型文件不受影响。</span>
      <button class="ui-button danger" :disabled="busy" @click="clearAll">
        {{ busy ? "正在清空…" : "确认清空" }}
      </button>
      <button class="ui-button" :disabled="busy" @click="confirming = false">取消</button>
    </div>
    <p v-if="error" class="msg error" role="alert">{{ error }}</p>
    <p v-if="message" class="msg" role="status">{{ message }}</p>
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
.confirm {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3);
  background: var(--color-bg-card);
  border-radius: var(--radius-control);
}
.workbench .ui-button.danger {
  color: var(--color-text-on-brand);
  background: var(--color-status-danger);
}
.msg.error {
  color: var(--color-status-danger);
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
