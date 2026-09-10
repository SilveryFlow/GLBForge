<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { listen } from "@tauri-apps/api/event";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";
import CompressView from "./views/CompressView.vue";
import ConvertView from "./views/ConvertView.vue";
import BatchView from "./views/BatchView.vue";
import DiagnoseView from "./views/DiagnoseView.vue";
import MarkView from "./views/MarkView.vue";
import LogsView from "./views/LogsView.vue";
import SettingsView from "./views/SettingsView.vue";
import { loadSettings, initSettingsPersistence } from "./lib/settings";

const tabs = [
  { key: "compress", label: "压缩" },
  { key: "convert", label: "格式转换" },
  { key: "batch", label: "批量" },
  { key: "diagnose", label: "诊断" },
  { key: "mark", label: "节点标记" },
  { key: "logs", label: "日志" },
  { key: "settings", label: "设置" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

const active = ref<TabKey>("compress");
const drops = reactive({} as Record<TabKey, string[]>);

let unlisten: (() => void) | null = null;

onMounted(async () => {
  await loadSettings();
  initSettingsPersistence();
  try {
    const dir = await appDataDir();
    await mkdir(await join(dir, "screenshots"), { recursive: true }).catch(() => undefined);
    await mkdir(await join(dir, "records"), { recursive: true }).catch(() => undefined);
  } catch {
    /* 目录预建失败不影响启动 */
  }
  unlisten = await listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
    if (e.payload.paths?.length) {
      drops[active.value] = e.payload.paths;
    }
  });
});
onUnmounted(() => unlisten?.());
</script>

<template>
  <div class="app">
    <header>
      <img src="/glbforge.svg" alt="" width="28" height="28" />
      <h1>GLBForge</h1>
      <span class="sub">glTF 压缩 · 转换 · 诊断 · 标记 — Meshopt / Draco / KTX2，完全离线</span>
    </header>
    <nav>
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="{ active: active === t.key }"
        @click="active = t.key"
      >
        {{ t.label }}
      </button>
    </nav>
    <main>
      <KeepAlive>
        <CompressView v-if="active === 'compress'" :drop="drops.compress ?? []" />
        <ConvertView v-else-if="active === 'convert'" :drop="drops.convert ?? []" />
        <BatchView v-else-if="active === 'batch'" :drop="drops.batch ?? []" />
        <DiagnoseView v-else-if="active === 'diagnose'" :drop="drops.diagnose ?? []" />
        <MarkView v-else-if="active === 'mark'" :drop="drops.mark ?? []" />
        <LogsView v-else-if="active === 'logs'" />
        <SettingsView v-else :drop="drops.settings ?? []" />
      </KeepAlive>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100vh;
  padding: 16px 20px;
}
header {
  display: flex;
  gap: 12px;
  align-items: center;

  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.4px;
  }
  .sub {
    font-size: 12px;
    color: var(--color-text-disabled);
  }
}
nav {
  display: flex;
  gap: 2px;
  align-self: flex-start;
  padding: 2px;
  background: var(--color-bg-control);
  border-radius: 9px;

  button {
    padding: 5px 14px;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-muted);
    cursor: pointer;
    background: transparent;
    border-radius: 7px;
    transition:
      color 0.15s ease,
      background 0.15s ease,
      box-shadow 0.15s ease;

    &:not(.active):hover {
      color: var(--color-text-primary);
    }
    &.active {
      color: var(--color-text-primary);
      background: var(--color-bg-card);
      box-shadow:
        0 1px 3px rgba(0, 0, 0, 0.12),
        0 0 0 0.5px rgba(0, 0, 0, 0.04);
    }
  }
}
main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  > :deep(*) {
    flex: 1;
    min-height: 0;
  }
}
</style>
