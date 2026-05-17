// Token usage extraction from AI API responses.
// Supports OpenAI, Anthropic, Volcengine, DeepSeek, Qwen formats.

interface Usage {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  total_tokens?: number;
}

export function extractTokensFromUsage(usage: Usage | undefined): number {
  if (!usage) return 0;
  const input = usage.input_tokens || usage.prompt_tokens || 0;
  const output = usage.output_tokens || usage.completion_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  return input + output + cacheCreate + cacheRead;
}

// Parse token count from a complete response body.
// Handles both non-streaming JSON and streaming SSE formats.
export function parseTokensFromBody(body: string): number {
  // Non-streaming JSON
  try {
    const json = JSON.parse(body);
    if (json.usage) {
      return extractTokensFromUsage(json.usage);
    }
    // Anthropic message format
    if (json.type === 'message' && json.usage) {
      return extractTokensFromUsage(json.usage);
    }
  } catch {
    // Not JSON, try SSE
  }

  // Streaming SSE: find the last line with a usage block
  let totalTokens = 0;
  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const json = JSON.parse(data);
      const t = extractTokensFromUsage(json.usage);
      if (t > 0) totalTokens = t; // keep last non-zero usage
    } catch {
      // skip
    }
  }
  return totalTokens;
}

// Check if a request URL looks like an AI API endpoint worth intercepting.
export function isAiApiPath(url: string): boolean {
  return /\/(chat\/completions|messages|completions|engines\/[^/]+\/chat)/i.test(url);
}
