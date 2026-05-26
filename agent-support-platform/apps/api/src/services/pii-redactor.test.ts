import { describe, it, expect } from "vitest";
import { redactPII, redactText } from "./pii-redactor";

describe("redactPII — card numbers (Luhn-verified)", () => {
  it("redacts a bare 16-digit Visa test number", () => {
    const r = redactPII("My card is 4111111111111111 please help");
    expect(r.text).toBe("My card is [REDACTED_CARD] please help");
    expect(r.redactions.card).toBe(1);
  });

  it("redacts a card with spaces", () => {
    const r = redactPII("4111 1111 1111 1111");
    expect(r.text).toBe("[REDACTED_CARD]");
    expect(r.redactions.card).toBe(1);
  });

  it("redacts a card with dashes", () => {
    const r = redactPII("4111-1111-1111-1111");
    expect(r.text).toBe("[REDACTED_CARD]");
    expect(r.redactions.card).toBe(1);
  });

  it("does NOT redact a 16-digit string that fails Luhn", () => {
    // 16 digits but not a valid card number — should pass through as account
    // sweep instead (8–20 digits qualifies). The point of this test is to
    // confirm card detection requires Luhn, not just shape.
    const r = redactPII("ID number 1234567890123456");
    expect(r.redactions.card).toBe(0);
    // Falls into the bare-account sweep instead.
    expect(r.text).toContain("[REDACTED_ACCOUNT]");
  });

  it("redacts an Amex-format 15-digit card", () => {
    // 378282246310005 is a published Amex test number (Luhn-valid).
    const r = redactPII("Amex: 378282246310005");
    expect(r.text).toBe("Amex: [REDACTED_CARD]");
    expect(r.redactions.card).toBe(1);
  });

  it("redacts multiple cards in one message", () => {
    const r = redactPII("4111111111111111 and 5500000000000004");
    expect(r.redactions.card).toBe(2);
    expect(r.text).toBe("[REDACTED_CARD] and [REDACTED_CARD]");
  });
});

describe("redactPII — OTPs (multilingual)", () => {
  it("redacts an English 'code 123456'", () => {
    const r = redactPII("Your code 123456 has been used");
    expect(r.text).toBe("Your code [REDACTED_OTP] has been used");
    expect(r.redactions.otp).toBe(1);
  });

  it("redacts an Haitian Creole 'kòd 482931'", () => {
    const r = redactPII("Voye kòd 482931 ban mwen");
    expect(r.text).toContain("[REDACTED_OTP]");
    expect(r.redactions.otp).toBe(1);
  });

  it("redacts a Spanish 'código: 7777'", () => {
    const r = redactPII("Mi código: 7777 no funciona");
    expect(r.text).toContain("[REDACTED_OTP]");
    expect(r.redactions.otp).toBe(1);
  });

  it("redacts a French 'mot de passe 555111'", () => {
    const r = redactPII("Le mot de passe 555111 ne marche pas");
    expect(r.text).toContain("[REDACTED_OTP]");
    expect(r.redactions.otp).toBe(1);
  });

  it("redacts 'OTP 4848'", () => {
    const r = redactPII("OTP 4848 received");
    expect(r.text).toBe("OTP [REDACTED_OTP] received");
  });

  it("does NOT redact 'code' followed by non-digit text", () => {
    const r = redactPII("There is a code review pending");
    expect(r.redactions.otp).toBe(0);
    expect(r.text).toBe("There is a code review pending");
  });

  it("does NOT redact 4-digit numbers without a preceding OTP keyword", () => {
    const r = redactPII("Last 4 digits 1234 of my card");
    expect(r.redactions.otp).toBe(0);
  });
});

describe("redactPII — phone numbers (E.164)", () => {
  it("redacts a standalone E.164 number", () => {
    const r = redactPII("Call me on +50937001001 thanks");
    expect(r.text).toBe("Call me on [REDACTED_PHONE] thanks");
    expect(r.redactions.phone).toBe(1);
  });

  it("preserves the agent's own number when preservePhone is supplied", () => {
    const r = redactPII("This is from +50937001001", {
      preservePhone: "+50937001001",
    });
    expect(r.text).toContain("+50937001001");
    expect(r.redactions.phone).toBe(0);
  });

  it("redacts a different E.164 number even when preservePhone matches another", () => {
    const r = redactPII("Forward to +18091234567 not me", {
      preservePhone: "+50937001001",
    });
    expect(r.text).toContain("[REDACTED_PHONE]");
    expect(r.redactions.phone).toBe(1);
  });

  it("does NOT redact bare digit sequences without the + prefix as phones", () => {
    // 8-digit run without + falls through to account sweep, not phone.
    const r = redactPII("number 50937001 here");
    expect(r.redactions.phone).toBe(0);
  });
});

describe("redactPII — emails", () => {
  it("redacts a standard email", () => {
    const r = redactPII("Reach me at customer@example.com today");
    expect(r.text).toBe("Reach me at [REDACTED_EMAIL] today");
    expect(r.redactions.email).toBe(1);
  });

  it("redacts multiple emails", () => {
    const r = redactPII("a@b.io and c@d.org");
    expect(r.redactions.email).toBe(2);
  });
});

describe("redactPII — account numbers (bare digit runs)", () => {
  it("redacts an 8-digit run", () => {
    const r = redactPII("Account 12345678 has issues");
    expect(r.text).toBe("Account [REDACTED_ACCOUNT] has issues");
    expect(r.redactions.account).toBe(1);
  });

  it("does NOT redact short digit runs (under 8 digits)", () => {
    const r = redactPII("Ticket #1234 reference");
    expect(r.redactions.account).toBe(0);
    expect(r.text).toBe("Ticket #1234 reference");
  });

  it("does NOT redact digits inside larger words/identifiers", () => {
    // "MSGID12345" is 5 digits attached to letters — should not match.
    const r = redactPII("Trace MSGID12345 in logs");
    expect(r.redactions.account).toBe(0);
  });

  it("does NOT double-match digits already turned into [REDACTED_CARD]", () => {
    // 16-digit card. Verifies pass ordering — card sweep runs before
    // account sweep and the placeholder has no digits.
    const r = redactPII("Card 4111111111111111 only please");
    expect(r.redactions.card).toBe(1);
    expect(r.redactions.account).toBe(0);
  });
});

describe("redactPII — combined inputs", () => {
  it("handles a message with multiple PII types", () => {
    const r = redactPII(
      "Hi I am stuck. Card 4111111111111111, code 123456, " +
        "call +50937001002 or email me@example.com — acct 99887766"
    );
    expect(r.redactions.card).toBe(1);
    expect(r.redactions.otp).toBe(1);
    expect(r.redactions.phone).toBe(1);
    expect(r.redactions.email).toBe(1);
    expect(r.redactions.account).toBe(1);
    expect(r.hadAny).toBe(true);
  });

  it("returns hadAny=false when nothing matched", () => {
    const r = redactPII("Just a normal message about my problem.");
    expect(r.hadAny).toBe(false);
    expect(r.text).toBe("Just a normal message about my problem.");
  });

  it("returns the input unchanged for empty / null-ish inputs", () => {
    expect(redactPII("").text).toBe("");
    expect(redactPII("").hadAny).toBe(false);
  });
});

describe("redactText — convenience wrapper", () => {
  it("returns just the redacted text string", () => {
    expect(redactText("call +18091234567")).toBe("call [REDACTED_PHONE]");
  });
});
