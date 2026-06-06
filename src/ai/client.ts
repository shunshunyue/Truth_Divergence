export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AiJsonStreamRequest = {
  messages: AiMessage[];
  temperature?: number;
  model?: string;
  onContent?: (content: string) => void;
};

type AiTextStreamRequest = {
  messages: AiMessage[];
  temperature?: number;
  model?: string;
  maxTokens?: number;
  onContent?: (content: string) => void;
};

function buildChatCompletionsUrl(value: string) {
  const url = new URL(value);
  if (!url.pathname.replace(/\/+$/, "").endsWith("/v1")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1`;
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
  return url.toString();
}

function getAiConfig(model?: string) {
  // 注意：这个文件只应该在服务端调用，不能把 API key 暴露给 NEXT_PUBLIC_* 或客户端组件。
  // 这里必须运行时读取 process.env，不能在模块加载时缓存。自定义 WebSocket server
  // 会先 import Agent 模块，再由 Next/dotenv 加载 .env.local；缓存会导致永远显示 AI 未配置。
  const baseUrl = process.env.UNITY2_AI_BASE_URL ?? "https://unity2.ai/";
  const apiKey = process.env.UNITY2_AI_API_KEY;
  const selectedModel = model ?? process.env.UNITY2_AI_MODEL;

  return {
    apiKey,
    chatCompletionsUrl: buildChatCompletionsUrl(baseUrl),
    selectedModel,
  };
}

export function hasAiCredentials() {
  const { apiKey, selectedModel } = getAiConfig();
  // 同时要求 key 和 model，是为了避免只填了 key 但没填模型名时触发一次必然失败的真实请求。
  // 没配完整时页面会显示“AI 未配置”，不会生成假剧情。
  return Boolean(apiKey && selectedModel);
}

export async function requestAiJsonStream<T>({
  messages,
  temperature = 0.4,
  model,
  onContent,
}: AiJsonStreamRequest): Promise<T> {
  const { apiKey, chatCompletionsUrl, selectedModel } = getAiConfig(model);

  if (!apiKey || !selectedModel) {
    throw new Error("UNITY2_AI_API_KEY or UNITY2_AI_MODEL is not configured.");
  }

  const response = await fetch(chatCompletionsUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature,
      response_format: { type: "json_object" },
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    throw new Error(`AI stream request failed ${response.status}: ${raw.slice(0, 800)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      const parsed = JSON.parse(payload);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta !== "string" || !delta) continue;

      content += delta;
      onContent?.(delta);
    }
  }

  if (!content.trim()) {
    throw new Error("AI stream response did not include message content.");
  }

  return JSON.parse(content) as T;
}

export async function requestAiTextStream({
  messages,
  temperature = 0.55,
  model,
  maxTokens = 700,
  onContent,
}: AiTextStreamRequest): Promise<string> {
  const { apiKey, chatCompletionsUrl, selectedModel } = getAiConfig(model);

  if (!apiKey || !selectedModel) {
    throw new Error("UNITY2_AI_API_KEY or UNITY2_AI_MODEL is not configured.");
  }

  const response = await fetch(chatCompletionsUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    throw new Error(`AI text stream request failed ${response.status}: ${raw.slice(0, 800)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      const parsed = JSON.parse(payload);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta !== "string" || !delta) continue;

      content += delta;
      onContent?.(delta);
    }
  }

  if (!content.trim()) {
    throw new Error("AI text stream response did not include message content.");
  }

  return content;
}
