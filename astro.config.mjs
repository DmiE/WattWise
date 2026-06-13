// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  adapter: cloudflare({
    imageService: "passthrough", // no Cloudflare Images binding needed — not using Astro image optimisation
  }),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      // AI gateway (OpenRouter). Key is a server-only secret; model is a public
      // server var so it can be swapped (free locally, paid in prod) without a
      // code edit. Both optional so build/dev work without them configured.
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_MODEL: envField.string({ context: "server", access: "public", optional: true }),
      // Optional secondary model → OpenRouter `models[]` + `route: "fallback"`
      // for provider redundancy if the primary model errors. Config-driven like
      // OPENROUTER_MODEL; unset means a single-model request (no fallback).
      OPENROUTER_FALLBACK_MODEL: envField.string({ context: "server", access: "public", optional: true }),
    },
  },
});
