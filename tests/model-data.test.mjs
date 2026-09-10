import test from "node:test";
import assert from "node:assert/strict";
import { Document, WebIO } from "@gltf-transform/core";
import { inspectDocument, triangleCount } from "../src/lib/diagnostics.ts";
import { modelSignature, readGlbJson, writeGlbMarks } from "../src/lib/glbMarks.ts";

function makeDocument(seam = false) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, -1, -1, 0, 1, -1, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const sign = seam ? -1 : 1;
  const normals = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, sign, 0, 0, sign, 0, 0, sign]))
    .setBuffer(buffer);
  const primitive = doc
    .createPrimitive()
    .setAttribute("POSITION", positions)
    .setAttribute("NORMAL", normals);
  const mesh = doc.createMesh().addPrimitive(primitive);
  const root = doc.createNode("root");
  root.addChild(doc.createNode("same").setMesh(mesh));
  root.addChild(doc.createNode("same").setMesh(mesh));
  root.addChild(doc.createNode().setMesh(mesh));
  doc.createScene().addChild(root);
  return { doc, primitive };
}

async function inspect(doc) {
  const items = [],
    stages = [];
  await inspectDocument(
    doc,
    (item) => items.push(item),
    (stage) => stages.push(stage),
  );
  return { items, stages };
}

test("different normal seams are not reported as weldable duplicates", async () => {
  const { items } = await inspect(makeDocument(true).doc);
  assert.ok(items.some((item) => item.msg.includes("未发现全部属性相同")));
  assert.ok(!items.some((item) => item.msg.includes("可尝试精确焊接")));
});

test("identical full vertex attributes are counted and stages are incremental", async () => {
  const { items, stages } = await inspect(makeDocument().doc);
  assert.ok(items.some((item) => item.msg.includes("3/6")));
  assert.ok(items.some((item) => item.msg.includes("节点名「same」出现 2 次")));
  assert.ok(stages.length >= 3);
});

test("morph-target differences prevent welding even with identical base attributes", async () => {
  const { doc, primitive } = makeDocument();
  const morph = doc
    .createAccessor()
    .setType("VEC3")
    .setBuffer(doc.getRoot().listBuffers()[0])
    .setArray(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]));
  primitive.addTarget(doc.createPrimitiveTarget().setAttribute("POSITION", morph));
  const { items } = await inspect(doc);
  assert.ok(!items.some((item) => item.msg.includes("可尝试精确焊接")));
});

test("triangle counts account for non-triangle drawing modes", () => {
  assert.equal(triangleCount(0, 6), 0);
  assert.equal(triangleCount(1, 6), 0);
  assert.equal(triangleCount(4, 6), 2);
  assert.equal(triangleCount(5, 6), 4);
  assert.equal(triangleCount(6, 6), 4);
});

test("indexed mark writes isolate duplicate names and unnamed nodes, preserving binary chunks", async () => {
  const encoded = await new WebIO().writeBinary(makeDocument().doc);
  const source = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  const json = readGlbJson(source);
  const same = json.nodes
    .map((node, index) => (node.name === "same" ? index : -1))
    .filter((index) => index >= 0);
  const unnamed = json.nodes.findIndex((node) => !node.name);
  const output = writeGlbMarks(source, {
    [same[1]]: { assetId: "second" },
    [unnamed]: { enabled: true },
  });
  const changed = readGlbJson(output);
  assert.equal(changed.nodes[same[0]].extras, undefined);
  assert.equal(changed.nodes[same[1]].extras.assetId, "second");
  assert.equal(changed.nodes[unnamed].extras.enabled, true);
  const tail = (bytes) => new Uint8Array(bytes, 20 + new DataView(bytes).getUint32(12, true));
  assert.deepEqual(tail(output), tail(source));
  assert.equal(await modelSignature(output), await modelSignature(source));
  assert.throws(() => writeGlbMarks(source, { 99999: {} }), /节点索引无效/);
});
