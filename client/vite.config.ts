import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
    server: {
        port: 5173,
        proxy: {
            "/api": {
                target: "http://localhost:5174",
                changeOrigin: true
            }
        }
    },
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") }
    }
});
