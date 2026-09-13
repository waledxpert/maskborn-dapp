import { config } from "../../config.js";

export type ProviderMessage = { role: "user" | "assistant"; content: string };
export type ProviderResult = { id: string; text: string; inputTokens: number | null; outputTokens: number | null };

type ResponsesPayload = {
  id?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

export function providerStatus() {
  return {
    configured: config.AGENT_MODEL_PROVIDER === "openai" && Boolean(config.AGENT_MODEL_API_KEY && config.AGENT_MODEL_NAME),
    provider: config.AGENT_MODEL_PROVIDER,
    model: config.AGENT_MODEL_PROVIDER === "disabled" ? null : config.AGENT_MODEL_NAME ?? null,
    destinationOrigin: config.AGENT_MODEL_PROVIDER === "disabled" ? null : new URL(config.AGENT_MODEL_BASE_URL).origin,
  };
}

export async function createModelResponse(input: { instructions: string; messages: ProviderMessage[] }): Promise<ProviderResult> {
  if (!providerStatus().configured) throw new Error("MODEL_PROVIDER_NOT_CONFIGURED");
  const response = await fetch(`${config.AGENT_MODEL_BASE_URL.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.AGENT_MODEL_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.AGENT_MODEL_NAME,
      instructions: input.instructions,
      input: input.messages,
      max_output_tokens: 800,
      store: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({})) as ResponsesPayload;
  if (!response.ok) throw new Error(`MODEL_PROVIDER_${response.status}`);
  const text = payload.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text ?? "")
    .join("\n")
    .trim();
  if (!payload.id || !text) throw new Error("MODEL_PROVIDER_EMPTY_RESPONSE");
  return {
    id: payload.id,
    text,
    inputTokens: payload.usage?.input_tokens ?? null,
    outputTokens: payload.usage?.output_tokens ?? null,
  };
}
