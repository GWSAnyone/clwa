/**
 * JSON utilities для LLM-output postprocessing.
 * Вынесено из llm-client.ts чтобы провайдеры могли импортировать без cyclical deps.
 */

/**
 * Truncate raw LLM output to first complete JSON object.
 * Handles multi-object output (e.g. {"speech":"..."} {"name":"..."})
 * by brace-matching with proper string/escape awareness.
 */
export function truncateToFirstJsonObject(raw: string): string {
  const trimmed = raw.trim().replace(/,\s*}/g, '}').replace(/,\s*$/g, '');
  if (!trimmed.startsWith('{')) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return trimmed.slice(0, i + 1);
    }
  }
  return trimmed; // no matching close brace — return as-is, let JSON.parse handle
}
