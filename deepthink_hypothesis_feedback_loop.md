# Updated Deepthink Hypothesis Feedback Loop
Close the loop between hypothesis generation, hypothesis testing, downstream branch use, and the next hypothesis refresh.
The system should learn two separate things about every tested hypothesis:
1. **How surprising was the observed test result?**
2. **Did the mapped Deepthink branches actually use that result correctly?**
---

## 1. Hypothesis generation: predict the test outcome

From now on each generated hypothesis includes a probability distribution over the hypothesis tester's actual ground-truth.

```json
{
  "hypothesis_id": "h2",
  "text": "...",
  "target_branches": ["main1", "main3"],

  "predicted_test_outcome": {
    "reason": "...",
    "probabilities": {
      "VALIDATED": 0.25,
      "REJECTED": 0.60,
      "INCONCLUSIVE": 0.15
    }
  }
}
```

The probabilities must sum to `1`.

---

## 2. After testing: calculate surprise programmatically

Suppose the actual tester verdict is:

```text
VALIDATED
```

and the hypothesis generator assigned:

```text
P(VALIDATED) = 0.25
```

The Deepthink backend programmatically calculates:

Surprise(h) = -\log_2 P(\text{observed test outcome})

Example:

-\log_2(0.25)=2\text{ bits}

`surprise_bits` means only:

> How unexpected was the actual tester verdict under the hypothesis generator's own previous forecast?

---

## 3. Next DOS input

At the next heartbeat, DOS receives:

```text
latest correction + critique from every branch

+

previous heartbeat:
  hypotheses
  testing outputs / verdicts
  hypothesis → branch mappings
```

DOS remains a **global agent**.

It must not claim that a hypothesis "caused" a branch decision. It should only inspect the observable relationship between the mapped evidence and the later correction/critique.

DOS determines:
whether each mapped branch used the testing result, if used is it used correctly? fully used or partially used (important for evolving the hypothesis), whether the hypothesis testing output was ignored or misused completely? 
more importantly, does the subsequent critique provides meaningful counter evidence against the tester verdict?
---

## 4. Structured DOS output

```json
{
  "core_synthesis": {
    "...": "existing DOS structured output"
  },

  "mdl": {
    "...": "structured minimum-description representation of the global state"
  },

  "hypothesis_feedback": [
    {
      "hypothesis_id": "h2",

      "branch_utilization": [
        {
          "branch_id": "main1",
          "utilization": {
            "reason": "The correction incorporates the tested result and applies it consistently with the tester verdict.",
            "classification": "USED_CORRECTLY"
          }
        },
        {
          "branch_id": "main3",
          "utilization": {
            "reason": "The result was mapped to this branch but is not materially reflected in the correction.",
            "classification": "NOT_USED"
          }
        }
      ],

      "critique_counterevidence": [
        {
          "branch_id": "main1",
          "reason": "The subsequent critique identifies evidence that materially challenges the tester's VALIDATED verdict.",
          "classification": "STRONG"
        }
      ]
    }
  ]
}
```

Allowed utilization states:

```text
USED_CORRECTLY
USED_PARTIALLY
NOT_USED
MISUSED
```

`critique_counterevidence` is optional and omitted when none exists.

---

## 5. Programmatically calculate package utilization

The unit is one `hypothesis → branch` assignment.

For hypothesis `h`:

- `C` = `USED_CORRECTLY`
- `P` = `USED_PARTIALLY`
- `N` = `NOT_USED`
- `M` = `MISUSED`
- `T = C + P + N + M`

The Deepthink backend programmatically creates:

\[
U(h)=
\left[
\frac{C}{T},
\frac{P}{T},
\frac{N}{T},
\frac{M}{T}
\right]
\]

Example:

```json
{
  "correct_use": 0.50,
  "partial_use": 0.25,
  "not_used": 0.25,
  "misused": 0.00
}
```

Do not collapse this vector into an arbitrary weighted usefulness score.

---

## 6. Programmatically create the final hypothesis feedback record

After DOS returns, the Deepthink backend programmatically creates:

```json
{
  "hypothesis_id": "h2",

  "your-predicted-test-outcome": {
    "VALIDATED": 0.25,
    "REJECTED": 0.60,
    "INCONCLUSIVE": 0.15
  },

  "Note": "This is what you predicted about this hypothesis claim while generating this hypothesis in the previous heartbeat.",

  "observed_test_outcome": "VALIDATED",

  "surprise_bits": 2.0,

  "utilization": {
    "correct_use": 0.50,
    "partial_use": 0.25,
    "not_used": 0.25,
    "misused": 0.00
  },
  
  "Note": "These utilization scores were calculated programatically based on the actual observations from the DOS agent and are faily accurate.",


  "critique_counterevidence": [
    {
      "branch_id": "main1",
      "classification": "STRONG",
      "reason": "..."
    }
  ]
}
```

This is the persistent feedback record for that hypothesis.

---

## 7. Persistent hypothesis history

This feedback must become a first-class part of the persistent hypothesis history.

Do **not** append it as an unrelated blob at the end.

Each heartbeat history block should consistently contain:

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

Whenever the hypothesis generator and its proximity agent run again, they receive this accumulated history in the same clean structure for all prior heartbeats.

This lets the hypothesis subsystem learn:

```text
what I predicted
→ what actually happened
→ how surprising it was
→ whether mapped branches used it
→ whether later critique challenged it
```

---

## 8. Context routing

### Hypothesis Generator + Hypothesis Proximity receive

```text
DOS core synthesis
DOS MDL
persistent hypothesis history
  including realized hypothesis feedback
      It should also receive the latest corrections from each branch. only corrections not critiques.
```

### Strategy Generator + Strategy Proximity receive

```text
DOS core synthesis
DOS MDL
```

They must **not** receive the hypothesis-specific feedback fields:

```text
your-predicted-test-outcome
surprise_bits
utilization
critique_counterevidence
```

Those exist specifically to improve the hypothesis-generation loop.

---

## 9. Interpretation

Keep `surprise` and `utilization` independent.

```text
high surprise + high correct utilization
→ unexpected and operationally valuable discovery

low surprise + high correct utilization
→ useful confirmation

high surprise + low utilization
→ unexpected but operationally irrelevant evidence

low surprise + low utilization
→ redundant hypothesis

high misuse
→ hypothesis/testing packet may be poorly framed or difficult to apply

strong critique counterevidence
→ tester verdict may deserve reconsideration in future hypothesis reasoning
```

---

## Final loop

```text
Hypothesis Generator
        ↓
predicted test-outcome distribution
        ↓
Hypothesis Tester
        ↓
observed verdict
        ↓
Deepthink backend
surprise = -log₂ P(observed)
        ↓
mapped into target branches
        ↓
correction + critique
        ↓
NEXT DOS
        ↓
USED_CORRECTLY / USED_PARTIALLY / NOT_USED / MISUSED
+ optional critique counterevidence
        ↓
Deepthink backend
programmatically creates utilization vector
+ final hypothesis feedback record
        ↓
persistent heartbeat history
        ↓
next Hypothesis Generator ↔ Proximity loop
