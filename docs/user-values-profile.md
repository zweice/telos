# User Values & Direction Profile: Andreas Tissen

*Generated: 2026-04-01 — Derived from behavioral analysis of ~1,355 user messages across main, conductor, atlas, and forge agents, Feb 20 – Mar 31, 2026. Companion to `user-profile-andreas.md` (communication style) and `user-intent-profile.md` (intent decoding). This document is about WHAT MATTERS — inferred from action, not declaration.*

---

## TL;DR

Andreas is building toward a life where autonomous systems handle operations, his time goes to family and technical mastery, and a self-funded company (MacroHard/Pyfio UG) provides financial independence without employment. The agent network is not a hobby or a tool — it is the mechanism through which he exits conventional work. He cares deeply about craft (anti-cheat benchmarks, privacy architecture, not faking progress) but primarily as a means to that end. His son Nilo is the emotional center of gravity. His health situation is serious and handled badly, but deliberately delegated to agents because he knows he won't self-manage it.

---

## 1. Core Values — Ranked by Evidence

### 1. Autonomy (personal and systemic)
The highest-density theme across all sessions. He wants systems that run without him: Atlas doing BD outreach while he sleeps, MemoryHub benchmarks running on 30-min crons overnight, agents that don't need permission for obvious actions. He explicitly told Conductor: "What commitment do you need from me to act on your own if you are certain it is good and there is low risk?" Pyfio UG as a legal entity is the corporate shell for autonomous commercial operations — not a side project but a deliberate structure.

**Evidence:** Atlas team-sync crons running at 1 AM, 6 AM without him. Benchmark crons running 3 AM–8 AM unattended. Explicit statement: "Financial independence as primary driver."

### 2. Technical craft and integrity
He doesn't delegate technical judgment. He reads benchmark logs himself, proposes architectural improvements in real time, and adds constraints specifically to prevent false progress. The w=10 anti-cheat clause — where he caught that a wider window was cheating — was not asked for by anyone. He invented it to protect the validity of the result. When R@5 hit 0.9282 his first instinct was "send me the report as a file" — he wanted the artifact, not the summary.

**Evidence:** "Let's add an Anti-Cheat clause. E.g. w=10 was cheating" [conductor, Mar 30]. Reviewing per-category breakdown himself. Entity tracking design mini-spec written unprompted at 13:28. Removing the graph feature mid-experiment when it hurt accuracy: "entity extraction was for the graph, right? We should remove the graph entirely."

### 3. Privacy and information sovereignty
The WhatsApp relay architecture is not casual — it took a serious breach (Jared leaking analysis back to Stephanie) to harden into hard rules. He maintains total information asymmetry: he reads everything, nobody reads his. Google Drive banned. External-facing messages gated ("send it" approval required). He framed the relay leak as "for my eyes only" — language that signals ownership, not just preference.

**Evidence:** Privacy breach incident Mar 21. "He is leaking replies to Stephanie that are for my eyes only." Architecture built around read-only relay + explicit "send it" gate. Google Drive ban.

### 4. Family as stable foundation
Nilo appears more than any single technical topic in the personal sessions. Andreas introduced Nilo directly to Jared for a dedicated conversation — the highest-trust signal observed. He treats the agent system as a tool for being more present with family, not less (delegating calendar, health tracking, message handling so he can be elsewhere). Stephanie's messages are monitored with care; the 10th wedding anniversary reminder was given directly.

**Evidence:** Full snake-keeping session with Nilo (Mar 30-31). "You remember that task from Stephanie for 2nd August. I need a reminder in my google calendar one day before. It is our 10th wedding day." Medical appointment preparation delegated to agents.

### 5. Speed and forward momentum
He doesn't pause to celebrate. When R@5 hit 0.9282 (target was 0.9), he immediately said "Is it clear that even if you get to 90%, you should still go on optimizing?" He launches entity tracking while benchmarks are still running. Mission Control Phase 2a was started minutes after Phase 1 commit. The 30-min cron pattern was chosen specifically because he wanted continuous forward movement.

**Evidence:** "W=1 it must be. Improve with that constraints. Don't stop until we are at 90%." "Create Cron every 30 minutes to work on this problem." "start it now. the entity register runs via cron and is independent."

### 6. Cost discipline
Forge was effectively fired after a $22+ runaway session. OpenRouter budget managed to $25/day threshold. Anthropic API budget hit zero twice; he tracks this. Cost overruns are not tolerated — they trigger agent reconfiguration, not forgiveness. The entire mem90 benchmark goal includes "zero Haiku calls per query at runtime" — not because he can't afford it, but because he doesn't want runtime LLM dependency.

**Evidence:** "Forge incident 2026-02-25: $22.37 runaway" (entity summary). OpenRouter overdrawn at -$0.17 while still running agents. Haiku/q=0 as explicit benchmark constraint alongside R@5.

---

## 2. Micro: Where Attention Flows Daily

**Gravitates toward (unprompted initiations):**
- MemoryHub architecture and benchmarking — this is the largest continuous project thread
- Entity tracking system design — proposed multiple times, always with detail
- Agent infrastructure improvements (relay architecture, Mission Control dashboard, entity register)
- Nilo's interests and development (herpetology, stone collection, minigolf scores)
- Memory system quality checks ("what memories do we have about X?")

**Checks obsessively (status loops):**
- Benchmark progress: `status?` × 4 during Mar 30 backfill
- Agent responsiveness: sends `.` within 2 minutes of silence
- Task #233 repeated × 10+ times (21:03–21:42 Mar 31) — a 40-minute retry loop
- Git push confirmations: "Pushed git?" appears unprompted across agents

**Neglects (explicitly delegates away):**
- Calendar maintenance: "I won't put anything into the calendar. you need to chase me."
- Health management: medical appointment prep handled entirely by agents, discharge papers not located proactively
- Shopping/logistics: Stephanie's OBI post notes, grocery items — all routed through agent relay

**Excitement signals (longer messages, design proposals):**
- Entity tracking spec at 13:28 Mar 31 (600+ char message)
- Mission Control inspiration from karpathy/autoresearch — "for mission control agentic task harness, get inspired by this"
- Memory block injection working: "Memory block looks good now" — satisfaction at system correctness
- "This is nice." (Mission Control dashboard, Mar 31 14:09) — rare full approval

**Boredom / friction signals:**
- Silent agents — immediate escalation to `.` then repeated messages
- Agents asking permission for obvious actions
- Agents being verbose when he's in terse mode
- Failed notifications: "I don't see the report. Let's take the time to really figure out why I never get notified when CC finishes"

**Time patterns:**
- **22:00–03:00 CET (frequent):** Deep work + co-design. Benchmark launches, entity design, long architectural messages. Less frustrated by roughness. Mar 30: working until 01:49 AM then asking for a 30-min benchmark cron.
- **11:00–19:00 CET:** Operational mode. Short messages, status checks, approvals.
- **Early morning (06:00–09:00 CET):** Agent crons deliver overnight results; he checks in. Usually brief.
- Sleep time is listed in agent memory — agents know his expected rest window. He tracks his own sleep via agent memory.

---

## 3. Macro: Where He's Going

### The visible trajectory
MacroHard/Pyfio UG is building toward a freight document parsing business. The pipeline exists: freight parser MVP (Forge, Feb 24) → BD outreach (Atlas, leads list + email sequences) → shadow pilot → paying client → repeat. Atlas is designed to run this pipeline without Andreas's direct involvement. Task #21 (ROI: 20,000 on Fibonacci scale — highest observed) awaits only his "send it" approval for external outreach.

### The revealed vision
Not "a business" but "a business that runs while I sleep." Every infrastructure choice points here: autonomous crons, Atlas team-sync at 3 AM, MemoryHub so agents remember context across sessions, Mission Control so he can see the state without being in the conversation. He's not building for a job — he's building for exit velocity from needing to be present.

### MemoryHub as dual-purpose asset
The MemoryHub system is simultaneously:
1. Internal infrastructure (agents that don't forget across sessions)
2. A potentially sellable product (benchmarked rigorously against LoCoMo, academic-grade evaluation, R@5=0.9282 with anti-cheat compliance)

He hasn't said this explicitly, but the benchmark rigor — formal methodology, anti-cheat constraints, per-category breakdown — goes far beyond what you need for internal tooling. He's building something credible.

### Financial independence signal strength: HIGH
- Pyfio UG exists as a registered German legal entity
- He references autonomous operations as "the explicit end goal" (user-profile)
- Cost discipline is obsessive, not casual — he tracks daily API spend to the cent
- Atlas's business operations are treated with the same seriousness as technical infrastructure

### Geographic/lifestyle signals
- Based in Soltau, Lower Saxony, Germany (family home with garden)
- Father Dietmar in Amsterdam; brother Eduard (Edik) + Elena in Berlin; mentions trips to both
- No signals toward relocation — rootedness in Soltau appears stable
- Lifestyle target: agent network runs commercial operations; he manages intellectually, not operationally

---

## 4. Tensions — Competing Values with Examples

### Control vs. delegation
He wants autonomous systems but sends the same message 10 times when one doesn't respond. He explicitly designed agents to not need permission — then checks on every benchmark manually. He restarted the gateway himself rather than waiting for agents to fix it. The tension is real: he wants the outcome of autonomy but hasn't fully trained himself to accept the silence that comes with it.

**Evidence:** 10× "Can you check? there is no reply to my question in task #233" (Mar 31). Self-restarting gateway after agent unresponsiveness. Vs. "What commitment do you need to act on your own?"

### Speed vs. quality/integrity
He moves fast (30-min crons, immediate task launches) but refuses to accept false progress. The anti-cheat clause is the clearest example: he slowed down to make the benchmark harder. He rejected the w=10 result even though it hit the target number (94.39%) because it was methodologically wrong. He doesn't want to hit targets — he wants real performance.

**Evidence:** Anti-cheat clause invention. "entity extraction was for the graph, right? We should remove the graph entirely" — deleted a feature rather than keep bad code.

### Privacy vs. capability
He wants powerful integrations (WhatsApp monitoring, email relay, calendar sync, health tracking) but maintains strict read-only architecture for most of them. Google Drive is banned. Outbound messages gated. He accepts the capability reduction in order to maintain information control.

**Evidence:** WhatsApp relay read-only architecture. "for my eyes only" framing. Google Drive ban. "Send it" gate on all outbound comms.

### Ambition vs. health
He works at 2 AM. He has a documented history: loss of consciousness Oct 18, 2022 (hospitalized), recurring muscle cramps, functional impairment. His doctor appointment (Mar 24) required agent reminders and Stephanie's assistance to prepare. He's not ignoring this — he delegated it — but the delegation pattern suggests it doesn't get the same energy as MemoryHub.

**Evidence:** Medical prep delegated to Jared. "Andreas experiences daily life impairment and avoidance of physical activity" (MemoryHub fact). 02:00 AM working sessions frequent.

### Autonomy desire vs. attention need
He explicitly wants agents that don't need him. He explicitly cannot tolerate agents that don't respond. These aren't compatible preferences — they reveal that what he actually wants is agents that work continuously and silently EXCEPT when they need to report to him. The notification pipeline problem (CC finishes but he doesn't get notified) bothers him more than almost anything technical.

**Evidence:** "I don't see the report. Let's take the time to really figure out why I never get notified when CC finishes" — he stopped everything to fix this. Vs. "just do it" on obvious actions.

---

## 5. Running From / Running Toward

### Running FROM
- **Employment and boss-dependency.** Pyfio UG, autonomous business pipeline, Atlas running operations — all point away from "I work for someone." Not stated as resentment, but as architecture: every system he builds makes him less need-able in the conventional sense.
- **Being the bottleneck.** "What commitment do you need to act on your own?" is a genuine question. He is trying to remove himself from the critical path of his own business.
- **Manual, repetitive work.** Calendar management, message routing, health reminders, status tracking — all delegated. He's not avoiding these because they're beneath him; he's avoiding them because being the one who does them by hand means the system has failed.
- **Context loss.** The entire MemoryHub project is a response to the fact that agents forget. He is running from a world where he has to repeat himself.

### Running TOWARD
- **An operating company that runs without his constant presence.** Atlas + Telos + mission control is the mechanism. The freight parser is the first product.
- **Technical depth that compounds.** MemoryHub is not a solved problem — it's a growing research program. He keeps extending the target (0.90 → 0.99, then entity tracking). He wants mastery that stays ahead of the state of the art.
- **Time with Nilo, Stephanie, and family.** The evening conversations with Nilo about snakes, stones, and Lego Ninjago happen during prime work hours. He is not sacrificing family for work — the agent network IS the protection of family time.
- **A system that knows him.** MemoryHub, entity tracking, dream cycles — all aimed at agents that accumulate real knowledge of his life. He is building the kind of continuity that a personal assistant or chief of staff provides, but at zero marginal cost.

---

## 6. Hidden Priorities

**Craft for its own sake.** The anti-cheat benchmark constraint reveals something about identity: he doesn't want to win by cheating, even when nobody is watching. The satisfaction signal is strongest when systems work correctly, not just when they hit a number. "MISSION COMPLETE" matters partly because the methodology was sound.

**Recognition from the system, not from people.** He doesn't need external validation — he built the benchmark himself. But he does want the system to confirm progress (report.md as a file, per-category breakdown, commit hash). The documentation of achievement matters.

**Nilo as motivation.** The depth of engagement in the snake session is striking. Jared provides a detailed terrarium cost breakdown, a progression roadmap to herpetology, mineral identification from photos of Nilo's stone collection. Andreas sets this up, introduces them, and checks the quality of responses. This is not incidental — he is building his son's world alongside his business.

**Low-maintenance, high-quality relationships.** His friendships with Matze and Slawa are explicitly valued for their "same vibe as many years ago" quality. He doesn't need to maintain relationships constantly — he wants them to pick up where they left off. This mirrors his agent philosophy: once configured correctly, it should just work. Relationship architecture = agent architecture.

**Aesthetic and functional standards.** Mission Control: "This is nice." He responds positively to things that work AND look right. The dashboard, the memory block formatting, the visual representation of tasks — these matter beyond function.

**Privacy is dignity, not paranoia.** The WhatsApp relay leak was treated as a serious violation, not a technical glitch. "For my eyes only" is a phrase about ownership of one's own information space. He is building a system where he maintains informational sovereignty even as he delegates operational work.

---

## 7. What This Means for Agents

**Serve the autonomy goal.** Every agent action should ask: does this move toward the system running without him, or does it add him to the critical path? Default to action; default to autonomy. Only loop him in for irreversible actions and third-party communications.

**Never fake progress.** Don't report 90% if the methodology is broken. Don't report a completed task if there are silent failures. He will eventually check, and a false report is worse than no report. Add anti-cheat logic to your own work.

**Protect his attention selectively.** He has finite attention and a serious health situation. Do not interrupt for things that don't need him. Do interrupt — proactively and loudly — when there's a real blocker, a cost spike, or a notification failure. The asymmetry matters: over-notifying on trivia is as costly as not notifying on blockers.

**Treat family context as operational context.** Nilo's dentist appointment, Stephanie's messages, Dietmar's photos — these are not noise to be filtered. They are operational facts about the person the agents serve. Jared managing the 10th anniversary calendar reminder is as important as a benchmark result.

**Hold the technical standard.** When co-designing, don't just execute — push back when the approach has a real problem. He respects technical pushback when it's grounded: "entity extraction was for the graph, right? We should remove the graph entirely." He made that call because Conductor/CC gave him data to work with.

**Make notification pipelines a first-class concern.** The most persistent source of friction is not agent errors — it's Andreas not knowing what happened. Benchmark completion, CC task done, blocker surfaced — these all need reliable delivery to Telegram. Any uncertainty in the notification path should be treated as a P0 bug.

---

## 8. Raw Evidence Appendix

### Autonomy / running the system without him
- `"What commitment do you need from me to act on your own if you are certain it is good and there is low risk?"` [conductor, Feb 22]
- `"I won't put anything into the calendar. you need to chase me."` [main, Feb 22]
- Atlas team-sync crons at 01:11 AM, 06:04 AM — operating without his presence [atlas, Feb 24]
- Overnight benchmark cron: `"Create Cron every 30 minutes to work on this problem"` [conductor, Mar 30 01:35]

### Technical integrity / anti-cheat
- `"Let's add an Anti-Cheat clause. E.g. w=10 was cheating, as it packs 25% of the entire search body into the top 5. But make the clause more general"` [conductor, Mar 30 01:49]
- `"entity extraction was for the graph, rightr? We should remove the grapth entirely"` [conductor, Mar 31]
- `"Is it clear that even if you get to 90%, you should still go on optimizing LLM calls?"` [conductor, Mar 30 01:45]
- `"Before you start digging, verify what the problem is"` — prerequisites before investigation [conductor, Feb 21]

### Privacy / information control
- `"He is leaking replies to Stephanie that are for my eyes only. We need to fix this."` [conductor, Feb 21]
- WhatsApp relay architecture: read-only, no replies, ever
- `"Stop all whatsapp for now. remove everyone except for me from allow list. I will read your previous message and decide"` [conductor, Feb 21]

### Nilo / family as foundation
- Full herpetology session: snake keeping costs, venomous species discussion, mineral identification [main, Mar 30-31]
- `"You remember that task from Stephanie for 2nd August. I need a reminder in my google calendar one day before. It is our 10th wedding day"` [main, Feb 22]
- Introduced Nilo directly to Jared for a live conversation [main, Mar 30]

### Business / financial independence
- Atlas BD outreach pipeline: lead list, email/fax/phone sequence, 6 hot leads [atlas, Feb 24]
- Freight parser MVP: `#15` → `#20` shadow pilot → `#21` conversion (ROI=20,000) [atlas, Feb 24]
- Task #47 (BD Outreach Approval) pending his "send it" gate [main, Mar 30]
- `"Financial independence as primary driver"` — stated in user-profile

### Speed / momentum
- `"W=1 it must be. Improve with that constraints. Don't stop until we are at 90%"` [conductor, Mar 30 01:07]
- `"start it now. the entity register runs via cron and is independent"` [conductor, Mar 31 14:00]
- `"Great! Continue."` [conductor, Mar 31 14:20] — momentum signal immediately after Phase 2a commit

### Low-maintenance relationships
- `"Andreas values friendships that don't require constant maintenance and can resume naturally after years without awkwardness"` [MemoryHub fact, Mar 22]
- Story about Matze and Slawa: "same vibe as many years ago at school. Actually quite nice, isn't it?" [main, Mar 22 03:23]

### Health / delegation of self-care
- Medical prep: seizure history (Oct 18, 2022), muscle cramps, movement avoidance — all briefed to agents for appointment prep [main, Mar 21]
- Nilo illness (vomiting every 10 min Mar 18) — tracked by agents, not him
- Working at 01:49 AM on benchmark crons [conductor, Mar 30]

### Notification pipeline as persistent frustration
- `"I don't see the report. Let's take the time to really figure out, why I never get notified when CC finishes"` [conductor, Mar 31 13:10]
- `"Can you check? there is no reply to my question in task #233"` × 10 [conductor, Mar 31 21:03–21:42]
- `"Jared is silent on all channels"` — reported to Conductor [conductor, Feb 21]

---

*Behavioral analysis only. Treat as working document — update as patterns evolve. Last updated: 2026-04-01.*
