<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import WorkspaceEmpty from "../components/WorkspaceEmpty.vue";
import ModelViewer from "../components/ModelViewer.vue";
import { readBytes, saveBytes, baseName } from "../lib/api";
import { resolveOutput } from "../lib/settings";
import {
  isObject,
  modelSignature,
  readGlbJson,
  writeGlbMarks,
  type MarkNode,
} from "../lib/glbMarks";
const props = defineProps<{ drop: string[] }>();
const viewer = useTemplateRef<InstanceType<typeof ModelViewer>>("viewer");
const treeHost = useTemplateRef<HTMLDivElement>("treeHost");
const importFile = useTemplateRef<HTMLInputElement>("importFile");
const inputPath = ref("");
const pathText = ref("");
const inputBytes = ref<ArrayBuffer | null>(null);
const nodes = ref<MarkNode[]>([]);
const expanded = ref(new Set<number>());
const selected = ref<number | null>(null);
const extras = ref<Record<string, unknown>>({});
const baseline = ref<Record<string, unknown>>({});
const jsonText = ref("{}");
const query = ref("");
const markedOnly = ref(false);
const busy = ref(false);
const error = ref("");
const status = ref("");
const previewError = ref("");
const pendingLoad = ref("");
const editMode = ref<"fields" | "json">("fields");
const fields = ref<{ id: number; key: string; type: string; value: string }[]>([]);
let fieldId = 0;
const fieldDraftDirty = ref(false);
const selectedNode = computed(() => (selected.value === null ? null : nodes.value[selected.value]));
const nodeName = (id: number) => nodes.value[id]?.name || `未命名节点 #${id}`;
const marked = (id: number) =>
  isObject(extras.value[id]) && Object.keys(extras.value[id] as object).length > 0;
const markedCount = computed(() => nodes.value.filter((_, id) => marked(id)).length);
const dirtyDraft = computed(
  () =>
    selected.value !== null &&
    jsonText.value !== JSON.stringify(extras.value[selected.value] ?? {}, null, 2),
);
const changed = computed(() =>
  nodes.value
    .map((_, id) => id)
    .filter((id) => JSON.stringify(extras.value[id]) !== JSON.stringify(baseline.value[id])),
);
const parents = computed(() => {
  const map = new Map<number, number>();
  nodes.value.forEach((node, id) =>
    node.children?.forEach((child) => {
      if (!map.has(child)) map.set(child, id);
    }),
  );
  return map;
});
const rows = computed(() => {
  const result: { id: number; depth: number; hasChildren: boolean }[] = [];
  const seen = new Set<number>();
  const matches = new Set<number>();
  const filtering = !!query.value.trim() || markedOnly.value;
  if (filtering)
    nodes.value.forEach((_, id) => {
      if (
        !`${nodeName(id)} #${id}`.toLowerCase().includes(query.value.trim().toLowerCase()) ||
        (markedOnly.value && !marked(id))
      )
        return;
      let at: number | undefined = id;
      const visited = new Set<number>();
      while (at !== undefined && !visited.has(at)) {
        visited.add(at);
        matches.add(at);
        at = parents.value.get(at);
      }
    });
  const walk = (id: number, depth: number) => {
    if (seen.has(id) || !nodes.value[id]) return;
    seen.add(id);
    if (filtering && !matches.has(id)) return;
    const children = nodes.value[id].children ?? [];
    result.push({ id, depth, hasChildren: children.length > 0 });
    if (filtering || expanded.value.has(id)) children.forEach((child) => walk(child, depth + 1));
  };
  nodes.value.forEach((_, id) => {
    if (!parents.value.has(id)) walk(id, 0);
  });
  return result;
});
watch(
  () => props.drop,
  (paths) => {
    const path = paths.find((p) => /\.glb$/i.test(p));
    if (path) requestLoad(path);
  },
);
function requestLoad(path: string) {
  if (!path.trim() || busy.value) return;
  if (dirtyDraft.value || fieldDraftDirty.value || changed.value.length) {
    pendingLoad.value = path;
    return;
  }
  void load(path);
}
async function load(path: string) {
  busy.value = true;
  error.value = "";
  status.value = "正在读取模型与节点…";
  previewError.value = "";
  pendingLoad.value = "";
  try {
    const bytes = await readBytes(path);
    const json = readGlbJson(bytes);
    nodes.value = json.nodes ?? [];
    extras.value = Object.fromEntries(nodes.value.map((node, id) => [id, node.extras ?? {}]));
    baseline.value = JSON.parse(JSON.stringify(extras.value));
    inputBytes.value = bytes;
    inputPath.value = path;
    pathText.value = path;
    selected.value = null;
    query.value = "";
    markedOnly.value = false;
    expanded.value = new Set(nodes.value.map((_, id) => id).filter((id) => !parents.value.has(id)));
    await nextTick();
    try {
      await viewer.value?.load(bytes);
    } catch (e) {
      previewError.value = `3D 预览失败，节点数据仍可编辑：${String(e)}`;
    }
    status.value = `已加载 ${nodes.value.length} 个节点`;
  } catch (e) {
    error.value = String(e);
    status.value = "加载失败";
  } finally {
    busy.value = false;
  }
}
function setFields() {
  fieldDraftDirty.value = false;
  try {
    const value = JSON.parse(jsonText.value);
    fields.value = isObject(value)
      ? Object.entries(value).map(([key, v]) => ({
          id: ++fieldId,
          key,
          type:
            typeof v === "string"
              ? "string"
              : typeof v === "number"
                ? "number"
                : typeof v === "boolean"
                  ? "boolean"
                  : "json",
          value: typeof v === "string" ? v : JSON.stringify(v),
        }))
      : [];
  } catch {
    fields.value = [];
  }
}
function fieldsToJson() {
  fieldDraftDirty.value = true;
  try {
    const entries: [string, unknown][] = [];
    const used = new Set<string>();
    for (const f of fields.value) {
      if (!f.key.trim()) throw new Error("字段名不能为空");
      if (used.has(f.key)) throw new Error(`字段名重复：${f.key}`);
      used.add(f.key);
      const value = f.type === "string" ? f.value : JSON.parse(f.value);
      if (f.type === "number" && (typeof value !== "number" || !Number.isFinite(value)))
        throw new Error(`「${f.key}」需要有效数字`);
      if (f.type === "boolean" && typeof value !== "boolean")
        throw new Error(`「${f.key}」需要 true 或 false`);
      entries.push([f.key, value]);
    }
    jsonText.value = JSON.stringify(Object.fromEntries(entries), null, 2);
    error.value = "";
    return true;
  } catch (e) {
    error.value = String(e);
    return false;
  }
}
function applyDraft() {
  if (selected.value === null) return true;
  if (editMode.value === "fields" && !fieldsToJson()) return false;
  try {
    const value = JSON.parse(jsonText.value);
    if (!isObject(value)) throw new Error("节点业务数据必须是 JSON 对象");
    extras.value[selected.value] = value;
    fieldDraftDirty.value = false;
    jsonText.value = JSON.stringify(value, null, 2);
    error.value = "";
    return true;
  } catch (e) {
    error.value = `数据无效：${String(e)}`;
    return false;
  }
}
async function select(id: number, fromModel = false) {
  if (busy.value || !nodes.value[id] || !applyDraft()) return;
  selected.value = id;
  jsonText.value = JSON.stringify(extras.value[id] ?? {}, null, 2);
  setFields();
  if (!isObject(extras.value[id])) editMode.value = "json";
  if (fromModel) {
    query.value = "";
    markedOnly.value = false;
  }
  const next = new Set(expanded.value);
  let at = parents.value.get(id);
  const seen = new Set<number>();
  while (at !== undefined && !seen.has(at)) {
    seen.add(at);
    next.add(at);
    at = parents.value.get(at);
  }
  expanded.value = next;
  viewer.value?.highlightNodeIndex(id);
  await nextTick();
  treeHost.value
    ?.querySelector<HTMLElement>(`[data-node-index="${id}"]`)
    ?.scrollIntoView({ block: "nearest" });
}
function toggle(id: number) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
function treeKey(event: KeyboardEvent, id: number) {
  const at = rows.value.findIndex((r) => r.id === id);
  let next = id;
  if (event.key === "ArrowDown") next = rows.value[Math.min(at + 1, rows.value.length - 1)].id;
  else if (event.key === "ArrowUp") next = rows.value[Math.max(0, at - 1)].id;
  else if (event.key === "ArrowRight") expanded.value = new Set([...expanded.value, id]);
  else if (event.key === "ArrowLeft") {
    if (expanded.value.has(id)) toggle(id);
    else next = parents.value.get(id) ?? id;
  } else if (event.key !== "Enter") return;
  event.preventDefault();
  void select(next).then(() =>
    treeHost.value?.querySelector<HTMLElement>(`[data-node-index="${next}"]`)?.focus(),
  );
}
function changeMode(mode: "fields" | "json") {
  if (!applyDraft()) return;
  editMode.value = mode;
  setFields();
}
function revertDraft() {
  if (selected.value !== null) {
    jsonText.value = JSON.stringify(extras.value[selected.value] ?? {}, null, 2);
    setFields();
    error.value = "";
  }
}
function addField() {
  fields.value.push({ id: ++fieldId, key: `字段${fieldId}`, type: "string", value: "" });
  fieldsToJson();
}
async function writeGlb() {
  if (busy.value || !inputBytes.value || !applyDraft()) return;
  busy.value = true;
  error.value = "";
  try {
    const output = writeGlbMarks(
      inputBytes.value,
      Object.fromEntries(changed.value.map((id) => [id, extras.value[id]])),
    );
    const path = await resolveOutput(inputPath.value, "mark");
    if (!path) {
      status.value = "已跳过：输出文件已存在";
      return;
    }
    await saveBytes(path, new Uint8Array(output));
    baseline.value = JSON.parse(JSON.stringify(extras.value));
    status.value = `已保存标记模型 → ${path}`;
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
async function exportJson() {
  if (busy.value || !inputBytes.value || !applyDraft()) return;
  busy.value = true;
  try {
    const report = {
      version: 1,
      source: baseName(inputPath.value),
      signature: await modelSignature(inputBytes.value),
      nodes: nodes.value.map((node, index) => ({
        index,
        name: node.name ?? "",
        extras: extras.value[index],
      })),
    };
    const path = await resolveOutput(
      inputPath.value,
      "export",
      ".json",
      `${baseName(inputPath.value).replace(/\.glb$/i, "")}-marks`,
    );
    if (!path) {
      status.value = "已跳过：JSON 文件已存在";
      return;
    }
    await saveBytes(path, new TextEncoder().encode(JSON.stringify(report, null, 2)));
    status.value = `已导出 → ${path}`;
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
async function importJson(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !inputBytes.value || busy.value) return;
  busy.value = true;
  try {
    const data = JSON.parse(await file.text());
    if (
      data.version !== 1 ||
      data.signature !== (await modelSignature(inputBytes.value)) ||
      !Array.isArray(data.nodes)
    )
      throw new Error("标记文件与当前模型结构不匹配");
    const next = { ...extras.value };
    const seen = new Set<number>();
    for (const item of data.nodes) {
      if (
        !Number.isInteger(item.index) ||
        !nodes.value[item.index] ||
        seen.has(item.index) ||
        !isObject(item.extras)
      )
        throw new Error("节点索引重复、越界或业务数据不是对象");
      seen.add(item.index);
      next[item.index] = item.extras;
    }
    extras.value = next;
    revertDraft();
    status.value = `已导入 ${data.nodes.length} 个节点的数据，保存 GLB 后生效`;
  } catch (e) {
    error.value = String(e);
  } finally {
    input.value = "";
    busy.value = false;
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirtyDraft.value || fieldDraftDirty.value || changed.value.length) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
<template>
  <div class="mark-view workbench">
    <div class="page-heading">
      <div>
        <h2>节点标记</h2>
        <p>
          {{ inputPath ? baseName(inputPath) : "为模型节点添加业务数据"
          }}<span v-if="nodes.length">
            · {{ markedCount }} 个已标记 / {{ nodes.length }} 个节点</span
          >
        </p>
      </div>
      <div class="page-actions">
        <button class="ui-button" :disabled="!nodes.length || busy" @click="importFile?.click()">
          导入 JSON</button
        ><button class="ui-button" :disabled="!nodes.length || busy" @click="exportJson">
          导出 JSON</button
        ><button class="ui-button primary" :disabled="!nodes.length || busy" @click="writeGlb">
          保存标记 GLB
        </button>
      </div>
    </div>
    <div class="source-bar">
      <label for="mark-source">模型文件</label
      ><input
        id="mark-source"
        v-model="pathText"
        aria-label="模型文件路径"
        placeholder="拖入 GLB 文件，或粘贴文件路径"
        @keydown.enter="requestLoad(pathText)"
      /><button class="ui-button" :disabled="busy" @click="requestLoad(pathText)">加载模型</button
      ><input ref="importFile" class="file-input" type="file" accept=".json" @change="importJson" />
    </div>
    <div v-if="pendingLoad" class="notice">
      当前模型有未保存的数据。<button @click="load(pendingLoad)">放弃修改并加载</button
      ><button @click="pendingLoad = ''">取消</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="status || changed.length" class="status" role="status">
      {{ status }}<span v-if="changed.length"> · {{ changed.length }} 个节点待写入</span>
    </p>
    <div class="workspace">
      <section class="node-panel">
        <header class="panel-heading">
          <b>节点树</b><span>{{ nodes.length }} 个节点</span>
        </header>
        <input
          v-model="query"
          type="search"
          placeholder="搜索名称或节点编号"
          aria-label="搜索节点"
        />
        <div class="tree-tools">
          <button @click="expanded = new Set(nodes.map((_, id) => id))">全部展开</button
          ><button @click="expanded = new Set()">全部收起</button
          ><label><input v-model="markedOnly" type="checkbox" />仅已标记</label>
        </div>
        <div ref="treeHost" class="tree" role="tree" aria-label="模型节点树">
          <div
            v-for="r in rows"
            :key="r.id"
            class="node"
            :class="{ active: selected === r.id }"
            :data-node-index="r.id"
            role="treeitem"
            :aria-level="r.depth + 1"
            :aria-selected="selected === r.id"
            :aria-expanded="r.hasChildren ? expanded.has(r.id) : undefined"
            :tabindex="selected === r.id || (selected === null && r === rows[0]) ? 0 : -1"
            :style="{ paddingLeft: 8 + r.depth * 14 + 'px' }"
            @click="select(r.id)"
            @keydown="treeKey($event, r.id)"
            @dblclick="viewer?.focusNode(r.id)"
          >
            <button
              v-if="r.hasChildren"
              tabindex="-1"
              class="chevron"
              :aria-label="expanded.has(r.id) ? '收起节点' : '展开节点'"
              @click.stop="toggle(r.id)"
            >
              {{ expanded.has(r.id) ? "▾" : "▸" }}</button
            ><span v-else class="spacer"></span>
            <span class="node-name" :title="nodeName(r.id)">{{ nodeName(r.id) }}</span
            ><small>#{{ r.id }}</small
            ><span v-if="marked(r.id)" class="badge">已标记</span>
          </div>
          <p v-if="!rows.length" class="empty">
            {{
              busy ? "正在读取节点…" : nodes.length ? "没有匹配的节点" : "拖入模型后显示完整节点树"
            }}
          </p>
        </div>
      </section>
      <section class="viewport">
        <WorkspaceEmpty
          v-if="!inputBytes"
          class="viewport-empty"
          title="加载你的模型"
          description="拖入 GLB 后，在模型或节点树中选择节点，即可开始标记。"
        />
        <p v-if="previewError" class="error">{{ previewError }}</p>
        <ModelViewer
          ref="viewer"
          label="点击选择 · 拖动旋转"
          pickable
          @pick="select($event, true)"
        />
      </section>
      <fieldset class="data-panel" :disabled="busy">
        <header class="panel-heading">
          <b>节点数据</b><span v-if="selected !== null">节点 #{{ selected }}</span>
        </header>
        <template v-if="selected !== null && selectedNode">
          <strong class="selected-name">{{ nodeName(selected) }}</strong
          ><small
            >{{ selectedNode.children?.length ?? 0 }} 个子节点 ·
            {{ parents.has(selected) ? "父节点 #" + parents.get(selected) : "根节点" }}</small
          >
          <button class="ui-button quiet locate" @click="viewer?.focusNode(selected)">
            定位到模型
          </button>
          <div class="editor-modes ui-segment">
            <button :aria-pressed="editMode === 'fields'" @click="changeMode('fields')">
              字段编辑</button
            ><button :aria-pressed="editMode === 'json'" @click="changeMode('json')">JSON</button>
          </div>
          <div v-if="editMode === 'fields'" class="fields">
            <div v-for="f in fields" :key="f.id" class="field">
              <label class="field-name"
                >字段名称<input v-model="f.key" aria-label="字段名" @input="fieldsToJson" /></label
              ><label class="field-type"
                >类型<select v-model="f.type" aria-label="字段类型" @change="fieldsToJson">
                  <option value="string">文本</option>
                  <option value="number">数字</option>
                  <option value="boolean">布尔</option>
                  <option value="json">JSON</option>
                </select></label
              ><label class="field-value"
                >值<textarea
                  v-model="f.value"
                  aria-label="字段值"
                  rows="2"
                  @input="fieldsToJson"
                ></textarea></label
              ><button
                class="remove-field"
                @click="
                  fields = fields.filter((row) => row.id !== f.id);
                  fieldsToJson();
                "
              >
                移除字段
              </button>
            </div>
            <button class="ui-button quiet add-field" aria-label="添加字段" @click="addField">
              ＋ 添加字段
            </button>
          </div>
          <textarea
            v-else
            v-model="jsonText"
            class="json-editor"
            aria-label="节点业务数据 JSON"
            spellcheck="false"
          ></textarea>
          <div class="editor-actions">
            <button
              class="ui-button"
              @click="applyDraft() && (status = '节点数据已应用，保存 GLB 后写入文件')"
            >
              应用数据</button
            ><button class="ui-button quiet" @click="revertDraft">撤销本次编辑</button>
          </div>
          <small>{{ dirtyDraft ? "当前编辑尚未应用" : "切换节点会自动应用有效数据" }}</small>
        </template>
        <WorkspaceEmpty
          v-else
          class="editor-empty"
          title="选择一个节点"
          description="在左侧节点树或模型中点击。已有数据将在这里显示。"
        />
      </fieldset>
    </div>
  </div>
</template>
<style scoped>
.mark-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  font-size: var(--typography-body-size);
}
.source-bar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--color-bg-card);
  border-radius: var(--radius-search);
}
.source-bar label {
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
  white-space: nowrap;
}
.source-bar input:not(.file-input) {
  flex: 1;
  min-width: 0;
  background: transparent;
  box-shadow: none;
}
.file-input {
  display: none;
}
.workspace {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(230px, 0.85fr) minmax(320px, 2fr) minmax(285px, 1fr);
  gap: var(--space-3);
  min-height: 0;
}
.node-panel,
.data-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  min-height: 0;
  padding: var(--space-4);
  margin: 0;
  background: var(--color-bg-card);
  border: none;
  border-radius: var(--radius-panel);
}
.node-panel > input {
  background: var(--color-bg-page);
  border-radius: var(--radius-search);
  box-shadow: none;
}
.tree-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.tree-tools button {
  padding: 4px 6px;
  font-size: var(--typography-label-size);
  color: var(--color-text-link);
  background: transparent;
}
.tree-tools label {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-left: auto;
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
}
.tree {
  flex: 1;
  min-height: 0;
  margin: 0 -8px;
  overflow: auto;
}
.node {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 36px;
  padding-right: 8px;
  cursor: pointer;
  border-radius: 6px;
}
.node:hover {
  background: var(--color-bg-control);
}
.node.active {
  color: var(--color-brand-primary);
  background: var(--color-brand-focus-bg);
}
.node:focus-visible {
  outline: 2px solid var(--color-brand-primary);
  outline-offset: -2px;
}
.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node small {
  font-size: var(--typography-label-size);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-disabled);
}
.chevron,
.spacer {
  flex: 0 0 16px;
  width: 16px;
  padding: 0;
  background: transparent;
}
.badge {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.viewport {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.viewport-empty {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.viewport :deep(.viewer) {
  border: none;
}
.data-panel {
  overflow: auto;
}
.selected-name {
  margin-top: var(--space-2);
  font-size: var(--typography-title-size);
  font-weight: var(--typography-title-weight);
  overflow-wrap: anywhere;
}
.data-panel > small {
  margin-top: -8px;
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
}
.data-panel .locate {
  align-self: flex-start;
  min-height: 26px;
  padding: 0;
  margin-top: -8px;
}
.editor-modes {
  align-self: stretch;
}
.editor-modes button {
  flex: 1;
}
.fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 86px;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-bg-page);
  border-radius: var(--radius-control);
}
.field label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
}
.field :is(input, select, textarea) {
  box-sizing: border-box;
  width: 100%;
  background: var(--color-bg-card);
  box-shadow: none;
}
.field-value {
  grid-column: 1/-1;
}
.remove-field {
  grid-column: 1/-1;
  justify-self: end;
  padding: 0;
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
  background: transparent;
}
.remove-field:hover {
  color: var(--color-status-danger);
}
.add-field {
  align-self: flex-start;
}
.json-editor {
  flex: 1;
  min-height: 240px;
  font-family: var(--font-family-number);
  resize: vertical;
  background: var(--color-bg-page);
  box-shadow: none;
}
.editor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-3);
  margin-top: auto;
}
.editor-empty {
  flex: 1;
  padding: var(--space-3);
}
.error {
  margin: 0;
  color: var(--color-status-danger);
  overflow-wrap: anywhere;
}
.status {
  margin: 0;
  font-size: var(--typography-label-size);
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}
.empty {
  padding: var(--space-3);
  line-height: 1.7;
  color: var(--color-text-muted);
}
.notice {
  padding: var(--space-3);
  background: var(--color-status-warning-bg);
  border-radius: var(--radius-control);
}
@media (max-width: 1100px) {
  .workspace {
    grid-template-rows: minmax(350px, 1fr) auto;
    grid-template-columns: 240px minmax(300px, 1fr);
    align-content: start;
    overflow: auto;
  }
  .data-panel {
    grid-column: 1/-1;
    min-height: 350px;
    max-height: 420px;
  }
  .viewport {
    min-height: 350px;
  }
  .page-heading {
    align-items: flex-start;
  }
}
</style>
