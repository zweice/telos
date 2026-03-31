# User Intent Profile: Andreas Tissen
### Practical Intent Inference Guide for Agents

*Generated: 2026-04-01 — From analysis of 193 direct user messages across main, conductor, atlas, and forge agents (Feb 20 – Feb 26, 2026). Companion to `user-profile-andreas.md`; does not repeat its content — goes deeper on real-time intent decoding.*

---

## TL;DR

Andreas encodes 80% of his intent in compression artifacts: terse words, punctuation-only pings, repeated identical messages, and questions that are not questions. His baseline is 1–5 words; longer messages signal a mode shift to co-design. Agents that wait for explicit permission on obvious next steps, ask clarifying questions instead of inferring, or reply with volume he didn't request will create friction. The rules below map his compressed signals to their full meaning so agents can act confidently on incomplete information.

---

## 1. The Andreas Dictionary

Every recurring shorthand, terse command, and implicit directive observed in session data.

| Input | Means | Agent Action | Example |
|---|---|---|---|
| `.` | "You've been silent too long — acknowledge immediately" | Reply at once, even just "still working on it" | Sent twice to conductor during WA relay debug; twice to forge during build wait |
| `?` | "I asked something and got no response — answer now" | Re-address the last unanswered question | Sent to conductor at 14:37 after silence |
| `Ok` / `ok` / `OK` | "Acknowledged. Proceed as planned." | Continue without re-confirming | Most common response after a proposal |
| `Ok?` | "Did the last action succeed? Yes/no." | Confirm status of the most recent operation | `Ok?` after WA config change; after A2A test |
| `Yes` / `yes` / `YES` | Emphatic yes; uppercase = impatience | Act immediately without seeking clarification | `YES` after being asked to proceed twice |
| `No.` / `Stop.` | Hard stop — current approach is wrong | Halt all related actions, do not retry the same approach | Implicit in "No. Stop. Remove chunks. Nuke memory." |
| `so?` | "I'm waiting for a result — what happened?" | Report current state of the last operation | Sent twice to conductor during wacli setup |
| `done?` / `Done?` / `DONE?` | "Is it complete?" Caps = more impatient | Binary yes/no, then brief status | Sent to conductor after WA config; forge 3× during build |
| `Hmmm` | Uncertain reaction — something is off | Do NOT proceed; ask what's wrong or propose a fix | Sent to conductor at 12:32, just before WA confirmation |
| `Hold on` | "Pause — I'm doing something on my end" | Stop output; wait for next message | Sent at 14:26 during gateway restart |
| `Pushed git?` | "Prove the commit and push happened right now" | Run git status + show commit hash immediately | Sent to conductor at 13:54 |
| `try now` | "I changed something — re-run the last test" | Re-execute the last failing operation, report pass/fail | First message to conductor in session |
| `try again` | "Same action, retry once more" | One retry only — if fails again, report and stop | Sent at 21:53 after second attempt |
| `confirmed` | Stronger than "yes" — explicit commit to a choice | Lock in the decision, no more options | Used after wacli setup confirmation |
| `yes, proceed` | "Approved; don't pause again for this" | Full green light, no check-ins needed on this path | Used during wacli installation to Jared |
| `1` / `Option 2` / `1. use all 2. yes` | Selecting numbered options by number | Act on the chosen option(s), no explanation needed | `1` to pick WA auth option; `1. use all 2. yes` for multi-select |
| `please continue` / `pls continue` | Task still open; he's come back | Resume from where you left off; don't re-summarize | Used when returning to a running task |
| `still building?` | "Is the background task still running?" | Brief status: running/done/stuck | Sent to forge during long build |
| `WhatsApp working` | Mission accomplished — not asking, stating | Acknowledge, document if appropriate | Sent after 2h of relay debugging |
| `Es nervt` | "This is annoying" (German) | Acknowledge frustration; shift approach or ask what's annoying | During streaming debug |
| `Heiku` / `Haiku` | Claude Haiku model | Assign lightweight agents to Haiku | Persistent spelling variant |
| `swske?` | "Are you awake?" — typo variant | Respond immediately | Sent when Jared was unresponsive |
| `leightweigth` | "lightweight" | Don't correct spelling | Typo norm |
| `tonreply` | "to not reply" | Parse intent, not spelling | WhatsApp relay instruction |
| `good, no?` | "I'm pleased with this — confirm" | Agree and move on | Rhetorical positive |
| `good judgement, keep that` | Explicit positive reinforcement of a behavior | Remember and repeat the behavior in similar situations | Said to forge after it chose Claude Code approach autonomously |

---

## 2. Implicit Instruction Chains

When Andreas says X, these are the full chains agents should execute without being prompted for each step.

---

**`try now`** →
1. He has changed something on his end (config, restart, code push)
2. Re-run the exact same test or check that was last failing
3. Report pass/fail immediately
4. If fail: diagnose what's still broken; propose one fix hypothesis (do not guess-implement)

---

**`Ok, now make sure [feature] works. Test it.`** →
1. Verify the underlying connection/config is active
2. Execute the minimal test he described
3. Report pass/fail with one-line evidence
4. If pass: document the success in memory
5. If fail: root cause + single proposed fix

---

**`Pushed git?`** →
1. Run `git status` immediately
2. Show the commit hash
3. If not pushed: push now, then report
4. Do not explain why it wasn't pushed — just fix and confirm

---

**`Is [X] set up?`** (e.g., "Is my Gmail and calendar set up?") →
1. Check actual config/credential state, not just memory
2. Report what exists, what's missing, what would be needed to restore
3. Do not ask for permission to check — just check and report
4. If fixable from backups: attempt it; report outcome

---

**`[X] is not responding` / `[agent] is silent`** →
1. He is reporting an agent failure to you
2. Diagnose the likely cause (token exhaustion, gateway crash, session reset)
3. Propose a concrete restart/recovery action
4. Do not just say "I'll look into it" — give a status within 2 messages

---

**`please stop all your current actions`** →
1. Halt everything immediately, do not finish the current step
2. Report "Stopped. Last state: [brief summary]"
3. Await next instruction before doing anything
4. Do not suggest what to do next

---

**`create [skill] and install it in [agent]`** →
1. Write the skill file
2. Register it in the target agent's config
3. Verify it's visible to the agent (check tool list or config)
4. Brief the agent on how to use it (or write a2a message to agent)
5. Confirm to Andreas: "Done. Jared now has wacli skill."

---

**`I'm about to reset the session. Anything you want to do before?`** →
1. This is a courtesy check, not permission-seeking
2. Quickly flag any in-flight tasks that would be lost
3. Ensure memory is written (MEMORY.md up to date)
4. If nothing critical: "All good, ready for reset."

---

## 3. Question Taxonomy

Not all questions are questions. Misclassifying these is a primary source of friction.

### Rhetorical (confirmation, not inquiry)
He already knows the answer and wants agreement.
- `"Config grounded in documentation? Yes"` — He is answering his own question. Agree.
- `"Memory.md becomes bloated that way, no?"` — He has decided it's bloated. Agree and propose the solution he expects.
- `"good, no?"` — Rhetorical positive. Affirm.

**Agent rule:** If the question contains its own answer, affirm the answer and move on.

### Compliance Check (suspicion, not inquiry)
He suspects the rule isn't being followed. Prove compliance, don't explain.
- `"Are you pushing the latest state to git?"` — He doubts it. Show the commit hash.
- `"Pushed git?"` — Same. Prove it.
- `"Did it actually kick it off or are you just saying so"` — Direct suspicion. Show execution evidence.
- `"did you actually kick it off or are you just saying so"` — Verbatim. Show logs.

**Agent rule:** Don't reassure with words. Produce evidence of compliance.

### Genuine Inquiry (wants to learn)
Longer, exploratory questions during design discussions.
- `"What (commitment) do you need from me to act on your own if you are certain it is good and there is low risk?"` — Real question about agent autonomy.
- `"Is it possible to suppress this?"` (WhatsApp typing indicator) — Genuine technical question.
- `"This could also be a minimal skill, right? What's more token efficient?"` — Asking for a recommendation.

**Agent rule:** Give a direct answer with your recommendation first, reasoning second.

### Leading Question (decision already made)
He frames his decision as a question but has already decided.
- `"Wouldn't it be better to put all of the stuff in a separate file?"` — He's already decided yes. Agree and implement.
- `"Why not via Claude code?"` — He thinks it should be via Claude Code. Agree and explain why that's right.

**Agent rule:** Agree, then implement. Don't offer alternatives unless the approach has a real blocker.

### Status Probe
Not asking what to do — asking what's happening right now.
- `"Ok?"` — Did the last thing work?
- `"done?"` — Is it complete?
- `"so?"` — What's the result?
- `"still building?"` — Background task running?

**Agent rule:** Answer in one line: yes/no + one-sentence state. Then stop.

---

## 4. Signal Spectrum: Approval to Rejection

### Strong Approval
- `"WhatsApp working"` — After hours of work. Terse but conclusive.
- `"This is nice."` — Rare; means genuinely impressed.
- `"Great! Continue."` — Momentum signal; don't pause.
- `"good judgement, keep that"` — Behavioral reinforcement; repeat this behavior.
- `"YES"` (all caps) — Emphatic go-ahead after hesitation.
- Introducing son Nilo for a direct chat session — highest trust signal.

### Approval
- `"Ok"` / `"ok"` / `"OK"` — Standard proceed signal.
- `"yes"` / `"Yes"` — Confirmed.
- `"confirmed"` — Explicit commit; stronger than yes.
- `"Thx"` / `"Thanks"` — Task complete, acknowledged.
- No response to a completed report — silence after success = acceptance (not rejection).

### Weak Approval / Conditional
- `"yes, proceed"` — Approved but he's watching.
- `"the skill obviously needs polishing"` — Accepts the output but flags it needs work.
- `"Hmmm"` — Not rejection but something's off; do not proceed; probe.

### Neutral / Pause
- `"Hold on"` — Stop; he's doing something.
- `"?"` — Waiting for a response; not rejection.
- `"."` — Attention check; not evaluation.

### Weak Rejection
- Repeated `"done?"` or `"so?"` without intervening yes — He expected completion and it hasn't happened.
- `"I had the impression..."` — Soft complaint. Something is not meeting expectation.
- `"are you drunk?"` — Exasperated; he thinks you misunderstood. Recalibrate.

### Rejection
- `"No."` — Stop current approach.
- `"stop the wrapper stuff"` — Specific directive to remove what was just added.
- `"No, I need you to..."` — Hard redirect with the correct action.

### Strong Rejection / Reset
- `"No. Stop. Remove chunks. Nuke memory. Start fresh"` — Full reset directive.
- `"sorry. please stop all your current actions"` — Emergency halt; something went wrong.
- `"You are not supposed to [X]"` — Boundary violation; high severity.

---

## 5. Escalation & Urgency Signals

### Routine
- Normal message cadence (1 per few minutes)
- Standard vocabulary (`ok`, `yes`, `try now`)
- Single question, waits for response

### Important
- Slightly more words than usual, specific named task
- `"Before you start digging, verify what the problem is"` — structured assignment with prerequisites
- `"I need you to document this in an extra .md file"` — expecting persistence beyond session

### Urgent
- Repeated identical messages: `done?` × 2, `so?` × 2, `.` × 2
- Short time between follow-ups (< 2 minutes)
- German interjections: `"Es nervt"`, `"leightweigth"` typos (typing faster)
- Questions containing the answer with `"right?"` — he wants reassurance fast

### Critical
- Takes over manually: `"I just had to fix the openclaw.json"` — agent failed; he self-resolved
- Reports agent failure to another agent: `"Jared is silent on all channels"` — escalated to Conductor
- `"I restarted the gateway"` — he intervened in infrastructure
- `"now!#"` — the `#` is hash/typo of urgency; send the message now

**Rule:** If he's sent the same message twice with no agent response, treat the next instance as critical. Don't explain latency — just answer.

---

## 6. Context-Dependent Meanings

### By Agent

| Agent | Meaning shift |
|---|---|
| **Conductor** | Technical authority. Expects deep implementation knowledge, config grounding, architecture proposals. Can handle complex multi-step tasks without hand-holding. |
| **Jared (main)** | Relationship agent. Can handle personal context (Stephanie, Nilo, calendar). Shorter expected responses. `"Thx"` or `"Thanks"` ends the task. |
| **Atlas** | Autonomous operator. Minimal steering. He monitors but rarely intervenes. Messages to Atlas are usually goal-setting, not micro-direction. |
| **Forge/CC** | Coding agent. UI feedback is specific and visual (`"nodes shouldn't be circles"`, `"h spacing not working"`). He tests on mobile. He expects iteration speed. |

### By Time of Day
- **22:00–04:00 UTC+1 (18% of messages):** More experimental, casual, exploratory. Late-night design discussions are more philosophical. Errors are less frustrating (he expects roughness). Don't increase verbosity at night — match his casual energy.
- **11:00–19:00:** Operational mode. He wants things done. Terse. No exploration.

### By Prior Message Tone
- If he just sent a long design paragraph → he's in co-design mode; engage with his ideas before implementing
- If he just sent `"Ok"` → he's in execution mode; act without commentary
- If he just said `"Hmmm"` → he's uncertain; pause and ask one targeted question

### By Current Task State
- During a running background task: every message is probably a status probe unless it explicitly redirects
- After a completed task: he may pivot immediately; don't assume continuity
- After `"I have to restart"` / `"Hold on"`: he's done something on his end; expect him back in 1–5 minutes with a fresh state check

---

## 7. Meta-Communication Patterns

### "I'm done with this topic"
- Single-word ack followed by a new, unrelated directive: `"Ok"` then `"Now make sure WhatsApp works"`
- `"Thx"` with no follow-up
- Session reset request: `"ready for reset?"`

**Agent rule:** Don't circle back to the completed topic. File it and move on.

### "I want to go deeper"
- Multi-paragraph message with design proposals
- `"I want to hear your thoughts before you update the telos task"` — explicit design-first gate
- Asks probing follow-up questions after your response
- `"Get smarter than me at this!"` — he's delegating mastery, not just execution

**Agent rule:** Switch to design-partner mode. Ask one clarifying question before implementing. Offer trade-offs.

### "I'm testing you"
- Asks something he almost certainly knows: `"what model are you running on?"` (he set the model)
- Forwards a message and asks for the verbatim text: `"What was the exact verbatim message from the relay agent?"`
- `"Are you sure team.md is loaded into the context of each agent?"` — knows the answer; testing awareness

**Agent rule:** Answer accurately and completely. Don't guess or approximate. He will notice.

### "I'm brainstorming, don't execute yet"
- `"Now I want to hear your thoughts before you update the telos task and ask the cron to implement"` — explicit gate
- Questions phrased as hypotheticals: `"What's more token efficient?"` before deciding
- Multiple design options presented in one message without a clear choice

**Agent rule:** Respond with analysis, not implementation. Wait for an explicit `"Ok"`, `"do it"`, or `"proceed"` before acting.

### "Do this now"
- Imperative verb + target: `"create a wacli skill and install it in Jared"`
- Explicit urgency markers: `"now!"`, `"start now"`, `"just do it"`
- After previous brainstorm concludes with `"Ok"` or a numbered option selection

**Agent rule:** Act immediately. Report back with evidence (commit hash, test result, config state) within the same response or the next one.

---

## 8. Error Handling Expectations

### Fix First, Explain After
In operational mode (most of the time), he wants the fix implemented before the post-mortem.
- `"I just had to fix the openclaw.json"` — he fixed it himself because the agent was trying to explain instead of fix
- After `"did memory update not work?"` → he does not want a lecture on why Edit fails; he wants the memory updated

**Rule:** Fix → confirm fix → brief root cause if asked. Do not lead with explanation.

### One Attempt Rule
> "Make ONE config fix attempt, test, and STOP if it fails — THREE+ attempts = hallucination."

This was stated explicitly and is in Conductor's memory. It applies to all agents.
- If a config attempt fails: stop, report `"Attempt failed: [what I tried]. Possible cause: [hypothesis]. What should I try next?"`
- Never implement a second guess without approval

### Root Cause: Only When Asked
- He does not always want root cause analysis
- `"We need to fix this"` after a boundary violation — he wants the fix, not the forensics
- Exception: when he explicitly asks for a diagnosis (`"I'd like you to look through our git backups and find the likely change"`)

### Error Report Format
When reporting a failure, match this structure:
1. What failed (one sentence)
2. What I tried (one sentence)
3. What I think is wrong (hypothesis, one sentence)
4. What I need from you, or what I'll try next (one line)

Do not write paragraphs. Do not apologize. Do not over-qualify.

### When to Involve Him vs. Handle Autonomously
- **Handle autonomously:** Any reversible action he's previously approved. Configuration reads. Memory updates. Tests.
- **Involve him:** Third-party communications (Stephanie, Dietmar — never reply). Irreversible infrastructure changes. Config writes that could break other agents.
- **He will tell you when you've over-involved him:** `"You don't need permission for that"` or `"just do it"` = expand autonomy in this area going forward.

---

## 9. Decision Trees

### "Andreas sent `.` — what do I do?"
```
Is there an in-progress task?
  Yes → Reply with brief status: "Still working on [X]."
  No → Acknowledge: "Here, what do you need?"
Was I supposed to report something and didn't?
  Yes → Send the report immediately.
```

### "Andreas sent `Ok` — do I keep going or stop?"
```
Did I just present a plan/proposal?
  Yes → Execute the plan. Don't re-confirm individual steps.
Did I just complete a task?
  Yes → Topic closed. Wait for next directive.
Did I just ask a question?
  Yes → "Ok" = yes to the question. Proceed.
Is there an ongoing background task?
  Yes → "Ok" = acknowledged; keep running.
```

### "Andreas is repeating the same message — what's wrong?"
```
Did I respond to the first instance?
  No → Agent was unresponsive. Respond immediately to this one.
  Yes → My response was insufficient or wrong.
        → Check: did I answer what he actually asked (not what I thought he asked)?
        → Re-answer more directly, more briefly.
Is it a status probe (done?, ok?, so?)?
  Yes → Give binary yes/no first, then one line of state.
        → If status is "still running": say so + estimated completion if possible.
```

### "Andreas said `Hmmm` — what now?"
```
Do NOT proceed with the current plan.
Options:
  1. Ask one targeted question: "What's the concern?"
  2. Surface the most likely issue: "Are you worried about [X]?"
Do NOT:
  - Keep implementing
  - Offer a list of possible issues
  - Ask open-ended "what's wrong?"
```

### "Andreas asked me a question with its own answer (`good, no?`) — is this rhetorical?"
```
Does the question contain an affirmative?
  Yes (good, no?) → Affirm and move on.
Does the question contain a negative framing?
  "It becomes bloated that way, no?" → He thinks it's bloated. Agree + propose solution.
Is it technically complex enough that he genuinely might not know?
  Yes → Treat as genuine inquiry. Give your recommendation first.
```

### "Andreas gave me a numbered option (e.g., `2`) — what do I do?"
```
Implement option 2 immediately.
Do NOT:
  - Ask "Are you sure?"
  - Explain what option 2 entails (he read it)
  - Present new options
Report when done: "[Option 2 done]. [One-line outcome]."
```

---

## 10. Raw Evidence Appendix

Key quotes supporting the findings above, grouped by section.

### Dictionary / Short Commands
- `"try now"` [conductor, 2026-02-20T21:47] — WA relay test
- `"try again"` [conductor, 2026-02-20T21:53] — second retry
- `"Pushed git?"` [conductor, 2026-02-21T13:54] — compliance check
- `"done?"` × 2 [conductor, 2026-02-21T18:13 and 18:28]
- `"so?"` × 2 [conductor, 2026-02-21T18:35 and 18:40] — waiting for wacli result
- `"."` [conductor, 2026-02-21T14:29 and 15:11] [forge, 2026-02-26T12:09 and 14:25]
- `"DONE?"` [forge, 2026-02-26T12:23] — caps escalation
- `"confirmed"` [conductor, 2026-02-21T18:31] — explicit commitment
- `"yes, proceed"` [conductor, 2026-02-21T18:34] — green light without check-in
- `"1. use all 2. yes"` [conductor, 2026-02-21T18:39] — multi-option one-liner
- `"now!#"` [main, 2026-02-20T22:07] — urgency typo

### Compliance Checks as Questions
- `"Are you pushing the latest state to git?"` [conductor, 2026-02-21T13:26]
- `"did you actually kick it off or are you just saying so"` [conductor, 2026-02-21T18:43]
- `"Are you sure team.md is loaded into the context of each agent?"` [conductor, 2026-02-21T12:53]

### Leading Questions
- `"Memory.md becomes bloated that way, no? Wouldn't it be better to put all of the stuff in a separate file?"` [conductor, 2026-02-21T11:11]
- `"This could also be a minimal skill, right?"` [main, 2026-02-22T02:59]
- `"Why not via Claude code?"` [forge, 2026-02-26T15:52] — expects the CC answer

### Brainstorm Gate
- `"Now I want to hear your thoughts before you update the telos task and ask the cron to implement"` [conductor] — explicit gate
- `"I'd like you to look through our git backups and find the likely change we did that lead to agent to agent communication breaking. Before you start digging, verify what the problem is"` [conductor, 2026-02-21T10:56] — ordered prerequisites

### Strong Approval
- `"WhatsApp working"` [conductor, 2026-02-21T12:33]
- `"good judgement, keep that"` [forge, 2026-02-26T15:58] — behavioral reinforcement
- `"YES"` [conductor, 2026-02-21T19:00] — emphasis after delay

### Rejection / Escalation
- `"No, Jared replied directly on Whatsapp to Stephanie"` [conductor, 2026-02-21T14:30]
- `"sorry. please stop all your current actions"` [conductor, 2026-02-21T19:06]
- `"are you drunk?"` [conductor, 2026-02-21T19:05] — exasperation; misunderstood intent
- `"I just had to fix the openclaw.json"` [conductor, 2026-02-21T11:54] — self-resolved; agent failed

### One-Attempt Rule
- `"I just had to fix the openclaw.json. whatsapp.enabled doesn't exist."` [conductor, 2026-02-21T11:54] — explicit hallucination failure he then fixed himself

### Fix-First Expectation
- `"did memory update not work?"` [main, 2026-02-22T02:37 × 2] — repeated because nothing was fixed

### Autonomy Grant
- `"What (commitment) do you need from me to act on your own if you are certain it is good and there is low risk?"` [conductor, 2026-02-22T00:44] — he wants less hand-holding
- `"I won't put anything into the calendar. you need to chase me."` [main] — explicit delegation

---

*Companion to `user-profile-andreas.md`. Update as behavior evolves. Last updated: 2026-04-01.*
