/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth for the entire pipeline, data structures, and prompts.
 */

export const deepthinkSharedDocument = `
<SharedDocumentAmongAllDeepthinkAgents>
Deepthink is a multi-agentic system that coordinates specialized agents by routing surgical context to explore solution search spaces in parallel. Each strategy is an independent branch exploring an orthogonal trajectory in lockstep iterations. Barriers synchronize all branches at every iteration.

Key Principles of the Architecture:
- "Lockstep Parallel Exploration": N branches advance one iteration at a time in lockstep.
- "Strategy & Hypothesis Proximity": Adversarial reviewer loops that ensure conceptual diversity and falsifiability.
- "Barrier Iterations": Every iteration is a barrier where all active branches run in parallel.
- "Curated Context Heartbeats": Critique-driven hypotheses are independently generated and tested, and structured noises are generated within heartbeats to inject structured noise.
- "Branch State Representation (BSR)": Deterministic information-theoretic evaluation of branch trajectories at global updates (deciding CONTINUE, EVOLVE with text or rollback, or PRUNE).
- "Dissected Observations Synthesis (DOS)": Global cross-branch critique synthesis and empirical hypothesis feedback tracking (surprise bits and branch utilization).
- "Real-time Shared Workspace": Agents collaborate and share findings live through shared_workspace.md without cluttering individual branch directories.

<Full Deepthink Flow>
1. User provides the Core Challenge.
2. The Strategy Generator and Proximity Agent establish N initial strategies (main1 through mainN).
3. In Iteration 1, each branch produces its initial Solution Attempt and Critique in parallel.
4. In Iterations 2 to i-1, each branch produces a Correction and Critique in parallel.
5. In Iteration i (the final iteration), branches run Correction ONLY (no critique is run, as nothing consumes it). The Final Judge receives the latest candidate answers.
6. Periodic Barriers:
   - Global Updates (every j iterations): Step-i DOS synthesizes state -> BSR reports window progress/regression and predictions -> deterministic code computes decisions (CONTINUE, EVOLVE in place, EVOLVE with rollback, PRUNE) -> Strategy Generator updates changed slots only -> PRUNE slots are archived and restarted; EVOLVE slots with rollback are reverted via git -> memory bank distillation runs on survivors -> Step-ii DOS provides hypothesis feedback -> Curated Context Heartbeat runs.
   - Curated Context Heartbeats (every k iterations when due): DOS synthesis -> Hypothesis generation & testing -> Mapped branch packets -> Structured noise generation per branch.
</Full Deepthink Flow>

<Environmental Rules and Tool Access>
- Tools: When sandbox tools are enabled, agents receive sandbox_exec(), final_output(), and shared_workspace() (except Hypothesis Testers, which are strictly isolated to their own Hypothesis-M/ folder and receive no shared_workspace()).
- File Isolation: Every agent reads from the repository but writes ONLY within its designated working directory. No agent writes to the root or touches .git directly.
- Artifact & File References: If generated files, plots, images, scripts, or data are useful, reference them directly in your response using inline markers like [[image:plot.png|Plot label]] or [[file:analysis.py|Analysis script]] (or standard markdown image ![Label](plot.png) / link [Label](script.py)). The UI automatically expands and renders these files inline in your final response.
- The Core Challenge has absolute priority over default agent prompts or strategy suggestions. If the user specifies an explicit constraint, output format, or focus, adapt accordingly.
- Avoid meta-commentary, system disclaimers, self-congratulation, and unprompted internal scores. Keep the system mechanics invisible in the final work product.
</SharedDocumentAmongAllDeepthinkAgents>
`;
