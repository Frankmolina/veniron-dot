import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { venironUtf8Mask } from "./vite-plugin-utf8-mask.ts";

export default defineConfig({
	plugins: [venironUtf8Mask(), react()],
	base: "./",
	build: { outDir: "dist/app", emptyOutDir: true },
	test: {
		name: "ui",
		environment: "jsdom",
		include: ["test/**/*.test.tsx", "test/**/*.test.ts"],
		setupFiles: ["test/setup.ts"],
	},
});
