# Runbooks

Operational playbooks for common incidents and issues. Each runbook follows the format: symptoms → diagnosis → resolution → prevention.

## Table of Contents

1. [No Messages Arriving from a Region](#1-no-messages-arriving-from-a-region)
2. [Mass SLA Breaches](#2-mass-sla-breaches)
3. [Translation Service Down](#3-translation-service-down)
4. [Classification Returning Wrong Categories](#4-classification-returning-wrong-categories)
5. [WhatsApp Outbound Messages Failing](#5-whatsapp-outbound-messages-failing)
6. [Bot Giving Wrong Advice](#6-bot-giving-wrong-advice)
7. [Incident False Positive — Unlinking Tickets](#7-incident-false-positive--unlinking-tickets)
8. [Knowledge Base Article With Low Success Rate](#8-knowledge-base-article-with-low-success-rate)
9. [Database Performance Degradation](#9-database-performance-degradation)
10. [Webhook Endpoint Returning Errors](#10-webhook-endpoint-returning-errors)

---

## 1. No Messages Arriving from a Region

### Symptoms
- The dashboard shows no new tickets from a specific country or region for 30+ minutes during business hours.
- The connectivity monitor fires a "silence detected" alert.
- Agent connectivity statuses in the region are showing "offline."

### Diagnosis

**Is it our system or the network?**

Check in this order:

1. **Check the webhook endpoint:** Is the API server healthy? `curl https://api.yourdomain.com/health`. If this fails, the problem is our infrastructure → go to Runbook #10.

2. **Check Twilio:** Log into the Twilio Console → Monitor → Logs → Errors. If Twilio is experiencing issues, there will be error entries. Also check [Twilio Status](https://status.twilio.com/).

3. **Check WhatsApp:** If Twilio is fine and our server is fine, WhatsApp or the local mobile network may be down. Check [Down Detector for WhatsApp](https://downdetector.com/status/whatsapp/). Ask a contact in the region to send a test message.

4. **Check the queue:** Are messages arriving at the webhook but getting stuck in the processing queue? Check BullMQ dashboard or Redis queue depth. If the queue is growing, a worker may have crashed.

### Resolution

- **Our infrastructure down:** Restart the affected service. Check logs for the root cause.
- **Twilio issue:** Wait for Twilio to resolve. Outbound messages will queue and send when service resumes.
- **Regional network outage:** This is expected, especially in Haiti. Ensure SLA clocks are paused for the region (the connectivity monitor should do this automatically). Notify the ops team via Slack that a regional outage is in progress. When messages resume, they'll arrive in a burst — the system handles this using agent timestamps.

### Prevention
- The connectivity monitor should catch silence within 45 minutes. Ensure the worker is running and Slack alerts are configured.

---

## 2. Mass SLA Breaches

### Symptoms
- Multiple tickets show SLA breached (red indicators on dashboard).
- Concentrated in one country or region.

### Diagnosis

1. **Is it a connectivity outage?** Check if the affected tickets are from Haiti/DRC and if the connectivity monitor detected an outage. If the SLA auto-pause didn't trigger, it may be a monitoring gap.

2. **Is the team understaffed?** If SLAs are breaching across all countries, the volume may have exceeded team capacity. Check ticket volume on the analytics dashboard.

3. **Was a batch of tickets mis-classified?** If tickets were classified as `low` severity but should have been `critical`, the SLA windows were too generous. Check recent reclassification activity.

### Resolution

- **Connectivity outage without auto-pause:** Manually pause SLA clocks for the affected region via admin settings. Fix the monitoring gap.
- **Volume spike:** Triage and prioritize. Assign tickets in bulk. Consider if the spike is related to an incident (check clustering).
- **Misclassification:** Reclassify affected tickets. Update the classification prompt with examples of the misclassified pattern.

---

## 3. Translation Service Down

### Symptoms
- New tickets show original text with `translatedText` equal to the original (or null).
- Translation confidence shows as null or 0.
- API logs show Anthropic API errors (401, 429, 5xx) from `integrations/translation.ts`.

### Diagnosis

1. Check the [Anthropic status page](https://status.anthropic.com/).
2. Check the Railway API logs for the specific Anthropic error code.
3. Check usage on the Anthropic console — rate limits or quota exhaustion produce 429s.
4. Confirm `ANTHROPIC_API_KEY` is still set in the Railway API service env vars (a missing key causes silent fallback to the stub).

### Resolution

- **API outage:** The translation call is fail-silent — tickets are still created with the original text, `translatedText` falls back to the input, and the dashboard's bilingual toggle still works. Operators can read the original until Anthropic is back.
- **Key rotated / revoked:** Rotate `ANTHROPIC_API_KEY` in the Railway API service variables. Railway will restart the service automatically.
- **Rate-limited:** the same key powers all five Claude surfaces (translation, classification, reply drafts, incident summaries, KB drafts). Request a quota bump if this happens regularly. Translation + classification run in parallel in the pipeline, so one rate-limit hit takes both down for that message — they share back-off semantics.

**Do not block ticket creation on translation failure.** Tickets are still created with the original text. The fail-silent path is intentional.

---

## 4. Classification Returning Wrong Categories

### Symptoms
- The US team is frequently reclassifying tickets.
- A specific type of message is consistently landing in the wrong category.
- The reclassification log shows a pattern.

### Diagnosis

1. Pull the last 50 reclassifications from the database. Look for patterns — is a specific phrase or issue type being misclassified?
2. Check the classification prompt in `integrations/classification.ts`. Is the problematic pattern covered in the examples?
3. Check if the LLM API is returning low confidence scores on the misclassified messages.

### Resolution

1. Add 2–3 examples of the misclassified pattern to the classification prompt's example section.
2. If a specific category definition is ambiguous, clarify it in the prompt.
3. Deploy the updated prompt.
4. Monitor reclassification rate over the next 48 hours to confirm improvement.

**Example:** Agents saying "lotterie a pa soti toujou" (lottery results haven't come out yet) was being classified as `bug_report` instead of `operational_complaint`. Adding this as an example in the prompt with the correct label fixed it.

---

## 5. WhatsApp Outbound Messages Failing

### Symptoms
- US team sends responses but agents don't receive them.
- Message delivery status stays "queued" or shows "failed."
- Twilio error logs show 4xx or 5xx errors.

### Diagnosis

1. **Check Twilio error codes:**
   - `21408` — permission denied (template not approved for non-sandbox).
   - `21610` — agent has opted out / blocked the number.
   - `63016` — rate limit exceeded.
   - `21211` — invalid phone number.

2. **Check if the sandbox session expired:** Twilio sandbox sessions expire after 72 hours of inactivity. The agent needs to rejoin the sandbox.

3. **Check rate limits:** If sending a broadcast to many agents, the egress worker may be hitting Twilio's per-second limit.

### Resolution

- **Sandbox expired:** Have the agent re-send the join code to the sandbox number. In production, this won't be an issue.
- **Rate limited:** The egress worker should already use exponential backoff. If broadcasts are too fast, increase the stagger interval in the config.
- **Invalid number:** Flag the agent's phone number for review. They may have changed numbers.

---

## 6. Bot Giving Wrong Advice

### Symptoms
- Agent reports that the bot's suggested fix made things worse.
- A knowledge base article has a declining success rate.
- The bot is suggesting resolutions from an outdated article.

### Diagnosis

1. Check which article or decision tree the bot used (visible in the `BotConversation` record).
2. Check the article's success rate on the KB manager dashboard.
3. Determine if the article is outdated (the underlying issue may have changed after a product update).

### Resolution

1. **Immediate:** Deactivate the article or decision tree in the dashboard (toggle `isActive` to false). The bot will stop using it immediately.
2. **Fix:** Update the article with the correct resolution, or archive it if the issue no longer applies.
3. **Post-mortem:** If the bad advice caused damage (e.g., agent lost data), escalate to engineering and create a ticket for the affected agent.

### Prevention
- Articles with success rate below 50% should be auto-flagged for review (the system does this).
- After any product update or deploy, review active KB articles for relevance.

---

## 7. Incident False Positive — Unlinking Tickets

### Symptoms
- The clustering engine created an incident, but the linked tickets are unrelated.
- Tickets from different issue types were grouped together.

### Diagnosis

The clustering engine may have matched on overly broad tags or a wide geographic window. Check the similarity scores on the linked tickets.

### Resolution

1. On the incident detail view, unlink the tickets that don't belong.
2. If the incident has fewer than 3 tickets after unlinking, consider closing it as a false positive.
3. If this pattern repeats, tighten the clustering thresholds in admin settings (increase the minimum similarity score or reduce the time window).

---

## 8. Knowledge Base Article With Low Success Rate

### Symptoms
- An article's success rate on the KB dashboard is below 50%.
- The bot presents the article but agents consistently escalate.

### Diagnosis

1. Read the article's resolution text. Is it still accurate?
2. Check the source tickets. Were they resolved correctly, or was the resolution coincidental?
3. Check if the problem description is too broad (matching tickets it shouldn't).

### Resolution

- **Outdated fix:** Update the resolution text, reset the success metrics.
- **Too broad:** Narrow the problem description and regenerate the embedding.
- **Unfixable:** Archive the article. It will stop appearing in suggestions.

---

## 9. Database Performance Degradation

### Symptoms
- Dashboard is slow to load.
- API response times increasing.
- Database CPU or connection count spiking.

### Diagnosis

1. Check slow query logs in Postgres / RDS Performance Insights.
2. Common culprits: full-table scans on the `tickets` or `messages` table, pgvector similarity searches without proper indexing, analytics queries running on the primary database.

### Resolution

- **Missing index:** Add the index identified in the slow query log. See `docs/DATA_MODEL.md` for recommended indexes.
- **Analytics queries on primary:** Route analytics queries to a read replica.
- **pgvector performance:** Ensure an IVFFlat or HNSW index exists on the `embedding` column for large article counts.
- **Connection exhaustion:** Increase Prisma connection pool size or add PgBouncer.

---

## 10. Webhook Endpoint Returning Errors

### Symptoms
- Twilio logs show repeated webhook failures (4xx/5xx responses).
- Messages are not being processed.

### Diagnosis

1. Check API server logs for errors at the `/webhooks/whatsapp` endpoint.
2. Check if the server is running (`curl /health`).
3. Check if ngrok is still active (development) or if the domain/SSL is valid (production).
4. Check if a code deploy broke the webhook handler.

### Resolution

- **Server crashed:** Restart. Check logs for the crash cause. Common: unhandled Promise rejection in the pipeline.
- **ngrok expired:** Restart ngrok and update the Twilio webhook URL.
- **Code bug:** Roll back to the previous deploy. The webhook handler should never throw — all processing is wrapped in try/catch with a guaranteed 200 response.

**Critical rule:** The webhook handler must always return 200, even if processing fails. Returning errors causes Twilio to retry, creating duplicate messages and compounding the problem.
