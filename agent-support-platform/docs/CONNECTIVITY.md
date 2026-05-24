# Haiti & DRC Connectivity Resilience

This document explains how the platform handles the connectivity challenges specific to Haiti and the Democratic Republic of Congo. These aren't edge cases — they affect the majority of the agent base and are woven throughout the architecture.

## The Reality on the Ground

Haiti has some of the lowest internet penetration and slowest average speeds in the Western Hemisphere. The DRC faces similar challenges outside major cities. Agents regularly deal with:

- **2G/EDGE connections** with effective speeds under 100 Kbps, particularly outside Port-au-Prince and Kinshasa.
- **Multi-hour power outages** daily in many regions. Agents charge phones opportunistically and may be offline for extended periods.
- **Intermittent connectivity** — connections drop mid-conversation and resume minutes or hours later.
- **Message queuing** — WhatsApp queues messages on the agent's phone when offline. When connectivity resumes, all queued messages deliver in a burst within seconds.

WhatsApp is the dominant platform precisely because it's optimized for these conditions. Our system must respect that optimization and never fight against it.

## The Dual-Timestamp Design

Every message in the system carries two timestamps:

| Field | Source | Description |
|---|---|---|
| `agentTimestamp` | WhatsApp payload | When the agent actually pressed send on their phone |
| `serverReceivedAt` | Our server clock | When the webhook arrived at our API |

The delta between these two values (`deliveryDelay`) is the foundational signal for everything connectivity-related. A message sent at 9:00 AM that arrives at 9:45 AM has a delivery delay of 2,700 seconds — that tells us the agent was offline or on a severely degraded connection.

**Canonical time rule:** Every component that involves time — SLA computation, incident clustering windows, bot session management, analytics timestamps — uses `agentTimestamp`, not `serverReceivedAt`. This single principle prevents a cascade of problems.

**Current limitation:** The Twilio WhatsApp Sandbox doesn't expose the original WhatsApp send timestamp in the webhook payload. In development, `agentTimestamp` equals `serverReceivedAt`. When migrating to Meta Cloud API or Twilio production, the real WhatsApp timestamp becomes available and the system starts tracking actual delivery delays.

## How Connectivity Affects Each Feature

### SLA Computation

| Severity | Standard SLA (DR) | Extended SLA (Haiti/DRC) |
|---|---|---|
| Critical first response | 1 hour | 1.5 hours |
| High first response | 4 hours | 6 hours |
| Medium first response | 24 hours | 36 hours |
| Critical resolution | 4 hours | 6 hours |
| High resolution | 24 hours | 36 hours |

Haiti and DRC get 1.5x the standard SLA windows. The SLA clock starts at `agentTimestamp`, so a message sent at 9:00 AM but received at 9:45 AM counts as 45 minutes already elapsed.

**Delivery-aware resolution:** A ticket's response is not considered "delivered" until a WhatsApp delivery receipt arrives. If the US team responds but the delivery receipt hasn't arrived after 2 hours, the dashboard shows a "Response pending delivery" warning. This prevents assuming an issue is handled when the agent hasn't seen the reply.

**Connectivity-pause rules:** When the connectivity monitor detects a regional outage (see below), SLA clocks for all tickets from that region are automatically paused. They resume when connectivity is restored. This prevents mass SLA breaches caused by infrastructure outside anyone's control.

### Self-Service Bot

The bot is designed for conversations that may span hours with long gaps between messages:

**Single-message resolution:** For Haiti/DRC, the bot prefers sending all troubleshooting steps in one message rather than a multi-step back-and-forth. A 5-step decision tree that requires 5 round trips may take 10+ minutes on a bad connection. Instead: "Try these steps: 1) ... 2) ... 3) ... Reply YES if fixed, NO if not." This cuts the interaction from 10 messages to 2.

**Extended session TTL:** Bot sessions for Haiti/DRC have a 2-hour TTL (vs 30 minutes for DR). An agent dealing with a power cut can resume the conversation when power returns.

**Message burst handling:** If the agent typed 3 messages offline and they all deliver at once, the bot processes only the most recent message in the context of the current session state, ignoring stale intermediate messages. It uses WhatsApp message timestamps to determine order, not arrival order.

**Text-only responses:** Bot responses to Haiti/DRC agents are text-only with quick-reply buttons. No images, PDFs, or video links. Each message is kept under 1,000 characters to ensure fast rendering on low-end devices.

**Graceful timeout recovery:** When a bot session expires, the next message from the agent starts a fresh conversation. If the expired session had reached a meaningful state, the bot says: "Welcome back! Last time we were working on [issue]. Would you like to continue?" — pulling from the persisted session record.

**Offline escalation guarantee:** If the bot escalates to a ticket but the confirmation message fails to deliver, the ticket is still created. The agent's connectivity doesn't block the support pipeline.

### Incident Clustering

**Network vs app distinction:** When agents in the same region report "app not loading" or "can't connect," it could be an app outage or an ISP outage. Tickets with connectivity-related tags (`connectivity`, `app_not_loading`, `timeout`, `cannot_connect`) get a `likelyNetwork` flag. If a cluster forms entirely from `likelyNetwork` tickets, the incident is labeled "Possible Network Issue" and routes to ops instead of engineering.

**Agent-timestamp clustering:** The clustering engine uses `agentTimestamp` for all time-window calculations. After a connectivity outage resolves, a burst of queued messages may arrive within minutes — but the issues may have occurred over the past 3 hours. Using agent-sent times prevents these bursts from creating phantom incidents.

**Wider time windows (planned, partially shipped):** `packages/shared/src/index.ts` declares a 6-hour window for HT / CD and 2 hours for DO (`CLUSTERING_CONFIG`). The current `incident-clusterer.ts` runs a uniform 30-min window with a 3-ticket threshold for all countries — wiring the per-country values is queued for the next pass.

**Silence detection:** If the system notices zero messages from a region for 30+ minutes during normal operating hours (when it typically receives a steady trickle), it creates a "Connectivity Monitoring" alert. This isn't an incident — it's a heads-up that the silence might mean an outage.

### Knowledge Base

**Condensed bot delivery:** When the bot sends a KB article resolution to a Haiti/DRC agent, it uses the `resolutionTextShort` version (under 500 characters). The full resolution is available via "Reply MORE." This avoids sending a 2,000-character message that times out on a 2G connection and leaves the agent with a partial, broken response.

**Pre-translated cache:** Article translations for bot delivery are pre-generated when the article is approved, not computed on the fly. This eliminates the translation API latency from the bot response path.

### Media Handling

**Inbound media:** Media uploads from agents on low-bandwidth connections frequently fail. The system retries media downloads from the WhatsApp media URL 3 times over 15 minutes. If it still fails, the ticket is created with a "media unavailable" placeholder.

**Outbound media:** Images and files sent from the US team to Haiti/DRC agents are automatically compressed (images resized to 800px max width, JPEG quality 60). The egress worker applies compression based on the agent's country.

**No automated media:** Bot responses and system notifications to Haiti/DRC agents never include media. Text-only with quick-reply buttons.

## Connectivity Health Monitoring

A background worker tracks regional connectivity health using a rolling window of `deliveryDelay` values.

### Health Scores

| Status | Median Delay | Meaning |
|---|---|---|
| `healthy` | < 30 seconds | Normal connectivity |
| `degraded` | 30 seconds – 5 minutes | Slow but functional |
| `outage` | > 5 minutes or zero messages | Likely regional outage |

The health score is computed per region per country on a 30-minute rolling window.

### What Triggers on Health Changes

| Health Change | Actions |
|---|---|
| Healthy → Degraded | Log event; update branch status on dashboard; no SLA impact |
| Degraded → Outage | Pause SLA clocks for region; create connectivity alert; extend bot session TTLs; notify ops via Slack |
| Outage → Healthy | Resume SLA clocks; process queued outbound messages; log outage duration |

### Agent Connectivity Status

Each agent has a derived `connectivityStatus` on their profile:

| Status | Condition |
|---|---|
| `online` | Delivery/read receipt received within the last hour |
| `intermittent` | Messages delivering but with delays > 5 minutes |
| `offline` | No delivery receipts in the last 4 hours |
| `unknown` | No recent outbound messages to check against |

This is visible on the dashboard (agent profile and ticket detail) and factored into incident analysis — if 20 agents in a region are all "offline," that's a connectivity event, not an app event.

## Configuration

All connectivity-related thresholds are configurable in the dashboard admin settings and defined in `packages/shared/src/index.ts`:

```typescript
// Bot session TTL per country (seconds)
BOT_SESSION_TTL: { HT: 7200, CD: 7200, DO: 1800 }

// Max message length for bot responses
BOT_MAX_MESSAGE_LENGTH: { HT: 1000, CD: 1000, DO: 2000 }

// Connectivity health thresholds
CONNECTIVITY_THRESHOLDS: {
  healthyMaxDelaySeconds: 30,
  degradedMaxDelaySeconds: 300,
  silenceAlertMinutes: 45,
  deliveryPendingAlertHours: 2,
  deliveryLostHours: 24,
}

// Incident clustering windows per country (hours)
CLUSTERING_CONFIG: { HT: 6, CD: 6, DO: 2 }
```

## Testing Connectivity Scenarios

In development, you can simulate connectivity issues:

1. **Delayed message:** Modify `message-normalizer.ts` to inject a fake `agentTimestamp` 30 minutes in the past. This simulates a message sent during an outage.
2. **Message burst:** Send 5 WhatsApp messages rapidly. The pipeline should process them with correct ordering.
3. **Bot session timeout:** Start a bot conversation, wait 2+ hours (or lower the TTL in config), then send another message. The bot should offer to resume the previous session.
4. **Missing delivery receipt:** Send a response via the API but don't trigger the status webhook. After the configured threshold, the dashboard should show "pending delivery."
