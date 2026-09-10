import { invoke } from "@tauri-apps/api/core";
import { readFile, readDir } from "@tauri-apps/plugin-fs";

export interface ToolResult {
  tool: string;
  output_path: string;
  input_size: number;
  output_size: number;
  elapsed_ms: number;
}

export interface ModelStats {
  meshes: number;
  primitives: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  animations: number;
  nodes: { name: string; children: number }[];
  extensionsUsed: string[];
  generator: string | null;
}

export interface DiagItem {
  level: "info" | "warn" | "error";
  category?: string;
  msg: string;
}

export type Engine = "meshopt" | "draco";
export type TextureMode = "none" | "etc1s" | "uastc" | "webp";
export type CompressionMode = "none" | "c" | "cc" | "cz";
export type PositionStorage = "int" | "normalized" | "float";

export interface TextureClassSetting {
  mode: TextureMode | "inherit";
  quality: number;
  scale: number;
  limit: number;
  /** 各数值项是否跟随全局（与格式选择互相独立；缺省视为 true 以兼容旧配置） */
  follows: { quality: boolean; scale: boolean; limit: boolean };
}

export interface CompressSettings {
  engine: Engine;
  fallback: boolean;
  compression: CompressionMode;
  dracoLevel: number;
  quant: { pos: number; tex: number; norm: number; color: number };
  geometry: {
    genTangents: boolean;
    keepUnused: boolean;
    floatTexcoords: boolean;
    floatNormals: boolean;
    positionStorage: PositionStorage;
    interleaved: boolean;
    noQuant: boolean;
  };
  simplify: {
    enabled: boolean;
    ratio: number;
    errorLimit: number;
    aggressive: boolean;
    permissive: boolean;
    lockBorder: boolean;
  };
  merge: boolean;
  keepNames: boolean;
  keepExtras: boolean;
  keepMaterials: boolean;
  gpuInstancing: boolean;
  compressionExt: "default" | "ext" | "khr";
  compressionFallback: boolean;
  threads: number;
  anim: { trans: number; rot: number; scale: number; fps: number; keepConstant: boolean };
  texture: {
    mode: TextureMode;
    quality: number;
    scale: number;
    limit: number;
    pow2: boolean;
    flipY: boolean;
    keepPaths: boolean;
    perClass: boolean;
    classes: TextureClassSetting[];
  };
}

const DEFAULT_CLASS: TextureClassSetting = {
  mode: "inherit",
  quality: 8,
  scale: 1,
  limit: 0,
  follows: { quality: true, scale: true, limit: true },
};

export const DEFAULT_SETTINGS: CompressSettings = {
  engine: "meshopt",
  fallback: true,
  compression: "none",
  dracoLevel: 7,
  quant: { pos: 14, tex: 12, norm: 8, color: 8 },
  geometry: {
    genTangents: false,
    keepUnused: false,
    floatTexcoords: false,
    floatNormals: false,
    positionStorage: "int",
    interleaved: false,
    noQuant: false,
  },
  simplify: {
    enabled: false,
    ratio: 0.8,
    errorLimit: 0.01,
    aggressive: false,
    permissive: false,
    lockBorder: false,
  },
  merge: false,
  keepNames: false,
  keepExtras: false,
  keepMaterials: false,
  gpuInstancing: false,
  compressionExt: "default",
  compressionFallback: false,
  threads: 0,
  anim: { trans: 16, rot: 12, scale: 16, fps: 30, keepConstant: false },
  texture: {
    mode: "none",
    quality: 8,
    scale: 1,
    limit: 0,
    pow2: false,
    flipY: false,
    keepPaths: false,
    perClass: false,
    classes: [{ ...DEFAULT_CLASS }, { ...DEFAULT_CLASS }, { ...DEFAULT_CLASS }],
  },
};

export const PRESETS: Record<string, { label: string; patch: Partial<CompressSettings> }> = {
  default: { label: "默认", patch: {} },
  conservative: {
    label: "保守",
    patch: {
      compression: "cc",
      quant: { pos: 16, tex: 14, norm: 10, color: 8 },
      simplify: {
        enabled: false,
        ratio: 1,
        errorLimit: 0.01,
        aggressive: false,
        permissive: false,
        lockBorder: false,
      },
      merge: false,
      keepNames: false,
    },
  },
  balanced: {
    label: "均衡",
    patch: {
      compression: "cc",
      quant: { pos: 14, tex: 12, norm: 8, color: 8 },
      simplify: {
        enabled: false,
        ratio: 0.8,
        errorLimit: 0.01,
        aggressive: false,
        permissive: false,
        lockBorder: false,
      },
      merge: true,
      keepNames: true,
    },
  },
  aggressive: {
    label: "激进",
    patch: {
      compression: "cz",
      quant: { pos: 12, tex: 10, norm: 6, color: 6 },
      simplify: {
        enabled: true,
        ratio: 0.5,
        errorLimit: 0.01,
        aggressive: true,
        permissive: false,
        lockBorder: true,
      },
      merge: true,
      keepNames: true,
    },
  },
};

export function buildGltfpackArgs(s: CompressSettings): string[] {
  const a: string[] = [];
  if (s.compression !== "none") {
    if (s.compressionFallback) {
      a.push("-cf");
    } else {
      a.push(`-${s.compression}`);
    }
  }

  if (s.geometry.noQuant) {
    a.push("-noq");
  } else {
    a.push(
      "-vp",
      String(s.quant.pos),
      "-vt",
      String(s.quant.tex),
      "-vn",
      String(s.quant.norm),
      "-vc",
      String(s.quant.color),
    );
  }
  if (s.geometry.positionStorage === "normalized") a.push("-vpn");
  else if (s.geometry.positionStorage === "float") a.push("-vpf");
  if (s.geometry.genTangents) a.push("-gt");
  if (s.geometry.keepUnused) a.push("-kv");
  if (s.geometry.floatTexcoords) a.push("-vtf");
  if (s.geometry.floatNormals) a.push("-vnf");
  if (s.geometry.interleaved) a.push("-vi");

  if (s.simplify.enabled) {
    a.push("-si", String(s.simplify.ratio));
    if (s.simplify.errorLimit > 0) a.push("-se", String(s.simplify.errorLimit));
    if (s.simplify.aggressive) a.push("-sa");
    if (s.simplify.permissive) a.push("-sp");
    if (s.simplify.lockBorder) a.push("-slb");
  }
  if (s.merge) a.push("-mm");
  if (s.keepNames) a.push("-kn");
  if (s.keepExtras) a.push("-ke");
  if (s.keepMaterials) a.push("-km");
  if (s.gpuInstancing) a.push("-mi");
  if (s.compressionExt !== "default" && s.compression !== "none") a.push("-ce", s.compressionExt);
  a.push(
    "-at",
    String(s.anim.trans),
    "-ar",
    String(s.anim.rot),
    "-as",
    String(s.anim.scale),
    "-af",
    String(s.anim.fps),
  );
  if (s.anim.keepConstant) a.push("-ac");

  if (s.texture.keepPaths) a.push("-tr");

  if (s.texture.perClass) {
    const classNames = ["color", "normal", "attrib"] as const;
    // 每类通道的有效设置：格式与三个数值项各自独立决定是否跟随全局
    const eff = classNames
      .map((cn, i) => {
        const c = s.texture.classes[i];
        const follows = (k: "quality" | "scale" | "limit") =>
          !c || !c.follows || c.follows[k] === undefined ? true : c.follows[k];
        return {
          cn,
          mode: (!c || c.mode === "inherit" ? s.texture.mode : c.mode) as string,
          quality: follows("quality") ? s.texture.quality : c!.quality,
          scale: follows("scale") ? s.texture.scale : c!.scale,
          limit: follows("limit") ? s.texture.limit : c!.limit,
        };
      })
      .filter((x) => x.mode !== "none");

    // 格式相同的通道合并：-tc color,normal（覆盖全部三类时发射裸 -tc）
    const byFmt = new Map<string, string[]>();
    for (const x of eff) byFmt.set(x.mode, [...(byFmt.get(x.mode) ?? []), x.cn]);
    for (const [fmt, list] of byFmt) {
      const flag = fmt === "etc1s" ? "-tc" : fmt === "uastc" ? "-tu" : "-tw";
      a.push(flag, ...(list.length === 3 ? [] : [list.join(",")]));
    }

    // 数值相同的通道合并，且等于引擎默认值时省略（质量 8 / 缩放 1 / 限边 0）
    const byVal = (pick: (x: (typeof eff)[number]) => number | null) => {
      const m = new Map<string, string[]>();
      for (const x of eff) {
        const v = pick(x);
        if (v === null) continue;
        m.set(String(v), [...(m.get(String(v)) ?? []), x.cn]);
      }
      return m;
    };
    const q = byVal((x) => (x.quality !== 8 ? x.quality : null));
    const sc = byVal((x) => (x.scale < 1 ? x.scale : null));
    const lm = byVal((x) => (x.limit > 0 ? x.limit : null));
    // 覆盖全部三类时升格为裸参数形式（-tl 2048），等价且最短
    const pushValFlag = (flag: string, m: Map<string, string[]>) => {
      for (const [v, list] of m) {
        a.push(flag, ...(list.length === 3 ? [] : [list.join(",")]), v);
      }
    };
    pushValFlag("-tq", q);
    pushValFlag("-ts", sc);
    pushValFlag("-tl", lm);

    if (s.texture.pow2) a.push("-tp");
    if (s.texture.flipY) a.push("-tfy");
  } else if (s.texture.mode !== "none") {
    if (s.texture.mode === "etc1s") a.push("-tc");
    else if (s.texture.mode === "uastc") a.push("-tc", "-tu");
    else a.push("-tw");
    a.push("-tq", String(s.texture.quality));
    if (s.texture.scale < 1) a.push("-ts", String(s.texture.scale));
    if (s.texture.limit > 0) a.push("-tl", String(s.texture.limit));
    if (s.texture.pow2) a.push("-tp");
    if (s.texture.flipY) a.push("-tfy");
  }
  if (s.threads > 0) a.push("-tj", String(s.threads));
  return a;
}

export function dracoQuantForLevel(level: number): {
  pos: number;
  tex: number;
  norm: number;
  color: number;
} {
  const clamp = (n: number) => Math.max(6, Math.min(16, n));
  return {
    pos: clamp(8 + level),
    tex: clamp(7 + level),
    norm: clamp(5 + level),
    color: clamp(5 + level),
  };
}

export function buildDracoArgs(s: CompressSettings): string[] {
  const q = s.quant;
  return [
    "-qp",
    String(q.pos),
    "-qt",
    String(q.tex),
    "-qn",
    String(q.norm),
    "-qc",
    String(q.color),
  ];
}

export async function runCompression(
  input: string,
  output: string,
  s: CompressSettings,
  jobId?: number,
): Promise<ToolResult> {
  const primary = s.engine === "meshopt" ? "gltfpack" : "draco_transcoder";
  const args = s.engine === "meshopt" ? buildGltfpackArgs(s) : buildDracoArgs(s);
  try {
    const r = await invoke<ToolResult>("run_tool", { tool: primary, input, output, args, jobId });
    void logOp(s.engine, input, r);
    return r;
  } catch (e) {
    if (s.fallback) {
      const fbTool = s.engine === "meshopt" ? "draco_transcoder" : "gltfpack";
      const fbArgs = s.engine === "meshopt" ? buildDracoArgs(s) : buildGltfpackArgs(s);
      const r = await invoke<ToolResult>("run_tool", {
        tool: fbTool,
        input,
        output,
        args: fbArgs,
        jobId,
      });
      void logOp(`${s.engine}→降级${fbTool}`, input, r);
      return r;
    }
    throw e;
  }
}

export async function cancelJob(jobId: number): Promise<boolean> {
  return invoke("cancel_job", { jobId });
}

export async function logOp(engine: string, input: string, r: ToolResult): Promise<void> {
  const entry = {
    time: new Date().toISOString(),
    engine,
    input,
    output: r.output_path,
    input_size: r.input_size,
    output_size: r.output_size,
    ratio: r.input_size ? +(100 - (r.output_size / r.input_size) * 100).toFixed(1) : 0,
    elapsed_ms: r.elapsed_ms,
  };
  try {
    await invoke("append_log", { entry: JSON.stringify(entry) });
  } catch {
    /* 日志失败不影响主流程 */
  }
}

export async function readLogs(): Promise<string[]> {
  return invoke("read_logs");
}

export async function readBytes(path: string): Promise<ArrayBuffer> {
  const data = await readFile(path);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export async function saveBytes(path: string, data: Uint8Array): Promise<void> {
  await writeFileEnsured(path, data);
}

async function writeFileEnsured(path: string, data: Uint8Array): Promise<void> {
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, data);
}

export async function listModelFiles(dir: string): Promise<string[]> {
  const entries = await readDir(dir);
  return entries
    .filter((e) => e.isFile && /\.(glb|gltf|fbx|obj|stl|dae|ply)$/i.test(e.name))
    .map((e) => joinPath(dir, e.name))
    .sort();
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("\\") || dir.endsWith("/") ? dir + name : dir + "\\" + name;
}

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}

export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(i + 1) : path;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString("zh-CN");
}

type WorkerRequest =
  | { id: number; type: "stats"; buffer: ArrayBuffer }
  | { id: number; type: "diagnose"; buffer: ArrayBuffer }
  | { id: number; type: "write-extras"; buffer: ArrayBuffer; extras: Record<string, unknown> };

type WorkerResponse =
  | { id: number; ok: true; type: "stats"; stats: ModelStats }
  | { id: number; ok: true; type: "diagnose"; items: DiagItem[] }
  | { id: number; ok: true; type: "write-extras"; buffer: ArrayBuffer }
  | { id: number; ok: false; error: string };

type WorkerCall =
  | { type: "stats"; buffer: ArrayBuffer }
  | { type: "diagnose"; buffer: ArrayBuffer }
  | { type: "write-extras"; buffer: ArrayBuffer; extras: Record<string, unknown> };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: string) => void }>();

function callWorker<T>(call: WorkerCall): Promise<T> {
  worker ??= new Worker(new URL("../stats.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) {
      const data = ev.data;
      p.resolve(
        data.type === "stats" ? data.stats : data.type === "diagnose" ? data.items : data.buffer,
      );
    } else p.reject(ev.data.error);
  };
  const id = ++seq;
  const transfer = [call.buffer];
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ ...call, id } as WorkerRequest, transfer);
  });
}

export function statModel(buffer: ArrayBuffer): Promise<ModelStats> {
  const copy = buffer.slice(0);
  return callWorker<ModelStats>({ type: "stats", buffer: copy });
}

export interface DiagnosisProgress {
  stage: string;
  items: DiagItem[];
  stats?: ModelStats;
}

export function diagnoseModel(
  buffer: ArrayBuffer,
  onProgress?: (progress: DiagnosisProgress) => void,
  signal?: AbortSignal,
): Promise<DiagItem[]> {
  const task = new Worker(new URL("../stats.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      task.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("诊断已取消", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    task.onmessage = (event) => {
      const data = event.data;
      if (data.type === "diagnose-progress") {
        onProgress?.(data);
        return;
      }
      cleanup();
      if (data.ok) resolve(data.items);
      else reject(new Error(data.error));
    };
    task.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "诊断线程异常终止，已输出结果保留"));
    };
    task.onmessageerror = () => {
      cleanup();
      reject(new Error("诊断结果读取失败"));
    };
    const copy = buffer.slice(0);
    task.postMessage({ id: 1, type: "diagnose", buffer: copy }, [copy]);
  });
}

export function writeExtras(
  buffer: ArrayBuffer,
  extras: Record<string, unknown>,
): Promise<ArrayBuffer> {
  const copy = buffer.slice(0);
  return callWorker<ArrayBuffer>({ type: "write-extras", buffer: copy, extras });
}
