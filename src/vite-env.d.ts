/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module "virtual:uno.css";

declare module "draco3dgltf" {
  const draco: {
    createDecoderModule(options?: { locateFile: () => string }): Promise<unknown>;
    createEncoderModule(options?: { locateFile: () => string }): Promise<unknown>;
  };
  export default draco;
}
