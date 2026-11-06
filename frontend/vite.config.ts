import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 与 main.ts 的 PI_A_PORT 对齐（默认 8000），Vite 把 /api 代理回后端
const apiTarget = `http://127.0.0.1:${process.env.PI_A_PORT || 8000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        // SSE（/api/events/:id/stream）实时转发，避免被代理缓冲
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            const ct = proxyRes.headers["content-type"] || "";
            if (ct.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
