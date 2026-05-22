# Bilingual WhatsApp Support Platform for Field Agent Operations

## Product Requirements Document

---

## 1. Overview

We operate a fintech platform with 1,000+ field agents across Haiti, Dominican Republic, and the Democratic Republic of Congo who run our branch locations. These agents regularly encounter technical issues (app crashes, transaction failures, connectivity problems), have operational complaints (e.g., lottery results taking too long to post), and surface feature requests — but there is no structured channel for them to communicate these back to our US-based operations and engineering teams.

Issues go unreported for days or weeks, and when they do surface, it's through informal, fragmented channels that make triage impossible.

The core engineering challenge is building a platform that bridges WhatsApp (where agents already communicate) with an internal web dashboard (where US teams work), with real-time translation between Haitian Creole/French/Spanish and English sitting transparently in the middle — so both sides can communicate naturally in their own language without friction.

---

## 2. Problem & Context

### 2.1 Business Context

Our 1,000+ branch agents are the frontline of our business in Haiti. When a technical issue at a branch goes unreported, customers can't deposit or withdraw money, and we lose both revenue and trust.

Today, agents sometimes message individual employees on personal WhatsApp, post in ad-hoc group chats, or simply don't report issues at all. The US team has no visibility into the volume, severity, or patterns of field issues.

This creates three concrete business problems:

**Slow incident response.** A broken POS terminal or app crash at a branch can go unresolved for days because no one on the engineering team knows about it. Each day of downtime at a branch means lost transactions and frustrated customers.

**No pattern detection.** If 50 agents across Port-au-Prince all experience the same login error on the same morning, we have no way to see that pattern — each report (if it comes at all) arrives through a different informal channel. We can't distinguish a systemic outage from an isolated issue.

**Language barrier.** Even when issues do get escalated, the Creole-to-English communication gap slows resolution. US engineers ask follow-up questions in English, agents respond in Creole, and someone has to manually translate back and forth. This adds hours or days to every interaction.

### 2.2 Vision

We want to build something similar in spirit to Front — a shared inbox where WhatsApp conversations from agents flow into a web-based dashboard that our US operations and engineering teams can manage collaboratively — but with translation as a first-class feature, not an afterthought.

### 2.3 Impact Metrics

| Metric | Description |
|---|---|
| Issue surface time | Time from agent encountering an issue to the US team being aware of it |
| First response time | Time from issue surfacing to first US team response |
| Resolution time | Time from issue surfacing to confirmed resolution |
| Translation accuracy | Quality of automated translations across language pairs |
| Issue pattern detection | Ability to identify systemic issues across multiple agent reports |

---

## 3. Requirements & Success Criteria

### 3.1 Functional Requirements

| Requirement | Description |
|---|---|
| WhatsApp integration (inbound) | Receive messages from field agents via WhatsApp |
| WhatsApp integration (outbound) | Send responses back to agents via WhatsApp |
| Real-time translation layer | Transparent translation between Haitian Creole/French/Spanish and English |
| Web dashboard (shared inbox) | Internal web interface for the US team to manage conversations |
| Conversation threading | Group related messages into coherent conversation threads |

### 3.2 Performance Benchmarks

| Benchmark | Description |
|---|---|
| Message ingestion latency | Time from agent sending a WhatsApp message to it appearing in the system |
| Translation latency | Time to translate a message between language pairs |
| Real-time update latency | Time for new messages to appear on the dashboard without refresh |
| Concurrent users | Number of simultaneous dashboard users supported |
| Message throughput | Volume of messages the system can process per second |
| Translation quality | Accuracy and naturalness of translations, especially for Haitian Creole |

### 3.3 Code Quality Expectations

| Area | Expectation |
|---|---|
| Documentation | Comprehensive technical documentation |
| API design | Clean, well-structured API surface |
| Real-time communication | WebSocket or equivalent for live dashboard updates |
| Testing | Adequate test coverage |
| Error handling | Graceful failure and recovery across the pipeline |

---

## 4. Technology

### 4.1 Required

| Category | Specification |
|---|---|
| Language | TypeScript |
| Frontend | React |
| Database | PostgreSQL |
| Containerization | Docker |
| Deployment | Railway |
| AI / ML frameworks | Any |
| Cloud platform | Any |

### 4.2 Off-Limits

None specified.

---

## 5. Submission Requirements

### 5.1 AI Usage Documentation

Required — document all AI tool usage throughout development.

### 5.2 Required Deliverables

| Deliverable | Description |
|---|---|
| Source code | Complete, runnable codebase |
| Technical documentation | Architecture, API reference, setup guides |
| Demo video | Walkthrough demonstrating the platform in action |
| Deployment guide | Instructions for deploying the platform to production |

---

## 6. Technical Contact

Available — yes.
