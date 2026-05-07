/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MESSAGE_TRACE_DISPLAY_MODE?: "debug" | "user";
  readonly VITE_MESSAGE_TRACE_DISPLAY_MODE?: "debug" | "user";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
