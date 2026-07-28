/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 打包后指向真实后端域名，例如 https://api.example.com；留空则同源 /api */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
