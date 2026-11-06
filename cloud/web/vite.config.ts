import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const envDir = fileURLToPath(new URL("..", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  return {
    root,
    envDir,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      origin: "http://localhost:5173",
      proxy: {
        "/api": {
          target: env.CLOUD_API_TARGET || "http://127.0.0.1:8080",
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
