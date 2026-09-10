// uno.config.ts — 工程化模板统一配置
import {
  defineConfig,
  presetWind4,
  presetAttributify,
  presetIcons,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  // 1. 预设 (Presets)
  presets: [
    presetWind4(),
    // 属性模式：解决 HTML class 冗长问题
    // <div class="m-2 p-1 text-red"> 变成 <div m-2 p-1 text-red>
    presetAttributify(),

    // 图标预设：直接用 class 写图标，如 i-carbon-sun
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
  ],

  // 2. 转换器 (Transformers)
  transformers: [
    // @apply 功能：在 SCSS/CSS 中使用 UnoCSS 类
    transformerDirectives(),

    // 变体组：hover:(bg-red text-white) 简写
    transformerVariantGroup(),
  ],

  // 3. 快捷方式
  // 语义快捷方式只引用 CSS Token（src/styles/theme.scss），
  // 不在 UnoCSS 中维护第二套颜色或排版值。
  shortcuts: {
    "flex-center": "flex justify-center items-center",

    "text-theme-primary": "[color:var(--color-text-primary)]",
    "text-theme-secondary": "[color:var(--color-text-secondary)]",
    "text-theme-muted": "[color:var(--color-text-muted)]",
    "text-theme-disabled": "[color:var(--color-text-disabled)]",
    "text-theme-control": "[color:var(--color-text-control)]",
    "text-theme-link": "[color:var(--color-text-link)]",
    "text-theme-brand": "[color:var(--color-brand-primary)]",
    "text-theme-success": "[color:var(--color-status-success)]",
    "text-theme-warning": "[color:var(--color-status-warning)]",
    "text-theme-danger": "[color:var(--color-status-danger)]",

    "bg-theme-page": "[background-color:var(--color-bg-page)]",
    "bg-theme-surface": "[background-color:var(--color-bg-surface)]",
    "bg-theme-card": "[background-color:var(--color-bg-card)]",
    "bg-theme-stage": "[background-color:var(--color-bg-stage)]",
    "bg-theme-control": "[background-color:var(--color-bg-control)]",
    "bg-theme-brand": "[background-color:var(--color-brand-primary)]",

    "border-theme-default": "[border-color:var(--color-border-default)]",
    "border-theme-hover": "[border-color:var(--color-border-hover)]",

    "type-theme-body":
      "[font-family:var(--font-family-body)] [font-size:var(--typography-body-size)] [font-weight:var(--typography-body-weight)] [line-height:var(--typography-body-line-height)]",
    "type-theme-label":
      "[font-family:var(--font-family-body)] [font-size:var(--typography-label-size)] [font-weight:var(--typography-label-weight)]",
    "type-theme-title":
      "[font-family:var(--font-family-body-medium)] [font-size:var(--typography-title-size)] [font-weight:var(--typography-title-weight)] [line-height:var(--typography-title-line-height)]",
    "type-theme-display":
      "[font-family:var(--font-family-display)] [font-size:var(--typography-display-size)] [font-weight:var(--typography-display-weight)] [line-height:var(--typography-display-line-height)]",
    "font-theme-number": "[font-family:var(--font-family-number)]",
    "font-theme-number-bold": "[font-family:var(--font-family-number-bold)]",
    "font-theme-display": "[font-family:var(--font-family-display)]",
  },
});
