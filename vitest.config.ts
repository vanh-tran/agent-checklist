import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/web/**/*.test.{ts,tsx}"],
    globals: true,
  },
});