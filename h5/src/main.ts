import "./styles.css";
// 页面模块通过副作用注册到路由表，必须在 bootApp 之前 import
import "./pages/guardian.js";
import "./pages/admin.js";

import { bootApp } from "./app.js";
import { bootstrap } from "./state.js";

const root = document.getElementById("app");
if (!root) throw new Error("找不到 #app 挂载点");

bootApp(root);
void bootstrap();
