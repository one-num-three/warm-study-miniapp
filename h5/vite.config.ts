import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const sharedSrc = fileURLToPath(new URL("../shared/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // 直接指向源码，改 shared 时 H5 立刻热更新，不用先 build
      "@warm-study/shared": sharedSrc + "/index.ts",
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发时前端 5173、后端 8787，用代理避免跨域和写死地址
      "/api": {
        target: process.env.WARM_STUDY_API ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
