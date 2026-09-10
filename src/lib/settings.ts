import { ref, watch } from "vue";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { baseName, dirOf, joinPath } from "./api";

import type { CompressSettings } from "./api";

export type OutputMode = "beside" | "custom";
export type ConflictPolicy = "rename" | "overwrite" | "skip";
export type OutputOp = "meshopt" | "draco" | "convert" | "mark" | "export";

export interface CustomPreset {
  name: string;
  settings: CompressSettings;
}

export interface AppSettings {
  outputMode: OutputMode;
  customDir: string;
  conflict: ConflictPolicy;
  suffixes: Record<"meshopt" | "draco" | "convert" | "mark" | "export", string>;
  presets: CustomPreset[];
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  outputMode: "beside",
  customDir: "",
  conflict: "rename",
  suffixes: {
    meshopt: "-meshopt",
    draco: "-draco",
    convert: "-conv",
    mark: "-marked",
    export: "",
  },
  presets: [],
};

export const appSettings = ref<AppSettings>({
  ...DEFAULT_APP_SETTINGS,
  suffixes: { ...DEFAULT_APP_SETTINGS.suffixes },
});

let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function migrateCompression(v: unknown): "none" | "c" | "cc" | "cz" {
  if (v === 0) return "c";
  if (v === 1) return "cc";
  if (v === 2) return "cz";
  if (v === "c" || v === "cc" || v === "cz") return v;
  return "none";
}

export async function loadSettings(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const file = await join(await appDataDir(), "settings.json");
    if (await exists(file)) {
      const parsed = JSON.parse(await readTextFile(file)) as Partial<AppSettings>;
      appSettings.value = {
        ...DEFAULT_APP_SETTINGS,
        ...parsed,
        suffixes: { ...DEFAULT_APP_SETTINGS.suffixes, ...parsed.suffixes },
        presets: (parsed.presets ?? []).map((p) => ({
          ...p,
          settings: { ...p.settings, compression: migrateCompression(p.settings.compression) },
        })),
      };
    }
  } catch (e) {
    console.warn("[settings] 读取配置失败，使用默认值：", e);
  }
}

export function initSettingsPersistence(): void {
  watch(
    appSettings,
    () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const dir = await appDataDir();
          await mkdir(dir, { recursive: true }).catch(() => undefined);
          const file = await join(dir, "settings.json");
          await writeTextFile(file, JSON.stringify(appSettings.value, null, 2));
        } catch (e) {
          // 静默吞掉会掩盖权限问题（曾导致预设丢失），必须可见
          console.error("[settings] 配置保存失败：", e);
        }
      }, 300);
    },
    { deep: true },
  );
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

export function outputDirFor(input: string): string {
  const s = appSettings.value;
  return s.outputMode === "custom" && s.customDir ? s.customDir : dirOf(input);
}

/**
 * 解析输出路径。保证：
 * 1. 永远不等于源文件路径（即使后缀配成空也会强制加 -new）；
 * 2. 按 conflict 策略处理同名冲突：rename 自动编号 / overwrite 覆盖旧输出 / skip 返回 null。
 */
export async function resolveOutput(
  input: string,
  op: keyof AppSettings["suffixes"],
  ext = ".glb",
  customName?: string,
): Promise<string | null> {
  const s = appSettings.value;
  const dir = outputDirFor(input);
  if (s.outputMode === "custom" && s.customDir) {
    await mkdir(dir, { recursive: true }).catch(() => undefined);
  }
  const suffix = s.suffixes[op] ?? "";
  const stem = customName?.trim()
    ? customName.trim().replace(/\.[a-z0-9]+$/i, "")
    : baseName(input).replace(/\.[a-z0-9]+$/i, "") + suffix;

  let target = joinPath(dir, stem + ext);
  if (samePath(target, input)) {
    target = joinPath(dir, stem + suffix + "-new" + ext);
  }
  if (s.conflict === "overwrite") return target;
  if (!(await exists(target))) return target;
  if (s.conflict === "skip") return null;
  for (let i = 1; i < 1000; i++) {
    const t = joinPath(dir, `${stem}-${i}${ext}`);
    if (!(await exists(t))) return t;
  }
  return null;
}
