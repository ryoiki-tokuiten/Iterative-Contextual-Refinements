# Iterative Studio

Highly specific & carefully thought multi-agent pipelines. The goal is to scale the inference test-time compute for any kind of problem/benchmark and push the frontier. All major providers are supported + local model support fully.

## Operational Modes

### 1. Deepthink Mode (huge refactoring in progress)

Deepthink is a multi-agentic system that co-ordinates agents with highly focused roles by routing very precise and surgical context to explore the solution search space. More broadly, it explores diverse "correct trajectories" or "implementations" or "executions" in parallel for any given user request. The system is based on the following ideas: "strategies proximity", "hypothesis proximity" "parallel exploration", "iterative corrections/refinements", "cross-strategy-learning through curated context", "independent hypothesis generation & testing", "random structured noise injection" and a "meta strategies evolving loop (pruning)". Each agent role can be steered surgically by the user as needed.

**Full Deepthink Flow:**
User provides the core challenge or put some files in your virtual environment and start the process. The system first generates high-level, distinct ways to approach the core challenge(strategies): in a global context, these are like parallel branches that tries to execute the given user core challenge using the provided approach (the strategy).
In parallel, various hypothesis are generated about the core user challenge and each one is tested independently. Hypotheses may include testing pivotal uncertainties or solving a problem for a smaller case and test if they can be transferred for a larger network etc. This is extremely useful context since it was tested with full attention by an independent agent and the agents further don't have to spend their tokens again thinking about that.
Most of the times, hypothesis are aware about the strategies i.e. they know exactly what strategies will be executed in the system later. So the hypotheses here are generated so that the agents executing those strategies can benefit., these are also resolved in advanced i.e. exactly what hypothesis testing should this strategy / branch agents should see to keep the context focused. Hypothesis generation and testing organically produce useful context and information that can be integrated into the branches. These are called information packet (or sub-packets if they are strategy-resolved).
Now, the execution agent (actual work-producing agent) receives the core challenge + its assigned strategy + available information packet. It produce its work. Its work is then critiqued. this happens in each and every branch in parallel.
By default, before producing the correction blindly by simply passing the execution + critique, this system introduces an extra agent in this step: structured solution pool agent. their sole purpose is to add random structured noise to each branch so that the branch is not stuck in a local-minima. pool contains various artifacts, independent helpful blocks, correction approaches, logic fragments, alternative improvements, or full alterative solutions that the correction agent may benefit from... but they are all not necessarily correct, rigorous and complete. yes, this can contain the wrong artifacts and that's the "random structured noise" in this context. the reason behind this is that typical execution > critique > correction never works with LLMs. they will always get stuck in some kind of cognitive loop. showing them wrong artifacts  or approaches explicitly executed removes their cognitive restraint and they actually start considering paths or approaches for implementation of some idea or solving some problem that they might only consider in their chain of thoughts but never in the actual final work pushed. it is like adding random structured noise within a sanity boundary.
Once the solution pool is ready, the correction agent receives the previous work + critique + available information packet + solution pool for that branch + curated cross-strategy context and it produces an improved work product.
and that's pretty much all. on top of this loop, there is an extra highly precise engineering to refresh the hypothesis (and thus information packets) after every k iteration., or after certain iterations distill the history into memory banks(what worked, what improved, what critique patterns persisted etc), or update the main strategies themselves (post-quality filter) after some point based on the degree to which critique-correction go back in a loop without a big delta (i.e. is the branch stuck? or the strategy is flawed? etc). post quality filter decides whether a branch should continue, be refined, or be replaced with an updated strategy.
after certain iterations, the final corrections are collected and sent to the final judge. it selects the best execution.

**Sandbox Environment and Artifact Submission**:
Deepthink integrates a secure sandbox virtual environment for execution and verification.
- **Repository Visibility**: Every Deepthink role receives `sandbox_exec` and `final_output` when the Sandbox Terminal Environment is enabled. Active branches use `Strategy-N/{Critique,SolutionPool}`: execution and correction write direct branch files, critique owns `Critique`, and the pool owns `SolutionPool`. PQF replacements archive the complete old branch under `Pruned_Strategies/Strategy-N_First_PQF` (then ordinal successors) before recreating fresh active slot directories. Hypothesis tests are organized by `Hypothesis-vN`, while only current selectively routed tests are mounted to branch workers. (this is largely a scaffolding and I am currently working on a cleaner solution.)
- **Submit Final Artifact**: Sandbox-enabled agents use `sandbox_exec` for iterative exploration and testing, then use `final_output` to submit their completed work. JSON-producing roles submit their existing role-specific JSON object directly through `final_output`; the environment validates that contract in the tool loop and returns a correction error without discarding the agent's research. Downstream agents and the central system receive only the submitted artifact, filtering out intermediate command transcripts and scratchpad data.


See [Deepthink architecture and context flow](Deepthink/DeepthinkDocs.md) for the complete agent contracts, repository schemas, mode behavior, iteration synchronization, and failure policy. The previous diagram remains archived at `Deepthink/OldSystemArchitecture.png`.


### 2. Adaptive Deepthink Mode

**Purpose**: An orchestrator-directed, pass-based Deepthink workflow for divergent strategic search without a separate final judge.

**Worker topology**:
- Strategy Generator ↔ Strategies Proximity
- Hypothesis Generator ↔ Hypothesis Proximity
- Test Hypothesis
- Execution → Critique → Correction for each selected strategy

Each generation/proximity pair runs a bounded three-round internal revision loop. The orchestrator remains responsible for judging evidence, selectively routing tested hypotheses, saving successful strategies, replacing failed unsaved slots, and submitting the final answer.

**Tool system**:
- `generate_strategies` — generates or updates up to five unsaved strategies.
- `generate_hypothesis` and `test_hypothesis` — create critique-driven, non-strategy-aware hypotheses and test them independently.
- `execute` — parallel per-strategy Execution → Critique → Correction, with optional per-branch `specialContext`.
- `save` — permanently reserves a strategy and its corrected branch state.
- `finalize_pass_and_execute` — compacts the completed pass into Markdown/trace files, advances the pass, then executes the requested next branches.
- `read_files`, `virtual_environment`, and `submit_final_output` — restore compacted evidence, use the shared sandbox repository, and let the orchestrator submit the final answer.

**Filesystem and UI**:
Adaptive runs project directly into the Deepthink Live and Filesystem tabs. When the Sandbox Terminal Environment is enabled, every worker receives the corresponding Deepthink role permissions and `final_output`; the orchestrator receives an explicit root read/write virtual-environment tool. Full agent outputs and JSON traces are written to the Results repository. Before an unsaved branch's correction runs, its strategy directory is checkpointed; the checkpoint is restored before a later pass reuses that strategy, so discarded corrections cannot leak into future executions.


### 3. Contextual Mode

**Purpose**: Iterative refinement through specialized agent collaboration.

This can work stable upto 2 Hours without human intervention for difficult problems and actually yield high quality insights and results.

**Architecture**:
- Three-agent system with distinct responsibilities:
  1. **Main Generator**: Produces content based on user requirements
  2. **Iterative Agent**: Suggests improvements and corrections
  3. **Memory Agent**: Works like a long term memory.

**Key Components**:
- `ContextualCore.ts`: State management and history tracking
- Separate history managers for each agent type
- Automated context window management

**Agent Interaction**:
```
User Request → Main Generator → Generated Content
                      ↓
              Iterative Agent → Suggestions
                      ↓
              Main Generator → Refined Content
                      ↓
              [Repeat until complete]
                      ↓
              Memory Agent → History Compression
```

**Key Features**:
- Automatic history condensation when context limits approached
- Iterative refinement through suggestion-response cycles
- Clean separation of concerns between agents
- Real-time visualization of agent interactions

**Workflow**:
1. Main generator creates initial content
2. Iterative agent analyzes and suggests improvements
3. Main generator applies suggestions
4. Memory agent compresses history when needed
5. Cycle continues until completion criteria met


## License

Apache-2.0
