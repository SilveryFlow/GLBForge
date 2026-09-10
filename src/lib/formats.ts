import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { ColladaLoader } from "three/addons/loaders/ColladaLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { decompress } from "three/addons/utils/WebGLTextureUtils.js";
import { dirOf, joinPath, readBytes } from "./api";
import { readDir } from "@tauri-apps/plugin-fs";

export const CONVERTIBLE = ["glb", "gltf", "fbx", "obj", "stl", "dae", "ply"] as const;

export function extOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function isConvertible(path: string): boolean {
  return (CONVERTIBLE as readonly string[]).includes(extOf(path));
}

interface LoadedModel {
  object: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

interface GltfMeta {
  images?: { uri?: string }[];
  buffers?: { uri?: string }[];
}

function safeParseMeta(text: string): GltfMeta | null {
  try {
    return JSON.parse(text) as GltfMeta;
  } catch {
    return null;
  }
}

async function loadGltfExternal(path: string, buffer: ArrayBuffer): Promise<LoadedModel> {
  const meta = extOf(path) === "gltf" ? safeParseMeta(new TextDecoder().decode(buffer)) : null;
  const blobMap = new Map<string, string>();
  if (meta) {
    const uris = [
      ...(meta.images ?? []).map((i) => i.uri),
      ...(meta.buffers ?? []).map((b) => b.uri),
    ].filter((u): u is string => !!u && !u.startsWith("data:"));
    await Promise.all(
      uris.map(async (uri) => {
        try {
          const bytes = await readBytes(joinPath(dirOf(path), decodeURIComponent(uri)));
          const mime = uri.endsWith(".bin")
            ? "application/octet-stream"
            : uri.endsWith(".png")
              ? "image/png"
              : "image/jpeg";
          blobMap.set(uri, URL.createObjectURL(new Blob([bytes], { type: mime })));
        } catch {
          /* 缺失的外部资源按缺失处理 */
        }
      }),
    );
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => blobMap.get(url) ?? url);
  const loader = new GLTFLoader(manager);
  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
    (resolve, reject) => {
      const data: ArrayBuffer | string =
        extOf(path) === "gltf" ? new TextDecoder().decode(buffer) : buffer;
      loader.parse(
        data,
        "",
        (g) => resolve(g),
        (e) => reject(e instanceof Error ? e : new Error(String(e))),
      );
    },
  );
  blobMap.forEach((u) => URL.revokeObjectURL(u));
  return { object: gltf.scene, animations: gltf.animations };
}

/** 收集同目录（含 .fbm / maps / textures 子目录）的贴图文件为 blob URL，供外部贴图解析 */
async function collectSiblingImages(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return map;
  }
  const files = entries.filter((e) => e.isFile);
  for (const sub of entries.filter((e) => e.isDirectory)) {
    if (/\.fbm$/i.test(sub.name) || /^(maps|textures|images)$/i.test(sub.name)) {
      try {
        const subs = await readDir(joinPath(dir, sub.name));
        for (const f of subs.filter((x) => x.isFile)) {
          files.push({ ...f, name: `${sub.name}/${f.name}` });
        }
      } catch {
        /* 子目录不可读则跳过 */
      }
    }
  }
  await Promise.all(
    files
      .filter((f) => /\.(png|jpe?g|bmp|tga|webp)$/i.test(f.name))
      .map(async (f) => {
        try {
          const bytes = await readBytes(joinPath(dir, f.name));
          const mime = /\.png$/i.test(f.name)
            ? "image/png"
            : /\.webp$/i.test(f.name)
              ? "image/webp"
              : "application/octet-stream";
          map.set(f.name.toLowerCase(), URL.createObjectURL(new Blob([bytes], { type: mime })));
        } catch {
          /* 单个文件失败不影响其余 */
        }
      }),
  );
  return map;
}

function siblingImageManager(blobMap: Map<string, string>): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, new TGALoader());
  manager.setURLModifier((url) => {
    if (/^(data:|blob:)/.test(url)) return url;
    const base = url.replace(/^(\.\/|\/)/, "").toLowerCase();
    if (blobMap.has(base)) return blobMap.get(base)!;
    const bn = base.split("/").pop()!;
    if (blobMap.has(bn)) return blobMap.get(bn)!;
    return url;
  });
  return manager;
}

export async function loadAny(path: string, buffer: ArrayBuffer): Promise<LoadedModel> {
  switch (extOf(path)) {
    case "glb":
    case "gltf":
      return loadGltfExternal(path, buffer);
    case "fbx": {
      const blobMap = await collectSiblingImages(dirOf(path));
      const obj = new FBXLoader(siblingImageManager(blobMap)).parse(buffer, "");
      return { object: obj, animations: obj.animations ?? [] };
    }
    case "obj": {
      const obj = new OBJLoader().parse(new TextDecoder().decode(buffer));
      return { object: obj, animations: [] };
    }
    case "stl": {
      const geo = new STLLoader().parse(buffer);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
      const group = new THREE.Group();
      group.add(mesh);
      return { object: group, animations: [] };
    }
    case "ply": {
      const geo = new PLYLoader().parse(buffer);
      const hasColor = !!geo.getAttribute("color");
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: hasColor }));
      const group = new THREE.Group();
      group.add(mesh);
      return { object: group, animations: [] };
    }
    case "dae": {
      const collada = new ColladaLoader().parse(new TextDecoder().decode(buffer), "");
      if (!collada?.scene) throw new Error("DAE 解析失败");
      const animations =
        (collada as unknown as { animations?: THREE.AnimationClip[] }).animations ?? [];
      return { object: collada.scene, animations };
    }
    default:
      throw new Error(`不支持的格式: .${extOf(path)}`);
  }
}

const TEX_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
] as const;

/** 导出前清洗：无数据的贴图剔除，压缩纹理(DXT)解码为普通纹理，否则 GLTFExporter 会报错 */
async function sanitizeForExport(root: THREE.Object3D): Promise<void> {
  const jobs: Array<() => Promise<void>> = [];
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    const list = Array.isArray(mats) ? mats : mats ? [mats] : [];
    for (const m of list) {
      for (const slot of TEX_SLOTS) {
        const t = (m as unknown as Record<string, unknown>)[slot] as THREE.Texture | undefined;
        if (!t || !t.isTexture) continue;
        if ((t as THREE.CompressedTexture).isCompressedTexture) {
          jobs.push(async () => {
            const mat = m as unknown as Record<string, unknown>;
            try {
              const d = await decompress(t as THREE.CompressedTexture, 4096);
              d.flipY = t.flipY;
              d.wrapS = t.wrapS;
              d.wrapT = t.wrapT;
              d.name = t.name;
              mat[slot] = d;
            } catch {
              mat[slot] = null;
            }
          });
        } else if (!t.image) {
          (m as unknown as Record<string, unknown>)[slot] = null;
        }
      }
    }
  });
  await Promise.all(jobs.map((j) => j()));
}

export async function exportGlb(
  object: THREE.Object3D,
  animations: THREE.AnimationClip[],
): Promise<ArrayBuffer> {
  await sanitizeForExport(object);
  const exporter = new GLTFExporter();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      object,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true, animations },
    );
  });
}

export async function convertToGlbBytes(path: string, buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const { object, animations } = await loadAny(path, buffer);
  return exportGlb(object, animations);
}
