export interface TranslationCase {
  input: { text: string; targetLanguage: "en" | "ht" | "fr" | "es" };
  expected: {
    sourceLanguage: "en" | "ht" | "fr" | "es";
    referenceTranslation: string;
    // Tokens that must appear verbatim in the output (numbers, product names,
    // error codes). The translator is explicitly instructed to preserve these.
    preservedTokens?: string[];
    // For pass-through cases (source already in target language), output text
    // should equal input text byte-for-byte.
    passThrough?: boolean;
  };
  metadata: { direction: string; notes?: string };
}

// Mix of inbound (foreign → en) and outbound (en → foreign) directions, plus
// preservation + pass-through edge cases. Authentic-sounding phrasing for HT;
// keep entries unique so the in-process translation cache doesn't mask Claude
// behavior between runs.
export const dataset: TranslationCase[] = [
  // en → ht (outbound replies from operators)
  {
    input: { text: "Your ticket has been resolved. Thank you for your patience.", targetLanguage: "ht" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Tikè ou rezoud. Mèsi pou pasyans ou.",
    },
    metadata: { direction: "en→ht", notes: "common outbound resolution message" },
  },
  {
    input: { text: "Please restart the app and try again.", targetLanguage: "ht" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Tanpri rekòmanse aplikasyon an epi eseye ankò.",
    },
    metadata: { direction: "en→ht" },
  },
  {
    input: { text: "We need your account number to proceed.", targetLanguage: "ht" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Nou bezwen nimewo kont ou pou nou kontinye.",
    },
    metadata: { direction: "en→ht" },
  },

  // ht → en (inbound agent messages)
  {
    input: { text: "Aplikasyon an pa louvri ditou depi maten.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "The app hasn't opened at all since this morning.",
    },
    metadata: { direction: "ht→en" },
  },
  {
    input: { text: "Mwen pa ka voye lajan an, li ban m yon erè.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "I can't send the money, it gives me an error.",
    },
    metadata: { direction: "ht→en" },
  },
  {
    input: { text: "Konbyen tan li pran pou yon transfè rive?", targetLanguage: "en" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "How long does a transfer take to arrive?",
    },
    metadata: { direction: "ht→en" },
  },
  {
    input: { text: "Entènèt la pa bon, aplikasyon an blòke.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "The internet is bad, the app is stuck.",
    },
    metadata: { direction: "ht→en" },
  },

  // en → fr
  {
    input: { text: "Your password has been reset successfully.", targetLanguage: "fr" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Votre mot de passe a été réinitialisé avec succès.",
    },
    metadata: { direction: "en→fr" },
  },
  {
    input: { text: "Please contact support if the problem persists.", targetLanguage: "fr" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Veuillez contacter le support si le problème persiste.",
    },
    metadata: { direction: "en→fr" },
  },

  // fr → en
  {
    input: { text: "Je n'arrive pas à me connecter à mon compte.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "fr",
      referenceTranslation: "I can't log in to my account.",
    },
    metadata: { direction: "fr→en" },
  },

  // en → es
  {
    input: { text: "Your transaction has been completed.", targetLanguage: "es" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Su transacción ha sido completada.",
    },
    metadata: { direction: "en→es" },
  },

  // es → en
  {
    input: { text: "La aplicación se cierra cuando intento hacer un pago.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "es",
      referenceTranslation: "The app closes when I try to make a payment.",
    },
    metadata: { direction: "es→en" },
  },

  // Preservation — numbers, error codes, currency
  {
    input: { text: "Error code 502: transfer of 1500 HTG to account 4471-2289 failed.", targetLanguage: "ht" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Kòd erè 502: transfè 1500 HTG nan kont 4471-2289 echwe.",
      preservedTokens: ["502", "1500", "HTG", "4471-2289"],
    },
    metadata: { direction: "en→ht", notes: "must preserve all numbers + currency code verbatim" },
  },
  {
    input: { text: "Reference number is TXN-887293 — please save it.", targetLanguage: "ht" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "Nimewo referans la se TXN-887293 — tanpri sere li.",
      preservedTokens: ["TXN-887293"],
    },
    metadata: { direction: "en→ht", notes: "preserve reference IDs" },
  },
  {
    input: { text: "Erè 403 lè m'ap eseye konekte.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "Error 403 when I try to connect.",
      preservedTokens: ["403"],
    },
    metadata: { direction: "ht→en", notes: "preserve HTTP-ish error codes" },
  },

  // Pass-through — source already matches target language
  {
    input: { text: "The app is working fine now.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "The app is working fine now.",
      passThrough: true,
    },
    metadata: { direction: "en→en", notes: "source==target should return input unchanged with confidence 1.0" },
  },
  {
    input: { text: "Mèsi anpil pou èd la.", targetLanguage: "ht" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "Mèsi anpil pou èd la.",
      passThrough: true,
    },
    metadata: { direction: "ht→ht", notes: "ht→ht pass-through" },
  },

  // Tone preservation — panicked agent stays panicked
  {
    input: { text: "URGENT!! Money disappeared from my account, what is happening?!", targetLanguage: "ht" },
    expected: {
      sourceLanguage: "en",
      referenceTranslation: "IJANS!! Lajan an disparèt nan kont mwen, kisa k ap pase?!",
      preservedTokens: ["!!"],
    },
    metadata: { direction: "en→ht", notes: "register/urgency markers should survive" },
  },
  {
    input: { text: "AYIDE! Mwen pa ka jwenn lajan mwen!", targetLanguage: "en" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "HELP! I can't find my money!",
      preservedTokens: ["!"],
    },
    metadata: { direction: "ht→en", notes: "urgency must propagate" },
  },

  // Short utterance
  {
    input: { text: "Wi, mèsi.", targetLanguage: "en" },
    expected: {
      sourceLanguage: "ht",
      referenceTranslation: "Yes, thank you.",
    },
    metadata: { direction: "ht→en", notes: "short ack" },
  },
];
