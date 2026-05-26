// PII redaction layer for the LLM trust boundary (SECURITY.md §5.2).
//
// Runs BEFORE any Anthropic API call so customer card numbers, OTPs,
// account numbers, and unrelated phone numbers don't leave our infra.
// The redacted form is what Claude sees; the original is what we
// persist in Message.originalText (covered by encryption at rest).
//
// Patterns are intentionally conservative — false-positive redaction
// degrades translation quality slightly, but false-negative leakage
// of a card number is a compliance incident. When in doubt, redact.

export type RedactionKind = "card" | "otp" | "phone" | "account" | "email";

export type RedactionCounts = Record<RedactionKind, number>;

export interface RedactionResult {
  text: string;
  redactions: RedactionCounts;
  hadAny: boolean;
}

export interface RedactionOptions {
  // The agent's own E.164 number. Phone-number matches that resolve to
  // these digits are preserved so translation context isn't destroyed
  // when an agent quotes their own number. Customer or third-party
  // numbers are still redacted.
  preservePhone?: string;
}

const PLACEHOLDER: Record<RedactionKind, string> = {
  card: "[REDACTED_CARD]",
  otp: "[REDACTED_OTP]",
  phone: "[REDACTED_PHONE]",
  account: "[REDACTED_ACCOUNT]",
  email: "[REDACTED_EMAIL]",
};

// Words that signal a 4–8 digit follow-on is an OTP / verification code.
// Multilingual on purpose — agents code-switch and a Creole "kòd" needs to
// trigger the same redaction path as an English "code".
const OTP_KEYWORDS = [
  // English
  "code",
  "otp",
  "pin",
  "passcode",
  "password",
  "verification",
  "verify",
  // Haitian Creole
  "kòd",
  "kod",
  "modpas",
  // French
  "code",
  "mot de passe",
  "vérification",
  "verification",
  // Spanish
  "código",
  "codigo",
  "contraseña",
  "contrasena",
  "clave",
  "verificación",
  "verificacion",
];

// Luhn check (mod-10) for card-number candidates. Operates on a digits-
// only string. Returns false for runs outside the 13–19 length window
// regardless of arithmetic — Visa / Mastercard / Amex / Discover all
// fall in that range.
function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

// Card-number candidates: 13–19 digits possibly broken by single
// spaces or single dashes (the common ways humans paste them). Anchor
// on word boundaries so we don't chew up parts of longer digit runs.
const CARD_CANDIDATE = /(?<![\d])(?:\d[\s-]?){12,18}\d(?![\d])/g;

// E.164: explicit + prefix plus 8–15 digits. The + is required —
// bare digit runs are caught by the account-number sweep instead.
const E164_PHONE = /\+\d{8,15}\b/g;

// OTP keyword detector — separate from the keyword list so we control
// boundary semantics. Uses Unicode word boundaries via the `u` flag
// so accented letters (kòd, código, vérification) match cleanly.
function buildOtpRegex(): RegExp {
  // Sort by length DESC so multi-word keywords ("mot de passe") win
  // over substring matches ("mot"). Escape regex metacharacters per
  // keyword to be safe even though current keywords are plain text.
  const sorted = [...new Set(OTP_KEYWORDS)].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Group: (?:keyword) followed by optional separators then 4–8 digits.
  // (?<![\w]) approximates a left word-boundary that respects Unicode.
  return new RegExp(
    `(?<![\\p{L}])(?:${escaped.join("|")})\\s*[:#-]?\\s*(\\d{4,8})\\b`,
    "giu"
  );
}

const OTP_REGEX = buildOtpRegex();

// Email: minimal pattern. Customer email addresses are PII; agent
// emails could be too. The check is intentionally loose — better a
// false-positive redaction of a non-email-looking-string than leaking
// a real one.
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// Bare-digit-run account number sweep. Runs LAST so card numbers and
// OTP-following digits (already replaced with placeholders) don't
// match. 8–20 consecutive digits is the configurable window — narrow
// enough to skip short references (ticket IDs, error codes) and wide
// enough to catch most bank account formats in HT / DO / CD. The
// negative lookbehind also excludes runs prefixed by `+` so a
// preserved phone (the agent's own number) doesn't get half-redacted.
const BARE_ACCOUNT = /(?<![\d+])\d{8,20}(?![\d])/g;

export function redactPII(
  input: string,
  opts: RedactionOptions = {}
): RedactionResult {
  if (!input || typeof input !== "string") {
    return {
      text: input ?? "",
      redactions: { card: 0, otp: 0, phone: 0, account: 0, email: 0 },
      hadAny: false,
    };
  }

  const counts: RedactionCounts = {
    card: 0,
    otp: 0,
    phone: 0,
    account: 0,
    email: 0,
  };

  let text = input;

  // 1. Cards (Luhn-verified) — most specific, highest stakes.
  text = text.replace(CARD_CANDIDATE, (match) => {
    if (luhnValid(digitsOnly(match))) {
      counts.card++;
      return PLACEHOLDER.card;
    }
    return match;
  });

  // 2. OTPs — keyword-anchored 4–8 digit codes. Run before the bare-
  // digit sweep so the digit-run sweep doesn't match the same value.
  text = text.replace(OTP_REGEX, (match) => {
    counts.otp++;
    // Reuse the keyword prefix so context survives — e.g.
    // "code 123456" → "code [REDACTED_OTP]". Strip the trailing digits.
    return match.replace(/\d{4,8}\s*$/, PLACEHOLDER.otp);
  });

  // 3. Phones — E.164 only. Preserve the agent's own number when the
  // caller passed it in.
  const preserveDigits = opts.preservePhone ? digitsOnly(opts.preservePhone) : "";
  text = text.replace(E164_PHONE, (match) => {
    if (preserveDigits && digitsOnly(match) === preserveDigits) {
      return match;
    }
    counts.phone++;
    return PLACEHOLDER.phone;
  });

  // 4. Emails.
  text = text.replace(EMAIL, () => {
    counts.email++;
    return PLACEHOLDER.email;
  });

  // 5. Bare account-number-shaped digit runs. Last pass so it can't
  // chew through earlier matches (placeholders contain no digits).
  text = text.replace(BARE_ACCOUNT, () => {
    counts.account++;
    return PLACEHOLDER.account;
  });

  const hadAny =
    counts.card + counts.otp + counts.phone + counts.account + counts.email > 0;

  return { text, redactions: counts, hadAny };
}

// Convenience for callers that want the redacted text without
// inspecting counts — the most common case at integration sites.
export function redactText(input: string, opts: RedactionOptions = {}): string {
  return redactPII(input, opts).text;
}
