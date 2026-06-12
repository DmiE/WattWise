import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";

// Thin OpenRouter chat-completion client. Transport concerns only — auth
// headers, structured `response_format`, low temperature, bounded retry on
// transient failures. It returns the parsed-but-UNVALIDATED JSON content plus
// usage metadata; semantic validation (zod + equipment match) is the caller's
// job (see `src/lib/plan.ts`). No SDK — plain `fetch`, which the Cloudflare
// workerd runtime supports natively.
//
// Secrets are read via `astro:env/server` (never `process.env`), mirroring
// `src/lib/supabase.ts`. When the key is absent the client fails closed by
// throwing a tagged `OpenRouterError` so the API route can map it to a generic
// 500 without leaking provider details to the client.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

// Low temperature → deterministic plan structure. Generous max_tokens so a full
// 28-day strict-JSON plan never truncates (truncation isn't retryable here).
const TEMPERATURE = 0.3;
const MAX_TOKENS = 8000;

// Bounded retry on transient (network / 5xx / 429) failures. Total attempts =
// MAX_RETRIES + 1. Each attempt is wrapped in an AbortController timeout so a
// hung upstream can't stall the Worker request indefinitely.
const MAX_RETRIES = 2;
const ATTEMPT_TIMEOUT_MS = 45_000;

export type OpenRouterErrorCode = "missing_api_key" | "http_error" | "network_error" | "parse_error";

export class OpenRouterError extends Error {
  readonly code: OpenRouterErrorCode;
  readonly status?: number;

  constructor(code: OpenRouterErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.code = code;
    this.status = status;
  }
}

export interface GenerateStructuredParams {
  system: string;
  user: string;
  /** JSON-Schema object passed verbatim as `response_format.json_schema.schema`. */
  jsonSchema: Record<string, unknown>;
  /** Name for the schema (OpenRouter requires it; arbitrary identifier). */
  schemaName: string;
  /** Optional fallback model candidates → `models[]` + `route: "fallback"`. */
  fallbackModels?: string[];
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GenerateStructuredResult {
  /** Parsed JSON from the model — NOT yet validated against any zod schema. */
  content: unknown;
  usage: Usage;
  model: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: Partial<Usage>;
  model?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Perform a single structured chat completion. Returns the parsed JSON content
 * (a trust boundary the caller must still validate) plus usage + the model that
 * actually served the request. Throws `OpenRouterError` on missing key,
 * non-recoverable HTTP errors, exhausted retries, or unparseable content.
 */
export async function generateStructured(params: GenerateStructuredParams): Promise<GenerateStructuredResult> {
  if (!OPENROUTER_API_KEY) {
    // Fail closed — mirrors the supabase.ts null-guard intent.
    throw new OpenRouterError("missing_api_key", "OPENROUTER_API_KEY is not configured");
  }

  const model = OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: params.schemaName,
        strict: true,
        schema: params.jsonSchema,
      },
    },
  };
  if (params.fallbackModels && params.fallbackModels.length > 0) {
    body.models = [model, ...params.fallbackModels];
    body.route = "fallback";
  }

  let lastError: OpenRouterError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, ATTEMPT_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          // Attribution headers — harmless, used by OpenRouter rankings.
          "HTTP-Referer": "https://wattwise.app",
          "X-Title": "WattWise",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // Network failure or abort (timeout) — retryable.
      lastError = new OpenRouterError("network_error", `OpenRouter request failed: ${String(err)}`);
      clearTimeout(timeout);
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      lastError = new OpenRouterError(
        "http_error",
        `OpenRouter returned ${res.status}: ${detail.slice(0, 500)}`,
        res.status,
      );
      if (isRetryableStatus(res.status)) {
        continue;
      }
      throw lastError;
    }

    let data: ChatCompletionResponse;
    try {
      data = (await res.json()) as ChatCompletionResponse;
    } catch (err) {
      throw new OpenRouterError("parse_error", `OpenRouter response was not JSON: ${String(err)}`);
    }

    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== "string") {
      // Empty/malformed completion — retry, it may be transient.
      lastError = new OpenRouterError("parse_error", "OpenRouter response had no message content");
      continue;
    }

    let content: unknown;
    try {
      // Structured output still arrives as a STRING — parse before validating.
      content = JSON.parse(raw) as unknown;
    } catch (err) {
      lastError = new OpenRouterError("parse_error", `Model content was not valid JSON: ${String(err)}`);
      continue;
    }

    const usage: Usage = {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      total_tokens: data.usage?.total_tokens ?? 0,
    };

    return { content, usage, model: data.model ?? model };
  }

  throw lastError ?? new OpenRouterError("network_error", "OpenRouter request failed after retries");
}
