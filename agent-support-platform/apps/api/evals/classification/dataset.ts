import type { ClassificationResult } from "@asp/shared";

export interface ClassificationCase {
  input: string;
  expected: ClassificationResult;
  metadata: {
    language: "en" | "ht" | "fr" | "es";
    notes?: string;
  };
}

// Starter golden set — 20 cases across the four supported languages.
// Expand as you find production examples worth pinning behavior on.
export const dataset: ClassificationCase[] = [
  // English — bug reports
  {
    input: "The app keeps crashing every time I try to send money. I have to force-close it.",
    expected: { category: "bug_report", severity: "high", tags: ["app_crash"], productArea: "mobile_app", confidence: 0.85, likelyNetwork: false },
    metadata: { language: "en", notes: "clear crash on critical flow" },
  },
  {
    input: "Cannot process any transactions, the app is completely down for everyone in my area.",
    expected: { category: "bug_report", severity: "critical", tags: ["app_crash"], productArea: "payments", confidence: 0.9, likelyNetwork: false },
    metadata: { language: "en", notes: "critical — total outage signal" },
  },

  // English — operational complaints
  {
    input: "The lottery results are taking way too long to load today. Been waiting 15 minutes.",
    expected: { category: "operational_complaint", severity: "medium", tags: ["lottery_results"], productArea: "lottery", confidence: 0.8, likelyNetwork: false },
    metadata: { language: "en" },
  },
  {
    input: "Transfer is slower than usual this afternoon.",
    expected: { category: "operational_complaint", severity: "medium", tags: [], productArea: "payments", confidence: 0.75, likelyNetwork: false },
    metadata: { language: "en" },
  },

  // English — feature requests
  {
    input: "It would be nice if the app had a dark mode option for evening use.",
    expected: { category: "feature_request", severity: "low", tags: [], productArea: "mobile_app", confidence: 0.9, likelyNetwork: false },
    metadata: { language: "en" },
  },
  {
    input: "You should add fingerprint login, typing my password is annoying.",
    expected: { category: "feature_request", severity: "low", tags: [], productArea: "mobile_app", confidence: 0.85, likelyNetwork: false },
    metadata: { language: "en" },
  },

  // English — questions
  {
    input: "How do I change my password?",
    expected: { category: "question", severity: "low", tags: [], productArea: "account", confidence: 0.9, likelyNetwork: false },
    metadata: { language: "en" },
  },
  {
    input: "What's the maximum amount I can transfer per day?",
    expected: { category: "question", severity: "low", tags: [], productArea: "payments", confidence: 0.9, likelyNetwork: false },
    metadata: { language: "en" },
  },

  // English — connectivity flag
  {
    input: "App stuck on loading screen, my wifi is bad today.",
    expected: { category: "operational_complaint", severity: "medium", tags: ["connectivity"], productArea: "mobile_app", confidence: 0.8, likelyNetwork: true },
    metadata: { language: "en", notes: "should set likelyNetwork=true" },
  },
  {
    input: "Cannot connect to the service, signal keeps dropping in my neighborhood.",
    expected: { category: "operational_complaint", severity: "medium", tags: ["connectivity"], productArea: "mobile_app", confidence: 0.8, likelyNetwork: true },
    metadata: { language: "en", notes: "connectivity-driven" },
  },

  // Haitian Creole
  {
    input: "Aplikasyon an pa louvri ditou.",
    expected: { category: "bug_report", severity: "high", tags: ["app_crash"], productArea: "mobile_app", confidence: 0.8, likelyNetwork: false },
    metadata: { language: "ht", notes: "the app won't open at all" },
  },
  {
    input: "Mwen pa ka voye lajan an, li ban m yon erè.",
    expected: { category: "bug_report", severity: "high", tags: [], productArea: "payments", confidence: 0.8, likelyNetwork: false },
    metadata: { language: "ht", notes: "can't send the money, it gives me an error" },
  },
  {
    input: "Konbyen tan li pran pou yon transfè rive?",
    expected: { category: "question", severity: "low", tags: [], productArea: "payments", confidence: 0.85, likelyNetwork: false },
    metadata: { language: "ht", notes: "how long does a transfer take to arrive" },
  },
  {
    input: "Entènèt la pa bon, aplikasyon an blòke.",
    expected: { category: "operational_complaint", severity: "medium", tags: ["connectivity"], productArea: "mobile_app", confidence: 0.8, likelyNetwork: true },
    metadata: { language: "ht", notes: "internet is bad, app is stuck" },
  },

  // French
  {
    input: "L'application plante chaque fois que j'essaie d'envoyer de l'argent.",
    expected: { category: "bug_report", severity: "high", tags: ["app_crash"], productArea: "payments", confidence: 0.85, likelyNetwork: false },
    metadata: { language: "fr", notes: "the app crashes every time I try to send money" },
  },
  {
    input: "Comment puis-je changer mon mot de passe?",
    expected: { category: "question", severity: "low", tags: [], productArea: "account", confidence: 0.9, likelyNetwork: false },
    metadata: { language: "fr", notes: "how do I change my password" },
  },
  {
    input: "Le tirage de la loterie d'aujourd'hui est très en retard.",
    expected: { category: "operational_complaint", severity: "medium", tags: ["lottery_results"], productArea: "lottery", confidence: 0.8, likelyNetwork: false },
    metadata: { language: "fr", notes: "today's lottery draw is very late" },
  },

  // Spanish
  {
    input: "La aplicación se cierra sola cuando intento hacer un pago.",
    expected: { category: "bug_report", severity: "high", tags: ["app_crash"], productArea: "payments", confidence: 0.85, likelyNetwork: false },
    metadata: { language: "es", notes: "the app closes by itself when I try to make a payment" },
  },
  {
    input: "¿Cómo puedo recuperar mi contraseña?",
    expected: { category: "question", severity: "low", tags: [], productArea: "account", confidence: 0.9, likelyNetwork: false },
    metadata: { language: "es", notes: "how do I recover my password" },
  },
  {
    input: "Sería genial poder ver el historial de transacciones más fácilmente.",
    expected: { category: "feature_request", severity: "low", tags: [], productArea: "payments", confidence: 0.85, likelyNetwork: false },
    metadata: { language: "es", notes: "it would be great to see transaction history more easily" },
  },
];
