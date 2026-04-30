import axios from "axios";

const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? "gpt-4o";
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION ?? "2024-12-01-preview";

function getUrl() {
  const base = AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
  return `${base}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;
}

export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT) {
    console.warn("[AI] Azure OpenAI not configured — returning empty");
    return "";
  }

  const { data } = await axios.post(
    getUrl(),
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 1000,
    },
    {
      headers: {
        "api-key": AZURE_OPENAI_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    }
  );

  return data.choices?.[0]?.message?.content ?? "";
}

export function isAIConfigured(): boolean {
  return !!(AZURE_OPENAI_API_KEY && AZURE_OPENAI_ENDPOINT);
}
