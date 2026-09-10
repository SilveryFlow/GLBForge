import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, dedup } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

import { inspectDocument, triangleCount } from "./lib/diagnostics";
import type { DiagItem } from "./lib/api";
import draco from "draco3dgltf";
import decoderWasm from "draco3dgltf/draco_decoder_gltf.wasm?url";
import encoderWasm from "draco3dgltf/draco_encoder.wasm?url";

const io = new WebIO();
io.registerExtensions(ALL_EXTENSIONS);
io.registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

interface Req {
  id: number;
  type: "stats" | "diagnose" | "write-extras";
  buffer: ArrayBuffer;
  extras?: Record<string, unknown>;
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<Req>) => void) | null;
  postMessage: (msg: unknown, transfer?: Transferable[]) => void;
};

function post(msg: Record<string, unknown>, transfer?: Transferable[]): void {
  try {
    ctx.postMessage(msg, transfer);
  } catch (e) {
    const bad = Object.keys(msg).filter((k) => {
      try {
        structuredClone(msg[k]);
        return false;
      } catch {
        return true;
      }
    });
    ctx.postMessage({
      id: typeof msg.id === "number" ? msg.id : -1,
      ok: false,
      error: `响应无法克隆，问题字段: ${bad.join(", ")}；${String(e).slice(0, 160)}`,
    });
  }
}

function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function collectStats(doc: import("@gltf-transform/core").Document) {
  const root = doc.getRoot();
  let primitives = 0;
  let vertices = 0;
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const count = pos ? pos.getCount() : 0;
      vertices += count;
      const idx = prim.getIndices();
      triangles += triangleCount(prim.getMode(), idx ? idx.getCount() : count);
      primitives++;
    }
  }
  return {
    meshes: root.listMeshes().length,
    primitives,
    vertices: Math.round(vertices),
    triangles: Math.round(triangles),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    nodes: root
      .listNodes()
      .filter((n) => n.getName())
      .map((n) => ({ name: n.getName(), children: n.listChildren().length })),
    extensionsUsed: root.listExtensionsUsed().map((extension) => extension.extensionName),
    generator: root.getAsset().generator ?? null,
  };
}

ctx.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, type, buffer } = ev.data;
  try {
    const progress = (stage: string, items: DiagItem[] = [], stats?: unknown) =>
      post({ id, type: "diagnose-progress", stage, items, stats });
    if (type === "diagnose") progress("正在初始化解码器");
    await MeshoptDecoder.ready;
    io.registerDependencies({
      "draco.decoder": await draco.createDecoderModule({ locateFile: () => decoderWasm }),
      "draco.encoder": await draco.createEncoderModule({ locateFile: () => encoderWasm }),
    });
    if (type === "write-extras") {
      const doc = await io.readBinary(new Uint8Array(buffer));
      const root = doc.getRoot();
      for (const [name, value] of Object.entries(ev.data.extras ?? {})) {
        const node = root.listNodes().find((n) => n.getName() === name);
        if (node) node.setExtras(value as Record<string, unknown>);
      }
      const out = await io.writeBinary(doc);
      post({ id, ok: true, type, buffer: out.buffer }, [out.buffer]);
      return;
    }

    if (type === "diagnose") progress("正在解析 GLB 结构与压缩数据");
    const doc = await io.readBinary(new Uint8Array(buffer));

    if (type === "stats") {
      post({ id, ok: true, type, stats: plain(collectStats(doc)) });
      return;
    }

    if (type === "diagnose") {
      const items: DiagItem[] = [];
      const emit = (item: DiagItem) => {
        items.push(item);
        progress("正在检查", [item]);
      };
      progress("基础统计已完成", [], plain(collectStats(doc)));
      emit({
        level: "info",
        category: "文件",
        msg: `源文件 ${buffer.byteLength} 字节。所有文件执行同一组检查，无大小跳过门槛。`,
      });
      await inspectDocument(doc, emit, (stage) => progress(stage));
      progress("正在测量清理前的重写文件大小");
      await MeshoptEncoder.ready;
      const before = (await io.writeBinary(doc)).byteLength;
      progress("正在执行去重与无引用资源清理");
      await doc.transform(prune(), dedup());
      progress("正在测量清理后的重写文件大小");
      const after = (await io.writeBinary(doc)).byteLength;
      emit({
        level: "info",
        category: "清理验证",
        msg: `相同写出配置下，去重与剪枝：${before} → ${after} 字节，差值 ${before - after} 字节。该值比较重写前后，不是相对源文件的压缩率；动画、扩展与编码重写可能影响输出。`,
      });
      emit({
        level: "info",
        category: "检查范围",
        msg: "已完成结构、顶点属性、索引、纹理和清理验证；这不是完整的 glTF 规范验证或视觉质量评估。",
      });
      post({ id, ok: true, type, items });
      return;
    }
  } catch (e) {
    post({ id, ok: false, error: String(e) });
  }
};
