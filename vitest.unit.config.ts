import { defineConfig } from "vitest/config";

// Pure calculation and validation tests do not require database bootstrapping.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/modules/*.validation.test.ts", "test/modules/packaging.test.ts"],
  },
});
