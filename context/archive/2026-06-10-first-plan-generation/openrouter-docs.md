# OpenRouter API — Reference for S-02 (first-plan-generation)

> External research artifact. Fetched via Context7 MCP (`/websites/openrouter_ai`) on 2026-06-10.
> Scope: server-side AI plan generation in the Astro 6 SSR + Cloudflare Workers stack.

## Endpoint & auth

`POST https://openrouter.ai/api/v1/chat/completions` — OpenAI-compatible. Auth is a bearer token:

```
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
```

Optional attribution headers (for OpenRouter rankings, harmless to include):

- `HTTP-Referer: <YOUR_SITE_URL>`
- `X-OpenRouter-Title: <YOUR_SITE_NAME>`

## Structured output — the key piece for plan generation

S-02 needs a reliably-structured 4-week plan, so use `response_format` with `json_schema` and
`strict: true`. The model is then forced to emit JSON matching the schema.

```jsonc
{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [
    { "role": "system", "content": "<plan-generation instructions>" },
    { "role": "user",   "content": "<FTP, goal, availability, equipment>" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "training_plan",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": { /* weeks -> sessions -> type, duration, intensity targets */ },
        "required": [ /* ... */ ],
        "additionalProperties": false
      }
    }
  }
}
```

Minimal documented example of the `response_format` shape:

```json
{
  "messages": [
    { "role": "user", "content": "What's the weather like in London?" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "weather",
      "strict": true,
      "schema": {
        "type": "object",
        "properties": {
          "location":    { "type": "string", "description": "City or location name" },
          "temperature": { "type": "number", "description": "Temperature in Celsius" },
          "conditions":  { "type": "string", "description": "Weather conditions description" }
        },
        "required": ["location", "temperature", "conditions"],
        "additionalProperties": false
      }
    }
  }
}
```

> The structured-output response still arrives as a **string** in `choices[0].message.content`.
> `JSON.parse()` it, then validate with zod (per CLAUDE.md convention) before persisting.

`ResponseFormat` type:

```typescript
type ResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        strict?: boolean;
        schema: object; // JSON Schema object
      };
    };
```

## Server-side fetch shape (no SDK — keeps the workerd bundle lean)

Plain `fetch` works in the Cloudflare workerd runtime:

```ts
const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ model, messages, response_format }),
});
const data = await res.json();
const plan = JSON.parse(data.choices[0].message.content);
```

`data.usage` (`prompt_tokens` / `completion_tokens` / `total_tokens`) comes back automatically —
useful if cost tracking is ever wanted.

### Success response shape

```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": { "content": "...", "role": "assistant" }
    }
  ],
  "created": 1677652288,
  "id": "chatcmpl-123",
  "model": "openai/gpt-4",
  "object": "chat.completion",
  "system_fingerprint": "fp_44709d6fcb",
  "usage": { "completion_tokens": 10, "prompt_tokens": 25, "total_tokens": 35 }
}
```

## Request parameters relevant to S-02

| Param             | Notes                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `model`           | e.g. `anthropic/claude-sonnet-4.5`. Uniform API → swap with a string. |
| `messages`        | `system` + `user` roles.                                              |
| `response_format` | Force structured JSON (see above).                                    |
| `temperature`     | Range [0, 2]. Use low (~0.2–0.4) for deterministic plan structure.    |
| `max_tokens`      | Range [1, context_length).                                            |
| `models`          | OpenRouter-only: `string[]` of fallback candidates.                   |
| `route`           | OpenRouter-only: `'fallback'` to auto-fallback on failure/slowness.   |
| `seed`            | Integer, for reproducibility.                                         |
| `provider`        | Provider routing preferences.                                         |

## Notes that map to the roadmap unknowns

- **Model choice (latency vs. quality NFR):** `models: string[]` + `route: "fallback"` gives
  automatic fallback if the primary model is down/slow. Swap models with a single string change
  since the API is uniform.
- **Structured-output support is model-dependent.** Not all models support `json_schema`. Check
  `openrouter.ai/models?supported_parameters=structured_outputs` (Claude and GPT-4o-class models do).

## Env wiring (CLAUDE.md compliance)

- Add `OPENROUTER_API_KEY` to `astro.config.mjs` `env.schema` as a **server-only secret**
  (alongside `SUPABASE_KEY`); read via `astro:env/server` — not `process.env`.
- For Cloudflare local dev, put it in `.dev.vars` (gitignored).
- Put the call behind a service in `src/lib/services/` and expose it through an API route
  (`src/pages/api/...` with `prerender = false`, zod-validated input).

## Sources

- https://openrouter.ai/docs/api-reference/overview
- https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- https://openrouter.ai/docs/guides/features/structured-outputs
- https://openrouter.ai/docs/api/reference/overview
