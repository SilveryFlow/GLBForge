<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { appSettings } from "../lib/settings";

const props = defineProps<{ drop: string[] }>();

const shotsDir = ref("");
const recordsDir = ref("");
const logFile = ref("");
const status = ref("");

onMounted(async () => {
  const dir = await appDataDir();
  shotsDir.value = await join(dir, "screenshots");
  recordsDir.value = await join(dir, "records");
  logFile.value = await join(dir, "operations.jsonl");
});

watch(
  () => props.drop,
  (paths) => {
    const p = paths[0];
    if (p && !/\.[a-z0-9]+$/i.test(p)) {
      appSettings.value.customDir = p;
      appSettings.value.outputMode = "custom";
      status.value = `输出目录已设为 ${p}`;
    }
  },
);

const s = appSettings;

async function open(path: string): Promise<void> {
  try {
    await invoke("open_path", { path });
  } catch (e) {
    status.value = `无法打开 ${path}：${String(e)}`;
  }
}
</script>

<template>
  <div class="view">
    <section class="card">
      <h3>输出位置</h3>
      <label class="radio">
        <input type="radio" value="beside" v-model="s.outputMode" />
        输出到源文件同目录（默认）
      </label>
      <label class="radio">
        <input type="radio" value="custom" v-model="s.outputMode" />
        统一输出到指定目录
      </label>
      <div v-if="s.outputMode === 'custom'" class="dirrow">
        <input v-model="s.customDir" placeholder="D:\Models\output —— 也可直接把文件夹拖到本页" />
        <span class="hint">把目标文件夹拖进窗口即可填入</span>
      </div>
    </section>

    <section class="card">
      <h3>文件名后缀</h3>
      <div class="grid">
        <label>Meshopt 压缩<input v-model="s.suffixes.meshopt" /></label>
        <label>Draco 压缩<input v-model="s.suffixes.draco" /></label>
        <label>格式转换<input v-model="s.suffixes.convert" /></label>
        <label>节点标记<input v-model="s.suffixes.mark" /></label>
      </div>
      <p class="hint">
        例：`scene.glb` + 后缀 `-meshopt` → `scene-meshopt.glb`。留空时若与源文件重名会强制加
        `-new`。
      </p>
    </section>

    <section class="card">
      <h3>同名冲突</h3>
      <label class="radio"
        ><input
          type="radio"
          value="rename"
          v-model="s.conflict"
        />自动编号（scene-meshopt-1.glb）</label
      >
      <label class="radio"
        ><input type="radio" value="overwrite" v-model="s.conflict" />覆盖旧输出文件</label
      >
      <label class="radio"><input type="radio" value="skip" v-model="s.conflict" />跳过</label>
    </section>

    <section class="card">
      <h3>保存位置一览</h3>
      <div class="pathrow">
        <span>压缩 / 转换 / 标记输出</span>
        <code>{{
          s.outputMode === "custom" && s.customDir ? s.customDir : "各源文件所在目录"
        }}</code>
      </div>
      <div class="pathrow">
        <span>截图</span><code>{{ shotsDir }}</code>
        <button @click="open(shotsDir)">打开</button>
      </div>
      <div class="pathrow">
        <span>录屏</span><code>{{ recordsDir }}</code>
        <button @click="open(recordsDir)">打开</button>
      </div>
      <div class="pathrow">
        <span>操作日志</span><code>{{ logFile }}</code>
        <button @click="open(logFile)">打开</button>
      </div>
    </section>

    <p class="ok">{{ status }}</p>
  </div>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
  padding: 12px 16px;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
}
h3 {
  margin: 0;
  font-size: 14px;
  font-weight: normal;
  color: var(--color-text-secondary);
}
.radio {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--color-text-primary);
}
.dirrow {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 24px;
}
.dirrow input {
  padding: 5px 10px;
  font-size: 13px;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.grid label {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--color-text-secondary);
}
.grid input {
  width: 110px;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-disabled);
}
.hint b {
  color: var(--color-status-warning);
}
.pathrow {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}
.pathrow span {
  flex-shrink: 0;
  width: 150px;
  color: var(--color-text-secondary);
}
.pathrow code {
  flex: 1;
  font-size: 12px;
  color: var(--color-text-muted);
  word-break: break-all;
}
button {
  flex-shrink: 0;
  padding: 3px 12px;
  font-size: 12px;
  color: var(--color-text-primary);
  cursor: pointer;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.ok {
  margin: 0;
  font-size: 13px;
  color: var(--color-status-success);
  word-break: break-all;
}
</style>
