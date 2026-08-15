# Deepthink architecture

Deepthink has one fixed execution pipeline. Its configurable values change scale, depth, isolation, and optional agent participation; they do not select alternate pipeline families.

## Pipeline

```text
Challenge
  → Strategy generation ↔ strategy proximity
  → Hypothesis generation ↔ hypothesis proximity (optional)
  → Independent hypothesis tests (optional)
  → Initial solution attempt per strategy branch
  → Critique per branch
  → Repeated branch cycle to configured depth
       ├─ structured solution pool (optional)
       ├─ solution correction
       ├─ solution critique
       ├─ hypothesis refresh every two global iterations (optional)
       └─ memory + evolution filter every five new history entries
  → Final judge
```

Every generated strategy is a direct branch with a stable slot ID such as `main1`. There is no intermediate expansion layer. The initial solution is iteration one, so a depth of one proceeds from the initial execution and critique to final judging without an additional correction iteration.

## Run configuration

| Field | Meaning |
|---|---|
| `strategiesCount` | Number of direct strategy branches, 1–5 |
| `strategyProximityLoops` | Generator/reviewer loops for strategy diversity |
| `hypothesisCount` | Number of hypotheses; zero disables the hypothesis agents |
| `hypothesisProximityLoops` | Generator/reviewer loops for hypothesis quality |
| `deepthinkDepth` | Total branch depth including the initial execution, 1–10 |
| `isolateBranches` | Removes peer-branch prompt context and mounts from correction and pool agents |
| `disableSolutionPool` | Skips structured pool calls without changing the branch lifecycle |
| `pqfAggressiveness` | Evolution-filter replacement threshold |
| `deepthinkCodeExecutionEnabled` | Enables role-scoped sandbox tools |
| `thinkingLevel` | Provider reasoning effort where supported |

The persisted schema contains exactly these Deepthink settings. Imports must match the current state version; retired fields are neither migrated nor ignored as supported configuration.

## Strategy generation and proximity

The Strategy Generator receives the challenge, requested strategy count, original image when present, and formatting constraints. It returns the complete active strategy vector.

The Strategies Proximity agent reviews that vector for overlap, shallow variation, missing problem regions, and weak strategic independence. The generator revises the complete vector after each proximity turn. The final IDs must exactly match `main1` through the configured branch count.

## Hypothesis generation, testing, and routing

Hypotheses are optional. When enabled, the generator and proximity agent produce self-contained, falsifiable claims. On the initial round they receive the current strategies. On later heartbeat rounds they also receive persistent hypothesis history, the immediately preceding testing outputs, recent correction/critique history, current branch versions, and replacement notes.

The generator returns objects with this contract:

```json
{
  "hypotheses": [
    {
      "text": "A self-contained testable claim",
      "target_branches": ["main1", "main3"]
    }
  ]
}
```

An empty `target_branches` array marks globally useful evidence. Each Hypothesis Tester receives only the challenge, original image when present, and one hypothesis. It cannot see strategy text, branch history, other hypotheses, or routing metadata.

After testing, Deepthink constructs one branch packet per active strategy. A packet contains only global hypotheses and hypotheses mapped to that branch, including their full test result. The same routing selector controls prompt packets and sandbox hypothesis mounts, preventing prompt/repository divergence.

When enabled, hypothesis generation runs initially and refreshes after every even completed global iteration.

## Initial branch execution

Each Solution Attempt agent receives:

- The Core Challenge and original image when present
- Its assigned strategy and stable branch identity
- Awareness of the other active strategy texts
- Its routed hypothesis-testing packet

Execution writes directly into `Strategy-N`. Calls for all active branches run in parallel. Each completed execution becomes iteration one and is immediately critiqued.

## Critique

A Solution Critique agent receives only its branch’s current solution, strategy, branch identity, current iteration metadata, and a bounded recent history window. It writes under `Strategy-N/Critique` and cannot read the branch’s solution-pool directory, peer branches, or hypothesis directories.

Critiques diagnose correctness, completeness, constraint violations, structural weakness, and whether the active strategy remains viable. They do not replace or rewrite the solution.

## Structured solution pool

Unless disabled, one Structured Solution Pool agent runs per active branch at each correction iteration. It receives the assigned strategy, current solution and critique, branch history, recursive memory, its routed hypothesis packet, and limited peer intelligence when branch isolation is off.

The pool explores five substantively executed alternatives rather than short suggestions. Its repository is `Strategy-N/SolutionPool`. Pool output is evidence for the next correction; it is not a final-judge candidate and does not create persistent branches.

## Correction

The Solution Correction agent advances one branch. It receives:

- The assigned strategy and version
- The latest solution and critique
- One dedicated latest pair plus up to four preceding branch-history entries
- Recursive branch memory when available
- The latest structured pool output when enabled
- The current routed hypothesis packet
- Limited current peer-branch intelligence when isolation is off

It writes the next complete solution directly into `Strategy-N`. The new solution is then critiqued and appended to branch history.

## Memory and evolution filter

Each branch tracks a cursor into its iteration history. Whenever five new entries accumulate, the Memory Bank agent recursively merges the previous memory with that new window. The memory records durable lessons, recurring failures, attempted repairs, and strategic trajectory.

The Post Quality Filter evaluates all active branches after the same maintenance boundary. For every stable strategy slot it must return exactly one decision:

- `keep`: continue the current strategy and branch version.
- `update`: replace a structurally failed strategy while preserving the slot ID.

An update request includes the current strategy, latest solution, latest critique, memory, and filter reasoning. Strategy generation produces replacement text for every requested slot in one validated vector.

Before replacement, the complete active branch directory is archived under an ordinal path in `Pruned_Strategies`. Runtime state is reset, the branch version increments, a fresh active directory is created, and an initial solution plus critique starts the replacement branch. Archived branches never return to active prompts or final judging.

## Final judge

The Final Judge receives the challenge, original image when present, and one candidate per completed active branch:

- Stable strategy ID
- Active strategy text
- Final solution text

It receives no critique, memory, pool output, filter reasoning, hypothesis history, sandbox transcript, or archived branch. Its output is the selected candidate’s answer, not a synthesis of hidden context.

## Sandbox repository

```text
Results/
├── Hypothesis-v1/
│   ├── Hypothesis-1/
│   └── Hypothesis-2/
├── Strategy-1/
│   ├── Critique/
│   └── SolutionPool/
├── Strategy-2/
│   ├── Critique/
│   └── SolutionPool/
└── Pruned_Strategies/
```

| Role | Writable location | Notable readable scope |
|---|---|---|
| Strategy Generator | Read-only role | Active repository except archived branches |
| Hypothesis Generator | Read-only role | Active repository and hypothesis history |
| Hypothesis Tester | Its hypothesis directory | No strategy directories |
| Solution Attempt | Direct `Strategy-N` files | Mapped current hypothesis tests |
| Solution Critique | `Strategy-N/Critique` | Direct files for its branch |
| Structured Solution Pool | `Strategy-N/SolutionPool` | Own branch, mapped tests, optional peer scope |
| Solution Correction | Direct `Strategy-N` files | Own critique/pool, mapped tests, optional peer scope |
| Memory Bank | Read-only role | Curated branch context supplied in prompt |
| Post Quality Filter | Read-only role | Active branches only |
| Final Judge | Read-only role | Active repository; prompt contains candidates only |

All sandbox-enabled roles receive `sandbox_exec` and `final_output`. Intermediate tool transcripts remain internal. `final_output` validates role-specific structured output before returning the artifact to the pipeline.

## Failure policy

Agent calls permit four total attempts with delays of 30 seconds, 60 seconds, and 5 minutes. A configured 30-minute timeout is shared by attempts and delays. Required strategy generation, filter decisions, and replacement generation fail the run when exhausted. Non-critical branch work records its error on that branch so the UI exposes the incomplete state.

Parser boundaries enforce exact IDs, unique routes, complete filter decision vectors, and complete replacement vectors. Invalid structured output is retried rather than partially applied.

## UI surfaces

- Strategic Solver: active strategies, versions, archived replacements, and branch history
- Hypothesis Explorer: generation/proximity history, rounds, routes, and tester output
- Solution Pool: per-branch, per-iteration pool artifacts when enabled
- Evolution Filter: memory and replacement decisions
- Final Result: isolated judge output
- Live: agent lifecycle, prompts, responses, traces, and failures
- Filesystem: versioned Results repository inspection

The configuration panel exposes only fixed-pipeline controls, and the prompt editor exposes only agents participating in this architecture.
