import { onMounted, onUnmounted, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowFullscreen() {
  const error = ref("");
  let pending = false;

  async function onKeydown(event: KeyboardEvent) {
    // 浏览器开发模式保留浏览器自己的 F11 行为。
    if (!isTauri() || !["F11", "Escape"].includes(event.key)) return;
    if (event.key === "F11") event.preventDefault();
    if (event.repeat || pending) return;
    pending = true;
    try {
      const appWindow = getCurrentWindow();
      const fullscreen = await appWindow.isFullscreen();
      if (event.key === "F11" || fullscreen) {
        await appWindow.setFullscreen(event.key === "F11" ? !fullscreen : false);
        error.value = "";
      }
    } catch (cause) {
      error.value = `全屏切换失败：${String(cause)}`;
    } finally {
      pending = false;
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
  return { fullscreenError: error };
}
