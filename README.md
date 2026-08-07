# Iterative Studio

Iterative Studio is a multi-agent reasoning application with Google AI, OpenAI, Anthropic, OpenAI-compatible, and local-model support.

## Application workflows

### Deepthink

Deepthink is a fixed high-depth search pipeline. Every run uses the same lifecycle:

1. Generate one to five independent strategies and run strategy-proximity review.
2. Optionally generate, review, and independently test hypotheses.
3. Route each completed hypothesis test to its declared strategy branches.
4. Produce an initial solution and critique for every branch.
5. Advance branches through the configured correction depth, with optional structured solution-pool exploration.
6. Refresh hypotheses every two completed global iterations when hypothesis testing is enabled.
7. Condense branch memory and run the evolution filter after each five-entry branch-history window.
8. Replace structurally failed branches in stable, versioned strategy slots.
9. Ask an isolated final judge to select from the active branch solutions.

Each strategy is one direct, persistent branch. The configured depth includes its initial solution attempt. A branch replacement archives the complete prior version under `Pruned_Strategies` and starts a clean version in the same slot.

The structured solution pool is optional. When enabled, it explores five executed alternatives for each branch and correction iteration. Branch isolation controls whether correction and pool agents receive limited peer-branch context. Hypothesis routing is always branch-mapped: testers receive only the challenge and one self-contained hypothesis, while completed testing results are delivered only to their declared branches.

The final judge receives active candidate strategy IDs, strategy text, and final solution text. It does not receive critiques, memory, solution pools, evolution-filter decisions, or archived branches.

See [Deepthink architecture and context flow](Deepthink/DeepthinkDocs.md) for the complete contracts.

### Adaptive Deepthink

Adaptive Deepthink is an orchestrator-directed workflow. Its LangGraph orchestrator decides when to generate strategies, generate and test hypotheses, execute branch chains, save candidates, compact a pass, inspect files, and submit the final answer.

Worker topology:

- Strategy Generator ↔ Strategies Proximity
- Hypothesis Generator ↔ Hypothesis Proximity
- Hypothesis Tester
- Execution → Critique → Correction

The orchestrator owns candidate selection and final submission. Completed passes are compacted into repository files, and unsaved branch corrections use checkpoint-and-restore semantics so discarded work cannot leak into later passes.

### Contextual

Contextual is a long-running iterative collaboration between a Main Generator, Iterative Agent, Solution Pool Agent, and Memory Agent. It condenses history as context grows and exposes the evolving interaction in real time.

## Deepthink configuration

Deepthink exposes only controls used by its fixed pipeline:

- Strategy count and strategy-proximity loops
- Hypothesis enablement, count, and hypothesis-proximity loops
- Search depth
- Branch isolation
- Solution-pool enablement
- Evolution-filter aggressiveness
- Sandbox code execution
- Per-agent models, prompts, and thinking levels

## Sandbox and artifacts

When sandbox execution is enabled, agents can inspect and modify their role-scoped repository view, run commands, and submit a validated artifact through `final_output`.

Deepthink uses the following active layout:

```text
Results/
├── Hypothesis-vN/
│   └── Hypothesis-X/
├── Strategy-N/
│   ├── Critique/
│   └── SolutionPool/
└── Pruned_Strategies/
```

Execution and correction write direct files in `Strategy-N`; critique writes under `Critique`; pool exploration writes under `SolutionPool`. Hypothesis tests are stored by hypothesis round. Role-scoped mounts prevent accidental access to protected or unrelated agent directories.

## Configuration and persistence

- Select a global model or override individual agent models.
- Configure provider credentials for Google AI, OpenAI, Anthropic, or an OpenAI-compatible endpoint.
- Local servers such as `http://127.0.0.1:1234` can run fully offline.
- Exported state is gzip-compressed and version validated on import.
- Deepthink configuration exports only the fixed-pipeline fields understood by the current state schema.

## Retry behavior

Deepthink permits four total attempts per agent call, with delays of 30 seconds, 60 seconds, and 5 minutes. Calls with a 15-minute timeout share that budget across attempts and delays. Failure of required strategy-generation, evolution-filter, or strategy-update work stops the pipeline; non-critical branch failures remain visible on the affected branch.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```

The project uses TypeScript, React 19, and Vite.

```text
AdaptiveDeepthink/  Orchestrator-directed workflow
Backend/            Sandbox and provider backends
Contextual/         Contextual workflow
Core/               Application state, loading, and persistence
Deepthink/          Fixed Deepthink pipeline and UI
Routing/            Provider, model, prompt, and configuration routing
Styles/             Shared UI components and styles
```

## License

Apache-2.0
