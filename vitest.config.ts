import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The Worker resolves the shared domain package from source via the
// `@pulltrader/scout-domain` path alias (see tsconfig.json `paths`). Mirror that
// here so Vitest resolves the same source without a build step. The wrangler
// (esbuild) bundle honors the tsconfig `paths` entry directly.
export default defineConfig({
  resolve: {
    alias: {
      "@pulltrader/scout-domain": fileURLToPath(
        new URL("./vendor/scout-domain/src/index.ts", import.meta.url),
      ),
    },
  },
});
