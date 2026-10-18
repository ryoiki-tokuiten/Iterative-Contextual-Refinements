# Deepthink

Deepthink tackles a hard challenge by running several different strategies side by side. Each strategy lives in its own branch. In every iteration each branch writes or improves a solution and has it critiqued, and all branches finish the iteration before any of them moves on. Every few iterations the system looks at how each branch has been trending and decides whether to keep it, change its strategy, or replace it. At the end, a judge picks the best solution among the surviving branches.

Two kinds of supporting evidence can be added along the way, and both are optional: hypotheses that are tested in isolation, and sets of alternative solutions. The pipeline is the same on every run. Settings change the number of branches, the length of the run, and which optional agents take part.

## Terms

| Term | Meaning |
|---|---|
| Branch, slot | One strategy and everything built on it. Branches are named `main1` to `mainN`. The name belongs to the slot, so replacing a branch's strategy text or the whole branch keeps the name. |
| Iteration | One round in which every branch advances once. |
| Window | The `j` iterations between two global updates. |
| Global update | Runs every `j` iterations. Scores each branch, then keeps it, rewrites its strategy, or replaces it. |
| Heartbeat | Runs every `k` iterations. Refreshes the evidence that corrections read. |
| Curated context | That evidence: tested hypotheses and structured noise, prepared per branch. |
| Structured noise | A set of five fully worked alternative solutions for one branch. It is evidence about the branch and is never a candidate for the final answer. |
| DOS | Dissected Observations Synthesis. An agent that summarizes where every branch stands. |
| BSR | Branch State Representation. An agent that reports what changed in a branch during a window and what it expects next. |

## Principles

- A branch name is also its folder, `Strategy-N`. Rewriting a strategy never changes the name.
- No agent decides what happens to a branch. BSR describes the window and gives a forecast, and fixed formulas turn that into a decision.
- Iteration numbers count from the start of the run for every branch. A replacement branch created after iteration 10 records its first solution as iteration 10 and its first correction as iteration 11.
- Hypotheses and structured noise are optional. The run works without either.

## Configuration

| Setting | Meaning | Range | Default |
|---|---|---|---|
| `i` | Total iterations | 5 to 20 | 10 |
| `j` | Iterations between global updates | 3 to 8 | 5 |
| `k` | Iterations between heartbeats | 2 to `j` | 3 |
| `strategiesCount` | Number of branches | 1 to 5 | |
| `strategyProximityLoops` | Rounds of strategy generator and proximity review | | |
| `hypothesisCount` | Hypotheses per heartbeat. 0 turns hypotheses off | | |
| `hypothesisProximityLoops` | Rounds of hypothesis generator and proximity review | | |
| `disableSolutionPool` | Turns structured noise off | | |
| `isolateBranches` | Correction and structured-noise agents get no information about other branches | | |
| `deepthinkCodeExecutionEnabled` | Gives agents sandbox tools | | |
| `thinkingLevel` | Reasoning effort requested from the provider | | |

All bounds are inclusive and a violation is reported as an error. `j` may be larger than `i`: with `i = 5` and `j = 8`, no global update runs.

Hypotheses and structured noise share one `k` slider, in a panel titled "Customize How Often Curated Context Is Refreshed". If both are turned off, the panel collapses, curated context is off, and `k` is ignored.

`isolateBranches` is enforced through the agents' instructions. Every agent can technically read the whole repository, so isolation depends on the agent following its prompt.

Each agent has an editable system prompt and an optional model override. The override wins over the run's selected model.

## The run loop

```text
Seed strategies
Iteration 1            every branch writes a first solution, then it is critiqued
Iterations 2 to i-1    every branch corrects its solution, then the correction is critiqued
Iteration i            every branch corrects its solution, with no critique
Final judge
```

Inside an iteration, all branches run in parallel and the system waits for every one of them to finish. The final iteration has no critique because nothing would read it: the judge sees only solutions, and BSR does not run after the last iteration. There are no hypotheses before iteration 1, because hypotheses are generated from critiques.

After iteration `n` finishes, exactly one of these happens:

1. If `n = i`, the run stops and goes to the final judge. No heartbeat or global update runs.
2. If `n` is a multiple of `j`, a global update runs. It always ends with a heartbeat, whatever `k` is.
3. Otherwise a counter of iterations since the last heartbeat goes up by one. When it reaches `k` and the heartbeat is worth running, a heartbeat runs and the counter resets. If curated context is off, this step is skipped.

Whatever runs after iteration `n` is what the corrections in iteration `n + 1` and later will read.

**When a heartbeat is worth running.** A heartbeat is read by the corrections that follow it, up to the next global update, which brings a heartbeat of its own. So a heartbeat only runs if it will serve at least two corrections. Let `G` be the next multiple of `j` after `n`. If a global update lies ahead (`G < i`) and `G - n < 2`, the heartbeat is skipped. If no global update lies ahead, it runs. A heartbeat that ends a global update is never skipped. The counter resets after any heartbeat, wherever it ran.

**Example: `i = 15`, `j = 5`, `k = 3`**

| After iteration | What runs |
|---|---|
| 1, 2 | nothing |
| 3 | heartbeat |
| 4 | nothing |
| 5 | global update, then its heartbeat |
| 6, 7 | nothing |
| 8 | heartbeat |
| 9 | nothing |
| 10 | global update, then its heartbeat |
| 11, 12 | nothing |
| 13 | heartbeat |
| 14 | nothing |
| 15 | final iteration (correction only), then the final judge |

**Example of a skipped heartbeat: `i = 14`, `j = 6`, `k = 5`.** After iteration 5 the counter reaches `k`, but the global update comes right after iteration 6, so a heartbeat would serve only one correction. It is skipped, and the global update's heartbeat refreshes everything.

## Strategy generation

Strategies come from a generator and a proximity reviewer that take turns. The generator proposes, the reviewer criticizes, and the generator revises, for as many rounds as `strategyProximityLoops` says. The last proposal is used. What each agent receives is listed under What every agent receives.

The reviewer looks for overlap between strategies, variations that are only on the surface, parts of the problem that no strategy covers, and strategies that depend on each other.

**Seed.** The output is the full set:

```json
{ "strategies": ["...", "..."] }
```

The strategies are assigned to `main1` to `mainN` in order.

**Global update.** The generator returns only the slots that are changing, covered in the global update section below.

## Branch work

### Solution attempt

Runs in iteration 1 and for every replacement branch. It writes its solution into `Strategy-N/`.

### Critique

Assesses the solution just produced for correctness, completeness, broken constraints, structural weaknesses, and whether the strategy still looks viable. It does not rewrite the solution.

### Correction

Writes the branch's next complete solution into `Strategy-N/`. When isolation is off, it is expected to open the other branches' directories and learn from them.

### Memory bank

At each global update, every surviving branch gets a new memory bank. The agent merges the previous memory bank with the window's full history. It records what was learned, which failures keep recurring, which repairs were tried, and where the strategy has been heading.

The window is the `j` iterations that end at the update: iterations `n - j + 1` to `n`. After a rollback, only the iterations that remain are used. If none remain, the previous memory bank stays and no new one is written. Nothing is compressed inside a window. Only the memory bank compresses.

## Heartbeat

A heartbeat prepares the evidence that corrections will read. What it runs depends on which optional parts are on.

| Hypotheses | Structured noise | Steps |
|---|---|---|
| on | on | DOS, hypotheses, tests, mapping, structured noise |
| on | off | DOS, hypotheses, tests, mapping |
| off | on | structured noise only |
| off | off | nothing |

A heartbeat that ends a global update reuses that update's second DOS call instead of running its own (see DOS).

### Hypotheses

A generator and a proximity reviewer take turns, as they do for strategies. The reviewer checks that each hypothesis can be proven wrong, can be tested alone, and matters to the challenge.

Each hypothesis is an object:

```json
{
  "hypothesis_id": "h2",
  "text": "A self-contained claim that a test could prove wrong",
  "target_branches": ["main1", "main3"],
  "predicted_test_outcome": {
    "reason": "...",
    "probabilities": { "VALIDATED": 0.25, "REJECTED": 0.60, "INCONCLUSIVE": 0.15 }
  }
}
```

An empty `target_branches` list means the result is useful to every branch. The probabilities must sum to 1.

### Tests

Each hypothesis goes to its own tester, and the testers run in parallel. A tester receives the challenge (and any image) and its one hypothesis, and nothing else. It cannot see strategies, branch history, other hypotheses, or who the result is for. The sandbox enforces this: the tester can read and write only its own `Hypothesis-M/` folder, and it has no shared workspace. This independence matters because the tester's verdict is later compared with the generator's prediction.

A tester ends with a classification line, which is read as `VALIDATED`, `REJECTED`, or `INCONCLUSIVE`.

### Mapping

Each branch gets a packet made of every hypothesis marked for all branches plus every hypothesis that targets it, each with its full test result. The same selection decides which hypotheses a branch's prompt and sandbox include.

### Structured noise

One agent per branch runs in parallel, after testing and mapping are complete, because each agent reads its branch's packet. The agent works out five alternatives in full and returns:

```json
{
  "strategy_id": "main1",
  "solutions": [{ "title": "...", "content": "...", "confidence": 0.7 }]
}
```

### What a heartbeat produces

For each branch, a packet of mapped hypothesis results, which every correction reads until the next heartbeat, and a structured-noise set, which is stored and handed to that slot's later structured-noise agents. The heartbeat also adds a block to the hypothesis history.

## Global update

A global update runs after iteration `n` when `n` is a multiple of `j` and `n < i`.

1. **BSR and the first DOS call run in parallel.** One BSR agent per branch, plus one DOS call that summarizes where every branch stands.
2. **Code decides.** The BSR reports go through the formulas in the BSR section and give each branch one decision: CONTINUE, EVOLVE, or PRUNE.
3. **New strategies.** The strategy generator and proximity reviewer rewrite the slots that need it (below).
4. **The repository is updated.** Pruned branches are archived, branches that are rolling back are restored, and each freed slot gets a fresh folder.
5. **Memory banks and replacements.** In parallel, each surviving branch gets a new memory bank, and each replacement branch writes a first solution and has it critiqued. The system waits for both. Every active strategy folder is then committed as the starting point of the next window.
6. **Second DOS call.** If hypotheses are on, DOS looks at the updated state and produces feedback on the previous heartbeat's hypotheses.
7. **Heartbeat.** It runs whatever `k` is, and its DOS step is the second call from step 6.

The first DOS call runs even when curated context is off, because strategy generation uses it. The second runs only when hypotheses are on.

### Strategy changes

Its inputs are listed under What every agent receives.

It returns only what changes:

```json
{
  "evolved_slots": [{ "slot_id": "main2", "updated_strategy_text": "..." }],
  "pruned_slots":  [{ "slot_id": "main4", "new_strategy_text": "..." }]
}
```

There must be one entry for every EVOLVE slot, one for every PRUNE slot, and none for any other slot. A branch that continues cannot be touched, because the output format has no place for it. For a pruned slot, the generator decides how much of the old strategy to reuse. It may re-aim the same idea, keep the part that worked, or drop it. The strategy text is the only thing a replacement branch inherits.

## DOS

DOS summarizes where the branches stand. It remembers nothing between calls. Each call is built fresh from the stored state.

| Call | When | Output |
|---|---|---|
| Heartbeat DOS | Start of a heartbeat that does not end a global update, hypotheses on | Summary, plus feedback on the last heartbeat's hypotheses if one exists |
| First call in a global update | Step 1 | Summary only. It goes to the strategy generator |
| Second call in a global update | Step 6, hypotheses on | Summary and feedback on surviving branches. It also serves as the DOS for the heartbeat that follows |

After the update, replacement branches appear with only their first solution and critique, and pruned branches are gone. A branch that rolled back has lost its later iterations. DOS can give feedback only on branches that survived, since new branches never received the last heartbeat's results. Each call comes with a note explaining which of these cases applies, and the second call's note lists what happened to each slot. The inputs and notes are listed under What every agent receives.

DOS reports only what it can see. It does not claim that a hypothesis caused a decision about a branch. For each hypothesis and each branch the hypothesis was sent to, it says whether the result was used, and if so whether correctly, partly, or wrongly. It also says whether a later critique gives strong evidence against the tester's verdict.

```json
{
  "core_synthesis": { "...": "the structured summary" },
  "hypothesis_feedback": [
    {
      "hypothesis_id": "h2",
      "branch_utilization": [
        { "branch_id": "main1", "utilization": { "reason": "...", "classification": "USED_CORRECTLY" } },
        { "branch_id": "main3", "utilization": { "reason": "...", "classification": "NOT_USED" } }
      ],
      "critique_counterevidence": [
        { "branch_id": "main1", "reason": "...", "classification": "STRONG" }
      ]
    }
  ]
}
```

The classifications are `USED_CORRECTLY`, `USED_PARTIALLY`, `NOT_USED`, and `MISUSED`. `critique_counterevidence` can be left out when there is none. `hypothesis_feedback` appears only when there is a previous heartbeat to report on.

## Hypothesis feedback

When DOS returns feedback, the harness turns it into a record for each hypothesis.

**Surprise** is `-log2` of the probability the generator gave to the verdict the tester actually reached. It measures how unexpected the result was to the generator. A probability below 0.01 is treated as 0.01.

**Utilization** is counted over the hypothesis-and-branch pairs that DOS could judge. With C, P, N, and M the counts of correct, partial, not used, and misused, and T their total, the result is the vector `[C/T, P/T, N/T, M/T]`. The four numbers are not combined into a single score. If T is 0, the record has no utilization.

```json
{
  "hypothesis_id": "h2",
  "your_predicted_test_outcome": { "VALIDATED": 0.25, "REJECTED": 0.60, "INCONCLUSIVE": 0.15 },
  "prediction_note": "What you predicted about this hypothesis when you generated it.",
  "observed_test_outcome": "VALIDATED",
  "surprise_bits": 2.0,
  "utilization": { "correct_use": 0.50, "partial_use": 0.25, "not_used": 0.25, "misused": 0.00 },
  "utilization_note": "Calculated from DOS's observations.",
  "critique_counterevidence": [{ "branch_id": "main1", "classification": "STRONG", "reason": "..." }]
}
```

Each record is saved in the matching `Hypothesis-M/` folder and kept in the heartbeat's block, together with the generator and reviewer exchange, the final hypotheses, the test results, and the branch packets. The strategy agents never see predictions, surprise, utilization, or counterevidence.

Surprise and utilization are read separately:

| Surprise | Utilization | Reading |
|---|---|---|
| high | high correct | An unexpected finding that proved useful |
| low | high correct | A useful confirmation |
| high | low | Unexpected, but made no difference to the branches |
| low | low | Redundant hypothesis |
| any | high misuse | The packet was hard to apply or poorly framed |
| any | strong counterevidence | The tester's verdict may be wrong |

## BSR

### What it does

BSR does not judge whether a branch's answer is correct. Confidence in an answer, an exhausted critique, and an answer that looks complete all count as no evidence of truth, since a branch can be firmly stuck in a wrong answer. BSR serves one question: is another window on this branch's strategy worth the compute?

It does not answer that question itself. It reports what changed during the window and what it expects to happen next, and code answers the question from those two things.

A branch can run out of value in two ways. In failure, it is stuck, getting worse, or repeating the same unresolved problems. In saturation, the strategy has given what it can, and another window would add little whether or not the answer is right. Progress that is already standing protects a branch from being pruned. A failing branch is released, and a saturated one gets a new strategy.

BSR runs once per branch at each global update, in parallel, and judges the whole window as a single trajectory. It never outputs an action.

### The report

```json
{
  "branch_id": "main2",
  "confirmed_progress":   [{ "iteration": 6, "size": "large", "reason": "..." }],
  "confirmed_regression": [{ "iteration": 9, "size": "large", "reason": "..." }],
  "critique_alignment": { "value": 0.6, "reason": "..." },
  "next_window_prediction": {
    "reason": "...",
    "probabilities": { "PROGRESS": 0.10, "STALL": 0.20, "REGRESS": 0.70 }
  }
}
```

An **event** is a change placed at the iteration whose correction caused it, with a size:

- `small`: a local change with little consequence
- `medium`: a change that matters for correctness or completeness
- `large`: a change that alters the validity or structure of the answer

BSR gives only these sizes and never a number. A branch's first solution is the baseline of its window and carries no events.

An event counts only when something besides the correction's own claim supports it. For progress, that means a critique from the same or a later iteration agrees the issue is resolved, or a sandbox run shows it. For regression, the same kinds of evidence show a defect that was absent before, or one that had been fixed and came back.

`critique_alignment` runs from -1 to 1. At 1, every point in the critiques was taken up by the next correction. At -1, the corrections went against them. It keeps a branch whose corrections ignored the critiques from being blamed on its strategy. Negative values are treated as 0.

`next_window_prediction` is what BSR expects if the branch is left alone, meaning CONTINUE. BSR is told what the three outcomes mean: PROGRESS if confirmed progress outweighs confirmed regression by at least one medium event, REGRESS for the opposite, and STALL for anything in between. The probabilities must sum to 1.

### Scoring the window

These constants are part of the formulas and are not settings.

| Constant | Value | Role |
|---|---|---|
| Size weights | small 1, medium 2, large 4 | Convert event sizes to movement |
| Noise level τ | 2 | Smallest net change that counts as a trend |
| Pressure floor θ | 0.3 | Smallest pressure that can trigger EVOLVE or PRUNE |
| Probability floor | 0.01 | Smallest probability used when scoring a prediction |

Code builds a running total over the window's iterations, starting at 0. A progress event raises it by its weight and a regression lowers it.

```text
net       = running total after the last iteration
movement  = sum of the weights of all events, both directions

window outcome:  PROGRESS if net >= τ,  REGRESS if net <= -τ,  otherwise STALL
best_total          = highest value the running total reached (at least 0)
last_good_iteration = latest iteration where the total was at best_total, or window_start
lost_ground         = (best_total - net) / (movement + τ)
progress_kept       = max(0, net_life) / (movement_life + τ)
```

`lost_ground` is the share of the window's movement that was undone after the branch's best point. `progress_kept` uses the branch's whole ledger, including this window, so that a branch which has quietly finished its work does not look like it did nothing. Both are 0 when there are no events.

### Grading the previous prediction

A prediction made at update `w` is about the window that ends at update `w + 1`.

- If the branch was kept (CONTINUE) at update `w`, the prediction is graded at `w + 1`.
- If the branch was rewritten (EVOLVE, either form) or pruned, the prediction no longer applies and is dropped. The branch starts its next window with full credibility, since a new strategy has no record yet.
- A prediction still open when the run ends is never graded.

```text
surprisal   = -log2( max(previous probability of the actual outcome, 0.01) )
credibility = clip(2 - surprisal / log2(3), 0, 1)
effective   = credibility * new prediction + (1 - credibility) * (1/3, 1/3, 1/3)
```

A uniform guess has a surprisal of log2(3), about 1.585 bits. At or below that, credibility is 1. It falls to 0 at twice that value, and it is 1 when there is nothing to grade. The effect is that a BSR that has just been badly wrong has less influence over what happens to the branch. Mean surprisal across all graded predictions is tracked per branch and overall on the Branch State screen, against the 1.585-bit baseline. Below the baseline, BSR's predictions carry information.

### Pressures and the decision

```text
expected_drift = effective[PROGRESS] - effective[REGRESS]
certainty      = 1 - entropy(effective) / log2(3)
stall_evidence = certainty * (1 - effective[PROGRESS]) * max(0, critique_alignment)

pressure[CONTINUE] = max(0, expected_drift)
pressure[EVOLVE]   = max(lost_ground, stall_evidence * progress_kept)
pressure[PRUNE]    = stall_evidence * (1 - progress_kept) * (1 - lost_ground)
```

Certainty is 0 for a uniform guess and 1 for a sure thing. Stall evidence means the evidence that another window will produce nothing. It needs a confident forecast, a good chance of no progress, and corrections that did follow the critiques. A near-uniform forecast cannot produce it. Pressures run from 0 to 1 and do not sum to 1.

The decision for each branch follows three rules in order:

1. If the EVOLVE and PRUNE pressures are both below θ, the branch continues.
2. Otherwise, if the CONTINUE pressure is at least as high as both, the branch continues.
3. Otherwise the higher of EVOLVE and PRUNE wins. Ties go to the less destructive action: CONTINUE, then EVOLVE, then PRUNE.

For EVOLVE, the form is rollback when `lost_ground > stall_evidence * progress_kept`, and in place otherwise. A tie goes to in place.

In practice, a branch that started well and then regressed gets EVOLVE with rollback. A branch that is confidently out of ideas with little progress standing gets PRUNE. A branch that is confidently out of ideas but has a lot of progress standing gets EVOLVE in place, and its solution stays a candidate for the final answer.

**Worked example.** Events: iteration 6 large progress, 7 small progress, 9 large regression, 10 large regression. The running total is 4, 5, 5, 1, -3, so `net` is -3, `movement` is 13, the outcome is REGRESS, and `last_good_iteration` is 8. Lost ground is 8 / 15 = 0.533. The previous prediction gave REGRESS only 0.20, a surprisal of 2.32 bits, so credibility is 0.535 and stall evidence works out to about 0.036. The EVOLVE pressure is 0.533, PRUNE is about 0.015, and CONTINUE is 0. The decision is EVOLVE with rollback to iteration 8.

### What each decision does

- **CONTINUE.** Nothing changes. The branch carries on from its new memory bank.
- **EVOLVE in place.** The strategy text is rewritten. History, memory, and the ledger stay as they are.
- **EVOLVE with rollback.** The branch's folder is restored to the end of `last_good_iteration`. The later iterations leave the folder but remain in git history. The ledger loses the discarded events and keeps the rest. The new strategy text tells the model where not to go. For long-running tasks, restoring is much better than rewriting the strategy and continuing from a memory of a bad trajectory.
- **PRUNE.** The branch is stopped and archived and its slot is freed. A new branch takes the slot with a new strategy, runs a first solution and critique, and starts with an empty ledger. Nothing the old branch produced reaches the new one except what the strategy generator chooses to carry into the new strategy text.

### Ledger and open prediction

Two things are stored per branch and carried from one global update to the next. Both live outside the repository, along with every BSR report, its computed values, and its decision.

- **The ledger** lists every confirmed event still standing, with its iteration, direction, size, weight, and reason. It feeds `progress_kept`. A rollback removes events after the rollback point, PRUNE closes the ledger along with the branch, and EVOLVE in place leaves it alone.
- **The open prediction** is the forecast waiting to be graded or dropped at the next update.

### Who sees BSR output

BSR never sees the prediction it made for the window it is judging, so it cannot shade its report to match its own forecast. Once a prediction has been graded, later BSR calls for the same branch see its outcome and surprisal. No other agent sees any BSR data except the strategy generator, which gets the decisions and event reasons described in Global update.

## What every agent receives

This section lists the prompt of every agent call in the order its parts appear. It is written from the prompt builders in `contextBuilders.ts`, the notes in `harnessNotes.ts`, and the call sites in `pipelineOrchestrator.ts`.

### How a prompt is put together

Each call has a system instruction and a user prompt. The system instruction is the agent's own prompt, taken from the prompt editor and falling back to the default. The user prompt is built from the templates in this section at the moment of the call, from the run's current state.

| Agent | System prompt | Output | Working directory |
|---|---|---|---|
| Strategy generator (seed) | `initialStrategy` | JSON | none, read-only |
| Strategy generator (global update) | `strategyGeneratorGlobalUpdate` | JSON | none, read-only |
| Strategy proximity (seed and update) | `strategyProximity` | text | none, read-only |
| Hypothesis generator | `hypothesisGeneration` | JSON | none, read-only |
| Hypothesis proximity | `hypothesisProximity` | text | none, read-only |
| Hypothesis tester | `hypothesisTester` | text | `Hypothesis-M/` |
| Solution attempt | `solutionAttempt` | text | `Strategy-N/` |
| Critique | `solutionCritique` | text | `Strategy-N/` |
| Correction | `solutionCorrection` | text | `Strategy-N/` |
| Structured noise | `structuredSolutionPool` | JSON | `Solution_Pools/` |
| Memory bank | `memoryBank` | text | `Strategy-N/` |
| DOS | `dos` | JSON | none, read-only |
| BSR | `bsr` | JSON | `Strategy-N/` |
| Final judge | `finalJudge` | JSON | none, read-only |

With sandbox tools off, the prompt goes to the model directly, with JSON mode for the JSON agents and the configured thinking level. With sandbox tools on, the same prompt goes in as the user message to a tool-using agent that has the system prompt, the repository access above, and the `shared_workspace` tool (every agent except the tester). The thinking level is not passed in that mode.

**`{challenge}`.** Every prompt starts from the same challenge text, built once when the run starts:

```text
{text the user typed}

Direct context files:

--- {file name} ---
{decoded text}
--- end file ---
                                      (one block per text or JSON file, in upload order)

<!-- EXECUTION_IMAGE_START -->
<!-- MIME_TYPE: {mime type} -->
{base64 data}
<!-- EXECUTION_IMAGE_END -->
                                      (one block per image, after all text files)
```

Before a prompt is sent, each image block is cut out of the text and sent as an image at that position. The model therefore sees the challenge text and files, then the images, then whatever the prompt contains after the challenge. Files that are neither text nor images are only copied into `direct_context/`.

**Labeled blocks.** A block written as `<Label>` ... `</Label>` is built as the label, a newline, the content with surrounding whitespace removed, a newline, and the closing label. Empty content becomes `Not available.`.

**Spacing.** The templates below show one blank line between parts. Some builders join their parts with a double newline and also have empty parts, which makes the real gap wider in places. Content and order are exactly as shown.

### State that prompts are built from

Prompts are rebuilt from stored fields every time. Nothing is carried over inside a prompt from an earlier call, except where a history is listed below.

| Stored field | Set when | Replaced or added to | Read by |
|---|---|---|---|
| Strategy text | Seed; EVOLVE; PRUNE | Replaced | Everything that names the branch's strategy |
| First solution | Iteration 1, and a replacement branch's first execution | Set once per branch | Fallback when there is no latest solution |
| Latest solution | Iteration 1, then every correction | Replaced | Peers' context, DOS, hypothesis generator, structured noise, strategy generator, final judge |
| Latest critique | Every critique | Replaced | Peers' context, DOS, structured noise |
| Iteration history | After the critique of each iteration (after the correction in the final iteration) | Added to | History windows, BSR, memory bank |
| Memory bank | Each distillation | Replaced | History window of correction and critique, BSR, next memory bank |
| Heartbeat blocks | End of each heartbeat | Added to | Corrections read only the newest block. DOS and the hypothesis generator read only the previous one |
| Structured noise store | Each structured-noise agent | Added to, never trimmed | Structured-noise agents |
| Seed strategy exchange | End of seed generation | Set once | Strategy generator at every update |
| Update strategy exchanges | After each update's strategy step | Added to | Strategy generator at later updates |
| Strategies used so far | Seed; each EVOLVE or new strategy | Added to | Strategy generator at every update |
| Ledger, open prediction, graded predictions | After each update's decisions | Ledger added to; open prediction replaced | BSR |
| DOS outputs | Each DOS call | Added to | Only the first call of an update feeds forward, to the strategy generator and to the second call |

Within one iteration all branches run in parallel and prompts are built from live fields. A branch's prompt can therefore see a peer's field after that peer has already finished its own step in the same phase (see Stage 3).

### One branch across a run

`i = 15`, `j = 5`, `k = 3`, hypotheses and structured noise on, isolation off. Each row shows what the correction in that iteration receives for one branch.

| Correction in iteration | History shows iterations | Memory bank | Curated context comes from |
|---|---|---|---|
| 2 | 1 | none | none yet |
| 3 | 1, 2 | none | none yet |
| 4 | 1 to 3 | none | heartbeat 1 (after iteration 3) |
| 5 | 1 to 4 | none | heartbeat 1 |
| 6 | none | bank 1 (iterations 1 to 5) | heartbeat 2 (end of update 1) |
| 7 | 6 | bank 1 | heartbeat 2 |
| 8 | 6, 7 | bank 1 | heartbeat 2 |
| 9 | 6 to 8 | bank 1 | heartbeat 3 (after iteration 8) |
| 10 | 6 to 9 | bank 1 | heartbeat 3 |
| 11 | none | bank 2 (bank 1 merged with 6 to 10) | heartbeat 4 (end of update 2) |
| 12 | 11 | bank 2 | heartbeat 4 |
| 13 | 11, 12 | bank 2 | heartbeat 4 |
| 14 | 11 to 13 | bank 2 | heartbeat 5 (after iteration 13) |
| 15 (final) | 11 to 14 | bank 2 | none |

The critique in iteration `k` gets the same history and memory bank as the correction in iteration `k`, plus that correction itself. BSR in update 1 sees iterations 1 to 5 and no memory bank. In update 2 it sees iterations 6 to 10 and bank 1. The hypothesis generator in heartbeats 1, 3, and 5 uses a heartbeat DOS. In heartbeats 2 and 4 it uses the DOS call that ended the update.

### Stage 1: seed strategies

**Strategy generator, turn 1.**

```text
# Core Challenge
{challenge}

Requested Number of Strategies: {strategiesCount}
```

**Strategy generator, turn 2 and later.** The prompt is rebuilt from scratch each turn and carries the whole exchange so far.

```text
# Core Challenge
{challenge}

Requested Number of Strategies: {strategiesCount}

# Previous Candidate Strategies & Proximity Feedback
### GENERATOR (Turn 1)
{generator's complete output, as returned}

### PROXIMITY (Turn 1)
{reviewer's complete output}

### GENERATOR (Turn 2)
{...}
                                      (every earlier turn in order, ending with the latest reviewer turn)

Please generate {strategiesCount} revised orthogonal strategies addressing the proximity review feedback. Output the same JSON format.
```

**Strategy proximity reviewer.** Every review is a fresh prompt.

```text
# Core Challenge
{challenge}

Review the current strategy candidates for orthogonality and independence:

[
  "{strategy 1}",
  "{strategy 2}"
]
```

The array is the latest generator output as pretty-printed JSON. The reviewer sees no history, no earlier reviews, and no requested count.

With `strategyProximityLoops = L` there are `L + 1` generator turns and `L` reviews. The last generator output becomes `main1` to `mainN`.

### Stage 2: iteration 1

All attempts finish first. Then all critiques run.

**Solution attempt.**

```text
# Core Challenge
{challenge}

Assigned Strategy: main1
{strategy text}

Produce iteration 1 solution attempt.
```

The attempt does not see the other strategies. The output is stored as both the first solution and the latest solution.

**Critique, iteration 1.**

```text
# Core Challenge
{challenge}

Assigned Strategy ID: main1
Assigned Strategy Text: {strategy text}

<BranchHistoryAndMemory>
No prior iteration history in this window.
</BranchHistoryAndMemory>

<CorrectionToCritique>
{the first solution}
</CorrectionToCritique>
```

After the critique, iteration 1 is added to the branch's history (solution and critique) and the critique becomes the latest critique.

### Stage 3: iterations 2 to i-1

All corrections finish first. Then all critiques run.

**Correction.**

```text
# Core Challenge
{challenge}

Assigned Strategy ID: main1
Assigned Strategy Text: {current strategy text}

<BranchHistoryAndMemory>
{history, below}
</BranchHistoryAndMemory>

<LatestCustomCuratedContext>              only when there is a packet
{the branch's hypothesis packet}
</LatestCustomCuratedContext>

<CrossStrategyPeerIntelligence>           only when isolation is off and other branches exist
{peers, below}
</CrossStrategyPeerIntelligence>
```

The branch's own latest solution and critique do not appear as separate blocks. They reach the correction only through the history.

**History.** Built the same way for the correction and the critique.

```text
<DistilledMemoryBank>                     only when the branch has a memory bank
{memory bank}
</DistilledMemoryBank>

<WindowCorrectionCritiqueHistory>
<Iteration n="6">
<Correction>
{solution of iteration 6}
</Correction>
<Critique>
{critique of iteration 6}
</Critique>
</Iteration>

<Iteration n="7">
{...}
</Iteration>
</WindowCorrectionCritiqueHistory>
```

When no iterations qualify, the whole `WindowCorrectionCritiqueHistory` block is replaced by the sentence `No prior iteration history in this window.` The memory bank, if any, still comes first.

- **Which iterations.** For a prompt in iteration `k`, the history shows every stored iteration `n` with `w <= n < k`, where `w = floor((k - 1) / j) * j + 1`. So `w` is the first iteration of the current block of `j` iterations (1, 6, 11, and so on for `j = 5`), and the history grows by one entry per iteration, then empties when the next block starts. Because `n < k`, the first iteration of each block after the first sees an empty history. That is why rows 6 and 11 of the table above show none.
- **The memory bank** is the branch's current bank. It is replaced, not accumulated, at each update.
- **Replacement branches** are cleared when they are created, so the memory bank is empty and the history follows the same rule.

**Packet.** The newest heartbeat block's hypotheses that were marked for all branches or that target this branch, each as:

```text
Hypothesis {id}: {text}
Verdict: {VALIDATED | REJECTED | INCONCLUSIVE}
Result: {the tester's complete output}

Hypothesis {id}: {text}
...
```

The block is left out when there is no heartbeat yet, when hypotheses are off, or when nothing is mapped to the branch. The packet is replaced at every heartbeat, not added to. Structured noise is not part of the correction prompt.

**Peers.**

```text
Strategy main2: {strategy text}
<LatestCorrection>
{latest solution of main2}
</LatestCorrection>
<LatestCritique>
{latest critique of main2}
</LatestCritique>

Strategy main3: {strategy text}
...
```

The values are read from each peer's stored fields when this branch's prompt is built. Corrections run in parallel, so a peer that has already finished its correction in this iteration shows that new solution here, next to a critique that is still from the previous iteration.

**Critique, iteration 2 and later.** Same template as the iteration 1 critique, with the history above, and `CorrectionToCritique` holding the correction that was just written. The critique runs after every branch has corrected, so the history never contains the iteration being critiqued. After it finishes, the iteration is added to the branch's history.

### Stage 4: heartbeat

Order of calls: DOS (a heartbeat that does not end an update, hypotheses on), hypothesis generator and reviewer turns, testers in parallel, structured-noise agents in parallel. The new heartbeat block is stored and committed at the end.

**Heartbeat DOS.**

```text
# Core Challenge
{challenge}

# Dissected Observations Synthesis - Heartbeat DOS
<HarnessNote>
{note, below}
</HarnessNote>

<PreviousHeartbeatHypothesesAndTests>
Hypothesis {id}: {text}
Verdict: {verdict, INCONCLUSIVE when missing}
Testing Output: {the tester's complete output}
Target Branches: ["main1","main3"]

Hypothesis {id}: {text}
...
</PreviousHeartbeatHypothesesAndTests>

<ActiveBranchesState>
### Branch main1
Strategy: {strategy text}

Latest Correction:
{latest solution}

Latest Critique:
{latest critique}

### Branch main2
...
</ActiveBranchesState>
```

The hypotheses block reads `None.` when there is no previous heartbeat or it had no hypotheses. `ActiveBranchesState` is built from the stored fields at this moment, after the critique of the iteration that just finished.

The heartbeat note: "The hypotheses below were generated at the previous heartbeat, tested independently and mapped to branches, and the branches then ran corrections with those mapped packets. You also have the latest correction and critique of every branch. Synthesize where each branch stands, and for every hypothesis → branch assignment report only what you can actually observe: whether the packet was used, and whether the later critique gives real counterevidence against the tester's verdict."

If the DOS returns feedback, it is attached to the previous heartbeat's records before hypotheses are generated.

**Hypothesis generator, turn 1.**

```text
# Core Challenge
{challenge}

# Hypothesis Generation Context for Heartbeat {N}

<DosCoreSynthesis>                        only when the synthesis is not empty
{core_synthesis as pretty JSON}
</DosCoreSynthesis>

<HypothesisProximityHistory>              only from turn 2 on
### GENERATOR (Turn 1)
{generator's complete output}

### PROXIMITY (Turn 1)
{reviewer's complete output}
</HypothesisProximityHistory>

## Active Running Strategies
- main1: {strategy text}
- main2: {strategy text}

## Latest Branch Corrections (Corrections ONLY, no critiques)
### main1
{latest solution}

### main2
{latest solution}

                                      (the next heading and block appear only when a previous heartbeat exists)
## Previous Heartbeat (Heartbeat {M}) Evidence & Realized Feedback
<RealizedHypothesisFeedback>
{one feedback record as pretty JSON}

{next record}
</RealizedHypothesisFeedback>
```

- The synthesis comes from the heartbeat DOS, or from the DOS call that ended the update when the heartbeat follows an update.
- The proximity history holds only this heartbeat's own exchange. It starts empty and is rebuilt whole each turn, with no extra instruction line after it. Earlier heartbeats' exchanges are not included.
- The feedback records are those of the previous heartbeat only. Each record has the prediction, observed outcome, surprise, utilization, and counterevidence, keyed by hypothesis id. The hypothesis texts and test outputs are not repeated here.
- The prompt does not state how many hypotheses to write. The harness keeps the first `hypothesisCount`.

**Hypothesis reviewer.**

```text
# Core Challenge
{challenge}

# Review Generated Hypotheses for Heartbeat {N}

Review candidate hypotheses for falsifiability, orthogonality, testability in isolation, and challenge relevance:

{the generator's latest complete output}
```

**Tester.**

```text
# Core Challenge
{challenge}

Assigned Hypothesis {id}:
{hypothesis text}

Test this hypothesis strictly within your assigned isolated folder.
```

**Structured noise.**

```text
# Core Challenge
{challenge}

Assigned Strategy ID: main1
Assigned Strategy Text: {strategy text}

<LatestCorrection>
{latest solution}
</LatestCorrection>

<LatestCritique>
{latest critique}
</LatestCritique>

<PreviousPoolsForThisBranch>              only when the slot already has pools
{earlier pool as pretty JSON}

{next earlier pool}
</PreviousPoolsForThisBranch>

<MappedHypothesisPacket>                  only when there is a packet
{the packet, in the format shown under Correction, from this heartbeat's tests}
</MappedHypothesisPacket>

<CrossStrategyLatestPools>                only when isolation is off and other pools exist
Peer Pool for Strategy main2:
{pool as pretty JSON}

Peer Pool for Strategy main3:
{pool as pretty JSON}
</CrossStrategyLatestPools>
```

Both pool blocks are read from the run-wide structured-noise store. The first takes every pool saved under this slot name, in order. The second takes every pool saved under the other slot names. Pools from the same heartbeat appear in the second block if their agent finished before this prompt was built.

### Stage 5: global update

**Step 1, in parallel: step-i DOS and BSR.** Both read the state after the critique of iteration `n`, before any decision is applied.

Step-i DOS:

```text
# Core Challenge
{challenge}

# Dissected Observations Synthesis - Global Update (Step-i)
<HarnessNote>
{note, below}
</HarnessNote>

<ActiveBranchesState>
{same per-branch blocks as in the heartbeat DOS}
</ActiveBranchesState>
```

The step-i note: "Your output is going to the strategy agents that are about to decide which strategies to continue, evolve or replace in this global update. So write it for them: where exactly each branch is failing, what the branches share, what looks worth keeping. Here you only receive the latest correction and critique of every branch, so there is no hypothesis feedback to produce in this call."

BSR, one call per branch:

```text
# Core Challenge
{challenge}

Branch ID: main1
Current Strategy: {strategy text}

<WindowCorrectionCritiqueHistory>
Iteration 6:
Correction: {solution of iteration 6}
Critique: {critique of iteration 6}

Iteration 7:
Correction: {...}
Critique: {...}
</WindowCorrectionCritiqueHistory>

<MemoryBankBeforeWindow>
{memory bank, or "None available."}
</MemoryBankBeforeWindow>

<StandingEventLedger>
[Iter 6] PROGRESS (large): {reason}
[Iter 9] REGRESSION (large): {reason}
</StandingEventLedger>

<EarlierGradedPredictionsHistory>
- Outcome: PROGRESS, Surprisal: 0.86 bits
</EarlierGradedPredictionsHistory>
```

- The window is iterations `n - j + 1` through `n`, inclusive: 1 to 5 for the first update and 6 to 10 for the second. It uses plain `Iteration x:` headings, not the tags used in the correction history.
- The memory bank is read before this update's distillation, so it is the bank from the previous update.
- The ledger has only events from earlier windows. This window's events are added after the decisions are made. An empty ledger prints `Empty ledger.`, and no graded predictions prints `No earlier predictions graded yet.`.
- Graded predictions are looked up by slot name. The open prediction for the window being judged is never passed.

**Step 3: strategy generator.** Runs only when at least one branch is EVOLVE or PRUNE.

```text
# Core Challenge (Global Update {U})
{challenge}

<HarnessNote>
{update note, below}
</HarnessNote>

<StrategyProximityHistory>
# Seed Strategy Generation History

### Strategy Generator (Turn 1)
{seed generator output}

### Strategy Proximity Reviewer (Turn 1)
{seed reviewer output}
                                      (every seed turn in order)

---
{reframed note for update 1, below}
---

# Global Update 1 Strategy Revision History

### Strategy Generator (Turn 1)
{...}

### Strategy Proximity Reviewer (Turn 1)
{...}
                                      (one reframed block per earlier update, in order)

# Current Update Proximity Turns:
### GENERATOR (Turn 1)
{this update's generator output so far}

### PROXIMITY (Turn 1)
{this update's reviewer output so far}
</StrategyProximityHistory>

<CurrentActiveStrategies>
### main1
{strategy text}

Latest Correction:
{latest solution}

### main2
{...}
</CurrentActiveStrategies>

<ConsolidatedBsrDecisions>
### main1
Decision: CONTINUE
Event reasons from window:
  - Progress (large): {reason}
  - Regression (small): {reason}

### main2
Decision: EVOLVE (rollback to iteration 8)
Event reasons from window:
  - ...

### main3
Decision: EVOLVE (in_place)

### main4
Decision: PRUNE
</ConsolidatedBsrDecisions>

<DosSynthesisForStrategies>
{step-i core_synthesis as pretty JSON}
</DosSynthesisForStrategies>

<StrategiesFinalizedAndUsedSoFar>
- [Iteration 0] main1: {seed strategy}
- [Iteration 0] main2: {seed strategy}
- [Iteration 5] main2: {strategy text from update 1}
</StrategiesFinalizedAndUsedSoFar>
```

- The `StrategyProximityHistory` block is left out when there is no history. In update 1 it holds the seed exchange and the current turns. Current turns appear from the second generator turn on, and the whole prompt is rebuilt each turn with no extra instruction line.
- Earlier exchanges use the headings `Strategy Generator` and `Strategy Proximity Reviewer`. The current update's turns use `GENERATOR` and `PROXIMITY`.
- Every branch is listed in the decisions, including CONTINUE branches. A rollback prints `(rollback to iteration N)` or `(rollback to window start)`. Event reasons are printed without their iteration numbers. A branch with no events has no reasons line.
- The decisions carry no probabilities, surprisal, credibility, or pressures.
- The list of strategies used so far only grows. It holds the seed strategies at iteration 0, and one entry per EVOLVE or new strategy at the iteration of the update.

The update note: "These strategies were actually finalized and were executed, critiqued, and corrected for {j} iterations. The DOS output provides a synthesis of the critique across each branch so that you understand where each branch is failing exactly. For richer context, you have also received the latest corrections in every branch. Finally, you have received the consolidated BSR decisions calculated by the harness from the window's trajectory (EVOLVE, PRUNE, CONTINUE). Now generate the surgical updated strategies object for the changed slots only."

The reframed note for update `U`: "Yes, these strategies were actually finalized and were executed, critiqued, and corrected for {j} iterations. You received the DOS output for previous global update {U} too, which you can find inside DOS_history/global_update_{UU}.md. You can view past corrections by going to their corresponding strategy directories. After this, you went back and forth with your proximity reviewer:"

**Strategy reviewer in an update.**

```text
# Core Challenge
{challenge}

# Review Surgical Strategy Updates for Global Update {U}

Review the proposed strategy changes for EVOLVE and PRUNE slots for orthogonality, independence from other branches, and alignment with BSR event reasons:

{the generator's latest complete output}
```

The reviewer does not receive the decisions, the other strategies, the event reasons, or the DOS output.

The strategy text of every changed slot is replaced when the last generator turn is applied. Everything after this point sees the new text.

**Step 4: repository.** Rolled-back folders are restored from commit. Pruned folders are archived. This changes files only. The stored latest solution, latest critique, and iteration history of a rolled-back branch are not changed by the rollback, so they keep showing the last iteration until the branch's next correction and critique replace them. For a pruned slot, the iteration history and memory bank are cleared.

**Step 5, in parallel: memory bank and replacement branches.**

Memory bank, once per surviving branch:

```text
# Core Challenge
{challenge}

Branch ID: main1

Strategy Text: {strategy text, after this update's changes}

Previous Memory Bank:
{memory bank}                         or "No previous memory bank."

Window History:
Iteration 6:
Correction: {solution of iteration 6}
Critique: {critique of iteration 6}

Iteration 7:
...
```

- The iterations are `n - j + 1` through `n`, or through the rollback iteration when the branch rolled back. When a branch rolled back to the window start, no memory bank call is made and the old bank stays.
- The result replaces the stored memory bank, and is also written to `Strategy-N/history/memory_bank_NN.md`.

Replacement branch, first execution:

```text
# Core Challenge
{challenge}

Assigned Strategy: main4
{new strategy text}

First execution for replacement branch in slot main4.
```

Then its critique uses the iteration 1 critique template with the history block holding only `First execution of new branch.` The result is stored as iteration `n`.

Every active strategy folder is then committed as the next window's starting state.

**Step 6: step-ii DOS** (hypotheses on).

```text
# Core Challenge
{challenge}

# Dissected Observations Synthesis - Global Update (Step-ii)
<HarnessNote>
{note, below}
</HarnessNote>

<StepIOutputBaseline>
{the complete step-i DOS output as pretty JSON}
</StepIOutputBaseline>

<PreviousHeartbeatHypothesesAndTests>
{same format as in the heartbeat DOS}
</PreviousHeartbeatHypothesesAndTests>

<SurvivingAndNewBranchesState>
### Branch main1
Strategy: {strategy text after the update}

Latest Correction:
{latest solution}

Latest Critique:
{latest critique}

### Branch main4
{...}
</SurvivingAndNewBranchesState>
```

The step-ii note is built from the decisions:

```text
This is your second call in this global update. Since your first output, the decisions were applied and the status of every slot is listed below:
- main1: CONTINUE (surviving uninterrupted)
- main2: EVOLVE with rollback (reverted to iteration 8, discarded later iterations)
- main3: EVOLVE in place (re-aimed strategy text, progress standing)
- main4: PRUNE (archived, freed slot now holds a new branch starting with first execution + critique)

Branches that were pruned are gone and their slots now hold new branches that only have a first execution and critique.
A branch that was rolled back no longer contains the iterations after its rollback point.
You also receive your own first output from this global update, unchanged.
The previous heartbeat's hypotheses, testing outputs and mappings are included now, so produce hypothesis feedback, but only for assignments you can really observe, which means the branches that survived.
You cannot say anything about the new branches and that is fine, leave them out.
Do not repeat your first output: use it as a base and give a more nuanced, natural synthesis of the state you see now.
```

A rollback to the window start prints `reverted to window start`.

**Step 7: heartbeat.** The same templates as Stage 4, with two differences. There is no separate heartbeat DOS, because the step-ii output is used, and the "previous heartbeat" in each prompt is the one before the update. The strategies, latest solutions, and latest critiques it reads already include the update's changes and the replacement branches' first execution.

### Stage 6: final iteration

Corrections use the Stage 3 correction template without the `LatestCustomCuratedContext` block. There are no critiques. Each branch's history entry for iteration `i` holds the correction and a placeholder where the critique would be.

### Stage 7: final judge

```text
# Core Challenge
{challenge}

# Competing Candidate Solutions

### Candidate main1
Strategy: {strategy text}

<FinalSolution>
{latest solution}
</FinalSolution>

### Candidate main2
{...}
```

One candidate per active branch. No critique, memory bank, structured noise, hypothesis, or archived branch is included.

## Repository

Prompts carry the curated context: the memory bank and recent history. The repository holds everything else, so an agent late in a long run can still open any file and see what was tried, what failed, and what has not been touched. Prompts keep their history objects anyway, since a model's memory of a long prompt is imperfect and the files back it up.

### Layout

```text
repo/
├── shared_workspace.md              live document, never committed
├── tmp/                             scratch space, never committed
├── direct_context/                  copies of the files the user attached
├── DOS_history/                     one file per DOS call
├── strategies_history/
│   ├── seed_strategies.md
│   ├── strategies_global_update01.md
│   └── strategies_finalized_and_used_so_far.md
├── Custom_Curated_Context/
│   ├── Heartbeat-1/
│   │   ├── Hypotheses/
│   │   │   ├── Hypothesis-1/        hypothesis, test files, feedback record
│   │   │   └── Hypothesis-2/
│   │   └── Solution_Pools/          one file per branch, Strategy-N.md
│   └── Heartbeat-2/
├── Pruned_Strategies/               for example Strategy-1_pruned_01/
├── Strategy-1/
│   ├── strategy.md
│   ├── solution files
│   └── history/
│       ├── iteration_01.md          solution and critique
│       └── memory_bank_01.md        one per memory bank
└── Strategy-2/
```

File numbers in `history/` are global iteration numbers. The final iteration's file holds the solution only. Every structured-noise agent in a heartbeat writes into the same `Solution_Pools/` folder, so each one keeping to its own file depends on its prompt. After a branch is pruned, earlier pool files under its slot name stay on disk, but they are never put in a prompt. Heartbeat folders are never deleted. File and folder names are indicative.

### Git

The repository has one git branch and one working tree. Every strategy folder, the heartbeat folders, and the strategy histories sit side by side. All branches run in parallel, and each agent writes in its own folder while reading everyone else's, so every folder needs to be on disk at once. Restoring one folder from an earlier commit does not affect the others, because no file is shared between strategies.

Only the harness uses git. Agents can read history but cannot commit or restore. The harness runs git operations one at a time, always when no agent is writing, so a commit never captures a half-written file. `shared_workspace.md` and `tmp/` are listed in `.gitignore`.

Commits are kept few:

- At the end of every iteration, each strategy folder is committed separately and in turn, named after its strategy and iteration. These commits are what a rollback goes back to.
- At the end of a global update, after memory banks and replacement branches are done, each active strategy folder is committed again. This is the starting point of the next window, and it is where a rollback to `window_start` returns.
- Shared folders are committed when a heartbeat finishes and after each strategy history file is written. DOS does not trigger a commit because it writes nothing.

When a branch is pruned, its folder is moved to `Pruned_Strategies/` under an ordinal name such as `Strategy-1_pruned_01`, and a new empty `Strategy-1/` takes its place. The ordinal keeps a reused slot name from clashing with archived data.

When a branch rolls back, its folder is emptied, restored from the chosen iteration's commit, and committed. This is a revert, so nothing is rewritten and the discarded iterations stay in git history.

At the end of the run, nothing is merged. The strategy folders are already in the repository, which is the record of the run.

### Access

Every agent can read the whole repository, with one exception: a hypothesis tester can read only its own folder. Each agent can write only in its working directory. Nobody writes to the root or to `.git`.

| Role | Working directory |
|---|---|
| Strategy generator and proximity | Repo root, read-only. Scratch space in `tmp/` |
| DOS | Repo root, read-only. Scratch space in `tmp/` |
| Hypothesis generator and proximity | Read-only. Scratch space in `tmp/` |
| Hypothesis tester | Its own `Hypothesis-M/` folder, with read and write access and nothing else |
| Structured noise | `Heartbeat-N/Solution_Pools/`, write |
| Solution attempt, critique, correction, memory bank, BSR | `Strategy-N/`, write |
| Final judge | Repo root, read-only |

The harness creates directories, writes strategy history files and hypothesis feedback records, makes the commits, restores folders, and moves pruned folders into `Pruned_Strategies/`.

Agents with sandbox access get two tools, `sandbox_exec` and `final_output`. Intermediate tool transcripts are kept internal. `final_output` checks the role's required output format before returning it to the pipeline.

### Shared workspace

Every agent except the hypothesis tester also gets a `shared_workspace` tool with three actions: `read`, `write` (replace everything), and `append`. All agents edit one live document, much like a shared online doc. Edits from parallel agents are applied one after another, and they are not tagged with the agent's role. The latest copy is always at the repo root, even between iterations. The tester has no access, since a shared live document would be a way around its single-folder view.

### Attached files

Text files the user attaches are included in the challenge text. Images are included as image blocks and passed to every agent as images. All of them are also copied into `direct_context/`, so agents can open them. Saved snapshots replace inline image data with a reference to the file.

## Final judge

The judge's prompt is listed in Stage 7 above. It also has read-only access to the repository and to the shared workspace, so it can open other files, but the candidates it chooses between are the ones in its prompt. Archived branches are never candidates.

It returns `{ "best_solution_id": "main2", "final_reasoning": "..." }`. The id must match a candidate. The result is the chosen candidate's solution as written, not a blend.

## Failures and retries

- **Retries.** An agent call gets four attempts, with waits of 30 seconds, 60 seconds, and 5 minutes between them. A 30-minute budget covers all attempts and waits together: no new attempt starts once it is used up, and a wait is cut to fit what is left. An output that fails its format check counts as a failed attempt.
- **Calls that stop the run.** If retries run out, the run fails for the strategy generator and proximity, the hypothesis generator and proximity, DOS, BSR, and the final judge.
- **Branch calls.** If retries run out for a branch's solution attempt, critique, or correction, the error is saved on that branch and shown in the interface.
- **Format checks.** Every structured output is checked before it is used. The checks cover:
  - exact slot names
  - one decision per branch
  - for a global update, exactly one strategy entry per EVOLVE or PRUNE slot and none for any other slot
  - a BSR report whose `branch_id` matches its branch, with probabilities that sum to 1
  - hypothesis probabilities that sum to 1
  - a judge choice that names a real candidate

  A failed check is retried, and a partly valid output is never applied.
- **Stopping.** A stop request takes effect between steps and during waits for a retry.

## Saving and resuming

The run's settings and prompts are fixed when it starts. A snapshot of the run, `latest.gz`, is written into the run's repository whenever the state changes, and it carries the state version.

The orchestrator also saves its place in the run: the current iteration, the heartbeat count, the counter since the last heartbeat, each slot's commit for every iteration (the targets for rollback), the list of strategies used so far, the strategy histories of global updates, and the shared workspace text.

Resuming rebuilds the orchestrator from the saved state and skips whatever is done: seed strategies that exist, and iterations where every branch has a history entry and where the global update or heartbeat that followed is recorded.

The saved state also holds BSR records, ledgers, open predictions, DOS outputs, heartbeat blocks, archived branches, and the live event feed.

## Interface

| Tab | Shows |
|---|---|
| Branches | Active strategies and each branch's history |
| Hypotheses | Generator and proximity history, heartbeats, which branches each hypothesis was sent to, test results, and feedback |
| Structured Noise | Each branch's pools at each heartbeat |
| Branch State | BSR reports, computed scores, graded predictions, and decisions at each global update, with calibration against the 1.585-bit baseline |
| Final Result | The judge's choice and reasoning |
| Live | Each agent's lifecycle, prompts, responses, traces, retries, and failures |
| Filesystem | The run's repository |

The configuration panel has only the settings listed above. The prompt editor lists these agents: Strategy Generator, Strategy Generator (Global Update), Strategies Proximity, Hypothesis Generation, Hypothesis Proximity, Hypothesis Testing, Solution Attempt, Solution Critique, Solution Correction, Structured Noise, Memory Bank, DOS, BSR, and Final Judge.

## Code map

| Module | Responsibility |
|---|---|
| `pipelineOrchestrator.ts` | The run loop, each iteration phase, heartbeats, global updates, the final judge, retries, and commits |
| `deepthinkCore.ts` | Starting and resuming a run, reading settings, saving snapshots, and assembling the challenge from attached files |
| `loopController.ts` | Bounds on `i`, `j`, `k`, the heartbeat rule, and what runs after each iteration |
| `formulas.ts` | BSR scoring, grading, pressures, and decisions; hypothesis surprise and utilization; calibration |
| `contextBuilders.ts` | The prompt contents for each agent, and conversion of image blocks |
| `harnessNotes.ts` | The notes added to the strategy generator and DOS, and the assembly of strategy proximity history |
| `agentRegistry.ts` | Each agent's label, sandbox role, system prompt key, and model key |
| `gitRepository.ts` | Repository commits, window starts, rollbacks, and archiving of pruned branches |
| `sharedWorkspace.ts` | The `shared_workspace` tool and its live document |
| `types.ts` | Types for settings, branches, hypotheses, BSR, DOS, heartbeats, and run state |
