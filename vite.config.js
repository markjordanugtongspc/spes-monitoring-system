import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true
  }
});
