import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { coverage: { provider: "v8", include: ["src/**"], exclude: ["src/cli.ts", "src/simulate.ts", "src/types.ts"] } },
});
