// Sequential yielding bounds memory and streams results while keeping cancellation responsive.
/* eslint-disable no-await-in-loop */
import type { Document, Primitive } from "@gltf-transform/core";
import type { DiagItem } from "./api";

export const triangleCount = (mode: number, count: number) =>
  mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Hash all vertex streams, then compare actual values on collision. POSITION alone is insufficient.
async function duplicates(prim: Primitive, progress: (done: number, total: number) => void) {
  const attrs = [
    ...prim.listAttributes(),
    ...prim.listTargets().flatMap((target) => target.listAttributes()),
  ];
  const count = prim.getAttribute("POSITION")?.getCount() ?? 0;
  if (!count || attrs.some((a) => a.getCount() !== count)) return null;
  const streams = attrs.map((a) => ({ data: a.getArray()!, width: a.getElementSize() }));
  const buckets = new Map<number, number | number[]>();
  const bits = new DataView(new ArrayBuffer(8));
  const equal = (a: number, b: number) =>
    streams.every(({ data, width }) => {
      for (let c = 0; c < width; c++) if (data[a * width + c] !== data[b * width + c]) return false;
      return true;
    });
  let repeated = 0;
  let invalid = 0;
  for (let i = 0; i < count; i++) {
    let hash = 2166136261;
    let finite = true;
    for (const { data, width } of streams) {
      for (let c = 0; c < width; c++) {
        const value = data[i * width + c];
        if (!Number.isFinite(value)) finite = false;
        bits.setFloat64(0, value === 0 ? 0 : value, true);
        hash = Math.imul(hash ^ bits.getUint32(0, true), 16777619);
        hash = Math.imul(hash ^ bits.getUint32(4, true), 16777619);
      }
    }
    if (!finite) invalid++;
    const candidates = buckets.get(hash);
    if (candidates === undefined) buckets.set(hash, i);
    else if (typeof candidates === "number") {
      if (equal(i, candidates)) repeated++;
      else buckets.set(hash, [candidates, i]);
    } else if (candidates.some((j) => equal(i, j))) repeated++;
    else candidates.push(i);
    if (i % 8192 === 0) {
      progress(i, count);
      await pause();
    }
  }
  buckets.clear();
  return { repeated, invalid, count };
}

export async function inspectDocument(
  doc: Document,
  emit: (item: DiagItem) => void,
  stage: (text: string) => void,
) {
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const names = new Map<string, number>();
  stage("检查场景与节点");
  emit({
    level: "info",
    category: "结构",
    msg: `${root.listScenes().length} 个场景、${nodes.length} 个节点，其中 ${nodes.filter((n) => !!n.getName()).length} 个命名节点。`,
  });
  for (const node of nodes)
    if (node.getName()) names.set(node.getName(), (names.get(node.getName()) ?? 0) + 1);
  for (const [name, count] of names)
    if (count > 1)
      emit({
        level: "warn",
        category: "结构",
        msg: `节点名「${name}」出现 ${count} 次。按名称定位存在歧义，应使用节点索引。`,
      });
  emit({
    level: "info",
    category: "结构",
    msg: `生成器：${root.getAsset().generator || "未声明"}；扩展：${
      root
        .listExtensionsUsed()
        .map((e) => e.extensionName)
        .join("、") || "无"
    }。`,
  });
  await pause();
  let pi = 0;
  const total = root.listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().length, 0);
  for (const [mi, mesh] of root.listMeshes().entries()) {
    for (const [index, prim] of mesh.listPrimitives().entries()) {
      pi++;
      const label = `网格 #${mi}「${mesh.getName() || "未命名"}」/ 图元 #${index}`;
      const pos = prim.getAttribute("POSITION");
      stage(`检查几何 ${pi}/${total}：${label}`);
      if (!pos) {
        emit({
          level: "error",
          category: "几何",
          msg: `${label} 缺少 POSITION，无法确定顶点位置。`,
        });
        continue;
      }
      const count = pos.getCount();
      const mode = prim.getMode();
      emit({
        level: "info",
        category: "几何",
        msg: `${label}：${count} 顶点，${triangleCount(mode, prim.getIndices()?.getCount() ?? count)} 三角面，绘制模式 ${mode}。`,
      });
      for (const attr of [
        ...prim.listAttributes(),
        ...prim.listTargets().flatMap((t) => t.listAttributes()),
      ]) {
        if (attr.getCount() !== count)
          emit({
            level: "error",
            category: "几何",
            msg: `${label} 属性长度不一致：POSITION 为 ${count}，某属性为 ${attr.getCount()}。`,
          });
      }
      if (mode >= 4 && !prim.getAttribute("NORMAL"))
        emit({
          level: "info",
          category: "几何",
          msg: `${label} 未提供法线；受光照材质通常需要渲染器生成面法线，无光照材质不受此影响。`,
        });
      const indices = prim.getIndices()?.getArray();
      let bad = 0;
      if (indices)
        for (let i = 0; i < indices.length; i++) {
          if (!Number.isInteger(indices[i]) || indices[i] < 0 || indices[i] >= count) bad++;
          if (i % 32768 === 0) await pause();
        }
      if (bad)
        emit({ level: "error", category: "几何", msg: `${label} 存在 ${bad} 个越界或非法索引。` });
      const dup = await duplicates(prim, (done, all) =>
        stage(`检查几何 ${pi}/${total} · 顶点 ${done}/${all}`),
      );
      if (dup?.invalid)
        emit({
          level: "error",
          category: "几何",
          msg: `${label} 有 ${dup.invalid} 个顶点含非有限数值。`,
        });
      if (dup?.repeated)
        emit({
          level: "info",
          category: "几何",
          msg: `${label} 有 ${dup.repeated}/${dup.count} 个顶点在全部已存储属性（含法线、UV、蒙皮和形变数据）上相同，可尝试精确焊接。不会合并属性不同的硬边或接缝；实际文件收益需写出验证。`,
        });
      else if (dup)
        emit({
          level: "info",
          category: "几何",
          msg: `${label} 未发现全部属性相同的重复顶点。坐标重合不作为优化警告。`,
        });
      await pause();
    }
  }
  emit({
    level: "info",
    category: "几何",
    msg: `${total} 个网格图元定义；实际绘制调用数取决于节点实例、材质通道和渲染器，不能直接等同于图元数。`,
  });
  for (const [i, texture] of root.listTextures().entries()) {
    stage(`检查纹理 ${i + 1}/${root.listTextures().length}`);
    const size = texture.getSize();
    const mime = texture.getMimeType();
    emit({
      level: "info",
      category: "纹理",
      msg: `纹理 #${i}「${texture.getName() || "未命名"}」：${mime || "未声明格式"}，${size ? `${size[0]} × ${size[1]}` : "尺寸未能识别"}，嵌入数据 ${texture.getImage()?.byteLength ?? 0} 字节。`,
    });
    if (size && Math.max(...size) > 4096)
      emit({
        level: "warn",
        category: "纹理",
        msg: `纹理 #${i} 最大边超过 4096px，可能增加显存占用；是否缩小应根据显示精度决定。`,
      });
    if (mime === "image/png" || mime === "image/jpeg")
      emit({
        level: "info",
        category: "纹理",
        msg: `纹理 #${i} 使用 PNG/JPEG 文件压缩，通常需解码上传 GPU。可评估 KTX2；收益取决于内容及编码设置，不保证固定缩减比例。`,
      });
    const referenced = texture.listParents().some((parent) => parent.propertyType !== "Root");
    if (!referenced)
      emit({
        level: "info",
        category: "纹理",
        msg: `纹理 #${i} 未被解析后的对象引用，可评估清理。`,
      });
    await pause();
  }
}
