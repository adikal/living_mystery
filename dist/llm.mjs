// Optional, boundary-respecting LLM dialogue realization.
//
// The deterministic engine remains authoritative. The engine decides WHAT a
// character asserts — including when they lie, withhold, or cooperate — and
// that decision is what keeps the mystery fair, solvable, and replayable.
// This module only RESTYLES an already-approved line so it sounds like that
// character speaking. It must never add, drop, or change a fact, and it never
// touches world state. Any failure (no endpoint, timeout, HTTP error, invalid
// output) falls back to the authored line, so play stays fully deterministic
// and offline-capable when no endpoint is configured.
//
// Nothing here is fed the hidden solution: callers pass a character's PUBLIC
// persona plus a derived, non-spoiling "manner", never the secret or the
// canonical crime truth.

const ENDPOINT_KEY = 'living-mystery.llm.endpoint';
const ENABLED_KEY = 'living-mystery.llm.enabled';

function safeStore(store) {
  return store ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined);
}

export function llmConfig(store) {
  const s = safeStore(store);
  try {
    return { endpoint: s?.getItem(ENDPOINT_KEY) || '', enabled: s?.getItem(ENABLED_KEY) === '1' };
  } catch {
    return { endpoint: '', enabled: false };
  }
}

export function setLlmConfig({ endpoint, enabled }, store) {
  const s = safeStore(store);
  try {
    if (endpoint !== undefined) s.setItem(ENDPOINT_KEY, String(endpoint).trim());
    if (enabled !== undefined) s.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable — settings simply do not persist */
  }
}

// Enabled AND a syntactically valid http(s) endpoint. Never throws.
export function llmActive(store) {
  const c = llmConfig(store);
  return c.enabled && /^https?:\/\/\S+/i.test(c.endpoint);
}

// Hard boundary stated to the model. Facts are fixed; only wording changes.
export const SYSTEM_PROMPT =
  'You are a dialogue stylist for a detective mystery set in the English village of Bellweather in 1932. ' +
  'You receive a line a character has ALREADY decided to say, plus who they are and the manner in which they are speaking. ' +
  'Rewrite ONLY the wording so it sounds like that character speaking naturally, in period-appropriate English, in the given manner. ' +
  'Absolute rules: ' +
  '(1) Preserve every fact, name, time, place and number exactly as given. ' +
  '(2) Do NOT add new claims, evidence, accusations, admissions, or information of any kind. ' +
  '(3) Do NOT remove any factual content. ' +
  '(4) You may convey the manner (evasive, tense, candid, etc.) through tone and phrasing, but never through new facts. ' +
  '(5) First person as the character. No narration, no stage directions, no surrounding quotation marks. ' +
  '(6) One to three sentences. ' +
  '(7) If you cannot comply, output the original line unchanged. ' +
  'Output only the spoken line.';

// Build the user prompt from NON-SPOILING inputs only.
export function buildUserPrompt({ speaker, role, persona, manner, traits, mood, authoredLine }) {
  const lines = [];
  lines.push(`Character: ${speaker}${role ? `, ${role}` : ''}.`);
  if (persona) lines.push(`Public reputation: ${persona}`);
  if (Array.isArray(traits) && traits.length) lines.push(`Disposition: ${traits.join(', ')}.`);
  const moodBits = [];
  if (mood && Number.isFinite(mood.trust)) moodBits.push(`trust in the detective ${Math.round(mood.trust * 100)}%`);
  if (mood && Number.isFinite(mood.stress)) moodBits.push(`stress ${Math.round(mood.stress * 100)}%`);
  if (moodBits.length) lines.push(`Current state: ${moodBits.join(', ')}.`);
  if (manner) lines.push(`Speaking manner right now: ${manner}.`);
  lines.push(`Line to restyle (preserve ALL facts, names, times, numbers): "${authoredLine}"`);
  lines.push(`Rewrite it in ${speaker}'s own voice.`);
  return lines.join('\n');
}

// Reject outputs that broke the contract; on any doubt, keep the authored line.
const _REFUSAL_MARKERS = [
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bi (?:cannot|can't|won't|am unable to)\b/i,
  /```/,
  /^\s*system\s*:/i,
  /^\s*(?:sure|certainly|here(?:'s| is))\b/i,
];

export function sanitizeRealization(authoredLine, candidate) {
  if (typeof candidate !== 'string') return authoredLine;
  let t = candidate.replace(/\r/g, '').trim();
  if (!t) return authoredLine;
  // Collapse to a single spoken paragraph.
  t = t.replace(/\s*\n+\s*/g, ' ').trim();
  // Strip wrapping quotes the model sometimes adds.
  t = t.replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim();
  if (!t) return authoredLine;
  // Control characters (other than normal spacing) → reject.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) return authoredLine;
  // Refusals / meta / code → reject.
  if (_REFUSAL_MARKERS.some((re) => re.test(t))) return authoredLine;
  // Length guard: a restyle should be comparable to the source.
  if (t.length > Math.max(400, authoredLine.length * 3 + 200)) return authoredLine;
  return t;
}

// Realize one line. NEVER throws; always resolves to a string.
// Returns the authored line unchanged whenever the LLM is inactive/unavailable.
export async function realizeLine(payload, opts = {}) {
  const authored = payload.authoredLine;
  const store = opts.store;
  if (!llmActive(store)) return authored;
  const fetchImpl = opts.fetchImpl ?? (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  const AbortImpl = opts.AbortControllerImpl ?? (typeof globalThis !== 'undefined' ? globalThis.AbortController : undefined);
  if (typeof fetchImpl !== 'function') return authored;
  const { endpoint } = llmConfig(store);
  const controller = AbortImpl ? new AbortImpl() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000) : null;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({ system: SYSTEM_PROMPT, prompt: buildUserPrompt(payload), max_tokens: 300 }),
    });
    if (!res || !res.ok) return authored;
    const data = await res.json();
    const raw = data && (data.text ?? data.completion ?? data.output);
    return sanitizeRealization(authored, raw);
  } catch {
    return authored;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
