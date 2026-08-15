# Information-Theory Integration for Deepthink

## 1. Purpose

This document defines the information-theory layer for Deepthink's branch-state evaluation and global strategy update.

Deepthink no longer uses the old Post Quality Filter. At each global update, one **Branch State Representation (BSR) agent** runs independently for each active branch. The BSR agent produces a structured description of the branch trajectory. Deterministic code then decides whether that branch should:

- **CONTINUE** — keep the current strategy text and allocate another iteration window.
- **EVOLVE** — keep the same branch ID, but evolve the strategy text.
- **PRUNE** — stop and save the branch permanently, then free that slot for a new strategy.

The BSR agent never directly outputs one of these actions.

The core question is not:

> Is this branch correct?

The core question is:

> Is another iteration window on this strategic trajectory still worth the compute?

This distinction is essential because a branch can become exhausted in two very different ways.

### FAILURE EXHAUSTION

The strategy is stuck, regressing, repeatedly unresolved, or otherwise failing to extract useful progress.

### SUCCESSFUL SATURATION

The strategy has extracted what it can. Continuing the same strategic trajectory has low marginal value.

A branch that appears "solved" from inside its own trajectory should not automatically be protected. A genuinely strong solution and a convincing but wrong local optimum can both look internally complete. In both cases, if the trajectory has saturated, Deepthink should preserve the branch and use the freed compute slot to explore a new strategy.

This is why the BSR layer evaluates **trajectory dynamics and marginal value**, not truth or final-answer correctness.

---

# 3. Where BSR runs in Deepthink

At every global-update boundary:

1. Run one BSR agent per active branch in parallel.
2. Run Dissected Observations Synthesis in parallel.
3. Once BSR outputs are ready:
   - validate any prediction stored from the previous global update,
   - calculate deterministic branch-state quantities,
   - calculate `PRUNE`, `CONTINUE`, and `EVOLVE` pressures,
   - choose exactly one action per branch.
4. Consolidate all branch decisions.
5. Give the decisions and DOS output to strategy generation.
6. Generate:
   - evolved strategy text for `EVOLVE` branches,
   - new strategies equal to the number of `PRUNE` branches.
7. Run memory-bank distillation on surviving branches.
8. Run first execution + critique on new branches.
9. Run DOS again.
10. Run the curated-context heartbeat.
11. Continue the normal Deepthink loop.

`strategy-id = branch-id`.

`EVOLVE` changes strategy text only. It does not create a new branch version.

`PRUNE` permanently stops and saves that branch.

---

# 4. BSR input contract

The BSR agent receives the complete branch trajectory required to evaluate the current global-update window.

At minimum this includes:

- branch ID,
- current strategy text,
- correction/critique history for the active window,
- distilled memory available before the current window,

For those strategies that survived or evolved (Continue(Keep) or Evolved), The BSR agent in those branches must also receive the previous global-update state snapshots they produced/outputted as history. Very important for maintaining the continuity.

However, it must **not receive the previous active next-window prediction before producing the current state vector**.

That prediction is intentionally hidden so the model cannot unconsciously make the new state agree with its own previous forecast.

The system compares the old prediction with the new state only after the new BSR output is complete.

---

# 5. BSR system-prompt semantics:
it is not a judge for that branch, it does not determine whether the branch's answer is ultimately correct. It shouldn't assume that the internal confidence, critique exhaustion, or apparent completeness means truth. The branch may be confidently trapped in a wrong local optimum.

## 5.2 Evaluate marginal value of continued compute

The object should characterize whether the branch trajectory is:
- productively advancing,
- plateauing,
- repeatedly failing,
- oscillating,
- drifting away from the problem,
- outgrowing its current strategy,
- or becoming predictably saturated.

## 5.3 Recognize both exhaustion modes

The prompt should state these explicitly:

> **FAILURE EXHAUSTION**  
> The strategy is stuck, regressing, repeatedly unresolved, or otherwise failing to extract useful progress. Continued compute has low marginal value.

> **SUCCESSFUL SATURATION**  
> The strategy has extracted what it can. Its trajectory has stabilized and additional iterations offer low marginal information value, regardless of whether its current answer ultimately proves globally correct.

The BSR agent should not decide which action to take from these labels. It should only produce the state representation that lets deterministic code make that decision.

---

# 6. Score ranges

Use only two numeric ranges.

### Directional fields

These use `[-1, 1]`.

- `delta.score`
- `progress_made.score`
- `global_delta.score`
- `global_progress_made.score`
- predicted `critique_balance.score`

Interpretation:

- `+1` = very strong positive movement
- `0` = no meaningful directional movement
- `-1` = very strong regression

### Magnitude fields

These use `[0, 1]`.

- `critique_alignment.score`
- `stagnation.score`
- `divergence.score`
- `oscillation.score`
- `strategy_deviation.score`

Interpretation:

- `0` = absent
- `1` = maximally present

All scores must be finite and schema-validated.

---

# 7. Progress classification

Each transition also includes:

```text
PROGRESS: HIGH
PROGRESS: GOOD
PARTIAL
NONE
REGRESSION
```
The classification exists for legibility, UI, debugging, and trace inspection. The deterministic branch-decision math uses the numeric score. To prevent contradictory output, code should validate the classification against the score. A simple default mapping is:

- `HIGH`: `score > 0.70`
- `GOOD`: `0.35 < score <= 0.70`
- `PARTIAL`: `0.10 < score <= 0.35`
- `NONE`: `-0.10 <= score <= 0.10`
- `REGRESSION`: `score < -0.10`

These thresholds are not part of the pruning policy. They only keep the human-readable label consistent with the numeric value.

---

# 8. Final BSR object

```json
{
  "branch_id": "main1",

  "transitions": [
    {
      "from_iteration": 1,
      "to_iteration": 2,

      "delta": {
        "reason": "The new correction materially improves the previous branch state by resolving the main failure identified in the preceding critique.",
        "score": 0.46
      },

      "critique_alignment": {
        "reason": "The substantive changes directly follow the important directions in the preceding critique.",
        "score": 0.88
      },

      "stagnation": {
        "reason": "The branch introduces a genuinely new repair and is not merely repeating the previous attempt.",
        "score": 0.08
      },

      "divergence": {
        "reason": "The correction remains directed at the core problem instead of drifting toward a different objective.",
        "score": 0.05
      },

      "oscillation": {
        "reason": "The correction does not undo successful earlier progress or return to a previously rejected state.",
        "score": 0.03
      },

      "progress_made": {
        "reason": "A major obstacle was removed and the branch moved meaningfully closer to a viable result.",
        "classification": "GOOD",
        "score": 0.58
      }
    }
  ],

  "global_state": {
    "global_delta": {
      "reason": "Across the complete window, the final branch state is materially stronger than the state at the beginning.",
      "score": 0.43
    },

    "global_progress_made": {
      "reason": "The complete trajectory produced meaningful net progress rather than only local rewrites.",
      "classification": "GOOD",
      "score": 0.55
    },

    "critique_resolution": {
      "reason": "Most unique substantive critique issues were eventually resolved. A smaller set remains unresolved and one new error class was introduced.",
      "resolved_critique_items": 7,
      "unresolved_critique_items": 2,
      "new_errors_introduced": 1
    },

    "stagnation": {
      "reason": "The branch still produces meaningful new improvements and has not collapsed into repeatedly attempting equivalent repairs.",
      "score": 0.14
    },

    "strategy_deviation": {
      "reason": "Useful progress remains mostly compatible with the assigned strategy, although some later reasoning stretches its original framing.",
      "score": 0.18
    },

    "compressed_trajectory_model": {
      "reason": "The trajectory exhibits a compact recurring dynamic that can be stated without reproducing the full branch history.",

      "representation": "The branch continues resolving local critique targets, but gains are shrinking because the current strategy preserves the same central assumption. If the strategy remains unchanged, future corrections are expected to remain critique-aligned while producing progressively less net progress.",

      "next_window_prediction": {
        "global_delta": {
          "reason": "The current pattern suggests further changes will be positive but small.",
          "score": 0.12
        },

        "global_progress_made": {
          "reason": "Some additional progress is expected, but at a substantially lower rate.",
          "score": 0.15
        },

        "stagnation": {
          "reason": "The trajectory is expected to become more repetitive if the current strategy is preserved.",
          "score": 0.72
        },

        "critique_balance": {
          "reason": "New corrections are expected to resolve some local critiques, while a persistent core issue remains unresolved.",
          "score": 0.10
        },

        "strategy_deviation": {
          "reason": "The branch is expected to remain largely inside the current strategy rather than escape it.",
          "score": 0.16
        }
      }
    }
  }
}
```

---

# 9. What the compressed trajectory model is

The compressed trajectory model is not a summary of every iteration.

It is a compact theory of the dynamics governing the branch.

Good representation example:

> The branch repeatedly resolves local implementation defects while preserving assumption X. This causes critique alignment to remain high while net progress shrinks. If the strategy remains unchanged, stagnation should increase during the next window.

The model must never output:

- raw trajectory token count,
- compressed token count,
- compression ratio,
- description length,
- predictive coding cost,
- MDL score.

Code owns all measurement.

---

# 10. Model-description length

After the BSR output is complete, code measures:

```text
model_token_length_g = token_estimator(
    compressed_trajectory_model.representation
)
```

This measures the complexity of the candidate model.

It is not divided by the token length of the full raw trajectory.

That ratio would be dominated by the obvious fact that a short model is much shorter than a complete branch transcript and would not tell us whether the model is actually useful.

The representation should have a fixed internal maximum token budget such as:

```text
H_MAX = 256 tokens
```

The exact cap is an engineering parameter, not a branch-action threshold.

If the model exceeds the cap, structured output validation should fail and retry.

The reason for the cap is simple: the BSR agent must propose a genuinely compact explanatory model instead of hiding the whole trajectory inside the "compressed" representation.

---

# 11. Predictive validation across global updates

Let:

- `g` = current global update,
- `H_g` = compressed trajectory model produced at global update `g`,
- `P_g` = its next-window prediction,
- `D_(g+1)` = the actual branch state observed at the next global update.

The key sequence is:

```text
global update g
    ↓
BSR produces current state S_g
    ↓
BSR proposes H_g + next-window prediction P_g
    ↓
branch CONTINUES
    ↓
next j-iteration window executes normally
    ↓
global update g+1
    ↓
BSR independently produces S_(g+1)
    ↓
code compares P_g against S_(g+1)
```

The previous prediction is hidden from the BSR call at `g+1`.

This makes the validation out-of-sample.

---

# 12. Intervention boundaries

A prediction is valid only if the process being predicted was not intentionally changed.

## CONTINUE

If the action at `g` is `CONTINUE`, the strategy remains unchanged.

Therefore:

```text
P_g is activated.
```

At `g+1`, code evaluates the prediction.

## EVOLVE

If the action at `g` is `EVOLVE`, the strategy text changes immediately after BSR.

This is an intervention.

The old trajectory model was describing the dynamics of the pre-evolution strategy, so it should not be scored against the post-evolution window.

Therefore:

```text
archive H_g
do not activate P_g
reset predictive validation for this branch
```

At the next global update, the evolved branch creates a fresh trajectory model under the new strategy.

The previous BSR state can still be preserved for historical analysis, but the pre-evolution prediction is not treated as a valid forecast.

## PRUNE

The branch stops permanently.

Archive its final BSR state and model.

No future prediction is evaluated.

## NEW

A newly created branch has no previous trajectory model.

Its first eligible global update creates the first model.

---

# 14. Deterministic trajectory calculations

Assume the current window contains `m` transitions.

For transition `t`:

- `δ_t` = delta
- `p_t` = progress-made score
- `a_t` = critique alignment
- `s_t` = stagnation
- `v_t` = divergence
- `o_t` = oscillation

## 14.1 Trajectory progress view

```math
D_T = mean(δ_t)
```

```math
P_T = mean(p_t)
```

Then:

```math
T = (D_T + P_T) / 2
```

`T` answers:

> What does the sequence of transition-level judgments say happened?

No recency weighting is required initially.

The global-update window is already bounded by `j`, so every transition belongs to the current state being evaluated.

---

# 15. Global progress view

Let:

- `D_G` = global-delta score
- `P_G` = global-progress score

Then:

```math
G = (D_G + P_G) / 2
```

`G` answers:

> What does the BSR agent think happened when judging the branch as one complete trajectory?

`T` and `G` are intentionally kept separate.

They are two measurement paths, not two numbers to immediately add together.

---

# 16. Agreement between trajectory and global views

Because both `T` and `G` lie in `[-1, 1]`, their maximum possible distance is `2`.

Define:

```math
Agreement = 1 - |T - G| / 2
```

Therefore:

```text
Agreement = 1   → complete agreement
Agreement = 0   → maximal disagreement
```

Define disagreement:

```math
Disagreement = 1 - Agreement
```

When disagreement is high, Deepthink should become conservative.

Destructive intervention should not be driven by a branch-state representation whose own local and global views contradict each other.

---

# 17. Confirmed progress and confirmed regression

Deepthink only credits progress when both views agree that progress occurred.

```math
ConfirmedProgress =
    min(T, G)     if T > 0 and G > 0
    0             otherwise
```

Deepthink only credits regression when both views agree that regression occurred.

```math
ConfirmedRegression =
    min(|T|, |G|) if T < 0 and G < 0
    0             otherwise
```

This is deliberately conservative.

If the transition sequence says the branch improved but the global view says it regressed, neither conclusion is treated as confirmed.

---

# 18. Critique-resolution balance

Let:

- `r` = resolved critique items
- `u` = unresolved critique items
- `e` = newly introduced errors

Treat a newly introduced error as a current liability.

Define:

```math
B = (r - (u + e)) / (r + u + e)
```

If:

```text
r + u + e = 0
```

define:

```math
B = 0
```

`B` naturally lies in `[-1, 1]`.

Interpretation:

```text
B → +1   resolved critique items strongly dominate
B ≈ 0    resolved and unresolved liabilities are balanced
B → -1   unresolved liabilities strongly dominate
```

Then:

```math
PositiveCritiqueBalance = max(B, 0)
```

```math
NegativeCritiqueBalance = max(-B, 0)
```

This directly implements the desired behavior:

> If unresolved critique items greatly outnumber resolved critique items, pruning pressure should increase heavily.

No fixed critique-count threshold is required.

The ratio handles it dynamically.

---

# 19. Stagnation

There are two stagnation views.

Transition-derived stagnation:

```math
S_T = mean(s_t)
```

Global stagnation:

```math
S_G = global_state.stagnation.score
```

Confirmed stagnation:

```math
S = min(S_T, S_G)
```

The `min` is intentional.

Stagnation is a destructive signal.

It should be considered strong only when both the transition sequence and the holistic global view support it.

---

# 22. Quantization

LLM-generated scores should not be treated as infinitely precise.

Before predictive coding, code quantizes the predicted and observed fields.

Recommended initial resolution:

```text
0.1
```

Therefore:

- `[0, 1]` fields have 11 possible states.
- `[-1, 1]` fields have 21 possible states.

The quantization step is an internal engineering parameter.

The reason for quantization is not convenience. It prevents fake precision and gives the predictive coding layer a finite state space.

---

# 23. Prediction residual

For each predicted field `f`:

```math
r_f = q(observed_f) - q(predicted_f)
```

where `q()` converts a score into its integer quantization bin.

A residual of zero means the previous trajectory model predicted that quantity exactly at the chosen resolution.

---

# 24. Conditional description length L(D | H)

Use a deterministic prefix code for the signed residuals.

A clean implementation is:

1. ZigZag encode the signed integer residual.
2. Add one so the code is positive.
3. Encode it with Elias gamma coding.

For residual `r`:

```text
z(r) =
    2r        if r >= 0
    -2r - 1   if r < 0
```

Then:

```math
L_r(r) = 2 * floor(log2(z(r) + 1)) + 1
```

The total conditional description length is:

```math
L(D_(g+1) | H_g) = Σ_f L_r(r_f)
```

This is deterministic code length for the prediction residuals.

No model log probabilities are required.

---

# 25. No-model baseline

We also need to know how many bits would be required to encode the same future state without the previous prediction.

For each field `f` with `K_f` possible quantized states:

```math
L0_f = ceil(log2(K_f))
```

Then:

```math
L0 = Σ_f L0_f
```

This is the fixed no-prediction baseline for exactly the same target state.

This avoids the meaningless comparison between:

- a huge raw branch transcript,
- and a tiny compressed representation.

We compare prediction residual cost against the cost of encoding the same canonical future-state vector from scratch.

---

# 26. Predictive compression gain

Define:

```math
Q = max(0, 1 - L(D_(g+1) | H_g) / L0)
```

Therefore:

```text
Q ≈ 1
```

means the previous trajectory model predicted the next global state very efficiently.

```text
Q ≈ 0
```

means the model failed to compress the next state better than the no-prediction baseline.

This is the main predictive information signal used by the branch-decision layer.

If there is no valid previous prediction:

```math
Q = 0
```

This applies to:

- the first global update,
- new branches,
- the first global update after an `EVOLVE` intervention.

---


# 28. Why predictive compression matters

Suppose a branch survives global update `g`.

Its compact model predicts:

- progress will remain low,
- critique alignment will remain high,
- stagnation will increase,
- the critique balance will remain near neutral,
- strategy deviation will remain low.

At `g+1`, almost exactly this happens.

Then:

```text
Q is high
```

This means:

> The next iteration window contained very little trajectory information that was not already captured by the previous compact model.

That is strong evidence that spending another identical window may have low marginal value.

However, high predictability alone is not automatically bad.

A branch can be predictably making strong progress.

Therefore `Q` is used together with stagnation and progress.

---

# 29. Successful saturation

Successful saturation means:

- the branch is not necessarily failing,
- critiques may largely be resolved,
- changes may remain aligned,
- but marginal progress has collapsed.

The branch may be truly close to the correct answer.

It may also be confidently trapped in a false local optimum.

Deepthink does not need to distinguish those cases here.

Both mean the current strategic trajectory has extracted most of its available value.

Define:

```math
SaturationEvidence =
    S
    * (1 - ConfirmedProgress)
    * max(
        A * PositiveCritiqueBalance,
        Q
      )
```

Interpretation:

A branch is strongly saturated when:

1. stagnation is confirmed,
2. confirmed progress is low,
3. and either:
   - critique-aligned work has largely exhausted the critique debt,
   - or the next trajectory window was highly predictable from the previous compact model.

The `max` is intentional.

Successful saturation can be supported by either internal critique exhaustion or out-of-sample predictive repetition.

---

# 30. Failure exhaustion

Failure exhaustion means the trajectory is not merely finished extracting value; it is actively failing to progress.

Define:

```math
FailureEvidence =
    max(
        ConfirmedRegression,
        S * NegativeCritiqueBalance,
        V * (1 - ConfirmedProgress),
        O * (1 - ConfirmedProgress)
    )
```

This captures four direct failure modes:

1. both local and global views confirm regression,
2. unresolved critique debt dominates while the trajectory is stagnant,
3. the branch diverges without productive progress,
4. the branch oscillates without productive progress.

No generic failure score is produced by the model.

Code derives it.

---

# 31. PRUNE pressure

The two exhaustion modes are alternatives.

A branch can deserve pruning because it has failed or because it has saturated.

Define:

```math
PRUNE =
    Agreement
    * max(
        SaturationEvidence,
        FailureEvidence
      )
```

Agreement gates destructive action.

If the BSR's local and global progress views strongly disagree, pruning pressure automatically falls.

---

# 32. EVOLVE pressure

`EVOLVE` is not failure.

It means:

> The branch is making real progress, but productive progress increasingly requires leaving the current strategy's framework.

This is why Deepthink has both:

- `strategy_deviation`,
- `divergence`.

Strategy deviation means movement away from the assigned strategy.

Divergence means movement away from the actual problem/objective.

High strategy deviation can be healthy.

High divergence is not.

Define:

```math
EVOLVE =
    Agreement
    * ConfirmedProgress
    * A
    * X
    * (1 - S)
    * (1 - V)
```

A strong EVOLVE case therefore requires:

- confirmed progress,
- critique alignment,
- increasing strategy pressure,
- low stagnation,
- low problem-level divergence.

---

# 33. CONTINUE pressure

A branch should continue for either of two reasons.

### Productive continuation

The strategy still fits and produces stable progress.

```math
ProductiveContinue =
    ConfirmedProgress
    * A
    * (1 - X)
    * Stability
```

### Uncertainty continuation

The local and global views disagree.

```math
UncertainContinue = Disagreement
```

Final:

```math
CONTINUE =
    max(
        ProductiveContinue,
        UncertainContinue
    )
```

This makes the system conservative under internal disagreement.

No separate `UNCERTAIN` action is required.

---

# 34. Final deterministic decision

Calculate:

```text
PRUNE
EVOLVE
CONTINUE
```

Then:

```math
Decision = argmax(PRUNE, EVOLVE, CONTINUE)
```

Tie precedence:

```text
CONTINUE > EVOLVE > PRUNE
```

The reason is simple:

- `CONTINUE` is reversible.
- `EVOLVE` is an intervention.
- `PRUNE` permanently ends the branch.

More destructive actions should lose exact ties.

No fixed branch-action threshold is required in the initial design.

The system compares the three internally derived pressures.

---

# 35. Predictive state storage

Deepthink should persist a compact state record per branch at every global update.

Example:

```json
{
  "branch_id": "main1",
  "global_update_no": 3,
  "strategy_text": "...",
  "decision": "CONTINUE",
  "branch_state_representation": {},
  "trajectory_model": {},
  "model_token_length": 74,
  "active_prediction": {},
  "previous_prediction_validation": {
    "conditional_description_length": 8,
    "baseline_description_length": 19,
    "predictive_compression_gain": 0.579
  }
}
```

The BSR agent itself does not output the code-owned fields.

The system appends them after deterministic calculation.

---

# 36. Prediction lifecycle

For branch `B`:

## First global update

```text
BSR creates state S1
BSR creates H1 + prediction P1
decision happens
```

If `CONTINUE`:

```text
activate P1
```

If `EVOLVE`:

```text
archive H1
prediction reset
```

If `PRUNE`:

```text
archive final state
stop branch
```

## Next global update after CONTINUE

```text
BSR independently creates S2
code validates P1 against S2
code calculates Q1→2
BSR also creates H2 + P2
decision happens
```

If branch continues again, `P2` becomes the next active prediction.

This produces a predictive history:

```text
H1 → D2
H2 → D3
H3 → D4
...
```

The branch can therefore become increasingly easy or difficult to predict over time.


Why EVOLVE resets predictive validation?

An `EVOLVE` action changes the strategy text. That is a deliberate intervention in the process generating future corrections.

Therefore:

```text
CONTINUE → preserve predictive chain
EVOLVE   → reset predictive chain
PRUNE    → terminate predictive chain
NEW      → begin with no prior prediction
```

This keeps the information-theory signal causally clean.

---

# 38. Relationship to Memory Bank

The compressed trajectory model and Memory Bank have different purposes.

### BSR compressed trajectory model

Answers:

> What compact dynamic explains how this branch is currently evolving, and what should happen next if the trajectory continues?

It exists for:

- predictive validation,
- branch-state analysis,
- detecting low marginal information value.

### Memory Bank

Answers:

> What durable lessons, failures, repairs, and strategic knowledge should survive context compaction?

It exists for future reasoning.

The BSR compressed model may be provided as one input to Memory Bank distillation, but Memory Bank should not simply copy it.

The two artifacts solve different problems. They are not related and one has nothing to do with the other.

---
