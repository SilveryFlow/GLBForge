export interface MarkNode {
  name?: string;
  children?: number[];
  mesh?: number;
  extras?: unknown;
  [key: string]: unknown;
}
interface GlbJson {
  nodes?: MarkNode[];
  scenes?: { name?: string; nodes?: number[] }[];
  scene?: number;
  [key: string]: unknown;
}
export function readGlbJson(buffer: ArrayBuffer): GlbJson {
  const view = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength
  )
    throw new Error("无效的 GLB 2.0 文件");
  const size = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + size > buffer.byteLength || size % 4)
    throw new Error("GLB JSON 数据块无效");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, size))) as GlbJson;
}
export function writeGlbMarks(buffer: ArrayBuffer, changes: Record<string, unknown>): ArrayBuffer {
  const json = readGlbJson(buffer);
  for (const [key, value] of Object.entries(changes)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || !json.nodes?.[index])
      throw new Error(`节点索引无效：${key}`);
    json.nodes[index].extras = value;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(encoded.byteLength / 4) * 4;
  const oldOffset = 20 + new DataView(buffer).getUint32(12, true);
  const result = new ArrayBuffer(20 + length + buffer.byteLength - oldOffset);
  const view = new DataView(result);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, result.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  const bytes = new Uint8Array(result);
  bytes.fill(32, 20, 20 + length);
  bytes.set(encoded, 20);
  bytes.set(new Uint8Array(buffer, oldOffset), 20 + length);
  return result;
}
export async function modelSignature(buffer: ArrayBuffer): Promise<string> {
  const json = readGlbJson(buffer);
  const nodes = json.nodes?.map(({ extras: _extras, ...node }) => node);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...json, nodes }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
