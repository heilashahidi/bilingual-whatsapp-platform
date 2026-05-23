// Lightweight heuristic English detector.
//
// Purpose: before invoking Claude Haiku for translation on every
// inbound message, short-circuit when the message is clearly already
// in English. Saves ~700 ms latency, one Anthropic API call per
// message, and prevents the dashboard from displaying redundant
// "translated" markup for messages where source and target are both
// English.
//
// Design philosophy: CONSERVATIVE. We only return true when we're
// very confident the text is English. False negatives (non-English
// text passed through to Claude for translation) are fine — the
// pipeline still works correctly, just at the normal latency.
// False positives (non-English text mistakenly flagged as English
// and skipped) would leave the dashboard showing untranslated
// foreign text — worse than the cost of an unnecessary API call.
//
// Heuristic rules:
//   1. Any accented Latin letter → not English (è, ñ, ç, ô, à — markers
//      of French / Spanish / Creole). Non-letter unicode punctuation
//      (em-dash, smart quotes, ellipsis) is allowed since operators
//      and modern keyboards routinely insert them.
//   2. Any known Creole / Spanish / French stopword → not English
//   3. At least one common English function word required to be
//      confident (just being ASCII isn't enough — could be random
//      product codes, gibberish, or a single foreign word)

const FOREIGN_TOKENS = [
  // Haitian Creole
  "mwen", " pou ", "pa ka", "ki sa", "kounye", "ankò", "bonjou",
  "tanpri", "kòman", "kisa", "fèt", "yo", "ou pa", "lajan",
  // Spanish
  " por favor", " problema", " ayuda", " necesito", " está ", " hola",
  " gracias", " buenos días", " buenas tardes", " no puedo", " hay ",
  // French
  "je ne", "s'il vous", " problème", " bonjour", " merci", " aide",
  " besoin", " peux pas", "n'arrive pas", " bonsoir",
];

// Common English function words — at least one must appear for us to
// be confident the text is English. Kept lowercase + space-padded so
// they only match whole words.
const ENGLISH_FUNCTION_WORDS = [
  " the ", " is ", " are ", " and ", " to ", " a ", " an ",
  " i ", " i'", " we ", " you ", " my ", " your ", " have ",
  " can't", " won't", " doesn't", " not ", " can ", " was ",
  " were ", " for ", " with ", " of ", " in ", " on ", " at ",
  " but ", " or ", " if ", " when ", " what ", " how ", " why ",
  " this ", " that ", " these ", " those ", " it ", " its ",
];

export function isLikelyEnglish(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  // Accented Latin letters (Latin-1 Supplement + Latin Extended-A/B)
  // strongly suggest French, Spanish, or Creole. Non-letter unicode
  // (em-dash, smart quotes, etc.) is intentionally allowed.
  if (/[À-ɏ]/.test(text)) return false;

  // Normalize: lowercase + pad with spaces so " the " matches at
  // boundaries, including start/end of the string.
  const padded = ` ${text.toLowerCase()} `;

  // Hard exit on any known foreign-language token.
  if (FOREIGN_TOKENS.some((token) => padded.includes(token))) return false;

  // Must contain at least one English function word to commit to
  // skipping translation. Avoids skipping for product codes, single
  // foreign words that happen to be ASCII, "ok thx", etc.
  return ENGLISH_FUNCTION_WORDS.some((word) => padded.includes(word));
}
