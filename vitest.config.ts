import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Standalone Vitest config — deliberately NOT Astro's `getViteConfig()`.
//
// `getViteConfig()` runs `astro:config:setup`, which makes the Cloudflare
// adapter push `@cloudflare/vite-plugin` into the Vite config. On this version
// pin that plugin's workerd SSR environment is incompatible with Vitest's
// module runner (withastro/astro#15878). The fix — skipping the CF/dev-server
// plugins when `process.env.VITEST` is set (withastro/astro#17248, merged
// 2026-07-01) — postdates both astro@6.3.1 and @astrojs/cloudflare@13.5.0.
//
// Nothing under test needs Astro's Vite pipeline: the target modules are plain
// TypeScript with no `.astro` files, no CSS, and no `astro:env` imports. The
// only thing `getViteConfig()` would have supplied that these tests actually
// need is the `@/*` tsconfig-paths alias, which `vite-tsconfig-paths` provides.
//
// Revisit only when astro and @astrojs/cloudflare are upgraded past the fix,
// AND a test genuinely needs the Workers runtime or `astro:env`.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
