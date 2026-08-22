import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        webflow: "src/webflow.ts",
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["swiper", "swiper/modules"],
    },
    target: "es2022",
  },
});
