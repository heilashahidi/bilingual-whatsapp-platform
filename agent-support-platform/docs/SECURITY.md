# Security & Compliance

This document is the threat model and control inventory for the Nclusion Field Agent Support platform. It is a living document — when an assumption here changes (new data flow, new vendor, new jurisdiction), this file must change with it. Reviewers should hold PRs to the bar this document sets.

## 1. Why this document exists

The platform sits inside a fintech business. Field agents in Haiti, the Dominican Republic, and the DRC report problems that frequently touch money: failed transactions, balance discrepancies, missing payouts, hardware failures at branches that process customer deposits and withdrawals. Their messages routinely contain transaction IDs, amounts, customer phone numbers, and sometimes — incorrectly but inevitably — full account or card details pasted in a moment of frustration.

Two threats follow directly from that:

1. **Regulatory and reputational** — if the platform leaks customer PII or financial identifiers, the business is exposed under Haiti BRH, DR Superintendencia de Bancos, and DRC BCC supervision, plus US data-protection norms our enterprise buyers will demand on diligence.
2. **Operational** — WhatsApp is the single most-abused channel for financial scams in the region. Impersonation of agents, of management, and of the support line itself is the default attack pattern. The platform is both a target and a potential amplifier.

Everything below is shaped by those two facts.

## 2. Data classification

| Class | What it includes | Where it lives | Handling rule |
|---|---|---|---|
| **P0 — Restricted financial** | Full PAN, full bank account number, OTP, password reset code, government ID number | Should never enter the system. If it does (agent pastes it into a message), it must be redacted on ingestion before persistence and before any LLM call. | Reject from logs entirely. Redact from `Message.originalText` and `Message.translatedText` on write. Alert ops. |
| **P1 — PII** | Agent name, agent phone number, customer phone number, branch name, geo (lat/long), profile name, internal user email | `Agent`, `Branch`, `InternalUser`, `Message.originalText`/`translatedText` (when mentioned) | Field-level encryption for phone numbers at rest (planned). Access logged via `Event`. Never sent to third parties without contractual cover (DPA in place). |
| **P2 — Confidential operational** | Ticket content, message content, internal `Note`s, `Incident` root-cause notes, KB drafts | `Ticket`, `Message`, `Note`, `Incident`, `KnowledgeArticle` | Encrypted at rest (Neon-managed) and in transit. Internal RBAC enforced. LLM calls allowed *after* P0 redaction. |
| **P3 — Internal** | Categorization metadata, severity, SLA timers, classification JSON, `ConnectivityLog`, derived metrics | All tables | Standard access controls. Safe for aggregate analytics. |
| **P4 — Public** | Decision tree templates, KB articles in `active` status (after human approval scrubs sensitive specifics), public documentation | `DecisionTree`, `KnowledgeArticle (status=active)` | KB approval flow must explicitly check that no P0/P1 leaked into the draft before publishing. |

The most important boundary is **P0 must not exist in the system**. The second-most-important is **P1/P2 must not leave the system to third parties without DPA cover and data minimization**.

## 3. Threat model

### 3.1 Actors

| Actor | Capability | Motivation |
|---|---|---|
| Legitimate field agent | Sends WhatsApp messages from a known number | Get a real issue resolved |
| Compromised field agent account | Same as above, but attacker controls the WhatsApp account (SIM swap, stolen device, leaked credentials at the carrier) | Extract intel about ops processes, escalate fake incidents to trigger compensating transactions, harvest customer PII from prior tickets |
| Scammer with unrelated number | Can send messages to the inbound number from any WhatsApp account | Impersonate an agent, social-engineer a support response, get money sent to a wrong destination |
| Phishing operator impersonating *us* outbound | Cannot send via our platform, but can register a lookalike WhatsApp number and DM agents directly | Trick agents into giving up customer info, OTPs, or moving funds |
| Insider — operations user | Logged-in dashboard user with `support`/`operations` role | Curiosity browsing, data exfiltration, deliberate fraud assistance |
| Insider — admin | Full dashboard + database access | Same as above, larger blast radius |
| External attacker — web | Network-level access to public endpoints, dashboard, API | Account takeover via OAuth misconfig, JWT forgery, webhook spoofing |
| External attacker — supply chain | Compromised npm dependency, compromised Twilio account, compromised Anthropic credentials | Pivot through our infrastructure |
| Anthropic / Twilio / Neon / Upstash / Slack / Google | Vendors with contractual access to data we send them | Vendor-side incident, subpoena, unauthorized employee access |

### 3.2 Critical assets

1. **Customer money** — never directly held by this platform, but operationally adjacent. The platform's blast radius into customer money is *indirect*: misleading information or fraudulent escalations can cause ops to take a compensating action that moves real funds.
2. **Customer PII** — leaks via tickets, messages, KB articles, or logs.
3. **Agent identity** — the trust assumption that the phone number maps to a known person at a known branch. Once this is wrong, every downstream control degrades.
4. **Operator credentials** — Google OAuth + NextAuth JWT. Compromise = full dashboard read/write.
5. **Vendor credentials** — Twilio account SID + auth token, Anthropic API key, Neon connection string, Slack webhook URL. Compromise = inbound spoofing, message exfiltration, or financial cost.

### 3.3 Top threat scenarios

| # | Scenario | Likelihood | Impact | Status |
|---|---|---|---|---|
| T1 | Scammer sends to inbound number from an unregistered WhatsApp account; pipeline auto-creates an `Agent` row and routes the message to a real operator who responds in good faith | **High** — the inbound pipeline auto-registers agents on first message today | High — fraudulent intel about our ops, phishing surface | **Open** — see §5.1 |
| T2 | Compromised agent account (SIM swap) submits a fake "transaction reversal needed" ticket; operator follows the playbook and triggers a compensating payment | Medium | Critical — direct money loss | **Partial** — depends on out-of-band verification at the ops step |
| T3 | Agent pastes customer card number or OTP into a message; full PAN/OTP is sent to Anthropic for translation and persisted in `Message.originalText`; later surfaces in KB draft | Medium | High — vendor exposure, KB pollution, log leakage | **Open** — see §5.2 |
| T4 | Lookalike WhatsApp number registered with similar profile name DMs agents claiming to be "support"; harvests OTPs | High | Critical — we cannot prevent this *on WhatsApp*, but we can train agents and reduce confusion | **Open** — see §5.5 |
| T5 | Twilio signing secret leaks via committed `.env` or compromised CI; attacker forges signed webhooks | Low | Critical — full inbound spoofing | **Partial** — secret is env-only; needs secrets-manager migration |
| T6 | NextAuth `NEXTAUTH_SECRET` leaks; attacker forges admin JWT | Low | Critical — full dashboard takeover | **Partial** — HS256 shared secret amplifies blast radius; RS256 + JWKS planned |
| T7 | Insider operator browses tickets for a specific customer name without operational reason | Medium | Medium — privacy violation, regulatory exposure | **Partial** — `Event` audit log exists but does not yet capture *reads* |
| T8 | Slack webhook URL leaks; attacker posts fake "incident resolved" messages to ops channels | Low | Medium — confusion, slowed response | **Open** |
| T9 | Auto-intake checklist or operator reply is sent to a *spoofed* From number because dedup keyed only on `whatsappMessageId`, not From-vs-Agent identity verification | Medium | Medium | **Open** — overlaps with T1 |
| T10 | KB article auto-drafted from a resolved ticket containing a real customer name + amount is promoted to `active` and surfaced to other agents | Medium | High — privacy violation across customer set | **Partial** — human approval gate exists; needs explicit scrub checklist |

## 4. Controls in place

### 4.1 Network and transport

- TLS terminated by Railway / load balancer for all public endpoints (dashboard, API, webhooks).
- Database (Neon) and Redis (Upstash) connections are TLS-only via provider defaults.

### 4.2 Identity and access

- Dashboard auth via NextAuth + Google OAuth. Only `@<workspace>` Google accounts allowed.
- API verifies a NextAuth-issued JWT (HS256) using the shared `NEXTAUTH_SECRET`. `requireRole(...)` middleware enforces RBAC on mutating routes — see `docs/API.md`.
- Roles: `admin`, `engineering`, `operations`, `support`. `support` cannot delete tickets; `operations` cannot bulk-modify settings.
- `senderId` on outbound message creation is derived from the authenticated session — body values are ignored. This is enforced at the route handler.

### 4.3 Webhook integrity

- `POST /webhooks/whatsapp` and `POST /webhooks/whatsapp/status` validate `x-twilio-signature` against `TWILIO_AUTH_TOKEN`. Failed signature → reject before pipeline entry.
- `whatsappMessageId` unique constraint on `Message` provides idempotency against Twilio webhook retries.

### 4.4 Data at rest

- Neon Postgres: at-rest encryption via the managed provider.
- Upstash Redis: at-rest encryption via the managed provider.
- Media (S3/GCS planned): server-side encryption when implemented.

### 4.5 Audit

- `Event` table captures ticket state changes, severity changes, assignment changes, incident lifecycle transitions, append-only by convention.
- Note: **reads are not yet captured**. See §5.6.

### 4.6 LLM trust boundary

- `USE_REAL_TRANSLATION` and `USE_REAL_CLASSIFICATION` env-gated. Stub mode for local development means no PII leaves the dev environment by default.
- Anthropic API key is env-only; never logged.
- Claude responses are parsed with explicit JSON schemas and fall back to safe defaults (`other` / `medium`) on parse failure rather than trusting freeform output.

### 4.7 Resilience as a security control

- BullMQ retries with exponential backoff prevent transient failures from being mistaken for tampering.
- 10s Twilio timeout caps the blast radius of a slow or hung downstream.
- Graceful degradation to inline send if Redis is unhealthy keeps the platform working without disabling controls.

## 5. Open gaps and planned controls

This is the working list. Each item has an owner field; fill in during PR scoping.

### 5.1 Inbound sender verification (T1, T9)

**Problem.** The inbound pipeline auto-creates an `Agent` row on first message from an unknown number. This means any WhatsApp account can become a registered agent simply by messaging the support number. From that point, the message looks indistinguishable from a legitimate agent in the dashboard.

**Control.** Auto-creation is replaced with auto-quarantine. Unknown `From` numbers create a `PendingAgent` row instead of an `Agent`, and their messages land in a separate `quarantined` ticket queue visible only to admin. An ops user must explicitly confirm the agent's identity (cross-checked against the operations roster) before the agent is promoted and the messages enter the normal flow.

**Implementation notes.**
- Add `Agent.verifiedAt` timestamp. Existing rows backfilled with `NOW()` since they predate this control.
- New table `PendingAgent` mirrors `Agent`'s phone/profile fields plus `firstMessageId`, `quarantineReason`.
- Inbound pipeline branches at step 2 of the §3.5 message lifecycle.
- Dashboard adds a "Quarantine" tab under `/agents` with promote/reject actions.

### 5.2 PII redaction before LLM calls (T3, T10)

**Problem.** Every inbound message is sent to Anthropic for translation (and optionally classification). Operator-drafted replies hit Anthropic for translation. Resolved tickets hit Anthropic for KB drafting. Incident clusters hit Anthropic for summarization. If a customer's account number, OTP, or full card details are in the original text, those values leave the system.

**Control.** A redaction pass runs before any outbound Anthropic call. Patterns:
- Card-number-shaped digit runs (Luhn-verified) → `[REDACTED_CARD]`.
- Account-number-shaped runs (configurable per country bank format) → `[REDACTED_ACCOUNT]`.
- 4–8 digit codes immediately following keywords like "code", "OTP", "pin", "kòd" (Creole), "código" (Spanish) → `[REDACTED_OTP]`.
- E.164-shaped phone numbers that don't match a known agent → `[REDACTED_PHONE]` (agent's own number is preserved so translation context isn't lost).

**Storage policy.** The redacted form is what's sent to Anthropic. The original form is what's persisted in `Message.originalText`, encrypted at rest. The translated text in `Message.translatedText` is the un-translated `[REDACTED_*]` token plus the rest of the translated content.

**Logging.** Each redaction event is logged to `Event` with the kind of value redacted (not the value itself) and the message ID. This gives us a queryable surface for "how often are agents pasting cards" without persisting the value.

**Implementation notes.**
- New module `apps/api/src/services/pii-redactor.ts`.
- Called from `translate-message.ts`, `classify-message.ts`, `suggest-replies.ts`, `kb-drafter.ts`, `incident-summarizer.ts`.
- Test fixture covers all four languages.

### 5.3 Read audit logging (T7)

**Problem.** `Event` captures writes but not reads. We can answer "who changed this ticket's severity" but not "who looked at this customer's ticket." Regulators in fintech contexts expect both.

**Control.** Add a thin middleware that emits a `ticket.viewed` / `agent.viewed` event when a dashboard page loads a record. Throttle to one event per (user, record) per 5 minutes to avoid log explosion on refreshes.

### 5.4 Scam pattern classifier signal (T1, T2)

**Problem.** Some inbound messages have scam fingerprints — urgency + payment redirect, "send me the OTP", impersonation of management, off-channel asks. Today the classifier flags `category` and `severity` only.

**Control.** Add a `socialEngineeringRisk: low | medium | high` field to the classifier output. High-risk messages route to a dedicated review queue regardless of category, and the dashboard renders a prominent warning banner on the ticket.

**Implementation notes.**
- Extend the classifier prompt with explicit examples in all four languages — scam playbooks differ by region.
- Add `Ticket.socialEngineeringRisk` column with index.
- Notification rule: `socialEngineeringRisk = high` → Slack `#agent-security` with operator name and ticket link.

### 5.5 Agent-side scam awareness (T4)

**Problem.** We cannot prevent a scammer from registering a lookalike WhatsApp number and DMing agents. We can reduce confusion.

**Control.**
- Operator-initiated outbound messages (`POST /api/tickets/outreach`) include a short, consistent footer in the agent's language: "Official Nclusion support — verify our number ends in [XXXX]. We will never ask for your password or OTP."
- A first-message onboarding flow when an agent is verified (§5.1) sends a one-page scam-awareness card.
- The bot, on detection of escalation phrases like "send code" or "give me OTP," responds with an explicit refusal and a reminder of what real support will and won't do.

### 5.6 Secrets management (T5, T6)

**Problem.** `NEXTAUTH_SECRET`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and Slack webhook URLs are env vars in Railway today. Rotation is manual; access scoping is per-team-member-credential.

**Control.** Migrate to a secrets manager (Doppler, AWS Secrets Manager, or 1Password Service Accounts depending on the rest of the infra). Document rotation cadence per secret. Add a quarterly rotation reminder.

### 5.7 JWT signing strategy (T6)

**Problem.** HS256 with a shared `NEXTAUTH_SECRET` means dashboard and API share the same symmetric key. Compromise of either compromises both.

**Control.** Migrate to RS256: dashboard signs, API verifies via JWKS endpoint. Dashboard can be redeployed with a new key without coordinating API config rollout.

**Caveat.** Not urgent. Acceptable for pilot. Required before SOC 2 Type II audit window.

### 5.8 KB article approval scrub checklist (T10)

**Problem.** The KB approval flow is a single Approve button. The approver may not check for embedded customer names or amounts in the draft.

**Control.** The approval dialog renders a forced checklist:
- [ ] No customer name appears in the article
- [ ] No specific account number, transaction ID, or amount appears
- [ ] The resolution generalizes the problem rather than describing a single case

Approve button is disabled until all boxes are checked.

### 5.9 Outbound rate limiting and abuse caps

**Problem.** A compromised operator account or a bug in our own code could trigger mass outbound — either spamming agents or attempting to reach numbers that aren't ours.

**Control.** Per-operator rate limit (e.g., 100 outbound messages per hour). Daily global outbound cap with admin-only override. Recipient phone number must match a verified `Agent` for non-broadcast routes — outbound to arbitrary numbers requires explicit admin role and is logged.

### 5.10 Backup and restore drill

**Problem.** Neon provides point-in-time recovery, but we have not exercised it.

**Control.** Quarterly restore drill: spin up a recovery copy from yesterday's snapshot, query a known row, document the result. SOC 2 will ask for this.

## 6. Compliance posture

We are not formally certified against any framework. The realistic short-term posture is:

- **SOC 2 Type II** as the operational anchor — most B2B fintech buyers will ask. Mapping each control in §4 and §5 to a SOC 2 trust-services-criteria entry is tractable in a quarter of focused work. This is the recommended primary target.
- **PCI DSS** is *only* applicable if PAN ever transits the platform. The redaction in §5.2 should make this never the case; the platform is then "PCI out-of-scope by design." This must be enforceable, not aspirational — see §5.2.
- **Local financial regulation.**
  - **Haiti — BRH.** Data residency and reporting requirements for entities supporting financial intermediaries. Consult counsel before pilot expansion.
  - **DR — Superintendencia de Bancos.** Cybersecurity normative framework imposes incident-reporting timelines. Our incident-response runbook (§7) must include the regulator notification path.
  - **DRC — BCC.** Cyber-risk reporting circulars apply to financial intermediaries; the platform's status as a vendor likely flows through the client's obligations.
- **Privacy.** No GDPR exposure unless EU data subjects appear. Haiti and the DR have constitutional and statutory privacy protections; DRC has Law No. 20/017 on telecommunications and digital data. Right-to-erasure flows are not built; we should add them before any consumer-facing surface ships.
- **Vendor risk.** DPAs needed and on file for: Twilio, Anthropic, Neon, Upstash, Google (OAuth), Slack. Track DPA status in a vendor risk register; review annually.

## 7. Incident response

A security incident is any event that compromises the confidentiality, integrity, or availability of P1 or P2 data, or that suggests an actor has taken an action they were not authorized to take.

### 7.1 Detection sources

- Dashboard anomaly: bulk reads, unusual export volume, role-elevation event in `Event` log.
- Slack alert on `socialEngineeringRisk = high` (§5.4).
- Twilio signature failures spike (potential webhook spoofing).
- Anthropic API usage spike (potential credential leak).
- Vendor-reported breach notification.

### 7.2 Response steps

1. **Triage.** On-call engineer assesses scope. Time-box: 30 minutes to first determination.
2. **Contain.** Rotate the affected credential immediately if applicable. Revoke suspected user sessions. Block compromised inbound numbers (see §5.1 quarantine).
3. **Preserve.** Snapshot the database; export the relevant `Event` rows; pull Railway logs.
4. **Notify.**
   - Internal: ops lead + engineering manager via PagerDuty + Slack `#agent-security`.
   - Regulator: per jurisdictional reporting timelines (DR requires notification within tight windows; verify with counsel).
   - Customers: only after legal sign-off.
   - Vendors: if a vendor-side issue, open a P1 ticket with the vendor.
5. **Eradicate and recover.** Apply the fix. Verify with the audit log that no further unauthorized activity is happening.
6. **Post-incident review.** Within 5 business days. Output: a write-up matching the format of resolved incidents in `docs/RUNBOOKS.md`. Update this document with any new control derived from the incident.

### 7.3 Specific runbooks needed

- Compromised agent WhatsApp account (SIM swap pattern).
- Leaked operator credential.
- Leaked Anthropic / Twilio / Slack credential.
- Suspected fraud-by-impersonation (T2).
- Subpoena or law-enforcement request for agent or customer data.

These should live in `docs/RUNBOOKS.md` alongside the operational runbooks; they are referenced from here.

## 8. Reviewer checklist

Use this checklist when reviewing any PR that touches:
- Inbound or outbound message handling
- LLM calls
- Authentication or authorization
- Database migrations
- Webhook routes
- Logging or audit code

- [ ] Does the change preserve sender-verification semantics (§5.1)?
- [ ] If the change adds an LLM call, does it route through the redaction layer (§5.2)?
- [ ] If the change adds a new data field, has it been classified per §2 and have appropriate handling rules been applied?
- [ ] Are new mutating routes guarded by `requireRole(...)` with the minimum necessary role?
- [ ] Are new events logged to `Event` in a way that lets us answer "who did this" later?
- [ ] Are any new secrets stored via the secrets manager (§5.6), not committed and not in a plain `.env`?
- [ ] If the change touches the KB approval flow, does it preserve the scrub checklist (§5.8)?
- [ ] If the change touches outbound recipient selection, does it preserve the verified-agent-only rule (§5.9)?

## 9. Document maintenance

This file is reviewed quarterly. The reviewer signs off in git history. Items in §5 are tracked in the repo's issue tracker with the `security` label and linked here when closed.
