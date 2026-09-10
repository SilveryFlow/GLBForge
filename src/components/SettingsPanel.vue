<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  DEFAULT_SETTINGS,
  PRESETS,
  buildDracoArgs,
  buildGltfpackArgs,
  dracoQuantForLevel,
  type CompressSettings,
} from "../lib/api";
import { appSettings } from "../lib/settings";

const props = defineProps<{ settings: CompressSettings; inputPath?: string }>();

const advanced = ref(false);
const copied = ref(false);
const naming = ref(false);
const newName = ref("");
const hideDefaults = ref(false);

const s = computed(() => props.settings);

watch(
  () => s.value.dracoLevel,
  (lvl) => {
    if (s.value.engine === "draco") {
      props.settings.quant = dracoQuantForLevel(lvl);
    }
  },
);

function applyPreset(key: string) {
  if (key === "default") {
    Object.assign(props.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as CompressSettings);
    return;
  }
  const patch = PRESETS[key]?.patch;
  if (!patch) return;
  Object.assign(props.settings, patch, {
    quant: { ...patch.quant! },
    simplify: { ...patch.simplify! },
  });
}

function applyCustomPreset(name: string) {
  const p = appSettings.value.presets.find((x) => x.name === name);
  if (!p) return;
  const merged = {
    ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    ...JSON.parse(JSON.stringify(p.settings)),
    geometry: { ...DEFAULT_SETTINGS.geometry, ...p.settings.geometry },
    simplify: { ...DEFAULT_SETTINGS.simplify, ...p.settings.simplify },
    anim: { ...DEFAULT_SETTINGS.anim, ...p.settings.anim },
    texture: { ...DEFAULT_SETTINGS.texture, ...p.settings.texture },
  } as CompressSettings;
  Object.assign(props.settings, merged);
}

function saveCustomPreset() {
  const name = newName.value.trim();
  if (!name) return;
  const exists = appSettings.value.presets.some((p) => p.name === name);
  if (exists && confirmOverwrite.value !== name) {
    confirmOverwrite.value = name;
    if (overwriteTimer) clearTimeout(overwriteTimer);
    overwriteTimer = setTimeout(() => {
      if (confirmOverwrite.value === name) confirmOverwrite.value = "";
    }, 2500);
    return;
  }
  if (overwriteTimer) clearTimeout(overwriteTimer);
  confirmOverwrite.value = "";
  const list = appSettings.value.presets.filter((p) => p.name !== name);
  list.push({
    name,
    settings: JSON.parse(JSON.stringify(props.settings)) as CompressSettings,
  });
  appSettings.value.presets = list;
  naming.value = false;
  newName.value = "";
  saveNote.value = exists ? `已覆盖预设「${name}」` : `已保存预设「${name}」`;
  setTimeout(() => (saveNote.value = ""), 2000);
}

const confirmingDel = ref("");
const confirmOverwrite = ref("");
let overwriteTimer: ReturnType<typeof setTimeout> | null = null;
const saveNote = ref("");
let confirmTimer: ReturnType<typeof setTimeout> | null = null;

function delCustomPreset(name: string) {
  if (confirmingDel.value !== name) {
    confirmingDel.value = name;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      if (confirmingDel.value === name) confirmingDel.value = "";
    }, 2500);
    return;
  }
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmingDel.value = "";
  appSettings.value.presets = appSettings.value.presets.filter((p) => p.name !== name);
}

const GLTFPACK_DEFAULTS: Record<string, string> = {
  "-vp": "14",
  "-vt": "12",
  "-vn": "8",
  "-vc": "8",
  "-at": "16",
  "-ar": "12",
  "-as": "16",
  "-af": "30",
  "-tq": "8",
  "-si": "1",
  "-se": "0.01",
  "-ts": "1",
};
const DRACO_DEFAULTS: Record<string, string> = {
  "-qp": "11",
  "-qt": "10",
  "-qn": "8",
  "-qc": "8",
};

const CLASS_NAMES = new Set(["color", "normal", "attrib"]);
const CLASS_FLAGS = new Set(["-tc", "-tu", "-tw", "-tq", "-ts", "-tl"]);

function isClassList(token: string): boolean {
  return token.split(",").length > 0 && token.split(",").every((p) => CLASS_NAMES.has(p));
}

function toUnits(args: string[]): [string, string?][] {
  const units: [string, string?][] = [];
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("-")) continue;
    const flag = args[i];
    if (CLASS_FLAGS.has(flag) && i + 1 < args.length && isClassList(args[i + 1])) {
      if (i + 2 < args.length && !args[i + 2].startsWith("-")) {
        units.push([flag, `${args[i + 1]} ${args[i + 2]}`]);
        i += 2;
      } else {
        units.push([flag, args[i + 1]]);
        i += 1;
      }
    } else if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
      units.push([flag, args[i + 1]]);
      i++;
    } else {
      units.push([flag]);
    }
  }
  return units;
}

const finalArgs = computed(() =>
  s.value.engine === "meshopt" ? buildGltfpackArgs(s.value) : buildDracoArgs(s.value),
);

const shownArgs = computed(() => {
  const args = finalArgs.value;
  if (!hideDefaults.value) return args;
  const baseline = s.value.engine === "meshopt" ? GLTFPACK_DEFAULTS : DRACO_DEFAULTS;
  const out: string[] = [];
  for (const [flag, value] of toUnits(args)) {
    if (value !== undefined && baseline[flag] === value) continue;
    out.push(flag, ...(value === undefined ? [] : [value]));
  }
  return out;
});

const cmdPreview = computed(() => {
  const tool = s.value.engine === "meshopt" ? "gltfpack" : "draco_transcoder";
  const input = props.inputPath || "输入.glb";
  return `${tool} -i ${input} -o 输出.glb ${shownArgs.value.join(" ")}`;
});

async function copyArgs(): Promise<void> {
  try {
    await navigator.clipboard.writeText(cmdPreview.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}
</script>

<template>
  <div class="panelbody">
    <div class="row">
      <label
        title="Meshopt：压缩率更高 + 顶点缓存优化（渲染更快），WebGPU 友好；Draco：体积略大于 Meshopt，但 Three.js/model-viewer 老版本原生支持"
        >引擎
        <select v-model="s.engine">
          <option value="meshopt">Meshopt (gltfpack)</option>
          <option value="draco">Draco</option>
        </select>
      </label>
      <label
        v-if="s.engine === 'draco'"
        title="Draco 压缩等级（映射为量化位数 -qp/-qt/-qn/-qc）：1 = 体积最小、几何明显失真；7 = 推荐（接近官方默认）；10 = 接近无损但体积大"
      >
        <i>-cl</i>等级
        <input
          type="range"
          min="1"
          max="10"
          v-model.number="s.dracoLevel"
          :title="`当前 ${s.dracoLevel} 级`"
        />
        <span class="numwrap"
          ><input
            type="number"
            class="num"
            min="1"
            max="10"
            v-model.number="s.dracoLevel"
            :title="`当前 ${s.dracoLevel} 级`"
        /></span>
      </label>
      <label
        v-if="s.engine === 'meshopt'"
        title="压缩的卖力程度，只影响耗时、完全不影响质量：无 = 只量化不压缩（零扩展依赖）；-c 最快；-cc 比 -c 慢约 1 倍、体积再省 5-10%（推荐）；-cz 最慢、再省 1-3%"
        >压缩
        <select v-model="s.compression">
          <option value="none">无（仅量化）</option>
          <option value="c">-c 快</option>
          <option value="cc">-cc 均衡</option>
          <option value="cz">-cz 极限</option>
        </select>
      </label>
      <label class="chk" title="所选引擎失败时自动换另一个引擎重试，不会中断任务"
        ><input type="checkbox" v-model="s.fallback" />失败自动降级</label
      >
    </div>

    <div class="row">
      <span>预设</span>
      <button
        v-for="(p, k) in PRESETS"
        :key="k"
        @click="applyPreset(k)"
        :title="
          k === 'default'
            ? '完全等价于不带任何参数的 gltfpack（引擎原生行为）'
            : `应用${p.label}预设`
        "
      >
        {{ p.label }}
      </button>
      <span v-for="p in appSettings.presets" :key="p.name" class="cpreset">
        <button @click="applyCustomPreset(p.name)" :title="`点击应用预设「${p.name}」`">
          {{ p.name }}
        </button>
        <i
          class="del"
          :class="{ armed: confirmingDel === p.name }"
          :title="confirmingDel === p.name ? '再点一次确认删除' : '删除该预设（需二次确认）'"
          @click="delCustomPreset(p.name)"
          >{{ confirmingDel === p.name ? "确认?" : "✕" }}</i
        >
      </span>
      <template v-if="!naming">
        <button class="ghost" title="把当前全部参数保存为预设" @click="naming = true">
          ＋ 存为预设
        </button>
      </template>
      <span v-else class="namerow">
        <input v-model="newName" placeholder="预设名" @keydown.enter="saveCustomPreset" />
        <button
          :class="{ danger: confirmOverwrite === newName.trim() }"
          :title="
            confirmOverwrite === newName.trim() && newName.trim()
              ? '同名预设已存在，再点一次确认覆盖'
              : '保存预设'
          "
          :disabled="!newName.trim()"
          @click="saveCustomPreset"
        >
          {{ confirmOverwrite === newName.trim() && newName.trim() ? "覆盖确认" : "保存" }}
        </button>
        <button class="ghost" @click="naming = false">取消</button>
      </span>
      <span v-if="confirmOverwrite === newName.trim() && newName.trim()" class="overwrite-hint"
        >同名预设已存在：再次点击“覆盖确认”才会替换原预设</span
      >
      <span v-if="saveNote" class="savenote">{{ saveNote }}</span>
      <button class="ghost" @click="advanced = !advanced">
        {{ advanced ? "收起参数 ▲" : "高级参数 ▼" }}
      </button>
    </div>

    <div class="cmdline" title="当前设置将生成的完整命令行，随参数实时变化；可复制后在终端直接使用">
      <span class="cmdlabel">最终参数</span>
      <code>{{ cmdPreview }}</code>
      <label class="hidechk" title="只显示与 gltfpack/Draco 官方默认值不同的参数，生成最短等价命令">
        <input type="checkbox" v-model="hideDefaults" />隐藏默认值
      </label>
      <button class="copybtn" @click="copyArgs">{{ copied ? "✓ 已复制" : "复制" }}</button>
    </div>

    <div v-if="advanced" class="adv">
      <div class="grp">
        <div
          class="gt g-quant"
          title="精度与体积的旋钮：每降 1 位，几何数据约省 6%；降到阈值以下会出现对应瑕疵（见各项说明）。Draco 引擎下映射为 -qp/-qt/-qn/-qc"
        >
          量化位数
        </div>
        <label
          title="-vp/-qp 顶点坐标量化位数（默认 14）。效果：每降 1 位省约 6% 几何体积；低于 11 位时，大场景远处的顶点会出现可见的台阶/抖动"
          ><i>{{ s.engine === "draco" ? "-qp" : "-vp" }}</i
          >位置
          <input
            type="range"
            min="6"
            max="16"
            v-model.number="s.quant.pos"
            :title="`当前 ${s.quant.pos} 位`"
          />
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="6"
              max="16"
              v-model.number="s.quant.pos"
              :title="`当前 ${s.quant.pos} 位`"
          /></span>
        </label>
        <label
          title="-vt/-qt 纹理坐标(UV)量化位数（默认 12）。效果：低于 10 位时贴图可能出现渗色、错位（精细 UV 模型先降这个最容易看出问题）"
          ><i>{{ s.engine === "draco" ? "-qt" : "-vt" }}</i
          >UV
          <input
            type="range"
            min="6"
            max="16"
            v-model.number="s.quant.tex"
            :title="`当前 ${s.quant.tex} 位`"
          />
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="6"
              max="16"
              v-model.number="s.quant.tex"
              :title="`当前 ${s.quant.tex} 位`"
          /></span>
        </label>
        <label
          title="-vn/-qn 法线量化位数（默认 8，同时影响切线）。效果：低于 6 位时光照出现块状/斑驳瑕疵，金属和光滑表面最明显"
          ><i>{{ s.engine === "draco" ? "-qn" : "-vn" }}</i
          >法线
          <input
            type="range"
            min="4"
            max="12"
            v-model.number="s.quant.norm"
            :title="`当前 ${s.quant.norm} 位`"
          />
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="4"
              max="12"
              v-model.number="s.quant.norm"
              :title="`当前 ${s.quant.norm} 位`"
          /></span>
        </label>
        <label
          title="-vc/-qc 顶点色量化位数（默认 8）。效果：低于 6 位顶点色出现色带/断层（无顶点色的模型不受影响）"
          ><i>{{ s.engine === "draco" ? "-qc" : "-vc" }}</i
          >颜色
          <input
            type="range"
            min="5"
            max="16"
            v-model.number="s.quant.color"
            :title="`当前 ${s.quant.color} 位`"
          />
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="5"
              max="16"
              v-model.number="s.quant.color"
              :title="`当前 ${s.quant.color} 位`"
          /></span>
        </label>
        <label
          v-if="s.engine === 'meshopt'"
          class="chk"
          title="-noq 完全禁用量化。效果：体积增大 3-10 倍，换来零精度损失且不依赖任何量化约定（目标加载器不认量化属性时的兜底）"
          ><input type="checkbox" v-model="s.geometry.noQuant" /><i>-noq</i>禁用量化</label
        >
      </div>
      <div v-if="s.engine === 'meshopt'" class="grp">
        <div class="gt g-geometry" title="顶点属性的处理选项">几何属性</div>
        <label
          title="位置属性的存储形式。整数(默认) = 量化存储，体积最小；归一化(-vpn) = 兼容需要 normalized 属性的渲染管线，体积略增；浮点(-vpf) = 位置完全不量化，体积 +30%~1 倍，可彻底消除大场景的顶点抖动"
        >
          <i>-vpi</i><i>-vpn</i><i>-vpf</i>位置
          <select v-model="s.geometry.positionStorage">
            <option value="int">整数(默认)</option>
            <option value="normalized">归一化 -vpn</option>
            <option value="float">浮点 -vpf</option>
          </select>
        </label>
        <label
          class="chk"
          title="-vi 交错存储顶点属性。效果：加载/解析略快（约 5%），代价是压缩率下降、体积 +10-20%"
          ><input type="checkbox" v-model="s.geometry.interleaved" /><i>-vi</i>交错存储</label
        >
        <label
          class="chk"
          title="-gt 缺失时自动生成切线。效果：修复法线贴图发黑/高光错误——模型带法线贴图但没切线时必开"
          ><input type="checkbox" v-model="s.geometry.genTangents" /><i>-gt</i>生成切线</label
        >
        <label
          class="chk"
          title="-kv 保留未被材质引用的顶点属性。效果：体积增大，但自定义 shader 需要这些属性（如数据可视化顶点数据）时不会被丢"
          ><input type="checkbox" v-model="s.geometry.keepUnused" /><i>-kv</i>保留未用属性</label
        >
        <label
          class="chk"
          title="-vtf UV 改浮点存储不量化。效果：修复贴图错位/闪烁（量化损伤 UV 时），体积增加"
          ><input type="checkbox" v-model="s.geometry.floatTexcoords" /><i>-vtf</i>浮点 UV</label
        >
        <label
          class="chk"
          title="-vnf 法线改浮点存储不量化。效果：修复光照块状瑕疵（量化损伤法线时），体积增加"
          ><input type="checkbox" v-model="s.geometry.floatNormals" /><i>-vnf</i>浮点法线</label
        >
      </div>
      <div v-if="s.engine === 'meshopt'" class="grp">
        <div
          class="gt g-simplify"
          title="减面（不可逆！直接删除三角面）。效果：体积和渲染负载大幅下降，代价是细节丢失——近距离观看轮廓变糊、圆角变多边形"
        >
          网格简化
          <label class="chk" title="开启后才应用简化；关闭则保留全部三角面"
            ><input type="checkbox" v-model="s.simplify.enabled" />启用</label
          >
        </div>
        <label
          title="-si 保留三角面比例。效果：0.5 = 面数砍半，几何体积约再省 40%；0.1 = 只留 10%，仅适合远景/LOD"
          ><i>-si</i>比例
          <input
            :disabled="!s.simplify.enabled"
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            v-model.number="s.simplify.ratio"
            :title="`当前 ${s.simplify.ratio}`"
          />
          <span class="numwrap"
            ><input
              :disabled="!s.simplify.enabled"
              type="number"
              class="num"
              min="0.05"
              max="1"
              step="0.05"
              v-model.number="s.simplify.ratio"
              :title="`当前 ${s.simplify.ratio}`"
          /></span>
        </label>
        <label
          title="-se 允许的最大几何变形量（模型尺寸的百分比）。效果：保险丝——超过该变形量的面不会被简化；配合 -sa 使用可防止压过头（建议 0.005~0.02）"
          ><i>-se</i>误差
          <input
            :disabled="!s.simplify.enabled"
            type="range"
            min="0"
            max="0.1"
            step="0.005"
            v-model.number="s.simplify.errorLimit"
            :title="`当前 ${s.simplify.errorLimit}`"
          />
          <span class="numwrap"
            ><input
              :disabled="!s.simplify.enabled"
              type="number"
              class="num"
              min="0"
              max="0.1"
              step="0.005"
              v-model.number="s.simplify.errorLimit"
              :title="`当前 ${s.simplify.errorLimit}`"
          /></span>
        </label>
        <label
          class="chk"
          title="-sa 激进简化。效果：必定压到目标比例，但可能明显变形（结构被压扁、细节消失）；务必配合 -se 误差上限"
          ><input
            :disabled="!s.simplify.enabled"
            type="checkbox"
            v-model="s.simplify.aggressive"
          /><i>-sa</i>激进</label
        >
        <label
          class="chk"
          title="-sp 允许跨 UV 接缝简化。效果：减面更多，但贴图在接缝处可能出现裂缝/错位"
          ><input
            :disabled="!s.simplify.enabled"
            type="checkbox"
            v-model="s.simplify.permissive"
          /><i>-sp</i>跨接缝</label
        >
        <label
          class="chk"
          title="-slb 锁定网格边界。效果：相邻模型拼接处不出现裂缝（机房拼装类模型建议开），减面率略降"
          ><input
            :disabled="!s.simplify.enabled"
            type="checkbox"
            v-model="s.simplify.lockBorder"
          /><i>-slb</i>锁边界</label
        >
      </div>
      <div v-if="s.engine === 'meshopt'" class="grp">
        <div
          class="gt g-texture"
          title="纹理通常占模型体积的 60-90%，是最大的压缩杠杆；GPU 纹理同时让加载更快、显存占用更低（仅 Meshopt 引擎支持）"
        >
          纹理（Meshopt）
        </div>
        <label
          title="KTX2 ETC1S(-tc)：纹理体积省 60-90%，颜色渐变处轻微模糊——适合颜色贴图；KTX2 UASTC(-tc -tu)：只省 20-50% 但质量接近原图——适合法线贴图；WebP(-tw)：省 30-70%，任何设备能读，但仍是 CPU 解码（省体积不省加载）"
        >
          <i>-tc</i><i>-tu</i><i>-tw</i>格式
          <select v-model="s.texture.mode">
            <option value="none">不改</option>
            <option value="etc1s">KTX2 ETC1S（-tc）</option>
            <option value="uastc">KTX2 UASTC（-tc -tu）</option>
            <option value="webp">WebP（-tw）</option>
          </select>
        </label>
        <label
          title="-tq 纹理编码质量 1-10（默认 8）。效果：每降 1 档体积再省约 8%、模糊感增加；法线贴图建议 ≥9 否则光照细节糊"
          ><i>-tq</i>质量
          <input
            :disabled="s.texture.mode === 'none'"
            type="range"
            min="1"
            max="10"
            v-model.number="s.texture.quality"
            :title="`当前 ${s.texture.quality}`"
          />
          <span class="numwrap"
            ><input
              :disabled="s.texture.mode === 'none'"
              type="number"
              class="num"
              min="1"
              max="10"
              v-model.number="s.texture.quality"
              :title="`当前 ${s.texture.quality}`"
          /></span>
        </label>
        <label
          title="-ts 纹理分辨率缩放。效果：0.5 = 长宽各减半、体积约变 1/4；特写时明显模糊，远景/小物件无感"
          ><i>-ts</i>缩放
          <input
            :disabled="s.texture.mode === 'none'"
            type="range"
            min="0.25"
            max="1"
            step="0.25"
            v-model.number="s.texture.scale"
            :title="`当前 ${s.texture.scale}`"
          />
          <span class="numwrap"
            ><input
              :disabled="s.texture.mode === 'none'"
              type="number"
              class="num"
              min="0.25"
              max="1"
              step="0.25"
              v-model.number="s.texture.scale"
              :title="`当前 ${s.texture.scale}`"
          /></span>
        </label>
        <label
          title="-tl 限制最大边长（像素，0 = 不限）。效果：4K 限到 2048 = 体积约 1/4；屏幕上看模型不超过半屏时 2048 足够"
          ><i>-tl</i>限边
          <span class="numwrap"
            ><input
              :disabled="s.texture.mode === 'none'"
              type="number"
              class="num"
              min="0"
              v-model.number="s.texture.limit"
              :title="`当前 ${s.texture.limit === 0 ? '不限' : s.texture.limit + 'px'}`" /></span
        ></label>
        <label
          class="chk"
          title="-tp 缩放到 2 的幂。效果：仅 WebGL1 时代设备需要；现代 GPU 无影响，可不勾"
          ><input type="checkbox" v-model="s.texture.pow2" /><i>-tp</i>2 的幂</label
        >
        <label
          class="chk"
          title="-tfy 纹理 Y 翻转。效果：修复贴图上下颠倒（目标引擎 UV 约定与 glTF 相反时）"
          ><input
            :disabled="s.texture.mode === 'none'"
            type="checkbox"
            v-model="s.texture.flipY"
          /><i>-tfy</i>Y 翻转</label
        >
        <label
          class="chk"
          title="-tr 保留原纹理路径不复制。效果：输出 .glb 时无作用（纹理总是内嵌），仅影响 .gltf 输出"
          ><input type="checkbox" v-model="s.texture.keepPaths" /><i>-tr</i>保留纹理路径</label
        >
        <label
          class="chk"
          title="按纹理类别（颜色/法线/其他）分别设置格式与参数，如 -tc color、-tu normal、-tq normal 10"
        >
          <input type="checkbox" v-model="s.texture.perClass" />分通道设置
        </label>
        <template v-if="s.texture.perClass">
          <div class="clsgrid">
            <span class="clsh"></span>
            <span class="clsh">格式</span>
            <span class="clsh"><i>-tq</i>质量</span>
            <span class="clsh"><i>-ts</i>缩放</span>
            <span class="clsh"><i>-tl</i>限边</span>
            <template v-for="(c, ci) in s.texture.classes" :key="ci">
              <span
                class="clsname"
                :title="
                  ['颜色/反照率/自发光等色彩类贴图', '法线贴图', '其他数据类贴图（ORM、遮罩等）'][
                    ci
                  ]
                "
                >{{ ["色彩", "法线", "属性"][ci] }}</span
              >
              <select
                v-model="c.mode"
                :title="`本类纹理的编码格式；跟随 = 仅格式沿用全局（与右侧三项无关）`"
              >
                <option value="inherit">跟随</option>
                <option value="etc1s">ETC1S（-tc）</option>
                <option value="uastc">UASTC（-tu）</option>
                <option value="webp">WebP（-tw）</option>
              </select>
              <span class="clscell">
                <i
                  class="fbtn"
                  :class="{ on: c.follows.quality }"
                  title="点击切换：随 = 沿用全局质量，独立 = 本行自定义"
                  @click="c.follows.quality = !c.follows.quality"
                  >随</i
                >
                <span
                  v-if="c.follows.quality"
                  class="ghost"
                  :title="`沿用全局质量 ${s.texture.quality}`"
                  >{{ s.texture.quality }}</span
                >
                <span v-else class="numwrap"
                  ><input
                    type="number"
                    class="num"
                    min="1"
                    max="10"
                    v-model.number="c.quality"
                    :title="`自定义质量 ${c.quality}（默认 8，等于 8 时自动省略）`"
                /></span>
              </span>
              <span class="clscell">
                <i
                  class="fbtn"
                  :class="{ on: c.follows.scale }"
                  title="点击切换：随 = 沿用全局缩放，独立 = 本行自定义"
                  @click="c.follows.scale = !c.follows.scale"
                  >随</i
                >
                <span
                  v-if="c.follows.scale"
                  class="ghost"
                  :title="`沿用全局缩放 ${s.texture.scale}`"
                  >{{ s.texture.scale }}</span
                >
                <span v-else class="numwrap"
                  ><input
                    type="number"
                    class="num"
                    min="0.25"
                    max="1"
                    step="0.25"
                    v-model.number="c.scale"
                    :title="`自定义缩放 ${c.scale}（1 = 原尺寸，自动省略）`"
                /></span>
              </span>
              <span class="clscell">
                <i
                  class="fbtn"
                  :class="{ on: c.follows.limit }"
                  title="点击切换：随 = 沿用全局限边，独立 = 本行自定义"
                  @click="c.follows.limit = !c.follows.limit"
                  >随</i
                >
                <span
                  v-if="c.follows.limit"
                  class="ghost"
                  :title="`沿用全局限边 ${s.texture.limit === 0 ? '不限' : s.texture.limit + 'px'}`"
                  >{{ s.texture.limit === 0 ? "不限" : s.texture.limit }}</span
                >
                <span v-else class="numwrap"
                  ><input
                    type="number"
                    class="num"
                    min="0"
                    v-model.number="c.limit"
                    :title="c.limit === 0 ? '不限（自动省略）' : `限边 ${c.limit}px`"
                /></span>
              </span>
            </template>
          </div>
          <div class="clshint">
            格式与质量/缩放/限边互相独立：格式的"跟随"只管格式；每个数值项的"随"按钮单独决定该项沿用全局还是本行自定义（灰色斜体
            = 当前沿用全局的值）
          </div>
        </template>
      </div>
      <div v-if="s.engine === 'meshopt'" class="grp">
        <div
          class="gt g-anim"
          title="动画轨道的精度与重采样。效果：低于默认值可能出现动作抖动、迟滞；无动画的模型这些全部无效"
        >
          动画量化
        </div>
        <label
          title="-at 位移轨道量化位数（默认 16）。效果：低于 12 位角色移动可能出现微小跳动/漂移"
          ><i>-at</i>位移
          <input
            type="range"
            min="8"
            max="24"
            v-model.number="s.anim.trans"
            :title="`当前 ${s.anim.trans} 位`"
          />
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="8"
              max="24"
              v-model.number="s.anim.trans"
              :title="`当前 ${s.anim.trans} 位`"
          /></span>
        </label>
        <label title="-ar 旋转轨道量化位数（默认 12）。效果：低于 8 位关节旋转出现抖动/棱角感"
          ><i>-ar</i>旋转
          <input
            type="range"
            min="4"
            max="16"
            v-model.number="s.anim.rot"
            :title="`当前 ${s.anim.rot} 位`"
          />
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="4"
              max="16"
              v-model.number="s.anim.rot"
              :title="`当前 ${s.anim.rot} 位`"
          /></span>
        </label>
        <label title="-as 缩放轨道量化位数（默认 16）。效果：低于 12 位缩放动画出现呼吸感/尺寸跳变"
          ><i>-as</i>缩放
          <input
            type="range"
            min="8"
            max="24"
            v-model.number="s.anim.scale"
            :title="`当前 ${s.anim.scale} 位`"
          />
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="8"
              max="24"
              v-model.number="s.anim.scale"
              :title="`当前 ${s.anim.scale} 位`"
          /></span>
        </label>
        <label
          title="-af 重采样频率（默认 30Hz）。效果：长动画体积大幅下降；设 0 = 保留原始关键帧（体积增大，但逐帧精度不变）"
          ><i>-af</i>采样Hz
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="0"
              max="60"
              v-model.number="s.anim.fps"
              :title="`当前 ${s.anim.fps === 0 ? '不重采样' : s.anim.fps + 'Hz'}`" /></span
        ></label>
        <label
          class="chk"
          title="-ac 保留常量轨道。效果：不动的骨骼轨道被保留（体积微增），外部程序读取静态姿态时需要"
          ><input type="checkbox" v-model="s.anim.keepConstant" /><i>-ac</i>保留常量轨道</label
        >
      </div>
      <div v-if="s.engine === 'meshopt'" class="grp">
        <div class="gt g-scene" title="场景结构的取舍：每项都是'省体积/性能'与'结构完整性'的交换">
          场景
        </div>
        <label
          class="chk"
          title="-mm 合并同网格实例。效果：draw call 大幅下降、帧率提升、体积略降；代价是无法再单独移动/高亮某个实例（需要单实例交互时别开）"
          ><input type="checkbox" v-model="s.merge" /><i>-mm</i>合并网格</label
        >
        <label
          class="chk"
          title="-kn 保留命名节点。效果：外部程序按名字查找/移动节点可用（节点标记功能依赖）；代价是节点树不被精简、体积微增"
          ><input type="checkbox" v-model="s.keepNames" /><i>-kn</i>保留命名节点</label
        >
        <label
          class="chk"
          title="-ke 保留 extras 自定义数据。效果：节点标记页写入的业务数据不丢；体积按数据量增加"
          ><input type="checkbox" v-model="s.keepExtras" /><i>-ke</i>保留 extras</label
        >
        <label
          class="chk"
          title="-km 保留命名材质且不合并。效果：运行时按名字换材质可用；代价是 draw call 可能上升"
          ><input type="checkbox" v-model="s.keepMaterials" /><i>-km</i>保留命名材质</label
        >
        <label
          class="chk"
          title="-mi 用 GPU 实例化序列化多实例。效果：重复物体多的场景文件更小、渲染更快；旧加载器可能不显示实例"
          ><input type="checkbox" v-model="s.gpuInstancing" /><i>-mi</i>GPU 实例化</label
        >
        <label
          title="-ce 压缩扩展版本。效果：默认自动；KHR 用于只认旧版扩展名的老引擎（babylon/旧 three）"
        >
          <i>-ce</i>扩展版本
          <select v-model="s.compressionExt" :disabled="s.compression === 'none'">
            <option value="default">默认</option>
            <option value="ext">EXT_meshopt_compression</option>
            <option value="khr">KHR_meshopt_compression</option>
          </select>
        </label>
        <label
          class="chk"
          title="-cf 带回退的压缩。效果：不支持 meshopt 扩展的旧加载器也能正常读（内部存双份），代价是体积 +10-15%"
          ><input
            :disabled="s.compression === 'none'"
            type="checkbox"
            v-model="s.compressionFallback"
          /><i>-cf</i>兼容回退</label
        >
        <label title="-tj 纹理压缩线程数。效果：0 = 自动用满核；大模型多纹理时从单线程提速数倍"
          ><i>-tj</i>线程
          <span class="numwrap"
            ><input
              type="number"
              class="num"
              min="0"
              max="32"
              v-model.number="s.threads"
              :title="`当前 ${s.threads === 0 ? '自动' : s.threads}`" /></span
        ></label>
      </div>
      <div v-if="s.engine === 'draco'" class="grp">
        <div class="gt">Draco</div>
        <div class="note">等级滑杆自动换算量化位数，也可直接拖动量化滑杆微调。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panelbody {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}
.row label {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--color-text-secondary);
}
.row select,
.row button,
.adv select,
.adv input[type="number"] {
  padding: 4px 10px;
  font-size: 13px;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
button.ghost {
  color: var(--color-text-disabled);
  border-color: transparent;
}
.chk {
  white-space: nowrap;
}
.cmdline {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 28px;
  padding: 5px 10px;
  font-size: 12px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
}
.cmdlabel {
  color: var(--color-status-success);
  white-space: nowrap;
}
.cmdline code {
  flex: 1;
  overflow-x: auto;
  font-family: Consolas, monospace;
  color: var(--color-text-secondary);
  word-break: keep-all;
  white-space: nowrap;
}
.hidechk {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  cursor: help;
}
.cpreset {
  display: inline-flex;
  align-items: center;
}
.cpreset .del,
.cpreset .del-confirm,
.cpreset .del-cancel {
  padding: 2px 7px;
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
  background: transparent;
  border-radius: 980px;
}
.cpreset .del:hover,
.cpreset .del-cancel:hover {
  color: var(--color-status-danger);
  background: var(--color-status-danger-bg);
}
.cpreset .del-confirm {
  color: #fff;
  background: var(--color-status-danger);
}
.namerow button.danger {
  color: #fff;
  background: var(--color-status-danger);
}
.savenote {
  font-size: 12px;
  color: var(--color-status-success);
}
.namerow {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.namerow input {
  width: 90px;
  padding: 3px 8px;
  font-size: 12px;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.adv {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-default);
}
.grp {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
  font-size: 12px;
}
.gt {
  min-height: 26px;
  padding: 4px 0 8px;
  font-size: var(--typography-body-size);
  font-weight: var(--typography-title-weight);
  color: var(--color-text-primary);
}
.gt.g-quant {
  --sec-color: var(--sec-quant);
}
.gt.g-geometry {
  --sec-color: var(--sec-geometry);
}
.gt.g-simplify {
  --sec-color: var(--sec-simplify);
}
.gt.g-texture {
  --sec-color: var(--sec-texture);
}
.gt.g-anim {
  --sec-color: var(--sec-anim);
}
.gt.g-scene {
  --sec-color: var(--sec-scene);
}
.note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-muted);
}
.grp label {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--color-text-secondary);
  cursor: help;
}
.grp i {
  padding: 0 4px;
  font-family: var(--font-family-number);
  font-size: 10px;
  font-style: normal;
  color: var(--color-chip-fg);
  background: var(--color-chip-bg);
  border-radius: 4px;
}
.copybtn {
  flex-shrink: 0;
  padding: 3px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-bg-card);
  border-radius: 6px;
  box-shadow: var(--color-border-hairline) 0 0 0 1px;
}
.copybtn:hover {
  box-shadow: var(--color-border-hover) 0 0 0 1px;
}
input[type="range"] {
  width: 74px;
}
.numwrap {
  position: relative;
  display: inline-block;
  min-width: 46px;
  max-width: 200px;
  overflow: hidden;
  vertical-align: middle;
  resize: horizontal;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.numwrap:hover {
  border-color: var(--color-border-hover);
}
.numwrap:focus-within {
  background: #edf5fe;
  border-color: rgba(0, 113, 227, 0.55);
}
.numwrap input:focus {
  outline: none;
  background: transparent;
  box-shadow: none;
}
.clsgrid {
  display: grid;
  grid-template-columns: 30px 104px repeat(3, minmax(96px, auto));
  gap: 3px 5px;
  align-items: center;
}
.clscell {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
}
.fbtn {
  flex-shrink: 0;
  padding: 1px 4px;
  font-family: inherit;
  font-size: 10px;
  font-style: normal;
  color: var(--color-text-disabled);
  cursor: pointer;
  user-select: none;
  background: var(--color-border-default);
  border-radius: 3px;
}
.fbtn.on {
  color: var(--color-status-success);
  background: var(--color-status-success-bg);
}
.ghost {
  font-size: 11px;
  font-style: italic;
  color: var(--color-text-disabled);
}
.clsh {
  display: flex;
  gap: 3px;
  align-items: center;
  font-size: 10px;
  color: var(--color-text-disabled);
}
.clsgrid select {
  width: 100%;
  padding: 2px 4px;
  font-size: 11px;
  color: var(--color-text-primary);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 5px;
}
.clsname {
  font-size: 11px;
  color: var(--color-text-muted);
}
.clshint {
  font-size: 10px;
  color: var(--color-text-disabled);
}
.numwrap input[type="number"] {
  width: 100%;
  padding: 2px 4px;
  font-size: 12px;
  color: var(--color-text-primary);
  background: transparent;
  border: none;
}
input:disabled {
  opacity: 0.4;
}
.overwrite-hint {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--color-status-warning);
  background: var(--color-status-warning-bg);
  border: 1px solid rgba(178, 80, 0, 0.18);
  border-radius: 980px;
}
</style>
