# Deepthink Architecture

Deepthink is a multi-agent search and refinement system for problems that benefit from independent strategic interpretations, targeted hypothesis testing, parallel execution, adversarial critique, and explicit final selection.

The current implementation has two distinct execution families:

1. A single-pass strategic pipeline, optionally expanded through sub-strategies and one correction pass.
2. Evolving Depth First Search (Evolving DFS), where each main strategy becomes a persistent branch with iterative correction, critique, structured breadth-first solution pools, recursive memory, hypothesis refreshes, and periodic strategy replacement.

This document describes the behavior implemented by `DeepthinkCore.ts`, `DeepthinkIterativeHistory.ts`, the configuration controller, the current system prompts, and the Deepthink UI. Where the planning document and the current code differ, the code is treated as the source of truth.

## Current Architecture Diagram

![Current Deepthink Architecture](SystemArchitecture.png)

`SystemArchitecture.png` is the current diagram used by the README. `OldSystemArchitecture.png` is intentionally retained as the archived diagram for the previous system.

The diagram is a conceptual overview. The exact context contracts, synchronization points, and replacement behavior are defined below. In particular, the current hypothesis heartbeat reads previous hypothesis rounds and recent correction/critique history; it does not receive the concurrently generated solution-pool outputs.

## Architectural Principles

### Search Before Selection

Deepthink does not ask one model call to both discover and judge the answer. It first creates independent strategic regions, explores them through separate work-producing agents, applies independent diagnostic pressure, and only then asks a final judge to select among completed candidates.

### Branch Identity

A main strategy is a branch identity, not a step in a shared plan. Downstream agents are expected to remain inside the assigned strategy while still changing conclusions, implementations, proofs, structures, or other substantive choices when evidence requires it.

Outside Evolving DFS, a main strategy may be expanded into several sub-strategies. Inside Evolving DFS, sub-strategies are disabled and every main strategy owns one direct branch.

### Curated Context Instead Of Global History

No active Evolving DFS agent receives the complete repository. The orchestrator constructs a role-specific view for each call:

- Correctors receive deep local history and shallow cross-branch status.
- Solution-pool agents receive local pool history and only the latest pools from other branches.
- Memory agents receive one branch and one five-entry history window.
- PQF agents receive full recent history only for the branches they are assigned to evaluate.
- Hypothesis testers receive one hypothesis and no strategy history.
- The final judge receives candidate solutions, not the internal search process.

This is both a context-control mechanism and an architectural boundary. It reduces irrelevant context while preventing one agent from treating every internal artifact as equally authoritative.

### Depth And Breadth Are Separate Responsibilities

The corrector and critique loop performs depth-first refinement. It repeatedly improves one current solution within each active strategy.

The Structured Solution Pool Agent performs breadth-first expansion around that depth-first path. It creates exactly five substantively executed alternatives or reusable artifacts for the same strategy. These alternatives may repair the current path, challenge its assumptions, change its representation, test a counter-attractor, or open a neglected region.

There is no separate top-level `BFS` configuration flag. "Breadth-first search" appears in two architectural senses:

- Sub-strategies create a broad one-pass strategy-by-sub-strategy execution matrix outside Evolving DFS.
- Structured solution pools provide recurring branch-local BFS inside Evolving DFS.

These mechanisms are different. Sub-strategies are disabled in Evolving DFS, while structured solution pools exist only in Evolving DFS.

### Stable Slots, Evolving Branches

Evolving DFS keeps stable strategy slot IDs such as `main1`, `main2`, and `main3`. PQF does not delete a slot. An update replaces the strategy text in that slot, increments its branch version, archives the previous branch, and starts a clean replacement branch.

The stable slot allows the UI and cross-branch orchestration to remain coherent. The branch version prevents old correction history, memory, solution pools, Python state, and selective hypotheses from contaminating the replacement.

## Mode Matrix

| Configuration | Branch shape | Critique and correction | Hypothesis behavior | Long-running state |
|---|---|---|---|---|
| Refinement off | Main strategies, optionally expanded into sub-strategies | No critique or correction; execution output goes directly to judging | One initial hypothesis round, optional | None |
| Single-pass refinement | Main strategies, optionally expanded into sub-strategies | One critique and one corrected solution per execution | One initial round; packet reaches execution and may optionally reach synthesis | No iterative branch history |
| Critique Synthesis enabled | Same as single-pass refinement | A global diagnostic synthesis is added to every corrector's context | Hypothesis packet may optionally be shared with synthesis | One shared synthesis artifact |
| Full Solution Context enabled | Same as single-pass refinement | Every corrector also receives all original solutions and critiques | No additional hypothesis behavior | One static cross-solution snapshot |
| Evolving DFS enabled | One direct branch per main strategy; maximum five strategies | Initial execution plus repeated correction/critique iterations | Forced selective routing, refreshed every two global iterations | Branch history, pool history, memory, PQF decisions, replacement archive |

Critique Synthesis and Full Solution Context can be enabled together in the single-pass refinement path. Both are automatically disabled when Evolving DFS is enabled.

## Configuration Rules

The configuration controller applies the following constraints:

| Setting | Current behavior |
|---|---|
| Refinement | Required for critiques, correction, Critique Synthesis, Full Solution Context, and Evolving DFS |
| Main strategies | 1-10 normally; 1-5 in Evolving DFS |
| Sub-strategies | 0, 2, 3, 4, or 5; forced to 0 in Evolving DFS |
| Hypotheses | 0-6 |
| Evolving DFS depth | 1-10 |
| PQF | Required and forced on in Evolving DFS |
| PQF aggressiveness | Balanced or Aggressive |
| Hypothesis injection | Blind Trust, Strategy-Aware, or Selective; forced to Selective in Evolving DFS |
| Critique Synthesis | Requires refinement; unavailable in Evolving DFS |
| Full Solution Context | Requires refinement; unavailable in Evolving DFS |
| Python execution | Optional; available only to selected work and verification agents |

Turning refinement off also disables Evolving DFS, Critique Synthesis, Full Solution Context, and PQF. Enabling Evolving DFS forces sub-strategies to zero, disables Critique Synthesis and Full Solution Context, enables PQF, and forces Selective hypothesis routing. Disabling Evolving DFS does not automatically restore the previous sub-strategy or refinement-option selections.

The Evolving DFS depth includes the original execution as iteration 1. Therefore:

- Depth 1 means initial execution, initial critique, initial solution pool, then final judging.
- Depth 2 means the initial iteration plus one correction/critique iteration.
- Depth 10 means the initial iteration plus nine correction/critique iterations.

## Common Request Envelope

Every Deepthink call is assembled from two layers:

1. A customizable system instruction defining the durable role and behavior of the agent.
2. A runtime-generated user prompt containing the exact challenge, assigned artifacts, branch identity, and permitted repository view.

The prompt editor exposes system instructions and per-agent model selection. Runtime user prompts are generated by the core and are not user-editable because they encode live branch state and context boundaries.

All calls receive the original challenge text. If the challenge includes an image, the image is attached to every Deepthink model call. When an eligible agent uses the Python backend, that image is also seeded into its isolated Python environment.

Model selection may be overridden per agent. Otherwise the currently selected model is used. Temperature, top-p, and thinking level are applied at invocation time.

## Agent Context Contracts

The following sections describe what each agent actually receives. "Does not receive" identifies important context that is deliberately withheld.

### Initial Strategy Generator

The Initial Strategy Generator receives:

- The Core Challenge.
- The original attached image, if any.
- The exact requested strategy count.
- A system instruction requiring high-level, independent, domain-adapted strategies.

It does not receive hypotheses, candidate solutions, critiques, or search history. It returns a JSON strategy array. Initial slots are assigned stable IDs in generation order: `main1`, `main2`, and so on.

During PQF evolution, the same strategy-generation role is reused with a different runtime prompt. That update call receives the consolidated decision vector and failed-branch context described later.

### Sub-Strategy Generator

One Sub-Strategy Generator runs for each main strategy when sub-strategies are enabled. Calls run in parallel.

Each call receives:

- The Core Challenge.
- The assigned main strategy.
- The text of every other main strategy for awareness.
- The required number of sub-strategies.
- The original image, if present.

It does not receive hypotheses, executions, critiques, or another main strategy's sub-strategies. It returns narrower but independent lenses within the assigned main strategy.

If sub-strategies are disabled, the system creates one direct branch whose text is the main strategy text. No Sub-Strategy Generator call is made.

### Hypothesis Generator

The initial Hypothesis Generator receives the Core Challenge, hypothesis count, and context determined by the selected injection mode.

In Blind Trust mode it receives no strategy context. In Strategy-Aware and Selective modes it receives the current main strategies and their sub-strategy IDs and texts.

The Hypothesis Generator does not test its own hypotheses. It creates self-contained claims so that each tester can operate without seeing the strategy or branch context that motivated the claim.

In Selective mode, each hypothesis also carries `target_strategies` routing metadata. The strategy IDs are delivery metadata and are not supposed to appear as hidden references inside the hypothesis text.

### Hypothesis Tester

Each hypothesis is tested by an independent call. All testers in a round run in parallel.

A tester receives:

- The Core Challenge.
- Exactly one hypothesis.
- The original image, if present.

It does not receive:

- Other hypotheses.
- Target strategy IDs.
- Main strategies or sub-strategies.
- Branch history.
- Solution pools.
- The generator's reason for creating the hypothesis.

The tester attempts both validation and refutation and ends with one classification: `VALIDATED`, `REFUTED`, or `INCONCLUSIVE`. The full testing output is preserved in the information packet.

### Execution Agent

Every execution call receives:

- The Core Challenge.
- The assigned main strategy.
- The assigned sub-strategy, or the direct strategy in skip/Evolving DFS mode.
- Other main strategy texts for situational awareness.
- The applicable hypothesis information packet.
- Branch identity metadata when a versioned branch exists.
- The original image, if present.

The execution agent does not receive other solutions, critiques, memory banks, or solution pools. Its responsibility is to produce a complete first work product under the assigned lens.

In non-Evolving mode, all strategy/sub-strategy executions run in parallel. In Evolving DFS, one direct execution runs per main strategy.

### Critique Agent

In the single-pass path, a Critique Agent receives:

- The Core Challenge.
- The assigned main strategy and sub-strategy.
- One solution attempt.
- The original image, if present.

In Evolving DFS, it additionally receives:

- Strategy slot and branch version.
- Global and branch-local iteration numbers.
- Up to five previous solution/correction plus critique entries from the same branch.

It does not receive the solution pool, memory bank, selective hypothesis packet, or another branch's history directly. Its output is diagnostic pressure, not a replacement solution.

A critique starts as soon as its corresponding execution or correction finishes. The system does not wait for every other branch to finish before starting that branch's critique.

### Dissected Observations Synthesis Agent

This agent exists only in single-pass refinement and only when Critique Synthesis is enabled.

It receives:

- The Core Challenge.
- Every main strategy and sub-strategy.
- Every original solution attempt.
- The corresponding critique for each solution.
- Optionally, the complete hypothesis information packet.
- The original image, if present.

It does not receive corrected solutions because they do not exist yet. It produces one shared diagnostic document that consolidates recurring failures, framework-specific problems, assumptions, missing elements, and conflicts between critiques.

That synthesis is then appended to every single-pass corrector's correction context.

### Single-Pass Corrector

Each corrector in the non-Evolving path receives:

- The Core Challenge.
- Its assigned main strategy and sub-strategy.
- Its own original solution attempt.
- Its own critique.
- The shared Critique Synthesis, if enabled.
- The static Full Solution Context, if enabled.
- The original image, if present.

The Full Solution Context contains every candidate's main strategy text, sub-strategy text, original solution, and critique. It marks which candidate is assigned to the current corrector.

All correctors run in parallel. Consequently, Full Solution Context is static: it contains original solutions and critiques, not corrections being generated by peer correctors in the same pass.

### Evolving DFS Corrector

An Evolving DFS corrector receives a purpose-built repository.

For its own branch, it receives:

- Strategy text and branch version.
- The latest execution or correction.
- The latest critique.
- Up to the last five branch history entries.
- The current recursive memory bank, if available.
- The latest solution-pool output for its own branch, if available.
- Its current selective hypothesis packet.

For every other active strategy, it receives only:

- Strategy text and branch version.
- Latest execution or correction.
- Latest critique.

It does not receive other branches' memory banks, histories, or solution pools.

Conceptually, the repository has this shape:

```text
<Context From Other Strategies>
  <Strategy-other>
    <StrategyText />
    <LatestCorrectionOrExecution />
    <LatestCritique />
  </Strategy-other>
</Context From Other Strategies>

<Strategy-Aware Selective Knowledge Packet />

<Relevant Context For Your Current Strategy>
  <Strategy-current>
    <StrategyText />
    <MemoryBank />
    <LatestCorrectionOrExecution />
    <LatestCritique />
    <BranchHistory last="5" />
    <LatestStrategySolutionPool />
  </Strategy-current>
</Relevant Context For Your Current Strategy>
```

The corrector produces the next complete branch artifact. It may perform a local repair, reconstruct a component, or rebuild the solution when the current framing has failed, but it must remain inside the active strategy.

### Structured Solution Pool Agent

The Structured Solution Pool Agent is the recurring breadth-first search component inside Evolving DFS.

For its assigned branch, it receives:

- Strategy text and branch version.
- Latest execution or correction.
- Latest critique.
- Current memory bank, if available.
- Up to the last five solution-pool outputs from the same branch.
- Current selective hypothesis packet.

For other active strategies, it receives:

- Their strategy text and branch version.
- Their latest completed solution-pool output only.

It does not receive other branches' corrections, critiques, histories, or memory banks.

The repository is conceptually:

```text
<Context From Other Strategies>
  <Strategy-other>
    <StrategyText />
    <LatestSolutionPool />
  </Strategy-other>
</Context From Other Strategies>

<Strategy-Aware Selective Knowledge Packet />

<Relevant Context For Your Current Strategy>
  <Strategy-current>
    <StrategyText />
    <MemoryBank />
    <LatestCorrectionOrExecution />
    <LatestCritique />
    <PoolHistory last="5" />
  </Strategy-current>
</Relevant Context For Your Current Strategy>
```

The agent returns JSON containing exactly five entries. Each entry includes a title, substantively executed content, confidence, and an internal critique. The five entries are not required to be five full answers. Depending on the task, they may be complete alternatives, section replacements, implementations, proofs, counterexamples, architectures, validation artifacts, or other reusable work products.

The pool is advisory search material. It is not automatically promoted to the branch solution and is not sent directly to the final judge. The next corrector decides what to adopt, reject, combine, or use as a stress test.

### Memory Bank Agent

A Memory Bank Agent receives:

- The Core Challenge.
- One active strategy and branch version.
- The previous memory bank, if one exists.
- The next five uncompressed branch history entries for that branch.
- The original image, if present.

It does not receive solution pools, hypothesis packets, other strategies, or the global repository.

The memory output is a recursive exploration summary organized around:

- Validated invariants.
- Dead ends.
- Persistent flaws.
- Useful techniques.
- Refuted assumptions.
- Open questions.
- Guidance for future corrections.

It is explicitly not a summary of solution prose and not a final answer. On later distillations, the previous memory bank is merged with the new five-entry window so earlier lessons are not discarded.

### Post Quality Filter Agent

PQF is branch maintenance, not solution ranking.

Due strategies are grouped in pairs. With an odd number of due strategies, the final group contains one strategy. PQF group calls run in parallel.

Each PQF agent receives:

- The Core Challenge.
- The selected aggressiveness instruction.
- The text of all currently active strategies for awareness.
- Full recent correction/critique history for only the one or two due strategies assigned to that PQF group.
- The original image, if present.

It does not receive solution pools, hypothesis packets, memory banks, or full histories for the other active strategies.

For each assigned strategy it returns:

- `keep`: the strategy remains useful and ordinary correction should continue.
- `update`: the strategy lens itself is failing and the slot should start a new branch.

Balanced mode reserves updates for evidence of fundamental strategic failure. Aggressive mode is more willing to replace branches with persistent conceptual weakness, domain mismatch, or low-value exploration.

### Strategy Update Generator

After all PQF groups finish, the system consolidates their decisions. If any strategy is marked `update`, one strategy-update call generates all required replacements together.

That call receives:

- The Core Challenge.
- The complete consolidated PQF decision vector.
- Every current active strategy and branch version.
- The strategy text of every previously replaced branch, so old failed directions are not accidentally recreated.
- For each branch being updated: old strategy text, PQF reasoning, latest solution/correction, latest critique, and the current memory bank.
- The original image, if present.

It does not receive full raw history, solution-pool history, or selective hypothesis packets. It returns exactly one replacement strategy for each updated slot.

### Final Judge

The Final Judge receives:

- The Core Challenge.
- The original image, if present.
- One candidate per completed active strategy/sub-strategy.
- Candidate ID, main strategy ID, sub-strategy text, and final solution text.

It does not receive critiques, memory banks, hypothesis packets, solution pools, PQF decisions, replacement history, or scores from other agents.

For corrected branches, the final candidate is the corrected output. If no correction exists, the original execution is used. Replaced branches are archived for inspection but are not final candidates.

The judge returns one winning solution ID and a comparison based only on the candidate texts it was given.

## Single-Pass Pipeline

The non-Evolving family is a bounded pipeline rather than a persistent search loop.

### Phase 1: Strategy Space

The Initial Strategy Generator creates 1-10 main strategies.

If sub-strategies are enabled, one Sub-Strategy Generator expands each main strategy into 2-5 independent sub-strategies. The resulting execution count is approximately:

```text
main strategies x sub-strategies per main strategy
```

If sub-strategies are disabled, each main strategy becomes one direct execution branch.

### Phase 2: Hypothesis Reconnaissance

One hypothesis round is generated and tested. Although the UI label for `parallel` is "Blind Trust," the current core still creates strategies and sub-strategies before starting the hypothesis round. The mode name describes context and routing, not actual concurrency with strategy generation.

All hypothesis testers run in parallel. Their complete outputs are assembled into a full information packet and, in Selective mode, into per-strategy packets.

### Phase 3: Parallel Execution

Every strategy/sub-strategy pair receives its assigned packet and produces one complete solution attempt. Execution calls run in parallel.

If refinement is disabled, these attempts become the final candidates immediately.

### Phase 4: Critique

When refinement is enabled, each completed execution is critiqued independently. A branch's critique begins as soon as that branch's execution is available.

### Phase 5: Optional Global Diagnostic Context

Critique Synthesis and Full Solution Context are optional and independent.

Critique Synthesis creates one shared diagnostic artifact from all original solutions and critiques. If "Include Hypothesis Findings" is enabled, it also receives the complete hypothesis packet.

Full Solution Context does not create a new agent call. It serializes all original candidates and critiques into a static context block for every corrector.

### Phase 6: Parallel Correction

Each corrector receives its own solution and critique, plus any enabled shared context. Correctors run in parallel and produce one final corrected solution each.

### Phase 7: Final Selection

The Final Judge compares all completed active candidates and selects one.

## Hypothesis Injection Modes

Hypothesis generation and testing are the same basic process in all three modes. What changes is what the generator knows and how the tested packet is routed.

### Blind Trust (`parallel`)

The Hypothesis Generator receives no strategy context. It creates hypotheses from the Core Challenge alone.

After testing, the complete packet is injected into every execution agent. There is no per-strategy filtering.

In the current implementation this round starts after strategy and sub-strategy generation, despite the historical `parallel` name.

### Strategy-Aware (`strategy_aware`)

The Hypothesis Generator receives all current strategies and sub-strategies, allowing it to choose tests informed by the search space.

The complete tested packet is still injected into every execution agent. Strategy awareness affects hypothesis selection, not delivery.

### Selective (`selective_injection`)

The Hypothesis Generator receives all current strategies and sub-strategies and maps each hypothesis to one or more main strategy IDs.

After testing, the system builds a separate packet for every main strategy:

- A hypothesis with matching target IDs goes only to those strategies.
- A hypothesis with an empty target list is treated as globally useful and goes to all strategies.
- The tester never sees the target IDs.

Outside Evolving DFS, selective packets are injected into the corresponding execution agents.

Inside Evolving DFS, selective packets are injected into:

- Initial execution agents.
- Evolving DFS correctors.
- Structured Solution Pool Agents.

Selective mode is mandatory in Evolving DFS.

## Evolving Depth First Search

Evolving DFS transforms each main strategy into a versioned, persistent branch. All active branches advance through a shared global iteration cycle, while each branch also maintains its own local age.

### Iteration Identity

Four identifiers must be kept separate:

| Identifier | Meaning |
|---|---|
| Strategy ID | Stable slot, such as `main3` |
| Branch version | Increments whenever PQF replaces the strategy in that slot |
| Branch-local iteration | Counts entries produced by the current branch version |
| Global iteration | Shared orchestration cycle across all active slots |

The original execution and its first critique are branch-local iteration 1 and global iteration 1.

A replacement created after global iteration 5 remains in the same strategy slot but starts branch version 2, branch-local iteration 1. Its initial execution and critique are recorded at global iteration 5. The other surviving branches still retain their own global iteration 5 history.

### Initialization

Evolving DFS starts as follows:

1. Generate up to five main strategies.
2. Create one direct branch for each strategy.
3. Force Selective hypothesis routing.
4. Generate and test the initial strategy-aware hypothesis round.
5. Execute all strategy branches in parallel.
6. Start each critique immediately after its execution completes.
7. Store each execution plus critique as branch-local iteration 1.
8. Generate one structured solution pool for every branch.

The first pool call has no prior pool history and no other current pool outputs. It still has the branch's original execution and critique. This is the natural initial state of the same repository schema used later.

### Recurring Global Iteration

For global iterations 2 through the configured depth:

1. Build synchronized branch snapshots.
2. Start one correction task per active strategy.
3. Each correction uses its curated repository.
4. Start the branch critique as soon as that correction completes.
5. Wait until all correction/critique tasks have settled.
6. Start all solution-pool calls.
7. On even global iterations, start a hypothesis heartbeat at the same time.
8. Wait for all solution-pool calls and the optional heartbeat.
9. Run any branch-local five-entry maintenance that is due.

An odd iteration is synchronized after its solution-pool calls settle.

An even iteration is synchronized after both solution-pool calls and the hypothesis heartbeat settle.

The heartbeat and solution pools run concurrently because the heartbeat does not consume the current pool outputs.

### Snapshot Consistency

Context is assembled from snapshots rather than partially changing shared state.

At the start of a correction iteration, every corrector sees other branches as they existed at the end of the previous synchronized iteration. It does not see another branch's correction simply because that correction happened to finish a few seconds earlier.

After all corrections and critiques settle, solution-pool snapshots are created. Each pool agent therefore sees its own current iteration correction and critique. Other branches are represented only through their previously completed pool outputs. Pool agents do not see pools concurrently being generated in the same iteration.

This avoids timing-dependent prompts and makes parallel completion order irrelevant to the intended context.

## Hypothesis Heartbeat

When hypotheses are enabled, Evolving DFS refreshes them after every even global iteration.

The heartbeat Hypothesis Generator receives:

- The Core Challenge.
- All previous hypothesis rounds, including testing outputs and resolved mappings.
- Every current active strategy and branch version.
- The last two correction/critique entries from every current branch.
- A note identifying strategies replaced since the previous heartbeat.

It does not receive the current solution-pool outputs.

The new hypotheses are tested in parallel and replace the active strategy-specific packets. Previous rounds remain archived and visible in the Hypothesis Explorer.

When PQF replaces a branch, the old selective packet for that slot is immediately replaced with an explicit flushed placeholder. The replacement branch receives no old strategy-specific hypothesis knowledge. Fresh targeted knowledge becomes available at the next even heartbeat.

## Five-Entry Maintenance

Maintenance is branch-age based, not simply global-iteration based.

After every synchronized global iteration, the system checks each branch for at least five history entries that have not yet been distilled into memory. Only due branches enter maintenance.

Initial branches become due after global iteration 5. A replacement branch becomes due only after it has accumulated its own five uncompressed entries, even if the rest of the system is at a later global iteration.

### Parallel Memory And PQF

For due branches:

- One Memory Bank Agent runs per due branch.
- PQF agents evaluate due branches in groups of two.
- Memory and PQF run concurrently.
- Strategy replacement waits for both phases to settle.

Memory and PQF intentionally receive different evidence. Memory receives one branch, its prior memory, and the next five raw entries. PQF receives the last five entries for its assigned branches plus all active strategy texts for awareness.

### Recursive Memory

The memory cursor advances only after successful distillation. A later memory call receives the previous memory bank and the next five raw entries, producing one unified replacement memory bank.

The complete raw branch history remains stored for UI and archival purposes. The memory bank controls what is reintroduced into active corrector and solution-pool prompts after history moves outside the five-entry active window.

### PQF Decision Semantics

PQF evaluates whether the strategy itself remains a valuable search direction.

It should not request an update merely because one correction contains a local defect. Correction is responsible for repairable execution problems. PQF is responsible for strategic failure: repeated conceptual traps, persistent domain mismatch, unproductive framing, or a branch whose strategy no longer justifies continued depth.

## Strategy Replacement

When at least one PQF decision is `update`, one consolidated Strategy Update Generator call produces replacements.

For every updated slot, the orchestrator:

1. Archives the old strategy text, latest solution, latest critique, memory bank, complete branch history, pool history, PQF reason, and replacement metadata.
2. Keeps the same stable strategy ID.
3. Increments the branch version.
4. Replaces the strategy text.
5. Clears active correction history.
6. Clears active solution-pool history.
7. Clears active memory.
8. Flushes the active selective hypothesis packet.
9. Starts a fresh execution and critique for the replacement branch.

The replacement execution is recorded at the maintenance global iteration as branch-local iteration 1.

The system does not generate a replacement branch's first solution pool immediately during the maintenance phase. Its pool history remains empty until the next normal global iteration reaches the solution-pool stage.

Archived branches remain visible in strategy history and the serialized solution-pool repository. They are not included in active corrector, pool, hypothesis, or final-judge context.

## Structured Repository And Stored State

Deepthink maintains more state than any one agent receives.

### Active Branch State

Each active Evolving DFS branch tracks:

- Stable strategy ID.
- Current strategy text.
- Branch version.
- Branch-local iteration count.
- Full branch execution/correction and critique history.
- Full solution-pool history.
- Current recursive memory bank.
- Current selective hypothesis packet.
- Last memory cursor.
- Replacement metadata.

### Pipeline State

The pipeline additionally tracks:

- Initial and refreshed hypothesis rounds.
- Full and strategy-specific knowledge packets.
- Every critique agent record.
- Every pool agent record.
- Every memory agent record.
- Every PQF group and decision.
- Replaced branch archives.
- Live agent events and retries.
- Final judge input and result.

### Serialized Structured Solution Pool

The UI-facing structured repository contains active strategies and archived replaced branches, including histories and pool outputs. This complete serialized object is for state, inspection, and export.

It is not passed wholesale to agents. Corrector and pool prompts are rebuilt from smaller curated views for every call.

## Python Tool Isolation

When Deepthink code execution is enabled, Python access is limited to:

- Hypothesis Testing.
- Solution Attempt.
- Solution Critique.
- Single-pass Self-Improvement.
- Evolving DFS Solution Correction.

Strategy generation, sub-strategy generation, hypothesis generation, synthesis, PQF, memory, solution-pool generation, and final judging do not receive Python access.

Hypothesis testers use isolated per-hypothesis sessions. They do not share Python variables or files across hypotheses or refresh rounds.

Execution, critique, and correction agents use sessions scoped by run, role, strategy, sub-strategy, and branch version. A surviving branch keeps its role-specific Python state across iterations. A replacement branch receives a new versioned session and therefore a fresh Python environment.

The execution, critique, and correction roles do not share one common Python session with each other. Persistence is role-specific.

## Output Representations

Normal model calls store the complete returned text without programmatic trimming.

Python-enabled calls may have three representations:

- Context text, which may include the execution trace used by downstream agents.
- Display text, used by the UI.
- Final text, representing the final work product.

The final judge prefers final work-product text when available. Full trace/context representations remain available to the pipeline and UI records.

## Timing, Retry, And Failure Behavior

Every Deepthink model invocation can make up to four total attempts: the initial attempt plus up to three retries.

Retry delays use exponential backoff:

```text
20 seconds
40 seconds
80 seconds
```

Where a 15-minute timeout is configured, it is one total budget for that agent call across attempts and retry delays. It is not a fresh 15-minute budget for every attempt.

The 15-minute budget is currently applied to:

- Hypothesis generation.
- Hypothesis testing.
- Solution execution.
- Solution critique.
- Single-pass correction.
- Evolving DFS correction.
- Structured solution-pool generation.
- Memory-bank generation.
- Final judging.

Initial strategy generation, sub-strategy generation, Critique Synthesis, PQF, and strategy update do not currently use that explicit 15-minute wrapper.

Initial strategy generation, PQF, and strategy update are control-critical. If their retry sequence is exhausted, the pipeline stops because it cannot safely continue with missing branch-control state.

Most work-agent failures are recorded on the affected agent while other parallel branches are allowed to settle. Missing outputs are represented as unavailable rather than fabricated.

## Final Selection Boundary

The Final Judge is intentionally separated from the internal search machinery.

It compares only active candidate solution texts. This prevents internal critique volume, pool confidence, branch age, PQF decisions, or the existence of a large memory bank from becoming an accidental voting signal.

The final result includes:

- Winning candidate ID.
- Candidate origin.
- The judge's comparison.
- The definitive selected solution text.

## UI Surface

Deepthink exposes tabs conditionally:

| Tab | Purpose |
|---|---|
| Live | Real-time agent calls, prompts, responses, retries, and status |
| Strategic Solver | Active strategies, sub-strategies, branch versions, archived replacements, and solutions |
| Hypothesis Explorer | Current and historical hypothesis rounds, routing targets, tests, and packets |
| Solution Pool | Per-iteration BFS pools, memory banks, and structured repository |
| Dissected Observations | Individual critiques and, outside Evolving DFS, optional critique synthesis |
| Evolution Filter | PQF group decisions and reasoning |
| Final Result | Final judge output and selected solution |

The Solution Pool tab appears only when Evolving DFS enables structured pools. The Evolution Filter tab appears after PQF agents exist. The Hypothesis Explorer appears only when hypothesis count is greater than zero.

## Implementation Ownership

The main architectural responsibilities are separated as follows:

| File | Responsibility |
|---|---|
| `DeepthinkCore.ts` | Pipeline orchestration, parallelism, retries, state transitions, hypothesis rounds, execution, refinement, maintenance, and judging |
| `DeepthinkIterativeHistory.ts` | Deterministic Evolving DFS prompt and curated repository construction |
| `DeepthinkPrompts.ts` | Customizable system instructions and agent role definitions |
| `DeepthinkPromptsContent.tsx` | System-prompt and per-agent model customization UI |
| `DeepthinkConfigController.ts` | Configuration constraints and mode side effects |
| `ModelConfig.ts` | Stored Deepthink parameters and clamped getters |
| `SolutionPool.tsx` | Solution-pool, memory-bank, and repository presentation |
| `Deepthink.tsx` / `Deepthink.ts` | Strategic, hypothesis, critique, PQF, and final-result UI |

The compatibility history-manager classes in `DeepthinkIterativeHistory.ts` are thin adapters. The active Evolving DFS pipeline uses explicit branch runtime state and deterministic repository builders rather than an external conversation-history manager.

## Removed Architecture

The current Deepthink pipeline has no red-team stage and no atomic reconstruction stage. PQF now performs strategy-level branch maintenance after evidence has accumulated, rather than judging strategies before their executions and critiques exist.

Sub-strategies remain available in the non-Evolving pipeline without red-team filtering. Their quality is tested through execution, critique, optional correction, and final judging.

-------------

Architecture Diagram (Code):
---
config:
  layout: elk
---
flowchart TB
    %% ================= PHASE 1: INITIALIZATION & HYPOTHESIS INJECTION =================
    IN["Core Challenge Input<br>(Max 10 Iters | 15m Strict Timers)"] --> GEN["Master Strategy Generator Agent"]:::strategyGen

    GEN -- "Spawns N Strategies" --> S1["Strategy 1"]:::strategyGen & S2["Strategy 2"]:::strategyGen & S3["Strategy 3"]:::strategyGen & S4["Strategy 4"]:::strategyGen

    S1 & S2 & S3 & S4 --> HGEN["Hypothesis Generation Agent<br>(Selective / Strategy-Aware Mode)"]:::hypothesis

    HGEN --> HT1["Hypothesis Testing Agent 1"]:::hypothesis & HT2["Hypothesis Testing Agent 2"]:::hypothesis & HT3["Hypothesis Testing Agent 3"]:::hypothesis

    HT1 -- "Extracts Axioms" --> P1["Sub-Packet 1"]:::info
    HT2 -- "Extracts Axioms" --> P2["Sub-Packet 2"]:::info
    HT3 -- "Extracts Axioms" --> P3["Sub-Packet 3"]:::info

    %% Exact Strategy Mappings
    P1 --> E3["Execution Agent 3"]:::execution & E4["Execution Agent 4"]:::execution
    P2 --> E2["Execution Agent 2"]:::execution & E3
    P3 --> E1["Execution Agent 1"]:::execution & E2 & E3

    S1 --> E1
    S2 --> E2
    S3 --> E3
    S4 --> E4

    E1 --> C1["Critique Agent 1"]:::critique
    E2 --> C2["Critique Agent 2"]:::critique
    E3 --> C3["Critique Agent 3"]:::critique
    E4 --> C4["Critique Agent 4"]:::critique

    C1 & C2 & C3 & C4 --> PINIT["Initialize Structured Solution Pool Repo<br>(Original Executions + Critiques)"]:::pool

    %% ================= PHASE 2: EVOLVING DEPTH FIRST SEARCH (EDFS) LOOP =================
    PINIT --> LOOP["Start EDFS Iteration Loop<br>(Global Iterations 1 to 10)"]:::info

    %% --- Track A: Solution Pool Generation ---
    LOOP --> PA1["Solution Pool Agent 1"]:::pool & PA2["Solution Pool Agent 2"]:::pool & PA3["Solution Pool Agent 3"]:::pool & PA4["Solution Pool Agent 4"]:::pool

    PA1 -. "Context: Last 5 Pools (S1)<br>Latest Pool (S2,S3,S4)<br>Latest Corr+Crit (S1)" .-> P_REPO["Structured Solution Pool<br>Real-Time Curated Updates"]:::pool
    PA2 -. "Context: Last 5 Pools (S2)<br>Latest Pool (S1,S3,S4)<br>Latest Corr+Crit (S2)" .-> P_REPO
    PA3 -. "Context: Last 5 Pools (S3)<br>Latest Pool (S1,S2,S4)<br>Latest Corr+Crit (S3)" .-> P_REPO
    PA4 -. "Context: Last 5 Pools (S4)<br>Latest Pool (S1,S2,S3)<br>Latest Corr+Crit (S4)" .-> P_REPO

    %% --- Track B: 2N Cycle (Hypothesis Evolution) ---
    LOOP -- "Every 2 Iterations (Even)" --> HEVO["Hypothesis Evolution Generator<br>(Reads Pools & Corrections)"]:::hypothesis
    HEVO --> HTE1["Hypo-Evo Testing Agent 1"]:::hypothesis & HTE2["Hypo-Evo Testing Agent 2"]:::hypothesis
    HTE1 & HTE2 --> P_UPD["Updated Selective Packets<br>(Dynamic Axiom Ledgers)"]:::info

    %% --- Iteration Synchronization Barrier ---
    P_REPO --> SYNC{"ITERATION COMPLETION SYNC<br><br>ODD ITERS: Awaits only Solution Pools<br>EVEN ITERS: Awaits Pools + Hypothesis Packets"}:::info
    P_UPD --> SYNC

    %% --- Track C: Correction & Critique ---
    SYNC --> CO1["Corrector Agent 1"]:::refinement & CO2["Corrector Agent 2"]:::refinement & CO3["Corrector Agent 3"]:::refinement & CO4["Corrector Agent 4"]:::refinement

    CO1 -. "Context: 5-Iter History (S1)<br>Pool (S1)<br>Latest Corr+Crit (S2,S3,S4)<br>Updated Axioms" .-> CR1["Critique Agent 1"]:::critique
    CO2 -. "Context: 5-Iter History (S2)<br>Pool (S2)<br>Latest Corr+Crit (S1,S3,S4)<br>Updated Axioms" .-> CR2["Critique Agent 2"]:::critique
    CO3 -. "Context: 5-Iter History (S3)<br>Pool (S3)<br>Latest Corr+Crit (S1,S2,S4)<br>Updated Axioms" .-> CR3["Critique Agent 3"]:::critique
    CO4 -. "Context: 5-Iter History (S4)<br>Pool (S4)<br>Latest Corr+Crit (S1,S2,S3)<br>Updated Axioms" .-> CR4["Critique Agent 4"]:::critique

    CR1 & CR2 & CR3 & CR4 --> CHECK{"Iteration Cycle Check"}
    CHECK -- "Iter % 5 != 0" --> LOOP

    %% ================= PHASE 3: 5-ITERATION CYCLE (EVOLUTION & PQF) =================
    CHECK -- "Iter % 5 == 0" --> HB5["5-Iteration Heartbeat<br>(Evolution Sync Phase)"]:::info

    %% Memory Distillation
    HB5 --> MB1["Memory Bank 1<br>(Recursive Distillation)"]:::filter & MB2["Memory Bank 2<br>(Recursive Distillation)"]:::filter & MB3["Memory Bank 3<br>(Recursive Distillation)"]:::filter & MB4["Memory Bank 4<br>(Recursive Distillation)"]:::filter

    %% N/2 PQF Evaluation
    HB5 --> PQF1["PQF Agent 1<br>(Evaluates S1, S2)"]:::filter & PQF2["PQF Agent 2<br>(Evaluates S3, S4)"]:::filter

    MB1 & MB2 & MB3 & MB4 --> GY["Strategy Graveyard<br>(Stores Post-Mortems)"]:::filter
    PQF1 & PQF2 --> DEC["Consolidated PQF Decision Vector"]:::filter

    GY & DEC --> EVOLVE_CHECK{"PQF Outcome"}
    EVOLVE_CHECK -- "Decision: Keep All" --> LOOP

    %% Strategy Evolution Path
    EVOLVE_CHECK -- "Decision: Update (e.g., S3 Failed)" --> GEN_UPD["Master Strategy Generator<br>(Receives Full Graveyard + Active Strategies)"]:::strategyGen

    GEN_UPD -- "Spawns Replacement Branch" --> S3V2["Strategy 3-v2<br>(New ID, Resets Age)"]:::strategyGen
    S3V2 --> E3V2["Execution Agent 3-v2"]:::execution
    E3V2 --> C3V2["Critique Agent 3-v2"]:::critique
    C3V2 --> FLUSH["Flush S3 Hypotheses<br>Overwrite Pool Slot 3<br>Set Local Age = 1"]:::filter
    FLUSH --> LOOP

    %% ================= PHASE 4: FINAL JUDGING =================
    CHECK -- "Iter == 10" --> FJ["Final Judge Agent<br>Analyticus Ultima"]:::final
    FJ --> BEST["Best Solution Selected"]:::final

    %% ================= STYLING DEFINITIONS =================
    classDef strategyGen fill:#E6E6FA,stroke:#8A2BE2,stroke-width:2px,color:#000
    classDef execution fill:#F0F8FF,stroke:#4682B4,stroke-width:1px,color:#000
    classDef critique fill:#FFFACD,stroke:#DAA520,stroke-width:1px,color:#000
    classDef refinement fill:#E8F5E8,stroke:#228B22,stroke-width:1px,color:#000
    classDef hypothesis fill:#FFE4E1,stroke:#DC143C,stroke-width:1px,color:#000
    classDef filter fill:#D3D3D3,stroke:#696969,stroke-width:2px,color:#000
    classDef final fill:#F1F8E9,stroke:#66BB6A,stroke-width:2px,color:#000
    classDef pool fill:#E0F2F1,stroke:#00897B,stroke-width:2px,color:#000
    classDef info fill:#E1F5FE,stroke:#0277BD,stroke-width:1px,color:#000
