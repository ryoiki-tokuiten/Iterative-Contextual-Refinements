Updated flow the Deepthink Mode:
this file is absolute source of truth for what the flow for the deepthink mode is supposed to be. every other file related to deepthink is some idea or draft or legacy docs etc. the final implementation would be check against this file.


## 1. Model

Each strategy is a node. N strategies are N branches, explored in parallel. Every iteration advances all nodes one level in lockstep. Heartbeats and global updates are barriers at specific levels.

Invariants:

1. `strategy-id = branch-id = slot`. EVOLVE changes strategy text only. Nothing else about the branch gets a new identity or version.
2. Every iteration is a barrier. All branches run correction + critique in parallel and the system waits for all of them. The final iteration runs correction only (§3).
3. PRUNE archives the node and creates a new node in the freed slot. No logic exists to update a node's children or dependents.
4. One fixed pipeline. Configuration changes scale and participation, never structure. No modes, no sub-strategies, no branch versions, no backward compatibility.
5. Hypotheses are optional. The system runs without them.
6. Models produce judgments. Deterministic code makes decisions.

---

## 2. Configuration

| Field | Meaning | Range | Default |
|---|---|---|---|
| `i` | Total iterations | 5 to 20 | 10 |
| `j` | Iterations between global updates | 3 to 8 | 5 |
| `k` | Iterations between curated-context heartbeats. A due heartbeat is skipped when it would feed fewer than two corrections before the next global update (§3) | 2 to `j` | 3 |
| `strategiesCount` | Number of branches | 1 to 5 | |
| `strategyProximityLoops` | Strategy generator/proximity loops | | |
| `hypothesisCount` | Hypotheses per heartbeat. 0 disables hypotheses | | |
| `hypothesisProximityLoops` | Hypothesis generator/proximity loops | | |
| `isolateBranches` | Correction agents receive no peer-branch context. Enforced by prompt only (§8.3) | | |
| `deepthinkCodeExecutionEnabled` | Enables role-scoped sandbox tools | | |
| `thinkingLevel` | Provider reasoning effort | | |

All bounds are inclusive: 5 ≤ `i` ≤ 20, 3 ≤ `j` ≤ 8, 2 ≤ `k` ≤ `j`. The frontend shows a direct error on any violation of the `i`, `j`, `k` bounds.

**Panel.** The curated context panel in `DeepthinkConfigPanel` holds the hypothesis toggle and sliders, while `k` is configured in the Loop Schedule panel when hypotheses are enabled. If hypotheses are disabled, custom curated context is disabled and `k` is never checked.

---

## 3. Loop control

Iteration 1 is the initial execution + critique of every branch. Every later iteration is correction + critique, except iteration `i`, the last one, which is correction only. Its critique is never run, because nothing consumes it: the final judge receives no critiques, and BSR never runs at `n == i`.

There is no hypothesis round before iteration 1. Hypotheses are critique-driven, so the first heartbeat can only follow iterations that have critiques.

State tracked: `iteration`, `since_heartbeat` (starts at 0), `heartbeat_no` (total heartbeats so far, used to build history and context objects).

**Numbering.** Iteration numbers are global run iterations, used everywhere: history files, events and ledger entries, rollback points, commit names and window boundaries. A branch created at the global update after iteration `n` records its first execution + critique as iteration `n` and its first correction as iteration `n + 1`, so every branch stays in lockstep and no branch-relative numbering exists.

After each iteration `n` completes, in this order:

1. **`n == i`:** stop. The final judge receives each branch's latest correction. No heartbeat and no global update run, even if the counters say so, because nothing consumes their output.
2. **`n` is a multiple of `j`:** run `perform_global_update()`. It ends with a heartbeat, which runs regardless of `k`. `since_heartbeat = 0`.
3. **Otherwise:** `since_heartbeat += 1`. If `heartbeat_due(n)` is true, run `curated_context_heartbeat()` and set `since_heartbeat = 0`. If curated context is disabled, this step is skipped entirely.

**`heartbeat_due(n)`.** One module owns the decision in step 3. It is true when `since_heartbeat == k` and the heartbeat would feed at least two correction + critique iterations before the next global update. A heartbeat's output is read by the corrections of iterations `n + 1` up to `G`, where `G` is the next multiple of `j` after `n` (no global update runs at `G ≥ i`, see step 1). After `G`, the global update's own heartbeat replaces it. The module computes `G − n` and returns false when `G − n < 2`, which is when the next iteration is the global update. If no global update lies ahead, the gap check does not apply. The heartbeat that ends a global update is exempt from this module and always runs (step 2).

Consequences:

- A heartbeat that coincides with a global update never runs twice. The global update wins.
- A skipped heartbeat needs no bookkeeping. It only happens when the next iteration ends in a global update, which sets `since_heartbeat = 0`.
- `since_heartbeat` resets on any heartbeat, wherever it ran. Nothing else needs tracking. The heartbeat that ends a global update makes the next iteration's packets fresh, so counting restarts from 1 instead of refreshing again immediately.
- Output of a heartbeat or global update at the end of iteration `n` is what the iteration `n+1` correction reads.

### Worked example: i = 15, j = 5, k = 3

| Iteration | Runs after it completes | `since_heartbeat` after |
|---|---|---|
| 1 | nothing | 1 |
| 2 | nothing | 2 |
| 3 | heartbeat | 0 |
| 4 | nothing | 1 |
| 5 | global update (ends with heartbeat) | 0 |
| 6 | nothing | 1 |
| 7 | nothing | 2 |
| 8 | heartbeat | 0 |
| 9 | nothing | 1 |
| 10 | global update (ends with heartbeat) | 0 |
| 11 | nothing | 1 |
| 12 | nothing | 2 |
| 13 | heartbeat | 0 |
| 14 | nothing | 1 |
| 15 | nothing. Final iteration (correction only, no critique), straight to final judge | n/a |

The heartbeats after iterations 3 and 8 each sit exactly two iterations before the next global update, the minimum `heartbeat_due(n)` allows. The one after 13 has no global update ahead, so the gap check does not apply.

**Skip example: i = 14, j = 6, k = 5.** After iteration 5, `since_heartbeat` reaches `k`, but the next global update is after iteration 6, so `G − n = 1` and `heartbeat_due(5)` is false. Iteration 6 completes, the global update runs, and its heartbeat refreshes every packet. Running the heartbeat after 5 would have fed a single correction and then been replaced.

---

## 4. Modules

### 4.1 `generate_strategies(count, loops, context)`

Runs the strategy ↔ proximity loop. Both agents receive the identical context. Only system prompt and output structure switch between them.

Called for the seed and for each global update. Returns only the proximity history of that call: `strategy_proximity_history_seed`, `strategy_proximity_history_global_update_01`, `_02`, and so on. The backend extracts the last strategies block from that history. For the seed, that block becomes the active strategies object. For a global update, it is a set of slot changes that the backend applies onto the existing active strategies object.

- Seed: the complete vector, N strategies (`main1` to `mainN`).
- Global update: only the changed slots, in a different output schema. One entry per EVOLVE slot (the slot ID and its updated strategy text) and one per PRUNE slot (the slot ID and the new strategy for the freed slot). CONTINUE slots have no entry and the agent cannot change them (see §4.6, step iii).

The output schema differs between the two calls because a global update never needs the complete vector. If the model re-emitted all N strategies, it could quietly rewrite or replace branches that were decided CONTINUE. So the schema itself is surgical, rather than the harness patching a full vector afterwards.

### 4.2 `generate_hypothesis(count, loops, context)`

Runs the hypothesis ↔ proximity loop with the same shared-context rule as strategies. Returns this call's proximity history (appended to the persistent history as one heartbeat block) and the final hypothesis object, extracted by the backend.

Hypothesis object:

```json
{
  "hypothesis_id": "h2",
  "text": "A self-contained, falsifiable claim",
  "target_branches": ["main1", "main3"],
  "predicted_test_outcome": {
    "reason": "...",
    "probabilities": { "VALIDATED": 0.25, "REJECTED": 0.60, "INCONCLUSIVE": 0.15 }
  }
}
```

An empty `target_branches` marks globally useful evidence. Probabilities must sum to 1.

### 4.3 `test_hypothesis(hypothesis_object)`

Starts one tester per hypothesis, in parallel. Each tester receives the challenge (and original image when present) and its one hypothesis in its prompt, while having full read access across the repository, read/write access in its own `Hypothesis-M/` folder and `/tmp/`, and access to `shared_workspace()` (§8.3, §8.4). Its verdict feeds `surprise_bits` (§5.2).

Returns the per-hypothesis testing outputs and the mapped packets. `hypothesis_testing_mapped(branch_id)` is the packet for one branch: every global hypothesis plus every hypothesis targeting that branch, each with its full test result. No concatenated blob of all outputs is produced.

### 4.4 `curated_context_heartbeat()`

| Hypotheses | Runs |
|---|---|
| on | DOS → `generate_hypothesis()` → `test_hypothesis()` → map to branches |
| off | nothing |

**DOS in a heartbeat.** A heartbeat that does not end a global update runs its own DOS (the heartbeat DOS, §5.1). The heartbeat that ends a global update does not: the global update has just run the step-ii DOS (§4.5 vi) on exactly the state the heartbeat needs, and the heartbeat reuses its output.

Returns:

- For the hypothesis subsystem's history: `hypothesis_proximity_history_heartbeat_NN` + `hypothesis_testing_output_heartbeat_NN`.
- For the branches: `latest_custom_curated_context(heartbeat_no, branch_id)` = that branch's mapped hypothesis packet (or null if hypotheses are disabled).

### 4.5 `perform_global_update()`

i. Run one BSR agent per branch and the step-i DOS (one call, §5.1), all in parallel.

ii. Code computes PRUNE / CONTINUE / EVOLVE per branch from the BSR reports (§6). Consolidate the decisions.

iii. Strategy generation receives the consolidated decisions and the step-i DOS output. It returns only the changed slots (§4.1): updated text for each EVOLVE slot and one new strategy per PRUNE slot, keyed to the freed slot. CONTINUE slots are not in its output, so their strategies are untouched by construction. The backend applies the entries onto the active strategies object.

iv. Apply the decisions to the repository (§8): archive PRUNE branches, revert EVOLVE branches that carry a rollback, and create a new branch in every freed slot.

v. Run memory-bank distillation on every surviving branch (CONTINUE, or EVOLVE in place or with rollback). In parallel, run first execution + critique on every new branch. Wait for both.

vi. If hypotheses are enabled, run the step-ii DOS (§5.1, context in §7 `context_for_DOS`). It sees the post-update state: the latest correction and critique of every active branch (the new branches' first execution and critique included), the previous heartbeat's hypotheses with their testing outputs and mappings, a note on what happened to each slot, and the step-i output unchanged. This is the call that produces the hypothesis feedback for the previous heartbeat. If hypotheses are disabled, nothing consumes its output and the step is skipped.

vii. Run `curated_context_heartbeat()` regardless of `k`. `since_heartbeat = 0`. Its DOS step is the step-ii DOS of step vi, reused (§4.4).

The step-i DOS runs even when curated context is disabled. Strategy generation needs it. The step-ii DOS runs only when hypotheses are enabled.

---

## 5. DOS and the hypothesis feedback loop

### 5.1 DOS

Dissected Observations Synthesis is a global agent. It keeps no history: every call is built from scratch by `context_for_DOS` (§7), and nothing is carried between heartbeats or global updates. That is intentional. It is called in three situations, and the call decides both its context and its output schema:

| Call | When | Context | Output |
|---|---|---|---|
| Heartbeat DOS | First step of a heartbeat that does not end a global update, when hypotheses are enabled | The previous heartbeat's hypotheses, testing outputs and verdicts, and hypothesis → branch mappings (when they exist), plus the latest correction and critique from every branch | `core_synthesis` and `hypothesis_feedback` when a previous heartbeat exists |
| Step-i DOS | Global update, §4.6 i | The latest correction and critique from every branch, nothing else | `core_synthesis` only. No `hypothesis_feedback`. Its output goes to the strategy agents |
| Step-ii DOS | Global update, §4.6 vi, when hypotheses are enabled | The heartbeat DOS context, built on the post-update state (the new branches' first execution and critique are in the latest corrections and critiques), plus what happened to each slot and the step-i output in full | `core_synthesis` and `hypothesis_feedback` for the surviving branches. It is also the DOS of the heartbeat that ends the update (§4.5) |

`hypothesis_feedback` comes only from the heartbeat DOS and the step-ii DOS. The step-i DOS exists to feed strategy generation and runs before the decisions are applied, so it is not asked about hypotheses at all.

In the step-ii DOS only the surviving branches (CONTINUE and EVOLVE) can be judged. Pruned branches are gone, and new branches never received the previous heartbeat's packets, so feedback omits both. A rolled-back branch has lost the iterations after its rollback point, so DOS judges only what remains visible.

DOS must not claim a hypothesis caused a branch decision. It reports only the observable relationship between the mapped evidence and the later correction and critique.

Per `hypothesis → branch` assignment it determines whether the result was used, and if used, whether correctly, partially, or misused, or ignored entirely. It also determines whether the later critique provides meaningful counterevidence against the tester verdict.

Output (full form, returned by the heartbeat DOS and the step-ii DOS. The step-i DOS returns `core_synthesis` only):

```json
{
  "core_synthesis": { "...": "existing DOS structured output. synthesis." },
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

Utilization states: `USED_CORRECTLY`, `USED_PARTIALLY`, `NOT_USED`, `MISUSED`. `critique_counterevidence` is optional and omitted when none exists. `hypothesis_feedback` is present only when a previous heartbeat exists, and `branch_utilization` lists only the branches the call can observe.

### 5.2 Backend calculation

**Surprise.** `surprise_bits = -log2 P(observed verdict)`, using the probability the generator assigned. It means only: how unexpected the actual tester verdict was under the generator's own forecast.

**Utilization.** The unit is one `hypothesis → branch` assignment. With C, P, N, M the counts of `USED_CORRECTLY`, `USED_PARTIALLY`, `NOT_USED`, `MISUSED`, and `T = C + P + N + M`:

`U(h) = [C/T, P/T, N/T, M/T]`

The vector is never collapsed into a weighted usefulness score. Only assignments DOS actually judged are counted: assignments to pruned or new branches (§5.1) are omitted, and when `T = 0` the record carries no `utilization`.

### 5.3 Feedback record

Created by the backend after a feedback-producing DOS returns (§5.1). `utilization` and `critique_counterevidence` are omitted when DOS had nothing to judge them on (§5.2):

```json
{
  "hypothesis_id": "h2",
  "your-predicted-test-outcome": { "VALIDATED": 0.25, "REJECTED": 0.60, "INCONCLUSIVE": 0.15 },
  "prediction_note": "This is what you predicted about this hypothesis while generating it in the previous heartbeat.",
  "observed_test_outcome": "VALIDATED",
  "surprise_bits": 2.0,
  "utilization": { "correct_use": 0.50, "partial_use": 0.25, "not_used": 0.25, "misused": 0.00 },
  "utilization_note": "Calculated programmatically from the DOS agent's observations.",
  "critique_counterevidence": [ { "branch_id": "main1", "classification": "STRONG", "reason": "..." } ]
}
```

### 5.4 Persistent hypothesis history

Feedback is a first-class part of each heartbeat block, never an appended blob:

```text
heartbeat-N
├── hypothesis generation ↔ proximity history
├── final generated hypothesis object
├── testing outputs
├── mapped branch packets
└── realized hypothesis feedback
    ├── your-predicted-test-outcome
    ├── observed test outcome
    ├── surprise_bits
    ├── utilization
    └── critique counterevidence
```

Feedback for heartbeat N is attached when the next feedback-producing DOS returns: the next heartbeat DOS, or the next global update's step-ii DOS (§5.1). DOS cannot write, so the harness writes each record into the matching `Hypothesis-M/` folder (§8.1). Every later hypothesis generator/proximity call receives all prior blocks in this structure.

### 5.5 Routing

| Consumer | Receives | Must not receive |
|---|---|---|
| Hypothesis generator + proximity | Core challenge + `hypothesisCount`, `hypothesis_proximity_history` (with prior heartbeat contexts replaced by `{HB_Reframed_Note}`), `{HB_Note}` + active heartbeat context (active running strategies + latest branch corrections + mapped branch packets, previous heartbeat's final generated hypotheses + independent testing outputs & verdicts, realized hypothesis feedback records, and DOS core synthesis from the heartbeat DOS or reused step-ii DOS) | Raw branch critiques, `strategies_finalized_and_used_so_far`, BSR scores |
| Strategy generator + proximity | Core challenge + `strategiesCount`, `strategy_proximity_history` (with prior global update contexts replaced by `{GU_Reframed_Note}`), `{GU_Note}` + active global update context (current active strategies + latest branch corrections, consolidated BSR decisions + event reasons, `dos_output.for_strategies` from step-i DOS, and `strategies_finalized_and_used_so_far`) | `your_predicted_test_outcome`, `surprise_bits`, `utilization`, `critique_counterevidence`, BSR probabilities/scores |

### 5.6 Interpretation

Surprise and utilization stay independent.

| Surprise | Utilization | Reading |
|---|---|---|
| high | high correct | unexpected and operationally valuable discovery |
| low | high correct | useful confirmation |
| high | low | unexpected but operationally irrelevant |
| low | low | redundant hypothesis |
| any | high misuse | packet poorly framed or hard to apply |
| any | STRONG counterevidence | tester verdict may deserve reconsideration |

---

## 6. Branch State Representation (BSR) and the decision

### 6.1 What BSR evaluates

BSR is not a judge. It does not decide whether a branch's answer is correct, and it treats internal confidence, critique exhaustion and apparent completeness as non-evidence of truth. A branch can be confidently trapped in a wrong local optimum.

The question it serves: **is another iteration window on this strategic trajectory still worth the compute?** BSR is never asked that directly. It reports what changed and what it expects, and code answers the question from those two things (§6.5).

A branch can be exhausted in two ways:

- **Failure exhaustion.** Stuck, regressing, repeatedly unresolved, or otherwise failing to extract progress.
- **Successful saturation.** The strategy has extracted what it can. Another window has low marginal value whether or not the answer is right. A solved-looking branch is not automatically protected, but progress that stands shields it from PRUNE: failure exhaustion releases the slot, saturation re-aims the strategy (§6.5).

BSR never outputs an action. It outputs state. Code decides.

BSR runs only at global updates, one call per branch, in parallel. Each call judges the entire window as a single trajectory. There are no per-transition scores and no consistency check between views.

It is asked for two things, and code later checks each against reality:

1. **What actually changed in the window.** Confirmed progress and confirmed regression, each placed at an iteration and given a coarse size. Checked by the confirmation rule (§6.2).
2. **What happens next if the branch is left alone.** A probability for each of PROGRESS, STALL and REGRESS. Checked at the next global update against what really happened (§6.4).

This is the loop §5 already runs for hypotheses (forecast, observation, surprisal), applied to branches. One surprisal function serves both.

### 6.2 The report

BSR writes the report below and nothing else. Everything else in §6 is computed by code.

```json
{
  "branch_id": "main2",
  "confirmed_progress": [
    { "iteration": 6, "size": "large", "reason": "..." },
    { "iteration": 7, "size": "small", "reason": "..." }
  ],
  "confirmed_regression": [
    { "iteration": 9, "size": "large", "reason": "..." },
    { "iteration": 10, "size": "large", "reason": "..." }
  ],
  "critique_alignment": { "value": 0.6, "reason": "..." },
  "next_window_prediction": {
    "reason": "...",
    "probabilities": { "PROGRESS": 0.10, "STALL": 0.20, "REGRESS": 0.70 }
  }
}
```

| Field | Range / type | Meaning |
|---|---|---|
| `confirmed_progress` | list of events | Real improvements made by corrections in the window |
| `confirmed_regression` | list of events | Real setbacks caused by corrections in the window |
| `critique_alignment` | [-1, 1] | How closely the corrections followed the critiques |
| `next_window_prediction` | probabilities over PROGRESS, STALL, REGRESS | What the next window will turn out to be if the branch is left alone |

Every judged field carries a `reason` alongside its value.

**Events.** An event is `{ iteration, size, reason }`. It sits at the iteration whose correction caused the change. `size` is `small` (a local change of low consequence), `medium` (a change of real consequence to correctness or completeness) or `large` (a change that alters the validity or structure of the answer). BSR never emits a number for movement, only this coarse scale, because a model can rank changes by size but cannot calibrate a float. Iteration 1, and the first execution of any new branch, is the baseline of its window and carries no events.

**Confirmation.** An event counts only if something other than the correction's own claim backs it:

- *Progress:* the critique of the same iteration or a later one in the window agrees the issue is resolved, or a sandbox run shows it (when `deepthinkCodeExecutionEnabled`).
- *Regression:* the same kinds of evidence show a defect that was absent from the earlier solution, or one that had been resolved and came back.

This turns §6.1's rule (confidence and apparent completeness are not evidence) into a test. An improvement BSR believes in but cannot point evidence for is not an event.

**`critique_alignment`.** +1 means every critique point was taken up by the next correction. 0 means no relationship, or nothing to take up. -1 means the corrections went against the critiques. It exists so that a branch whose corrections ignored the critiques is not blamed on its strategy (§6.5). A negative value is read as 0 there, because it points at execution, not at the strategy.

**`next_window_prediction`.** "Left alone" means CONTINUE: same strategy text, same pipeline. The three outcomes are defined exactly as the window outcome is (§6.3), and BSR is told the definitions in plain terms: PROGRESS means confirmed progress will outweigh confirmed regression by at least one medium event, REGRESS means the reverse, and STALL is anything in between. Probabilities are in [0, 1] and sum to 1. An invalid report is retried, never partly applied (§9).

### 6.3 Scoring the window (code)

**Constants.** These belong to the formulas. They are not configuration (§2), and changing one means changing this spec.

| Constant | Value | Used for |
|---|---|---|
| Size weights | small 1, medium 2, large 4 | Turning event sizes into movement. Each step is worth twice the one below, so one large event outweighs three small ones |
| Noise level `τ` | 2 (one medium event) | The smallest net change called a trend, and the room left for noise in `lost_ground` and `progress_kept` |
| Pressure floor `θ` | 0.3 | The least pressure that can trigger EVOLVE or PRUNE (§6.5) |
| Probability floor | 0.01 | The smallest probability surprisal will use (§6.4) |
| Uniform prior | (⅓, ⅓, ⅓) | What a prediction is pulled toward when it is not credible (§6.4) |

**Running total.** Code turns the events into one running total per iteration. It rises when a progress event lands and falls when a regression lands, and it starts at 0 at the window's starting state (the result of the previous global update, a rollback target, or a first execution).

```
change[n]   = (weight of progress events at n) − (weight of regression events at n)
total[n]    = change[first iteration of the window] + … + change[n]       total[start] = 0
net         = total[last iteration of the window]
movement    = sum of the weights of all events in the window, both directions
```

**Window outcome.** How the window turned out. This is what the previous prediction is graded against (§6.4).

```
PROGRESS   if net ≥  τ
REGRESS    if net ≤ −τ
STALL      otherwise
```

A net change smaller than one medium event is noise. With whole-number weights, a band of ±1 would make STALL mean exactly zero.

**Last good iteration.** The latest point at which `total` was at its highest, `best_total`. The starting state counts as the earliest point, so `best_total` is never below 0. This is where a rollback goes. It is `window_start` when the starting state was itself the best point.

**Lost ground.** The share of the window's movement that was undone after the branch's best point.

```
lost_ground = (best_total − net) / (movement + τ)
```

It is 0 when the branch ended at its best and approaches 1 when nearly everything gained was lost. Adding `τ` to the denominator keeps a window with almost no events from producing an extreme share. With no events at all, `lost_ground` is 0.

**Progress kept.** The share of everything the branch has done, over its whole life, that is real progress still standing. It is read from the branch's event ledger (§6.8), including this window's events.

```
progress_kept = max(0, net_life) / (movement_life + τ)
```

`net_life` and `movement_life` are `net` and `movement` summed over the ledger. A window-only version would make a branch that has quietly finished its work look as if it had nothing. The same `τ` guards a tiny ledger from producing an extreme share. An empty ledger gives 0.

### 6.4 Grading the last prediction (code)

**Lifecycle.** The prediction BSR issues at global update `w` is about the window that ends at update `w+1`. At `w+1` it is resolved or voided:

- **Resolved** if the branch was CONTINUE'd at update `w`. The prediction is conditional on the branch being left alone, and CONTINUE is the only decision that leaves it alone.
- **Voided** if the branch was EVOLVEd (either form) or PRUNEd. The condition no longer holds, so there is nothing to grade. A changed branch starts its next window with credibility 1, because a new strategy is a new bet with no record yet.
- A prediction still open when the run ends is never graded.

So only branches left alone are graded. That is not a bias in the data. Left alone is exactly the situation the prediction is about.

**Surprisal.** How unexpected the window outcome (§6.3) was under the previous prediction. It is the information-theory measure for this, and the same function as `surprise_bits` in §5.2.

```
surprisal = −log₂ max( P_previous[window_outcome], 0.01 )
```

The floor stops a stated 0 from producing infinite surprise. A uniform guess (⅓ each) always scores log₂3 ≈ 1.585 bits, so that is the line between a forecaster that carries information and one that does not.

**Credibility.** How much weight the forecaster's own opinion deserves right now.

```
credibility = clip( 2 − surprisal / log₂3 , 0 , 1 )
```

- At or below 1.585 bits (no worse than a uniform guess), credibility is 1.
- It falls linearly to 0 at twice that, 3.17 bits.
- A 20% outcome scores 2.32 bits, which gives 0.535.
- With no graded prediction, credibility is 1.

**Effective prediction.** The new prediction `P`, pulled toward the uniform prior by how little the forecaster has earned.

```
effective_prediction = credibility · P + (1 − credibility) · (⅓, ⅓, ⅓)
```

This is the one place surprisal acts on a decision. A forecaster that was just badly wrong about this branch gets less authority over what happens to it, so a confident BSR that has been surprised cannot talk the system into a destructive action.

**Calibration** is tracked, not assumed. The mean surprisal of all graded predictions in the run, per branch and across all branches, is shown in the Branch State surface against the 1.585-bit baseline. This is log loss. Below the baseline, BSR's predictions carry information. Above it, they are worse than guessing.

### 6.5 Pressures and the decision (code)

Three quantities are read from the effective prediction.

```
expected_drift = effective[PROGRESS] − effective[REGRESS]
entropy        = −Σ effective[o] · log₂ effective[o]                  (0 · log 0 = 0)
certainty      = 1 − entropy / log₂3
stall_evidence = certainty · (1 − effective[PROGRESS]) · max(0, critique_alignment)
```

- **Expected drift** is the expected value of the next window if PROGRESS counts +1, STALL 0 and REGRESS −1. Positive means the branch is expected to improve.
- **Certainty** is how sharp the prediction is: 0 for a uniform guess, 1 for a sure thing.
- **Stall evidence** is the evidence that another window will yield nothing. Each factor has a job. Certainty stops a vague prediction from convicting a branch. `1 − effective[PROGRESS]` is the chance of no progress. `critique_alignment` stops a branch whose corrections ignored the critiques from being blamed on its strategy.

Each action gets a **pressure**, a score from 0 to 1 for how strongly the evidence argues for it. Pressures are not probabilities and do not sum to 1.

```
pressure[CONTINUE] = max(0, expected_drift)
pressure[EVOLVE]   = max( lost_ground , stall_evidence · progress_kept )
pressure[PRUNE]    = stall_evidence · (1 − progress_kept) · (1 − lost_ground)
```

- **CONTINUE** applies only if the effective prediction expects improvement.
- **EVOLVE** has two triggers. Real ground was lost, so undo it (`lost_ground`). Or the branch is running dry but has real progress standing, so re-aim its strategy (`stall_evidence · progress_kept`).
- **PRUNE** needs the branch to be out of steam, to have little real progress standing, and not to be better fixed by a rollback. The `(1 − lost_ground)` factor is what keeps a branch that a rollback would repair from being thrown away.

**Decision.** Code picks exactly one action per branch.

1. If both `pressure[EVOLVE]` and `pressure[PRUNE]` are below `θ`, the action is CONTINUE.
2. Otherwise, if `pressure[CONTINUE]` is at least as large as both, the action is CONTINUE.
3. Otherwise the larger of EVOLVE and PRUNE wins.

When the evidence is tied, the less destructive action wins: CONTINUE, then EVOLVE, then PRUNE.

**EVOLVE form.** Code selects it. Rollback to `last_good_iteration` when `lost_ground > stall_evidence · progress_kept`, in place otherwise. A tie goes to in place, because it discards nothing.

**What this produces.**

- Oscillation (a good start, then confirmed regressions) gives high `lost_ground` and so EVOLVE with rollback.
- A branch that is confidently out of steam with little standing gives PRUNE.
- A branch that is confidently out of steam with a lot standing gives EVOLVE in place, and its answer stays a final-judge candidate.
- Everything else gives CONTINUE. Oscillation is measured by `lost_ground` and local saturation by `stall_evidence`.
- `lost_ground` and `progress_kept` are observed. Only `expected_drift` and `stall_evidence` depend on the forecast, and credibility limits how much a forecast that was just wrong can matter.

**Sharp predictions are required.** Stall evidence needs conviction. With `critique_alignment` 0.9 and full credibility, the prediction (0.05, 0.85, 0.10) gives stall evidence 0.45, but the softer (0.10, 0.70, 0.20) gives 0.22 and nothing fires. That is intended: re-aiming or discarding a branch needs a confident reason, and a near-uniform prediction cannot produce one (Example 1 gives 0.04). `θ` = 0.3 sits between the two. `lost_ground` needs no forecast, so an observed regression is acted on whatever BSR expects, unless a credible forecast of improvement outweighs it.

**What code writes** next to the report, never the model. These are the values for Example 2 (§6.9). `surprisal_bits` and `credibility` are null when nothing was graded. `form` is present only for EVOLVE, and `rollback_to` only for a rollback. `last_good_iteration` may be `"window_start"`.

```json
"computed": {
  "net": -3,
  "movement": 13,
  "window_outcome": "REGRESS",
  "last_good_iteration": 8,
  "lost_ground": 0.533,
  "progress_kept": 0.130,
  "surprisal_bits": 2.32,
  "credibility": 0.535,
  "effective_prediction": { "PROGRESS": 0.209, "STALL": 0.262, "REGRESS": 0.530 },
  "expected_drift": -0.321,
  "certainty": 0.077,
  "stall_evidence": 0.036,
  "pressure": { "CONTINUE": 0.0, "EVOLVE": 0.533, "PRUNE": 0.015 },
  "decision": "EVOLVE",
  "form": "rollback",
  "rollback_to": 8
}
```

### 6.6 Actions

**CONTINUE.** Unchanged. The branch carries on from its memory distillation.

**EVOLVE.** Same branch ID, new strategy text. Two forms, selected by code (§6.5):

- *In place.* Text only. History and memory continue as for survivors. Used when the branch is out of steam but has progress standing.
- *Rollback.* The branch is reverted to the end of `last_good_iteration`. History after that point leaves the branch folder but stays in git history (§8.2). The evolved strategy tells the model where not to go. Targets oscillation. The ledger drops the discarded events (§6.8). Memory distillation then covers only the retained part of the window. When none of the window is retained (`window_start`), the previous memory bank stands and the branch returns to the state it was left in by the previous global update.

Rollback matters most on long-horizon tasks that run for hours. Reverting is far better than evolving the strategy and continuing from a memory distillation of the bad trajectory.

**PRUNE.** The branch is permanently stopped and archived. The slot is freed. No dependents are updated. PRUNE is also the only way to start over: an approach that should not remain in history even as memory is pruned, and its replacement is a new branch.

**NEW.** The strategy agent produces one new strategy per pruned slot. The new branch runs first execution + critique. How much of the pruned strategy the new one inherits is the strategy agent's decision: it may re-aim the same idea, keep the part that worked, or abandon it. It decides from the pruned branch's BSR event reasons (§7). The strategy text is the only thing that crosses over. No history, memory bank or ledger carries to the new branch.

### 6.7 Who sees what

| Consumer | Receives | Never receives |
|---|---|---|
| Strategy generator + proximity (global update) | For each EVOLVE or PRUNE branch: the decision, the form, the rollback point, the BSR event reasons | Probabilities, surprisal, credibility, effective prediction, pressures, the prediction's reasoning |
| The same branch's next BSR call | Its ledger, and its earlier predictions that have been graded, each with outcome and surprisal | The prediction for the window it is judging |
| Every other agent (correction, critique, memory bank, hypothesis, tester, DOS, final judge) | Nothing from BSR | Everything |

**Hidden-prediction rule.** A prediction is hidden from the BSR call that judges the window it predicts, so BSR cannot shade its report to fit its own forecast. Once graded it becomes feedback to later BSR calls, as hypothesis feedback does in §5.4. It is hidden from every acting agent, so no branch is steered by a forecast about itself.

The rule is structural. BSR records are not stored in the repository (§12.13) and every context function in §7 lists exactly what its agent receives, so nothing depends on a prompt telling an agent not to look.

### 6.8 Persistence

Each global update stores, per branch, the BSR report, the computed values and the decision, outside the repository (§12.13). The Branch State surface (§10) reads them. Two things are carried forward per branch:

- **The event ledger.** Every confirmed event still standing: iteration, direction, size, reason. `progress_kept` is computed from it. A rollback removes every event after the rollback iteration. PRUNE closes the ledger with the branch, and the new branch in the slot starts with an empty one. Slot IDs are reused, ledgers are not. EVOLVE in place leaves the ledger as it is.
- **The open prediction.** Issued, waiting to be graded at the next global update or voided (§6.4).

Surviving branches' BSR calls receive their own ledger and graded predictions for continuity (§7 `context_bsr`). The stored reports remain as history even after a rollback has removed events from the ledger.

### 6.9 Worked examples

**Setup.** `i = 18`, `j = 5`, so global updates run after iterations 5, 10 and 15 (§3). Four branches. All examples are the second global update, after iteration 10. The window is iterations 6 to 10, starting from the state the first update left behind. All four branches were CONTINUE'd at the first update, so each has a prediction to grade. Weights: small 1, medium 2, large 4. `τ = 2`, `θ = 0.3`.

#### Example 1: healthy branch, CONTINUE

| Input | `main1` |
|---|---|
| Events | it6 progress medium, it8 progress large, it9 regression small, it10 progress small |
| `critique_alignment` | 0.8 |
| New prediction | PROGRESS 0.45, STALL 0.40, REGRESS 0.15 |
| Prediction from update 1 (being graded) | PROGRESS 0.55, STALL 0.30, REGRESS 0.15 |
| Ledger before this window | net 6, movement 8 (it2 large progress, it3 medium progress, it4 small regression, it5 small progress) |

1. **Running total.** Changes are +2, 0, +4, −1, +1 for iterations 6 to 10, so the totals are 2, 2, 6, 5, 6. `net` = 6, `movement` = 2 + 4 + 1 + 1 = 8. `net ≥ 2`, so the window outcome is **PROGRESS**.
2. **Lost ground.** `best_total` = 6, last reached at iteration 10, so `last_good_iteration` = 10. `lost_ground` = (6 − 6) / (8 + 2) = **0**.
3. **Progress kept.** `net_life` = 6 + 6 = 12, `movement_life` = 8 + 8 = 16. `progress_kept` = 12 / (16 + 2) = **0.667**.
4. **Grade.** The previous prediction gave PROGRESS 0.55, so `surprisal` = −log₂ 0.55 = 0.86 bits. That is below 1.585, so `credibility` = 1 and the effective prediction equals the new one.
5. **Forecast quantities.** `expected_drift` = 0.45 − 0.15 = **+0.30**. `entropy` = 1.458, so `certainty` = 1 − 1.458 / 1.585 = **0.080**, nearly a uniform guess. `stall_evidence` = 0.080 × (1 − 0.45) × 0.8 = **0.035**.
6. **Pressures.** CONTINUE = 0.30. EVOLVE = max(0, 0.035 × 0.667) = 0.023. PRUNE = 0.035 × 0.333 × 1 = 0.012.

EVOLVE and PRUNE are far below `θ`. The decision is **CONTINUE**. The strategy is unchanged, memory distillation runs over the full window, and the new prediction stays open until the update after iteration 15.

#### Example 2: oscillating branch, EVOLVE with rollback

The report is the one shown in §6.2 and the computed values are the ones shown in §6.5.

| Input | `main2` |
|---|---|
| Events | it6 progress large, it7 progress small, it9 regression large, it10 regression large |
| `critique_alignment` | 0.6 |
| New prediction | PROGRESS 0.10, STALL 0.20, REGRESS 0.70 |
| Prediction from update 1 (being graded) | PROGRESS 0.50, STALL 0.30, REGRESS 0.20 |
| Ledger before this window | net 6, movement 8 |

1. **Running total.** Changes are +4, +1, 0, −4, −4, so the totals are 4, 5, 5, 1, −3. `net` = −3, `movement` = 4 + 1 + 4 + 4 = 13. `net ≤ −2`, so the window outcome is **REGRESS**.
2. **Lost ground.** `best_total` = 5, last reached at iteration 8, so `last_good_iteration` = **8**. `lost_ground` = (5 − (−3)) / (13 + 2) = **0.533**.
3. **Progress kept.** `net_life` = 6 − 3 = 3, `movement_life` = 8 + 13 = 21. `progress_kept` = 3 / (21 + 2) = **0.130**.
4. **Grade.** The previous prediction gave REGRESS only 0.20, so `surprisal` = −log₂ 0.20 = **2.32 bits**. That is worse than a uniform guess, so `credibility` = 2 − 2.32 / 1.585 = **0.535**. The effective prediction is 0.535 × (0.10, 0.20, 0.70) + 0.465 × (⅓, ⅓, ⅓) = **(0.209, 0.262, 0.530)**.
5. **Forecast quantities.** `expected_drift` = 0.209 − 0.530 = **−0.321**. `entropy` = 1.464, so `certainty` = **0.077**. The raw prediction had certainty 0.27, so the discount cut it by almost three quarters. `stall_evidence` = 0.077 × (1 − 0.209) × 0.6 = **0.036**.
6. **Pressures.** CONTINUE = 0. EVOLVE = max(0.533, 0.036 × 0.130) = **0.533**. PRUNE = 0.036 × 0.870 × 0.467 = 0.015.

EVOLVE clears `θ` and beats both others. `lost_ground` (0.533) exceeds `stall_evidence · progress_kept` (0.005), so the form is **rollback to the end of iteration 8**. BSR had just been surprised by its own forecast, so the decision rests on what actually happened, not on its new forecast.

Applied: the harness reverts `main2` to the end of iteration 8, and iterations 9 and 10 leave the folder but stay in git history. The ledger drops the two regressions and now stands at net 11, movement 13. The strategy agent receives the event reasons and the rollback point and writes the evolved strategy. Distillation covers iterations 6 to 8. The prediction is voided, so `main2` has credibility 1 at the next update.

#### Example 3: the same stall, different history

`main3` and `main4` have an identical window and an identical prediction. Only what each had before differs.

| Input | `main3` and `main4` |
|---|---|
| Events | it6 progress small, it8 regression small, it10 progress small |
| `critique_alignment` | 0.9 |
| New prediction | PROGRESS 0.05, STALL 0.85, REGRESS 0.10 |
| Prediction from update 1 (being graded) | PROGRESS 0.25, STALL 0.60, REGRESS 0.15 |
| Ledger before this window | `main3`: net 14, movement 14 (it2 large, it3 large, it4 large, it5 medium, all progress). `main4`: net 0, movement 4 (four small events that cancel) |

Shared steps:

1. **Running total.** Changes are +1, 0, −1, 0, +1, so the totals are 1, 1, 0, 0, 1. `net` = 1, which is inside the ±2 band, so the window outcome is **STALL**. `movement` = 3. `best_total` = 1, last reached at iteration 10, so `lost_ground` = (1 − 1) / (3 + 2) = **0**.
2. **Grade.** The previous prediction gave STALL 0.60, so `surprisal` = 0.74 bits and `credibility` = 1.
3. **Forecast quantities.** `expected_drift` = 0.05 − 0.10 = −0.05, so CONTINUE = 0. `entropy` = 0.748, so `certainty` = **0.528**. `stall_evidence` = 0.528 × (1 − 0.05) × 0.9 = **0.452**.

Where they differ:

| | `net_life`, `movement_life` | `progress_kept` | EVOLVE = max(0, 0.452 × kept) | PRUNE = 0.452 × (1 − kept) | Decision |
|---|---|---|---|---|---|
| `main3` | 15, 17 | 15 / 19 = 0.789 | 0.357 | 0.095 | **EVOLVE in place** |
| `main4` | 1, 7 | 1 / 9 = 0.111 | 0.050 | 0.402 | **PRUNE** |

Both branches are confidently out of steam. `main3` holds a lot of real progress, so its strategy is re-aimed and its answer stays a final-judge candidate. Its prediction is voided, and the strategy agent receives its event reasons. `main4` has almost nothing standing, so it is archived under an ordinal name (§8.2) and its slot is freed. The strategy agent writes a new strategy for the slot, receives `main4`'s event reasons, and decides how much to inherit. The new branch runs first execution + critique with an empty ledger. This is the failure versus saturation distinction of §6.1 producing different actions.

---

## 7. Context construction: every agent's input is built by a dedicated function/module.

very imp: `strategy_proximity_history` or `hypothesis_proximity_history` is the cleanest possible direct back and forth history between the strategy and its corresponding proximity agent or the hypothesis and its corresponding proximity agent. this is a clean history object back and forth and both receive the same history object.
and yes, both the strategy generator and its proximity will always have the same context, just a different system prompt and a different output schema. same with the hypothesis generator and its proximity.
the strategy_proximity_history looks like following for example:
```
strategy-generator-seed:
strategy-proximity:
strategy-generatror-seed:
strategy-proximity:
strategy-generator:
suppose the proximity depth was only set to 3. it stops here. our harness would pick this latest output from the generator. seed is completed.
when the generate strategies is called again for the global-update-01, we need to keep the strategy agent in sync with what's actually going on. so now this is where our multi-agent harness literally adds a special note {note} + the context for the global-update-1.
the strategy generator and its proximity again go back and forth for 3 times and then generate their final object and that is the global update-1.
strategy-generator: 
strategy-proximity:
strategy-generatror:
strategy-proximity:
strategy-generator: {finalized}
when it is called for the global update 2, we put {reframed_note} between the strategy generator history of seed and global update 1. and ofc we remove the context from the history that we added for the global update-1.
and ofc now again we add the same note for the global update 2 and its context. 
when called for the global update 3, we inject the {reframed_note} between global update 1 and 2 back and forth histories and remove the context added for global update 2.
```

{note} = "these strategies were actually finalized and were executed critiqued and corrected for j iterations. the DOS output is synthesis of the critique across each branch so that you understand where each branch is failing exactly. for more richer context you have also received the latest corrections in every branch. finally, you will receive a BSR object calculated by the harness by running some information-theory and related concepts on the window and it contains the decisions about what to update, prune and evolve. now generate the new strategies object."

{reframed_note} = "yes, these strategies were actually finalized and were executed critiqued and corrected for j iterations. you received the DOS output for previous global update too, which you can find inside the {file_name i.e. DOS/DOS_file_for_that_global_update.md from its directory}, you can view the past corrections by going to their corresponding strategies directories. after this, you went back and forth with your proximity friend:"
as you might have guessed, this is not static and should be again managed by the multi-agent harness for correct DOS filenames and strategies iteration directories numbers.

ofc this is an example for the strategies generator agent and the same principle should follow upon the hypothesis generator agent.  a clear communication and reminders like these are very very important because if our multi-agent harness is not communicating with the agents properly then what's the point.



**Slots are reused, branches are not.** Every per-branch context function below (`critique_correction_memory_bank_history`, `cross_strategy_latest_correction_critique`, `context_bsr`) reads a branch's artifacts by the branch that currently occupies the slot, never by slot ID alone. Once a PRUNE is applied, nothing the pruned branch produced (corrections, critiques, memory banks, ledger) can enter any agent's direct context, and the new branch in its slot starts with none of it. The strategy generator and its proximity are the one exception: they still see what was tried, through `strategies_finalized_and_used_so_far`, the proximity history and the BSR event reasons for that update, because that is the purpose of those objects. The archived folder and old heartbeat files stay readable in the repository, which is file-system context, not direct context (§8.4).

### `context_for_strategy_generate(seed | global-update-N)` (Shared identically by Strategy Generator & Strategy Proximity)

Both **Strategy Generator (SG)** and **Strategy Proximity (SP)** receive the **exact same user prompt** at every turn of a loop (differing only in their system prompt and output schema, and with each completed turn appended to the bottom of the active loop for the next turn).

#### Short Forms
- **`[Challenge + Count]`**: Core challenge (with any direct context files/images) + target count (`strategiesCount`).
- **`[Seed G↔P]`**: The back-and-forth turns from Seed (`SG-seed-1` → `SP-seed-1` → `SG-seed-2` → … → `SG-seed-final`).
- **`[GU-u G↔P]`**: The back-and-forth turns from Global Update $u$ (`SG-gu-1` → `SP-gu-1` → … → `SG-gu-final`).
- **`{GU_Note(u)}`**: Active note for Global Update $u$:
  > *"These strategies were actually finalized and were executed, critiqued, and corrected for `j` iterations. The DOS output is a synthesis of the critique across each branch so that you understand where each branch is failing exactly. For richer context, you have also received the latest corrections in every branch. Finally, you will receive a BSR object calculated by the harness by running information-theory and related concepts on the window, containing the decisions about what to continue, evolve, and prune. Now generate the new strategies object for the changed slots only."*
- **`[GU-u Context]`**: The heavy context for Global Update $u$:
  1. Current actual strategies (`main1`…`mainN`) + latest correction from every branch
  2. Consolidated BSR decisions (`CONTINUE` / `EVOLVE in_place` / `EVOLVE rollback` / `PRUNE` + event reasons)
  3. `dos_output.for_strategies` (Step-i DOS synthesis for GU-$u$)
  4. `strategies_finalized_and_used_so_far` (ledger of every strategy actually finalized and executed so far)
- **`{GU_Reframed_Note(u)}`**: Compact note that **replaces** `{GU_Note(u)} + [GU-u Context]` once Global Update $u$ is in the past:
  > *"Yes, these strategies were actually finalized and were executed, critiqued, and corrected for `j` iterations. You received the DOS output for previous global update `u` too, which you can find inside `DOS_history/DOS_global_update_0{u}_step_i.md`. You can view the past corrections by going to their corresponding `Strategy-N/history/` directories. After this, you went back and forth with your proximity friend:"*

#### Exact Chronological Payloads (`SG & SP`)
- **During Seed:**
  - SG Turn 1: `1. [Challenge + Count]`
  - SP Turn 1: `1. [Challenge + Count]` → `2. SG-seed-1`
  - SG Turn 2: `1. [Challenge + Count]` → `2. SG-seed-1` → `3. SP-seed-1`
  - …continues for `strategyProximityLoops` rounds until `SG-seed-final`.
- **During Global Update 1:**
  - `1. [Challenge + Count]`
  - `2. [Seed G↔P]`
  - `3. {GU_Note(1)} + [GU-1 Context]`
  - `4. [GU-1 G↔P so far]` (empty on SG Turn 1; `SG-gu1-1` on SP Turn 1; `SG-gu1-1 → SP-gu1-1` on SG Turn 2; etc.)
- **During Global Update 2** (`{GU_Note(1)} + [GU-1 Context]` is removed and replaced by `{GU_Reframed_Note(1)}`):
  - `1. [Challenge + Count]`
  - `2. [Seed G↔P]`
  - `3. {GU_Reframed_Note(1)}`
  - `4. [GU-1 G↔P]`
  - `5. {GU_Note(2)} + [GU-2 Context]`
  - `6. [GU-2 G↔P so far]`
- **During Global Update $u$ ($u \ge 3$):**
  - `1. [Challenge + Count]`
  - `2. [Seed G↔P]`
  - `3. {GU_Reframed_Note(1)}` → `4. [GU-1 G↔P]`
  - `5. {GU_Reframed_Note(2)}` → `6. [GU-2 G↔P]`
  - …
  - `{GU_Reframed_Note(u-1)}` → `[GU-(u-1) G↔P]`
  - `{GU_Note(u)} + [GU-u Context]`
  - `[GU-u G↔P so far]`

The consolidated decisions carry, for each EVOLVE or PRUNE branch, the decision and the BSR event reasons, and for an EVOLVE with rollback also the rollback point. The strategy agent uses them to know where not to go and, for a pruned slot, how much of the old strategy is worth inheriting (§6.6). They carry no probabilities or computed scores (§6.7).

---

### `context_for_hypothesis_generate(heartbeat_no)` (Shared identically by Hypothesis Generator & Hypothesis Proximity)

Both **Hypothesis Generator (HG)** and **Hypothesis Proximity (HP)** receive the **exact same user prompt** at every turn of a heartbeat loop. It does **not** include `hypotheses_finalized_and_used_so_far` or raw branch critiques.

#### Short Forms
- **`[Challenge + Count]`**: Core challenge (with any direct context files/images) + target count (`hypothesisCount`).
- **`[HB-h G↔P]`**: The back-and-forth turns from Heartbeat $h$ (`HG-hb-1` → `HP-hb-1` → … → `HG-hb-final`).
- **`{HB_Note(1)}`**: Active note for Heartbeat 1 (no previous hypotheses exist yet):
  > *"The branches have executed, critiqued, and corrected up to this first heartbeat. You have received the DOS synthesis of where each branch currently stands, along with the currently running strategies and their latest corrections. Now generate the initial hypotheses object."*
- **`[HB-1 Context]`**:
  1. Current running strategies (`main1`…`mainN`) + latest correction from each active branch
  2. DOS core synthesis for Heartbeat 1 (`DOS_heartbeat_01`)
- **`{HB_Note(h)}`** (for $h \ge 2$): Active note before Heartbeat $h$:
  > *"The hypotheses from Heartbeat `h-1` were finalized, tested independently by dedicated tester agents, and mapped as packets to the target branches, which then executed corrections with them. Below is the context for Heartbeat `h`: the finalized hypotheses from Heartbeat `h-1` and their independent test outputs, the mapped branch packets showing the current running strategies, their latest corrections, and which hypotheses were routed to which branches, the realized hypothesis feedback (your predicted test outcome, observed test outcome, surprise bits, utilization across branches, and critique counterevidence), and the new DOS synthesis. Now generate the new hypotheses object."*
- **`[HB-h Context]`** (for $h \ge 2$): Strictly these items (nothing extra or less):
  1. Final generated hypothesis object from Heartbeat $h-1$ + corresponding independent testing outputs & verdicts
  2. Mapped branch packets (schema showing current running strategies `main1`…`mainN`, their latest corrections, and which hypotheses from Heartbeat $h-1$ were mapped to which branches)
  3. Realized hypothesis feedback for Heartbeat $h-1$ (`your_predicted_test_outcome`, `observed_test_outcome`, `surprise_bits`, `utilization` vector `[C/T, P/T, N/T, M/T]`, and `critique_counterevidence`)
  4. DOS core synthesis for Heartbeat $h$
- **`{HB_Reframed_Note(h)}`**: Compact note that **replaces** `{HB_Note(h)} + [HB-h Context]` once Heartbeat $h$ is in the past:
  - For $h = 1$:
    > *"In Heartbeat 1, you received the initial DOS synthesis (`{dosFilePath}`), the active strategies, and their latest corrections, and went back and forth with your proximity friend:"*
  - For $h \ge 2$:
    > *"Yes, the hypotheses from Heartbeat `h-1` were finalized, tested independently, and mapped to branches. For Heartbeat `h`, you received the DOS synthesis inside `{dosFilePath}`, the latest corrections from the corresponding strategy directories, and the prior test outputs and realized feedback records inside `Custom_Curated_Context/Heartbeat-{h-1}/Hypotheses/`. After this, you went back and forth with your proximity friend:"*
  *(Note: `{dosFilePath}` is dynamically resolved by the harness to either `DOS_history/DOS_heartbeat_0{h}.md` for a standalone heartbeat or `DOS_history/DOS_global_update_0{u}_step_ii.md` when Heartbeat $h$ concluded Global Update $u$.)*

#### Exact Chronological Payloads (`HG & HP`)
- **During Heartbeat 1:**
  - `1. [Challenge + Count]`
  - `2. {HB_Note(1)} + [HB-1 Context]`
  - `3. [HB-1 G↔P so far]` (empty on HG Turn 1; `HG-hb1-1` on HP Turn 1; `HG-hb1-1 → HP-hb1-1` on HG Turn 2; etc.)
- **During Heartbeat 2** (`{HB_Note(1)} + [HB-1 Context]` is removed and replaced by `{HB_Reframed_Note(1)}`):
  - `1. [Challenge + Count]`
  - `2. {HB_Reframed_Note(1)}`
  - `3. [HB-1 G↔P]`
  - `4. {HB_Note(2)} + [HB-2 Context]`
  - `5. [HB-2 G↔P so far]`
- **During Heartbeat 3** (`{HB_Note(2)} + [HB-2 Context]` is removed and replaced by `{HB_Reframed_Note(2)}`):
  - `1. [Challenge + Count]`
  - `2. {HB_Reframed_Note(1)}` → `3. [HB-1 G↔P]`
  - `4. {HB_Reframed_Note(2)}` → `5. [HB-2 G↔P]`
  - `6. {HB_Note(3)} + [HB-3 Context]`
  - `7. [HB-3 G↔P so far]`
- **During Heartbeat $h$ inside a Global Update (The Exception):**
  - When a Global Update $u$ finishes Step v (memory bank distillation on surviving branches + first execution & critique on replacement branches), Step vi runs **`step_ii` DOS**, and Step vii immediately runs a Heartbeat (say Heartbeat $h$) that **reuses `step_ii` DOS** instead of running a standalone Heartbeat DOS.
  - HG & HP receive the exact same chronological structure as above, with two Global-Update-specific properties inside `[HB-h Context]`:
    1. **Mapped branch packets** reflect the **post-update active strategies** (including evolved strategy texts and new replacement branches in pruned slots), their **latest corrections** (which for replacement branches is their first execution), and the Heartbeat $h-1$ branch mappings.
    2. **Realized hypothesis feedback for Heartbeat $h-1$** and **DOS core synthesis** come directly from **Global Update $u$ Step-ii DOS** (where utilization and counterevidence were graded on surviving branches only).
    3. On the *next* heartbeat ($h+1$), `{HB_Reframed_Note(h)}` points to `DOS_history/DOS_global_update_0{u}_step_ii.md`.
 

### `context_for_DOS(heartbeat_no | global-update-N step-i | global-update-N step-ii)`

DOS keeps no history. Nothing from an earlier DOS call, heartbeat or global update is carried forward, except that the step-ii call receives its own step-i output. This is intentional.

- **Heartbeat DOS:** the previous heartbeat's hypotheses + their testing outputs and verdicts + their mapping to branches (when a previous heartbeat exists) + the latest correction and critique from every branch + `{dos_heartbeat_note}`.
- **Step-i DOS:** the latest correction and critique from every branch + `{dos_step_i_note}`. No hypothesis material, and no `hypothesis_feedback` in its output (§5.1).
- **Step-ii DOS:** the previous heartbeat's hypotheses + their testing outputs and verdicts + their mapping to branches + the latest correction and critique from every active branch (the new branches' first execution and critique are now among them, pruned branches are not) + the status of every slot (CONTINUE, EVOLVE in place, EVOLVE with rollback, or PRUNE replaced by a new branch) + its own step-i output, in full and unchanged + `{dos_step_ii_note}`.

{dos_heartbeat_note} = "the hypotheses below were generated at the previous heartbeat, tested independently and mapped to branches, and the branches then ran corrections with those mapped packets. you also have the latest correction and critique of every branch. synthesize where each branch stands, and for every hypothesis → branch assignment report only what you can actually observe: whether the packet was used, and whether the later critique gives real counterevidence against the tester's verdict."

{dos_step_i_note} = "your output is going to the strategy agents that are about to decide which strategies to continue, evolve or replace in this global update. so write it for them: where exactly each branch is failing, what the branches share, what looks worth keeping. here you only receive the latest correction and critique of every branch, so there is no hypothesis feedback to produce in this call."

{dos_step_ii_note} = "this is your second call in this global update. since your first output, the decisions were applied and the status of every slot is listed below. branches that were pruned are gone and their slots now hold new branches that only have a first execution and critique. a branch that was rolled back no longer contains the iterations after its rollback point. you also receive your own first output from this global update, unchanged. the previous heartbeat's hypotheses, testing outputs and mappings are included now, so produce hypothesis feedback, but only for assignments you can really observe, which means the branches that survived. you cannot say anything about the new branches and that is fine, leave them out. don't repeat your first output: use it as a base and give a more nuanced, natural synthesis of the state you see now."

As with the strategy notes above, the multi-agent harness writes these notes and fills in the slot statuses dynamically (§8.5).

### `critique_correction_memory_bank_history(branch_id, i)`

The history object shared by the correction and critique agents. It depends on the branch only.

A window is the `j` iterations between two global updates. Nothing is compacted inside a window: the full history of the window is available. Only a distillation compacts it into the memory bank.

| Point in the branch's life | Contents |
|---|---|
| Before the first distillation (the branch's first window) | The full branch history: every correction-critique pair from the branch's first iteration up to the latest completed iteration. It grows until the branch's first global update (iteration `j` for a seed branch) |
| First iteration after any distillation | The branch's latest memory bank + the latest correction-critique |
| Later in the same window (`j-1`, `j-2`, ... iterations after the distillation) | The latest memory bank + the full correction-critique since that distillation, including the latest |

Each new distillation restarts the window: the newest memory bank replaces the previous one and the history begins again from the latest correction-critique.

Its content ends at the critique of iteration `i-1`.

### `context_for_correction_agent(branch_id, i)`

Assigned strategy ID + text, `critique_correction_memory_bank_history` + `latest_custom_curated_context(heartbeat_no, branch_id)` + `cross_strategy_latest_correction_critique(!branch_id, i)`.

### `context_for_critique_agent(branch_id, i)`

Assigned strategy ID + text, the same `critique_correction_memory_bank_history` + the iteration-`i` correction just produced. Nothing from hypotheses.

### `cross_strategy_latest_correction_critique(!branch_id, i)`

For every other active branch:

```text
strategy-id-1: strategy_text + latest correction + latest critique
strategy-id-2: same
...
```

"Latest" for the correction at iteration `i` means iteration `i-1`. Returns null when `isolateBranches` is on.

### `context_bsr(branch_id, i)`

Branch ID, current strategy text, correction-critique for the current window, and the distilled memory available before the window. For surviving branches, also the branch's own event ledger and its earlier predictions that have already been graded, each with its outcome and surprisal (§6.8). Never the prediction for the window being judged (§6.7).

### `context_memory_bank(branch_id)`

First distillation: the full history of the branch's first window (iterations 1 to `j` for a seed branch; iterations `n` to `n + j` for a branch created at the update after iteration `n`). Later distillations: the previous memory bank + the full history of the window since it.

### Solution Attempt (iteration 1 and new branches)

Core challenge (and original image), assigned strategy ID + text, and the texts of the other active strategies. See §12.4 for hypothesis packets.

---

## 8. Repository and access

The prompt carries the curated context: the memory bank and recent history. The repository carries everything else. At i = 500 an agent can still open any file and look up what was tried, what failed and what has not been touched. Prompt history objects stay, because an agent's memory of a long prompt is imperfect and the files back them up.

### 8.1 Layout

```text
repo/
├── shared_workspace.md
├── tmp/                             scratch space, never committed
├── DOS_history/                     one file per DOS run
├── strategies_history/
│   ├── seed_strategies.md
│   ├── strategies_global_update01.md
│   └── strategies_global_update02.md
|    |___strategies_finalized_and_used_so_far.md -- very important and contains the strategies that were actually executed critiqued corrected., pruned, evolved etc. file managed by the harness but always visible to the strategy generator agent.
├── Custom_Curated_Context/
│   ├── Heartbeat-1/
│   │   └── Hypotheses/
│   │       ├── generation_history.md
│   │       ├── Hypothesis-1/        hypothesis.md + test files + feedback record
│   │       └── Hypothesis-2/
│   └── Heartbeat-2/
├── Pruned_Strategies/
├── Strategy-1/                      one folder per strategy slot
│   ├── solution files
│   └── history/
│       ├── iteration_01.md          correction summary + critique
│       └── memory_bank_01.md        one per distillation
└── Strategy-2/
    ├── solution files
    └── history/
```

Directory and file names are indicative.

- **`shared_workspace.md`:** a shared document (capped at 5,000 tokens) that every agent can read, surgically edit, or append to via `shared_workspace()` (§8.3). Never committed (§8.2).
- **`tmp/`:** shared untracked read/write directory at the repository root where every agent can write scratch files, shared verification harnesses, and test loops. Never committed and not part of git history.
- **`.jsonl` trajectory files:** every `.md` final output file written by the harness is accompanied in the same directory by a `.jsonl` file storing the full raw agent trajectory for that invoke.
- **`strategies_history/`:** each file holds the full back-and-forth between the strategy agent and its proximity agent for one call (plus `.jsonl`). The harness writes it from the history the call returns (§4.1).
- **`generation_history.md`:** the same for the hypothesis agent and its proximity agent, for one heartbeat (plus `generation_history.jsonl`).
- **`Hypothesis-M/`:** the tester's working directory (`hypothesis.md` + `hypothesis.jsonl` + test files). After the next DOS the harness writes that hypothesis's feedback record here (`feedback_record.md` + `feedback_record.jsonl`, §5.4).
- **Heartbeat directories:** never erased.
- **`Strategy-N/history/`:** one file per iteration (correction summary and critique, plus `.jsonl`) and one per memory bank (plus `.jsonl`). File numbers are global iteration numbers (§3): a branch created at the update after iteration `n` starts at iteration `n`, and the final iteration's file holds the correction only. There is no `Critique/` subfolder and no BSR file: BSR records are not stored in the repository (§6.8).


### 8.2 Git

**One branch.** The repository has a single git branch and a single working tree. The shared directories (`strategies_history/`, `Custom_Curated_Context/` and `Pruned_Strategies/`) and every `Strategy-N/` folder live on it side by side, exactly as in §8.1. There are no per-strategy branches, no worktrees and no merges.

**Never committed.** `shared_workspace.md` and `tmp/` stay out of git: the harness lists both in git exclude / `.gitignore`. `shared_workspace.md` is managed by the harness and reached through its `shared_workspace` tool (§8.3). Every agent edits it live, so tracking it would only create conflicts and noise.

**Who runs git.** Only the harness. `.git` sits at the root, which no agent can write (§8.3), so agents can read history but cannot commit or restore. The harness runs its git operations one at a time, never in parallel: git locks the repository for every write, and when two commits happen at the same moment one of them fails instead of waiting. All strategies finish an iteration together, which is exactly when parallel commits would collide. Every commit also happens at a barrier, when no agent is writing, so a commit never captures a half-written file.

**Commits.** They are kept few on purpose.

- At the end of every iteration the harness commits each strategy folder on its own, one after another, limited to that folder (`git add Strategy-N`, then `git commit -- Strategy-N`). That is N small commits per iteration, each touching one strategy only and each named after its strategy and iteration. These commits are what make rollback possible.
- A global update commits each surviving strategy folder once more after memory-bank distillation, and each new branch after its first execution + critique. That commit is the starting state of the branch's next window, which a rollback to `window_start` returns to (§6.3).
- The harness commits the shared directories when a heartbeat finishes and after each strategy history file is written.

**Lifecycle.**

1. The repository is created when the core challenge is ready, before strategy generation.
2. The harness writes `strategies_history/seed_strategies.md` (and `.jsonl`), then creates N strategy directories.
3. Branches are dispatched in parallel for execution and critique.
4. The harness commits each strategy folder when an iteration completes.
5. Each heartbeat writes its `Heartbeat-N` directory. Branches receive its content through their prompts (`latest_custom_curated_context`) and can open the files.
6. Each global update writes its strategy history file.
7. **PRUNE:** the harness moves the strategy folder into `Pruned_Strategies/` under an ordinal name (for example `Pruned_Strategies/Strategy-1_pruned_01/`, with `git mv`) and commits. A new branch takes the freed slot with a fresh, empty `Strategy-N/` folder. The ordinal keeps a reused slot ID from colliding with archived data (§12.12). The pruned folder's history stays in git.
8. **EVOLVE with rollback:** the harness restores the strategy folder to its state at the end of the chosen iteration, and the strategy text is updated. Only that folder is touched. The restore removes the folder's current contents, checks the folder out from the chosen iteration's commit and commits the result: `git rm -r` and `git clean -fd` on the folder (so leftovers an agent wrote after the last commit do not survive), `git checkout <commit> -- Strategy-N`, then `git commit`. Files created after that point disappear and files changed after it return to their earlier content. It is a revert, not a reset: nothing is rewritten, so the discarded iterations leave the folder but stay in git history.
9. **End of run:** nothing is merged. The surviving strategy folders are already in the repository, which is the record of the run.

Reason for one branch: all strategies run in parallel, and each agent writes in its own folder while reading everyone else's (§8.3). A working tree holds one checked-out branch at a time, so a branch per strategy would remove the other strategies' folders from disk whenever HEAD moved, and keeping them all on disk would take one worktree per strategy, which ends the single repository tree of §8.1. A branch is also not what makes per-strategy revert possible. Each strategy owns a separate folder, so no file is ever changed by two strategies, and one folder can be restored from an earlier commit without touching any other.

### 8.3 Access

| Role | Working directory |
|---|---|
| Strategy generator and proximity | root dir is cwd (read-only). Read/write in `tmp/` |
| DOS | root dir is cwd (read-only). Read/write in `tmp/` |
| Hypothesis generator and proximity | `Custom_Curated_Context/Heartbeat-N/` is cwd (read-only). Read/write in `tmp/` |
| Hypothesis tester (one per hypothesis) | `.../Hypotheses/Hypothesis-M/` (read/write here and in `tmp/`, full repository read) |
| Solution attempt, critique, correction | `Strategy-N/` (read/write here and in `tmp/`, full repository read) |
| Memory bank, BSR | `Strategy-N/` is cwd (read-only). Read/write in `tmp/`, full repository read |
| Final judge | root dir is cwd (read-only). Read/write in `tmp/` |

- **Read:** every agent can read the whole repository.
- **Write:** every agent has read/write access to `/tmp/` (`repo/tmp/`) for shared verification harnesses and scratch files, plus write access in its assigned `Working directory` (`Strategy-N/` or `Hypothesis-M/`). Nobody writes directly to the repository root or to `.git` (§8.2).
- `shared_workspace.md` is handled by the harness and every agent can read, surgically edit (`old_string` $\to$ `new_string` with optional `replace_all`), or append to it in real-time via `shared_workspace()`. Targeted edits update specific sections in place while preserving peer findings, and the file is capped at 5,000 tokens. When an edit or append exceeds 5,000 tokens, the failed tool call and error are preserved in the agent's conversation history and the harness injects a note instructing the agent to trim stale content or make a more concise update. The live up-to-date copy is always available at the root directory even in-between iterations, and git never tracks it (§8.2).
- **Harness:** the harness, not any agent, creates directories, writes strategy history files, hypothesis feedback records, and `.jsonl` trajectory files, commits, restores strategy folders to earlier commits, and moves strategy folders into `Pruned_Strategies/`.

All sandbox-enabled roles receive `sandbox_exec`, `shared_workspace`, and `final_output`. When `maxToolTurns` is $m$, the harness injects countdown notes at $m - 10$ and $m - 5$ remaining tool calls, grants a 5-turn overtime grace window at $m$ with an urgent submission prompt, and revokes `sandbox_exec` and `shared_workspace` after $m + 5$ turns so only `final_output` remains. `final_output` validates role-specific structured output and enforces per-role output token caps (5,000 tokens for strategy generator, strategy proximity, hypothesis generator, hypothesis proximity, DOS, BSR, critique, hypothesis tester, solution attempt, and final judge; 10,000 tokens for correction and memory bank). When a submission exceeds its token cap, the tool call and error remain in conversation history and the harness injects a note instructing the agent to condense and resubmit within its token limit.


### 8.4 Harness Update (tools that every agent have):
The harness provides every agent with `sandbox_exec()`, `shared_workspace()` (`read`, `edit`, `append`, capped at 5,000 tokens), and `final_output()` (with per-role output token gate). Every agent also gets full repository read scope and read/write access to workspace-root `/tmp/`.
direct context vs the context through file-system distinction and its logic still stays as it is. literally no change in it. doing anything to it would seriously fk this up so just keep it like that.

### 8.5 Multi-agent harness empathy:
this is very very important and we need to understand that this is a very well thought multi-agent system. it is very important that we manage the co-ordination and context flow correctly. one example is that note between strategy generator global update turns. reframed notes. dynamically managing reframed notes. that kinda stuff. similarly for the hypothesis. holding the hypothesis prediction testing it against the the independent tester's work etc etc. or DOS output schema changing when it is called twice during the global update. or strategies generator schema. etc etc. there's much more. we really really need to provide correct organic and context rich notes to the agents. that is the empathy. and i expect one separate file managing just all this stuff. other example is say BSR agent, it needs to know roughly what is the best it can do to help the system move forward in the best possible way and yep this is not given through a note but rather from its system prompt.

In the current deepthink prompts file there is also this shared document. it needs to be rewritten (in the same style of articulation and communication btw). I think it should be moved to the multi-agent harness file separately and also each agent should have its own prompt file now. not just all filled in one large prompts file.
but what's very important is that: the current prompts are all handwritten and so must be preserved like that with some minor edits that are necessary to guide them in the updated system. shouldn't be directly and fully rewritten or replaced.

--- 

## 9. Agent contracts

**Strategy Proximity.** Reviews the strategy vector for overlap, shallow variation, missing problem regions and weak independence. In a seed call the generator revises the complete vector after each proximity turn, and final IDs must exactly match `main1` through `mainN`. In a global-update call the generator revises its set of changed slots (§4.1), and proximity reviews them against the unchanged strategies, which neither agent can alter.

**Hypothesis Generator / Proximity.** Produce self-contained, falsifiable claims. Proximity reviews their quality and the generator revises.

**Solution Attempt.** Executes the assigned strategy and writes directly into `Strategy-N`. Its output is iteration 1 of that branch.

**Critique.** Diagnoses correctness, completeness, constraint violations, structural weakness, and whether the active strategy remains viable. It does not replace or rewrite the solution.

**Correction.** Writes the next complete solution directly into `Strategy-N`. Expected to view other strategies directories to do cross strategy examination learn from them and get more richer and nuanced context.

**Memory Bank.** Recursively merges the previous memory with the new window. Records durable lessons, recurring failures, attempted repairs and strategic trajectory. Runs at each global update on surviving branches.

**Final Judge.** Receives the challenge (and original image) and one candidate per active branch: stable strategy ID, active strategy text, final solution. It receives no critique, memory, hypothesis history, sandbox transcript or archived branch in its direct context. It has read-only access to the repository (§8.3), so it can open those files, but the candidates it chooses between are the ones in its direct context. Its output is the selected candidate's answer, not a synthesis.

### Failure policy

Agent calls allow four total attempts with delays of 30 seconds, 60 seconds and 5 minutes. A 30-minute timeout is shared by attempts and delays. Required strategy generation fails the run when exhausted. Non-critical branch work records its error on that branch so the UI shows the incomplete state.

Parsers enforce exact IDs, unique routes, a complete decision vector (one decision per branch) and, for a global update, exactly one strategy entry per EVOLVE or PRUNE slot and none for any other slot. Invalid structured output is retried, never partially applied.

---

## 10. UI surfaces

Branches (active strategies and branch history), Hypotheses (generation/proximity history, heartbeats, routes, tester output, realized feedback), Branch State (BSR reports, computed scores, graded predictions and decisions per global update), Final Result, Live (agent lifecycle, prompts, responses, failures), Filesystem (repository inspection). The configuration panel exposes only fixed-pipeline controls, and the prompt editor exposes only agents that exist in this architecture.