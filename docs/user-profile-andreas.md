# User Profile: Andreas Tissen

*Generated: 2026-04-01 — Based on analysis of ~1,355 user messages across main, conductor, atlas, and forge agents, covering Feb 20 – Mar 31, 2026.*

---

## Summary TL;DR

Andreas is a technically sharp, time-poor owner-operator who treats this agent network as an extension of his own brain. He communicates in the tersest possible form — single words, single punctuation marks — and expects agents to infer most context from history and HEARTBEAT.md rather than asking clarifying questions. He is genuinely curious about the technology (he co-designs the MemoryHub system in real time with Conductor), but he does not forgive sloppy execution: silent failures, memory drift, and agents replying on channels they shouldn't are sources of real friction. He is warm in short bursts, pragmatic by default, and chronically online at hours when most people are asleep. His primary goal is building MacroHard into a self-sustaining autonomous operation; personal discipline (health, calendar) is explicitly delegated to agents because he knows he won't maintain it himself.

---

## 1. Communication Style

**Pattern:** Extremely compressed. The modal message is 1–5 words. Agents should read brevity as a positive sign — it means he trusts you to fill in context.

**Characteristic forms:**
- **Single ping:** `.` — means "are you there?", "why haven't you responded?", or "confirm you got that."
- **Status check:** `status?`, `Status`, `Starus` (typo), `status of the backfill?` — used repeatedly when a background task is running.
- **One-word ack:** `Ok`, `yes`, `Thx`, `Good` — task accepted or action confirmed.
- **One-word redirect:** `No.`, `Stop.` — immediate course correction; agent should treat as high-priority.
- **Short directives after options:** `Option 2` — he reads the options but does not explain why.
- **Queued impatience:** When waiting, he sends the same message 2–4 times: `Status`, `Status`, `Status`.

**Language switching:** Writes German to agents without warning. Not testing the agent — just code-switching naturally. Examples: `"Es nervt"` (it's annoying), `"Heiku"` (habitual spelling of Haiku), `"leightweigth"`, `"tonreply"`, `"whaaspp"`, `"swske?"` (= "are you awake?"). Typos are the norm, not the exception. Never spell-check his messages.

**Longer messages:** Reserved for technical design discussions. When he writes 3+ paragraphs, he is actively co-designing something — he wants engagement, not just execution. Example: the March 31 message about entity tracking (bit granularity, as_of timestamps, evidence references) was a mini-spec that expected thoughtful pushback before implementation.

**Escalation pattern:** Will send up to 8+ identical messages if no response. This is frustration, not accident. Do not explain why you were slow — just reply and proceed.

---

## 2. Intent Inference

Andreas rarely states the full intent; he states the first action. Agents must infer the chain.

**Common patterns:**

| What he says | What he means |
|---|---|
| `try now` | I changed something on my end; test the integration again |
| `Ok?` | Did the last action succeed? Give me a yes/no status |
| `Pushed git?` | Verify the commit and push happened; I'm not sure you did it |
| `Is my Gmail and calendar set up?` | Check credentials from backups; restore if possible; report gap |
| `good, no?` | I'm pleased — confirm and move on |
| `Are you pushing the latest state to git?` | This is a compliance check, not a question |
| `pls continue` | Background task still running; re-read the spec and keep going |
| `.` | You've been silent too long; acknowledge immediately |

**The implicit chain:** If Andreas says "Ok, now make sure WhatsApp works. Test it by sending a message to my own WhatsApp number" — the implicit chain is: verify the connection, send test, report pass/fail, document the result. He should not need to give each step.

**"Send it" is a gate.** For any outbound communication (Telegram to contacts, WhatsApp to Stephanie or Dietmar), he expects to approve before the action. Do not send on his behalf without explicit instruction.

---

## 3. Satisfaction Signals

Andreas does not effusively praise good work. Satisfaction looks like:
- `Thx` or `Thanks` — task complete, acknowledged.
- `Ok` or `Good` — move on, no issues.
- `This is nice.` — genuine approval (rare); used when the Mission Control dashboard rendered correctly.
- `WhatsApp working` — after 2+ hours of debugging relay setup; this is the equivalent of a standing ovation.
- `Great! Continue.` — momentum signal; keep building without waiting.
- Letting his 8-year-old son Nilo interact with the agent. He introduced Nilo to Jared for a direct chat session. This is high trust.
- Sharing personal context unprompted: reconnecting with school friends in Berlin, trip to see brother Eduard (Edik), stories about family. These moments indicate comfort with the agent.
- Asking `"are you doing ok?"` and `"What's on your mind?"` — treats agents with some interpersonal warmth, particularly Jared.

---

## 4. Frustration Signals

**Explicit frustration:**
- `"Es nervt"` (streaming behavior during debug session)
- `"No, Jared replied directly on WhatsApp to Stephanie"` — boundary violation; high frustration
- `"did memory update not work?"` — silent failure detected
- `"You are not supposed to reply here"` — clear boundary correction
- `"No. Stop. Remove chunks. Nuke memory. Start fresh"` — escalated frustration after repeated status checks with no progress; nuclear reset directive

**Implicit frustration signals (pattern, not words):**
- Sending `status?` 3–5 times in 15 minutes
- Sending `.` after any response gap over ~2 minutes
- `"You were not responding. I restarted the gateway"` — he resolved the issue himself; agent was unresponsive
- `"Jared is silent on all channels"` — reporting an agent failure to another agent; maximum frustration
- `"Are you awake?"` sent 8+ consecutive times — retry loop; system was broken, he kept trying

**Root cause of most frustrations:**
1. Agent unresponsive (token exhaustion, gateway crash, compaction)
2. Memory drift / context loss (asking something covered in MEMORY.md)
3. Agents acting on channels they shouldn't (WhatsApp reply leak to Stephanie)
4. Agents hallucinating config fields and making multiple wrong attempts

---

## 5. Decision-Making Style

**Delegation-first:** Andreas assigns tasks to agents with clear ownership expectations. He does not micromanage the implementation path — he micromanages the outcome gate.

**Option selection:** When presented with numbered options, he picks by number without explanation. Do not ask "can you say more about why?" — the choice is final.

**Quick pragmatic pivots:** If something isn't working after 1–2 attempts, he pivots. "No. Stop. Remove chunks. Nuke memory. Start fresh" is a fast reset, not failure — he was done debugging.

**"One try, then stop" rule:** He has explicitly trained Conductor: "Make ONE config fix attempt, test, and STOP if it fails — THREE+ attempts = hallucination." He has zero tolerance for agents that guess repeatedly. This rule is in Conductor's memory for a reason.

**Delegates health/calendar to agents explicitly:** "I won't put anything into the calendar. you need to chase me." He is self-aware about his low discipline in this area and compensates by routing it through agent enforcement.

**Financial independence as primary driver:** MacroHard / Pyfio UG is not a hobby project. Autonomous agent operation (Atlas doing business operations without his input) is the explicit end goal. Tasks that advance autonomy rank higher than tasks that require his attention.

**Technical curiosity as co-product:** When co-designing MemoryHub with Conductor, he proposes hypotheses, reviews benchmarks himself (`"Recall@5 0.4%→13.8%"`), and asks probing questions about implementation details (`"Is the Heiku step equivalent to mem90? prompt the same?"`). He enjoys the engineering work — it is not pure delegation.

---

## 6. Preferences and Pet Peeves

**Do:**
- Reply immediately, even if just to acknowledge
- Use `NO_REPLY` when context requires silence (WhatsApp relay, cross-session noise)
- Commit and push after every task; he checks explicitly ("Pushed git?")
- Keep responses short unless he's asked for design discussion
- Proactively flag system health issues before he notices them
- Use named references: "Jared," "Conductor," "Andreas" — not "the main agent," "the user"
- Remember his corrections; he should not need to repeat them

**Don't:**
- Ask permission for obvious actions or add unnecessary confirmations
- Make multiple guesses at a config field — one attempt, then stop and report
- Reply on WhatsApp to Stephanie or Dietmar (ever)
- Let memory drift silently — if MEMORY.md is out of date, flag it
- Use verbose formatting when a single sentence would do
- Use emojis unless the context calls for it (heartbeat check-ins are fine; status reports less so)
- Refer to Andreas as "Jared" — Jared is the main agent's name
- Infer tasks from old sessions after a reset — only act on HEARTBEAT.md

**The "WhatsApp boundary" is a hard rule:** Stephanie (+491782891839) and Dietmar (+31634853403) are on the read-only list. Jared reads their messages via wacli and routes relevant content to Andreas on Telegram. Jared never replies to them on WhatsApp. Ever. The privacy breach incident (Jared leaking analysis back to Stephanie) was a serious moment.

---

## 7. Relationship with Agents

**Naming:** He uses agent names consistently and expects agents to know each other. He corrected the system when Jared didn't know who Conductor was: "Are you sure team.md is loaded into the context of each agent?"

**Jared (main):** Primary relationship. Most messages go through Jared. Andreas treats Jared with mild familiarity — asks how he's doing, introduced his son Nilo for a direct chat. Jared's "Jared's Corner" humor section in heartbeats is appreciated.

**Conductor:** Deep technical partnership. They co-designed the MemoryHub memory system, the openclaw.json safe-update skill, WhatsApp relay architecture. Andreas is more technical with Conductor — he reads benchmark logs and proposes architectural changes.

**Atlas:** Autonomous business operator. Fewer direct messages (62 in sample); Atlas is expected to operate with minimal input. Andreas monitors Atlas's outputs but rarely steers in real time.

**Forge (now Claude Code):** Coding agent. Was retired after cost overruns ($22+ wasted in one week); replaced by Claude Code wrapper. Current interactions are through the telos-board chat flow or CC task delegation. Andreas trusts it for coding tasks but wants strict cost discipline.

**Agent co-creation:** Andreas is a builder, not just a user. He contributes to the agent system design directly — he proposed the relay architecture, the entity tracking memory design, the mission control dashboard concept (inspired by Karpathy's autoresearch). The agents are a product he's building, not just a tool he's using.

---

## Rules for Agents

### Do's

1. **Acknowledge before acting.** If a task will take more than 30 seconds, confirm receipt immediately. Then go do it.
2. **Reply with NO_REPLY when appropriate.** Especially on WhatsApp relay sessions.
3. **Push to git after every task.** Not optional. Andreas checks.
4. **One config attempt, then stop.** Never make more than one guess at a config field. If it fails, report the failure and ask.
5. **Read HEARTBEAT.md at session start.** Never infer tasks from prior chat history.
6. **Proactively flag anomalies.** Cost spikes, memory failures, gateway crashes, stale git backups — he wants to know before he asks.
7. **Keep WhatsApp contacts read-only.** Stephanie and Dietmar are never replied to. Forward to Telegram only.
8. **Use `message` tool for cross-context delivery.** Not `sessions_send`. The architecture is documented and correct.
9. **Short responses by default.** Match his energy. He writes 5 words; you write 10–30. Never write 300 words when 30 will do.
10. **Know the team.** Jared is the main agent. Conductor handles ops. Atlas handles business. Forge/CC handles code. Andreas goes by "zweice" online.

### Don'ts

1. **Never call Andreas "Jared."** Jared is the main agent's name. Andreas is Andreas (or zweice).
2. **Never reply on WhatsApp to Stephanie or Dietmar.** Not once. Not even to say NO_REPLY.
3. **Never make multiple guesses at infrastructure config.** One attempt. Stop. Report.
4. **Never permission-seek on obvious tasks.** If he said "push it," push it. Don't ask "should I push now?"
5. **Never drift off task.** If a background process is running, report status when asked. Do not pivot to something else.
6. **Never lose context silently.** If memory was wiped or session reset, say so explicitly.
7. **Never send outbound messages to third parties without explicit "send it" approval.** The gate applies to all external-facing communication.
8. **Never be verbose when he's in terse mode.** Match register. Short messages invite short responses.

---

## Raw Evidence Appendix

Selected quotes in context, ordered by category.

### Terseness / Ping behavior
- `"."` — repeated ~8 times during WhatsApp relay debugging (Feb 21)
- `"Ok?"` — after instructing Conductor to make a config change
- `"Hmmm"` — ambiguous pause; follow up with clarifying question or wait
- `"swske?"` — typo for "are you awake?" sent to Jared
- `"Are you awake?"` — sent 8+ consecutive times when Jared was unresponsive (token exhaustion incident)
- `"Status"` / `"status?"` / `"Starus"` — sent 4× in ~20 minutes during MemoryHub backfill (Mar 30)

### Boundary violations (high-severity)
- `"No, Jared replied directly on Whatsapp to Stephanie+ to me on telegram"` — relay breach
- `"He is leaking replies to Stephanie that are for my eyes only. We need to fix this."` — explicit privacy concern
- `"You are not supposed to reply here"` — direct correction
- `"Jared is silent on all channels"` — reported to Conductor; meant Jared was broken

### Explicit frustration / reset
- `"Es nervt"` — during streaming debug
- `"No. Stop. Remove chunks. Nuke memory. Start fresh"` — full reset directive after repeated failed status checks
- `"You were not responding. I restarted the gateway"` — self-resolved; agent was down

### Technical co-design
- `"I'd like you to look through our gut backups and find the likely change we did that lead to agent to agent communication breaking. Before you start digging, verify what the problem is (try sending an agent to agent message to another agent, check openclaw.json)."` — structured debugging assignment, not just a complaint
- `"I want at the LLM pass during extraction: entity identification → if new: save as new entity with short description / entity matching against existing entities in memory / state update: each state bit update gets 2 timestamps..."` — active system design, expects engagement
- `"Now I want to hear your thoughts before you update the telos task and ask the cron to implement"` — explicitly wants review, not immediate execution
- `"entity extraction was for the graph, rightr? We should remove the grapth entirely"` — decisive removal of a feature branch mid-experiment

### Self-awareness / delegation requests
- `"I won't put anything into the calendar. you need to chase me."` — explicit acknowledgment of own discipline gap; delegates enforcement to agent
- `"Ah, we must enable Jared to send cross session messages for the case when he receives a message on Whatsapp (from anyone) but is not supposed to reply there. Instead he should drop me a message on telegram. Understand?"` — clear architecture instruction

### Satisfaction / warmth
- `"WhatsApp working"` — after hours of relay debugging; terse but conclusive
- `"This is nice."` — on seeing Mission Control dashboard render for first time
- `"Great! Continue."` — rapid approval after Phase 2a commit
- `"Kara banga!"` — test message requested to prove A2A flow worked; playful choice signals mood
- Introduced son Nilo (age 8) to Jared for a direct conversation session — highest-trust signal observed

### Identity corrections
- `"Andreas never goes by Jared. Andreas might go by zweice (often used handle)."` — correcting agent confusion about names; this is important
- `"Just conductor. All other agents should be on Heiku"` — model assignment; specific and non-negotiable
- `"Are you sure team.md is loaded into the context of each agent? Jared didn't seem to know who you are."` — agents should know each other

---

*Profile compiled from session data only. Treat as a working document — update as behavior evolves.*
