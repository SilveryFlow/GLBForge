import { createApp } from "vue";
import "@csstools/normalize.css/normalize.css";
import "virtual:uno.css";
import "./styles/base.css";
import "./styles/theme.scss";
import App from "./App.vue";

createApp(App).mount("#app");
