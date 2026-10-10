/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth for the entire pipeline, all loop barriers,
 * and data structures (§1, §2, §3, §4, §5, §6, §7, §8, §9).
 * NOTE: For ANY minor inconvenience or uncertainty during execution, ALWAYS consult
 * Deepthink_Consolidated_Specification.md first. It contains critical operational
 * details (failure policies, hidden-prediction rules, window_start rollbacks, etc.)
 * that must never be altered or ignored.
 */

import { nanoid } from 'nanoid';
import { HumanMessage } from '@langchain/core/messages';
import type {
  BsrAction,
  BsrComputedScores,
  BsrEvolveForm,
  BsrReport,
  DeepthinkHypothesisData,
  DeepthinkLiveEvent,
  DeepthinkMainStrategyData,
  DeepthinkPipelineState,
  DeepthinkStructuredSolutionPoolAgentData,
  DosHypothesisFeedbackItem,
  DosOutput,
  HeartbeatBlock,
  ProximityTurn,
  RealizedHypothesisFeedback,
} from './types.ts';
import {
  evaluateBranchState,
  calculateSurpriseBits,
  calculateUtilizationVector,
  SIZE_WEIGHTS,
  TAU,
  THETA,
  type BsrConfigOptions,
} from './formulas.ts';
import {
  determinePostIterationStep,
  validateLoopBounds,
} from './loopController.ts';
import {
  buildContextForBsr,
  buildContextForCorrectionAgent,
  buildContextForCritiqueAgent,
  buildContextForDos,
  buildContextForFinalJudge,
  buildContextForHypothesisGenerate,
  buildContextForSolutionPool,
  buildContextForStrategyGlobalUpdate,
  buildContextForStrategySeed,
  buildCritiqueCorrectionMemoryBankHistory,
  buildCrossStrategyLatestCorrectionCritique,
  buildCrossStrategyLatestPools,
  parsePromptToGeminiParts,
} from './contextBuilders.ts';
import {
  DEEPTHINK_AGENT_REGISTRY,
  deepthinkAgentModel,
  deepthinkAgentSystemInstruction,
  type DeepthinkAgentKind,
} from './agentRegistry.ts';
import { createDefaultCustomPromptsDeepthink } from '../prompts/index.ts';
import { GitRepositoryHarness } from './gitRepository.ts';
import { SharedWorkspaceManager } from './sharedWorkspace.ts';
import { buildStrategyProximityHistoryWithNotes } from './harnessNotes.ts';
import type {
  SandboxRepositoryAccess,
  DeepthinkResultsContextFile,
} from './types.ts';

async function getSandboxToolAgentRunner() {
  try {
    const mod = await import('../../Core/SandboxToolRuntime.ts');
    return mod.runSandboxToolAgent;
  } catch {
    return null;
  }
}

// ============================================================================
// Constants & Failure Policy (§9)
// ============================================================================

/** Delays for 4 total attempts: 30s, 60s, 5m (§9) */
const RETRY_DELAYS_MS = [30_000, 60_000, 5 * 60_000] as const;
const MAX_API_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 4 attempts total
const TOTAL_AGENT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes shared by attempts and delays (§9)

export interface PipelineExecutionCallbacks {
  callAI: (args: {
    prompt: string;
    model: string;
    systemInstruction?: string;
    thinkingConfig?: { thinkingLevel?: string };
    responseSchema?: Record<string, unknown> | boolean;
    agentKind?: DeepthinkAgentKind;
    stepDescription?: string;
  }) => Promise<string>;
  parseJsonStrict?: <T>(text: string) => T;
  parseJsonSafe?: <T>(text: string, fallback?: T) => T;
  onLiveEvent?: (event: DeepthinkLiveEvent) => void;
  onStateChange?: (state: DeepthinkPipelineState) => void;
  retryDelaysMs?: number[];
}

export class PipelineStopRequestedError extends Error {
  constructor(message = 'Deepthink run stopped by user request.') {
    super(message);
    this.name = 'PipelineStopRequestedError';
  }
}

export interface OutputValidationContract<T> {
  name: string;
  validate: (parsed: T) => void;
}

/**
 * Extracts a candidate JSON string from markdown code blocks or surrounding text.
 */
export function extractJsonString(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.trim();

  // 1. If wrapped in markdown code fence, extract the block
  const fenceMatch = text.match(/```(?:json|json5)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (fenceMatch && fenceMatch[1].trim()) {
    text = fenceMatch[1].trim();
  }

  // 2. If it already starts with { or [, return it
  if (text.startsWith('{') || text.startsWith('[')) {
    return text;
  }

  // 3. Find the outermost { ... } or [ ... ]
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let startIdx = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx !== -1) {
    const isObject = text[startIdx] === '{';
    const closeChar = isObject ? '}' : ']';
    const lastIdx = text.lastIndexOf(closeChar);
    if (lastIdx > startIdx) {
      return text.substring(startIdx, lastIdx + 1).trim();
    }
  }

  return text;
}

/**
 * Clean, modular, functional orchestrator for the Deepthink Consolidated Specification.
 */
export class DeepthinkPipelineOrchestrator {
  private readonly gitHarness: GitRepositoryHarness;
  private readonly sharedWorkspace: SharedWorkspaceManager;
  private commitHashesPerIteration = new Map<string, string>(); // key: `slotIndex:iteration` or `slotIndex:start_${windowStart}`
  private strategiesUsedSoFar: Array<{ slotId: string; iterationFinalized: number; text: string }> = [];
  private globalUpdateStrategyHistories: Array<{ updateNumber: number; turns: ProximityTurn[] }> = [];
  private readonly state: DeepthinkPipelineState;
  private readonly callbacks: PipelineExecutionCallbacks;

  constructor(
    state: DeepthinkPipelineState,
    callbacks: PipelineExecutionCallbacks
  ) {
    this.state = state;
    this.callbacks = callbacks;
    this.gitHarness = new GitRepositoryHarness(state.id);
    this.sharedWorkspace = new SharedWorkspaceManager();
  }

  public getSharedWorkspace(): SharedWorkspaceManager {
    return this.sharedWorkspace;
  }

  public getGitHarness(): GitRepositoryHarness {
    return this.gitHarness;
  }

  /**
   * Strict JSON parsing helper: extracts code block / JSON payload
   * and parses strictly via standard JSON.parse.
   * If parsing fails, throws immediately (§9). No fallback values or dirty relaxed JSON.
   */
  public parseJsonStrict<T>(raw: string, context?: string): T {
    if (!raw || typeof raw !== 'string') {
      throw new Error(`Cannot parse JSON from empty or invalid raw input${context ? ` in ${context}` : ''}.`);
    }

    if (this.callbacks.parseJsonStrict) {
      return this.callbacks.parseJsonStrict<T>(raw);
    }

    const extracted = extractJsonString(raw);
    try {
      return JSON.parse(extracted) as T;
    } catch (err: any) {
      throw new Error(`Strict JSON parse failed${context ? ` in ${context}` : ''}: ${err?.message || String(err)}`);
    }
  }

  // ==========================================================================
  // Public Execution Entry Point (§1, §3)
  // ==========================================================================

  public async run(): Promise<void> {
    const config = this.state.runConfig;
    const boundsCheck = validateLoopBounds(config.i, config.j, config.k);
    if (!boundsCheck.valid) {
      throw new Error(`Invalid Deepthink loop configuration: ${boundsCheck.error}`);
    }

    this.emitEvent('Orchestrator', 'Initializing Deepthink repository and workspace', 'info');
    await this.gitHarness.initializeRepository(config.strategiesCount);

    // Initialize shared workspace file (§8.1, §8.3)
    await this.sharedWorkspace.write(`# Shared Workspace\nChallenge: ${this.state.challenge}\n`);

    // 1. Initial Strategy Generation + Proximity (§4.1)
    await this.runInitialStrategyGeneration();

    // Checkpoint initial window start for window 1 (iterations 1 to j) (§6.3, §8.2)
    for (let slotIdx = 0; slotIdx < this.state.initialStrategies.length; slotIdx++) {
      const strat = this.state.initialStrategies[slotIdx];
      const contextFiles: DeepthinkResultsContextFile[] = [
        {
          path: `Strategy-${slotIdx + 1}/strategy.md`,
          content: `# Strategy ${slotIdx + 1} (${strat.id})\n\n${strat.strategyText}\n`,
        },
      ];
      const commit = await this.gitHarness.commitWindowStart(slotIdx, 1, contextFiles);
      this.commitHashesPerIteration.set(`${slotIdx}:start_1`, commit);
    }

    let sinceHeartbeat = 0;
    let heartbeatNo = 0;

    // 2. Iteration Loop (§3)
    for (let iteration = 1; iteration <= config.i; iteration++) {
      this.checkStopRequested();
      (this.state as any).currentIteration = iteration;
      (this.state as any).heartbeatNo = heartbeatNo;
      this.emitEvent('Loop', `Starting Iteration ${iteration} of ${config.i}`, 'info');

      if (iteration === 1) {
        // Iteration 1: Initial solution attempt + critique in parallel (§3)
        await this.runIterationOne();
      } else if (iteration < config.i) {
        // Iterations 2 .. i - 1: Correction + critique in parallel (§3)
        await this.runCorrectionAndCritiqueIteration(iteration, heartbeatNo);
      } else {
        // Iteration i: Final iteration runs correction ONLY, NO critique (§3)
        await this.runFinalCorrectionIteration(iteration, heartbeatNo);
      }

      // Record barrier commits for rollback targets (§8.2)
      await this.commitIterationBarriers(iteration);

      // Post-iteration barrier actions (§3)
      const curatedContextEnabled = config.hypothesisCount > 0 || !config.disableSolutionPool;
      const step = determinePostIterationStep(
        iteration,
        sinceHeartbeat,
        config.i,
        config.j,
        config.k,
        curatedContextEnabled
      );

      sinceHeartbeat = step.nextSinceHeartbeat;

      if (step.action.type === 'FINAL_JUDGE') {
        this.emitEvent('Loop', 'Reached final iteration barrier. Calling Final Judge.', 'info');
        await this.runFinalJudge();
        break;
      } else if (step.action.type === 'GLOBAL_UPDATE') {
        this.emitEvent('Loop', `Running Global Update at iteration ${iteration}`, 'info');
        heartbeatNo++;
        (this.state as any).heartbeatNo = heartbeatNo;
        await this.performGlobalUpdate(iteration, heartbeatNo);
        sinceHeartbeat = 0; // GU ends with heartbeat, since_heartbeat resets (§3)
      } else if (step.action.type === 'HEARTBEAT') {
        this.emitEvent('Loop', `Running Curated Context Heartbeat at iteration ${iteration}`, 'info');
        heartbeatNo++;
        (this.state as any).heartbeatNo = heartbeatNo;
        await this.runCuratedContextHeartbeat(iteration, heartbeatNo);
        sinceHeartbeat = 0; // Heartbeat resets counter (§3)
      }

      this.callbacks.onStateChange?.(this.state);
    }

    this.state.status = 'completed';
    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Strategy Generation (§4.1)
  // ==========================================================================

  private async runInitialStrategyGeneration(): Promise<void> {
    const config = this.state.runConfig;
    const prompt = buildContextForStrategySeed(this.state.challenge, config.strategiesCount);

    this.emitEvent('Orchestrator', 'Starting seed strategy generation', 'info');

    let currentStrategies: string[] = [];
    const history: ProximityTurn[] = [];

    const seedContract: OutputValidationContract<{ strategies: string[] }> = {
      name: 'SeedStrategiesContract',
      validate: (parsed) => {
        if (!parsed || !Array.isArray(parsed.strategies)) {
          throw new Error('Seed strategies output must contain a "strategies" array.');
        }
        if (parsed.strategies.length < config.strategiesCount) {
          throw new Error(`Expected at least ${config.strategiesCount} strategies, got ${parsed.strategies.length}.`);
        }
        for (let idx = 0; idx < config.strategiesCount; idx++) {
          if (typeof parsed.strategies[idx] !== 'string' || !parsed.strategies[idx].trim()) {
            throw new Error(`Strategy at index ${idx} is empty or invalid.`);
          }
        }
      },
    };

    const executionGroupId = 'group-seed-strategies';
    const executionGroupName = 'Seed Strategy Proximity Loop';

    const targetProximityReviews = Math.max(0, config.strategyProximityLoops ?? 1);

    for (let reviewIndex = 0; reviewIndex <= targetProximityReviews; reviewIndex++) {
      const turn = reviewIndex + 1;
      this.checkStopRequested();

      const promptText = history.length > 0
        ? [
            prompt,
            '',
            '# Previous Candidate Strategies & Proximity Feedback',
            history.map(h => `### ${h.role.toUpperCase()} (Turn ${h.turnNumber ?? reviewIndex})\n${h.content}`).join('\n\n'),
            '',
            `Please generate ${config.strategiesCount} revised orthogonal strategies addressing the proximity review feedback. Output the same JSON format.`
          ].join('\n')
        : prompt;

      // Generator turn with contract validation and retry policy (§9)
      const genOutput = await this.callAgentModelWithRetry({
        kind: 'initialStrategy',
        promptText,
        stepDescription: `Seed Strategy Generator (Turn ${turn})`,
        jsonResponse: true,
        isCritical: true, // Strategy generation failure halts run (§9)
        contract: seedContract,
        executionGroupId,
        executionGroupName,
      });

      const parsed = this.parseJsonStrict<{ strategies: string[] }>(genOutput, 'Seed Strategy Generator');
      currentStrategies = parsed.strategies.slice(0, config.strategiesCount);

      history.push({
        role: 'generator',
        content: genOutput,
        timestamp: Date.now(),
        turnNumber: turn,
      });

      if (reviewIndex < targetProximityReviews) {
        // Proximity review turn
        const proxPrompt = [
          `# Core Challenge\n${this.state.challenge}`,
          `Review the current strategy candidates for orthogonality and independence:\n\n${JSON.stringify(currentStrategies, null, 2)}`
        ].join('\n\n');
        const proxOutput = await this.callAgentModelWithRetry({
          kind: 'strategyProximity',
          promptText: proxPrompt,
          stepDescription: `Strategy Proximity Review (Turn ${turn})`,
          isCritical: true,
          executionGroupId,
          executionGroupName,
        });

        history.push({
          role: 'proximity',
          content: proxOutput,
          timestamp: Date.now(),
          turnNumber: turn,
        });
      }
    }

    this.state.strategyProximityHistory = history;

    // Initialize N branches (main1 to mainN) (§1 Invariant 1)
    this.state.initialStrategies = currentStrategies.map((text, idx) => {
      const slotId = `main${idx + 1}`;
      this.strategiesUsedSoFar.push({ slotId, iterationFinalized: 0, text });
      return {
        id: slotId,
        strategyText: text,
        strategyTextHistory: [{ iteration: 0, text }],
        status: 'pending',
      };
    });

    for (const strat of this.state.initialStrategies) {
      this.state.branchLedgers[strat.id] = [];
    }

    // Persist strategy history into repository (§8.1)
    const seedHistoryMarkdown = [
      '# Seed Strategies Proximity History',
      ...history.map(h => `### ${h.role.toUpperCase()} (Turn ${h.turnNumber})\n${h.content}`),
    ].join('\n\n');

    await this.gitHarness.commitStrategyHistory('seed_strategies.md', seedHistoryMarkdown);
    await this.updateStrategiesUsedSoFarFile();

    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Iteration 1 (§3)
  // ==========================================================================

  private async runIterationOne(): Promise<void> {
    const branches = this.state.initialStrategies;

    // Run Solution Attempt in parallel across all branches
    await Promise.all(branches.map(async (branch) => {
      this.checkStopRequested();
      branch.status = 'processing';
      this.callbacks.onStateChange?.(this.state);

      const prompt = [
        `# Core Challenge\n${this.state.challenge}`,
        `Assigned Strategy: ${branch.id}\n${branch.strategyText}`,
        'Produce iteration 1 solution attempt.',
      ].join('\n\n');

      try {
        const attemptOutput = await this.callAgentModelWithRetry({
          kind: 'solutionAttempt',
          promptText: prompt,
          stepDescription: `Solution Attempt for ${branch.id} (Iteration 1)`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false, // Non-critical branch work records error (§9)
          executionGroupId: 'group-iter-1-attempt',
          executionGroupName: 'Iteration 1: Initial Solution Attempts (Parallel)',
        });

        branch.solutionAttempt = attemptOutput;
        branch.solutionAttemptDisplay = attemptOutput;
        branch.refinedSolution = attemptOutput;
        branch.status = 'completed';
      } catch (err: any) {
        branch.status = 'error';
        branch.error = err.message || String(err);
      }
    }));

    // Run Critique in parallel across all branches
    await Promise.all(branches.map(async (branch) => {
      this.checkStopRequested();
      branch.solutionCritiqueStatus = 'processing';
      this.callbacks.onStateChange?.(this.state);

      const historyContext = buildCritiqueCorrectionMemoryBankHistory(branch.memoryBank, []);
      const critiquePrompt = buildContextForCritiqueAgent(
        this.state.challenge,
        branch.id,
        branch.strategyText,
        historyContext,
        branch.solutionAttempt || ''
      );

      try {
        const critiqueOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCritique',
          promptText: critiquePrompt,
          stepDescription: `Solution Critique for ${branch.id} (Iteration 1)`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: 'group-iter-1-critique',
          executionGroupName: 'Iteration 1: Solution Critiques (Parallel)',
        });

        branch.solutionCritique = critiqueOutput;
        branch.solutionCritiqueDisplay = critiqueOutput;
        branch.solutionCritiqueStatus = 'completed';

        if (!this.state.solutionCritiques) this.state.solutionCritiques = [];
        this.state.solutionCritiques.push({
          id: `critique-${branch.id}-1`,
          mainStrategyId: branch.id,
          globalIteration: 1,
          status: 'completed',
          critiqueResponse: critiqueOutput,
          critiqueResponseDisplay: critiqueOutput,
        });
        this.state.solutionCritiquesStatus = 'completed';

        // Record iteration 1 history
        if (!branch.iterationHistory) {
          branch.iterationHistory = { iterations: [], status: 'completed' };
        }
        branch.iterationHistory.iterations.push({
          iterationNumber: 1,
          correctedSolution: branch.solutionAttempt || '',
          critique: critiqueOutput,
          timestamp: Date.now(),
        });
      } catch (err: any) {
        branch.solutionCritiqueStatus = 'error';
        branch.error = err.message || String(err);
      }
    }));

    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Iterations 2 .. i - 1: Correction + Critique (§3)
  // ==========================================================================

  private async runCorrectionAndCritiqueIteration(iteration: number, _heartbeatNo: number): Promise<void> {
    const branches = this.state.initialStrategies;
    const config = this.state.runConfig;
    const currentWindowStart = Math.floor((iteration - 1) / config.j) * config.j + 1;

    // Run Correction in parallel
    await Promise.all(branches.map(async (branch) => {
      this.checkStopRequested();
      branch.correctionStatus = 'processing';
      this.callbacks.onStateChange?.(this.state);

      const windowIterations = (branch.iterationHistory?.iterations || []).filter(
        it => it.iterationNumber >= currentWindowStart && it.iterationNumber < iteration
      );
      const historyContext = buildCritiqueCorrectionMemoryBankHistory(branch.memoryBank, windowIterations);

      const peerCorrectionContext = buildCrossStrategyLatestCorrectionCritique(
        branch.id,
        branches,
        config.isolateBranches
      );

      // Latest curated context packet from most recent heartbeat
      const latestHeartbeat = this.state.heartbeats[this.state.heartbeats.length - 1];
      const mappedPacket = latestHeartbeat
        ? latestHeartbeat.hypotheses
            .filter(h => !h.targetBranchIds || h.targetBranchIds.length === 0 || h.targetBranchIds.includes(branch.id))
            .map(h => `Hypothesis ${h.id}: ${h.hypothesisText}\nVerdict: ${h.testerVerdict}\nResult: ${h.testerAttempt}`)
            .join('\n\n')
        : null;

      const correctionPrompt = buildContextForCorrectionAgent(this.state.challenge, 
        branch.id,
        branch.strategyText,
        historyContext,
        mappedPacket,
        peerCorrectionContext
      );

      try {
        const correctedOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCorrection',
          promptText: correctionPrompt,
          stepDescription: `Solution Correction for ${branch.id} (Iteration ${iteration})`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: `group-iter-${iteration}-correction`,
          executionGroupName: `Iteration ${iteration}: Branch Corrections (Parallel)`,
        });

        branch.refinedSolution = correctedOutput;
        branch.refinedSolutionDisplay = correctedOutput;
        branch.correctionStatus = 'completed';
      } catch (err: any) {
        branch.correctionStatus = 'error';
        branch.error = err.message || String(err);
      }
    }));

    // Run Critique in parallel
    await Promise.all(branches.map(async (branch) => {
      this.checkStopRequested();
      branch.solutionCritiqueStatus = 'processing';
      this.callbacks.onStateChange?.(this.state);

      const windowIterations = (branch.iterationHistory?.iterations || []).filter(
        it => it.iterationNumber >= currentWindowStart && it.iterationNumber < iteration
      );
      const historyContext = buildCritiqueCorrectionMemoryBankHistory(branch.memoryBank, windowIterations);

      const critiquePrompt = buildContextForCritiqueAgent(this.state.challenge, 
        branch.id,
        branch.strategyText,
        historyContext,
        branch.refinedSolution || ''
      );

      try {
        const critiqueOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCritique',
          promptText: critiquePrompt,
          stepDescription: `Solution Critique for ${branch.id} (Iteration ${iteration})`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: `group-iter-${iteration}-critique`,
          executionGroupName: `Iteration ${iteration}: Branch Critiques (Parallel)`,
        });

        branch.solutionCritique = critiqueOutput;
        branch.solutionCritiqueDisplay = critiqueOutput;
        branch.solutionCritiqueStatus = 'completed';

        if (!this.state.solutionCritiques) this.state.solutionCritiques = [];
        this.state.solutionCritiques.push({
          id: `critique-${branch.id}-${iteration}`,
          mainStrategyId: branch.id,
          globalIteration: iteration,
          status: 'completed',
          critiqueResponse: critiqueOutput,
          critiqueResponseDisplay: critiqueOutput,
        });
        this.state.solutionCritiquesStatus = 'completed';

        // Append to iteration history
        branch.iterationHistory?.iterations.push({
          iterationNumber: iteration,
          correctedSolution: branch.refinedSolution || '',
          critique: critiqueOutput,
          timestamp: Date.now(),
        });
      } catch (err: any) {
        branch.solutionCritiqueStatus = 'error';
        branch.error = err.message || String(err);
      }
    }));

    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Iteration i: Correction ONLY (§3)
  // ==========================================================================

  private async runFinalCorrectionIteration(iteration: number, _heartbeatNo: number): Promise<void> {
    const branches = this.state.initialStrategies;
    const config = this.state.runConfig;
    const currentWindowStart = Math.floor((iteration - 1) / config.j) * config.j + 1;

    this.emitEvent('Loop', `Iteration ${iteration}: Running final corrections (critique is omitted per §3)`, 'info');

    await Promise.all(branches.map(async (branch) => {
      this.checkStopRequested();
      branch.correctionStatus = 'processing';
      this.callbacks.onStateChange?.(this.state);

      const windowIterations = (branch.iterationHistory?.iterations || []).filter(
        it => it.iterationNumber >= currentWindowStart && it.iterationNumber < iteration
      );
      const historyContext = buildCritiqueCorrectionMemoryBankHistory(branch.memoryBank, windowIterations);

      const peerCorrectionContext = buildCrossStrategyLatestCorrectionCritique(
        branch.id,
        branches,
        config.isolateBranches
      );

      const correctionPrompt = buildContextForCorrectionAgent(this.state.challenge, 
        branch.id,
        branch.strategyText,
        historyContext,
        null,
        peerCorrectionContext
      );

      try {
        const correctedOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCorrection',
          promptText: correctionPrompt,
          stepDescription: `Final Solution Correction for ${branch.id} (Iteration ${iteration})`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: `group-iter-${iteration}-final-correction`,
          executionGroupName: `Iteration ${iteration}: Final Corrections (Parallel)`,
        });

        branch.refinedSolution = correctedOutput;
        branch.refinedSolutionDisplay = correctedOutput;
        branch.correctionStatus = 'completed';

        // Record final iteration correction only (no critique) in history (§3, §8.1)
        branch.iterationHistory?.iterations.push({
          iterationNumber: iteration,
          correctedSolution: correctedOutput,
          critique: '[Iteration i critique intentionally omitted per §3]',
          timestamp: Date.now(),
        });
      } catch (err: any) {
        branch.correctionStatus = 'error';
        branch.error = err.message || String(err);
      }
    }));

    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Curated Context Heartbeat (§4.5)
  // ==========================================================================

  public async runCuratedContextHeartbeat(
    iteration: number,
    heartbeatNo: number,
    reusedDos?: DosOutput
  ): Promise<void> {
    const config = this.state.runConfig;
    if (config.hypothesisCount === 0 && config.disableSolutionPool) {
      return; // Curated context disabled (§3, §4.5)
    }

    const previousHeartbeat = this.state.heartbeats[this.state.heartbeats.length - 1];

    // 1. DOS (if hypotheses are enabled)
    let dosOutput = reusedDos;
    if (!dosOutput && config.hypothesisCount > 0) {
      const activeState = this.state.initialStrategies.map(s => ({
        branchId: s.id,
        strategyText: s.strategyText,
        latestCorrection: s.refinedSolution || s.solutionAttempt || 'None',
        latestCritique: s.solutionCritique || 'None',
      }));

      const dosContract: OutputValidationContract<DosOutput> = {
        name: 'HeartbeatDosContract',
        validate: (parsed) => {
          if (!parsed || typeof parsed !== 'object') {
            throw new Error('Heartbeat DOS output must be an object.');
          }
        },
      };

      const dosPrompt = buildContextForDos(this.state.challenge, 'heartbeat', activeState, { previousHeartbeat });
      const rawDos = await this.callAgentModelWithRetry({
        kind: 'dos',
        promptText: dosPrompt,
        stepDescription: `Heartbeat DOS (Heartbeat ${heartbeatNo})`,
        jsonResponse: true,
        isCritical: true,
        contract: dosContract,
        executionGroupId: `group-heartbeat-${heartbeatNo}-dos`,
        executionGroupName: `Heartbeat ${heartbeatNo}: DOS Synthesis`,
      });

      dosOutput = this.parseJsonStrict<DosOutput>(rawDos, `Heartbeat DOS (Heartbeat ${heartbeatNo})`);
      this.state.dosOutputs.push({ callType: 'heartbeat', iteration, output: dosOutput });

      // Save DOS output to repository (§8.1, §12.13)
      await this.gitHarness.writeFilesAndCommit(
        `Heartbeat ${heartbeatNo} DOS output`,
        [{
          path: `DOS_history/DOS_heartbeat_${String(heartbeatNo).padStart(2, '0')}.md`,
          content: `# DOS Heartbeat ${heartbeatNo} Output\n\n\`\`\`json\n${JSON.stringify(dosOutput, null, 2)}\n\`\`\``,
        }]
      );

      // Process and attach realized hypothesis feedback for the previous heartbeat (§5.1, §5.4)
      if (dosOutput.hypothesis_feedback && previousHeartbeat) {
        await this.attachRealizedDosFeedback(dosOutput.hypothesis_feedback, previousHeartbeat.heartbeat_no);
      }
    }

    // 2. Generate Hypotheses + Proximity (§4.2)
    const newHypotheses: DeepthinkHypothesisData[] = [];
    const realizedFeedback: RealizedHypothesisFeedback[] = [];
    const heartbeatFiles: DeepthinkResultsContextFile[] = [];

    if (config.hypothesisCount > 0) {
      let parsedGen: {
        hypotheses: Array<{
          hypothesis_id: string;
          text: string;
          target_branches: string[];
          predicted_test_outcome: {
            reason: string;
            probabilities: { VALIDATED: number; REJECTED: number; INCONCLUSIVE: number };
          };
        }>;
      } = { hypotheses: [] };

      const hypContract: OutputValidationContract<{ hypotheses: Array<{ hypothesis_id: string; text: string; predicted_test_outcome: { probabilities: { VALIDATED: number; REJECTED: number; INCONCLUSIVE: number } } }> }> = {
        name: 'HypothesisGenerationContract',
        validate: (parsed) => {
          if (!parsed || !Array.isArray(parsed.hypotheses)) {
            throw new Error('Hypothesis output must contain a "hypotheses" array.');
          }
          for (const h of parsed.hypotheses) {
            if (!h.hypothesis_id || !h.text) throw new Error('Hypothesis missing id or text.');
            const probs = h.predicted_test_outcome?.probabilities;
            if (!probs) throw new Error(`Hypothesis ${h.hypothesis_id} missing predicted probabilities.`);
            const sum = (probs.VALIDATED ?? 0) + (probs.REJECTED ?? 0) + (probs.INCONCLUSIVE ?? 0);
            if (Math.abs(sum - 1.0) > 0.05) {
              throw new Error(`Hypothesis ${h.hypothesis_id} probabilities must sum to 1.0 (got ${sum.toFixed(3)}).`);
            }
          }
        },
      };

      const hypHistory: ProximityTurn[] = [];
      const latestCorrections = this.state.initialStrategies.map(s => ({
        branchId: s.id,
        text: s.refinedSolution || s.solutionAttempt || 'None',
      }));

      const targetHypProximityReviews = Math.max(0, config.hypothesisProximityLoops ?? 1);

      for (let reviewIndex = 0; reviewIndex <= targetHypProximityReviews; reviewIndex++) {
        const turn = reviewIndex + 1;
        this.checkStopRequested();

        const proximityHistoryText = hypHistory.length > 0
          ? hypHistory.map(h => `### ${h.role.toUpperCase()} (Turn ${h.turnNumber ?? reviewIndex})\n${h.content}`).join('\n\n')
          : undefined;

        const hypContext = buildContextForHypothesisGenerate(this.state.challenge, 
          heartbeatNo,
          this.state.initialStrategies,
          dosOutput,
          previousHeartbeat,
          latestCorrections,
          proximityHistoryText
        );

        const rawHypGen = await this.callAgentModelWithRetry({
          kind: 'hypothesisGeneration',
          promptText: hypContext,
          stepDescription: `Hypothesis Generation (Heartbeat ${heartbeatNo}, Turn ${turn})`,
          jsonResponse: true,
          isCritical: true,
          contract: hypContract,
          executionGroupId: `group-heartbeat-${heartbeatNo}-hypotheses`,
          executionGroupName: `Heartbeat ${heartbeatNo}: Hypothesis Proximity Loop`,
        });

        parsedGen = this.parseJsonStrict<{
          hypotheses: Array<{
            hypothesis_id: string;
            text: string;
            target_branches: string[];
            predicted_test_outcome: {
              reason: string;
              probabilities: { VALIDATED: number; REJECTED: number; INCONCLUSIVE: number };
            };
          }>;
        }>(rawHypGen, `Hypothesis Generation (Heartbeat ${heartbeatNo}, Turn ${turn})`);

        hypHistory.push({
          role: 'generator',
          content: rawHypGen,
          timestamp: Date.now(),
          turnNumber: turn,
        });

        if (reviewIndex < targetHypProximityReviews) {
          const proxPrompt = [
            `# Core Challenge\n${this.state.challenge}`,
            `# Review Generated Hypotheses for Heartbeat ${heartbeatNo}`,
            `Review candidate hypotheses for falsifiability, orthogonality, testability in isolation, and challenge relevance:\n\n${rawHypGen}`,
          ].join('\n\n');

          const proxOutput = await this.callAgentModelWithRetry({
            kind: 'hypothesisProximity',
            promptText: proxPrompt,
            stepDescription: `Hypothesis Proximity Review (Heartbeat ${heartbeatNo}, Turn ${turn})`,
            isCritical: true,
            executionGroupId: `group-heartbeat-${heartbeatNo}-hypotheses`,
            executionGroupName: `Heartbeat ${heartbeatNo}: Hypothesis Proximity Loop`,
          });

          hypHistory.push({
            role: 'proximity',
            content: proxOutput,
            timestamp: Date.now(),
            turnNumber: turn,
          });
        }
      }

      this.state.hypothesisProximityHistory = [
        ...(this.state.hypothesisProximityHistory || []),
        ...hypHistory,
      ];

      // Save generation & proximity history into repository (§8.1)
      const hypHistoryMarkdown = hypHistory.map(h => `### ${h.role.toUpperCase()} (Turn ${h.turnNumber ?? 1})\n${h.content}`).join('\n\n');
      heartbeatFiles.push(
        {
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/generation_history.md`,
          content: `# Hypothesis Generation Heartbeat ${heartbeatNo}\n\n\`\`\`json\n${JSON.stringify(parsedGen, null, 2)}\n\`\`\``,
        },
        {
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/hypothesis_proximity_history_heartbeat_${String(heartbeatNo).padStart(2, '0')}.md`,
          content: `# Hypothesis Proximity History (Heartbeat ${heartbeatNo})\n\n${hypHistoryMarkdown}`,
        }
      );

      // 3. Test Hypotheses in parallel (§4.3)
      await Promise.all(parsedGen.hypotheses.slice(0, config.hypothesisCount).map(async (hypItem, idx) => {
        this.checkStopRequested();

        const testerPrompt = [
          `# Core Challenge\n${this.state.challenge}`,
          `Assigned Hypothesis ${hypItem.hypothesis_id}:\n${hypItem.text}`,
          'Test this hypothesis strictly within your assigned isolated folder.',
        ].join('\n\n');

        const folderIndex = idx + 1;
        const testResult = await this.callAgentModelWithRetry({
          kind: 'hypothesisTester',
          promptText: testerPrompt,
          stepDescription: `Hypothesis Tester for ${hypItem.hypothesis_id}`,
          workingDirectory: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/Hypothesis-${folderIndex}`,
          isCritical: false,
          executionGroupId: `group-heartbeat-${heartbeatNo}-testing`,
          executionGroupName: `Heartbeat ${heartbeatNo}: Independent Hypothesis Testers (Parallel)`,
        });

        // Parse verdict classification line (§4.3)
        let verdict: 'VALIDATED' | 'REJECTED' | 'INCONCLUSIVE' = 'INCONCLUSIVE';
        if (testResult.includes('CLASSIFICATION: VALIDATED')) verdict = 'VALIDATED';
        else if (testResult.includes('CLASSIFICATION: REFUTED') || testResult.includes('CLASSIFICATION: REJECTED')) verdict = 'REJECTED';
        else if (testResult.includes('CLASSIFICATION: INCONCLUSIVE')) verdict = 'INCONCLUSIVE';

        const hypData: DeepthinkHypothesisData = {
          id: hypItem.hypothesis_id,
          hypothesisText: hypItem.text,
          targetBranchIds: hypItem.target_branches,
          predicted_test_outcome: hypItem.predicted_test_outcome,
          testerAttempt: testResult,
          testerStatus: 'completed',
          testerVerdict: verdict,
          roundNumber: heartbeatNo,
          globalIteration: iteration,
        };

        newHypotheses.push(hypData);

        // Record hypothesis file in repository (§8.1)
        heartbeatFiles.push({
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/Hypothesis-${folderIndex}/hypothesis.md`,
          content: [
            `# Hypothesis ${hypItem.hypothesis_id}`,
            `**Claim**: ${hypItem.text}`,
            `**Target Branches**: ${hypItem.target_branches?.join(', ') || 'Global'}`,
            `**Predicted Outcome**: ${JSON.stringify(hypItem.predicted_test_outcome)}`,
            `**Verdict**: ${verdict}`,
            `\n## Tester Execution & Output\n${testResult}`,
          ].join('\n\n'),
        });

        // Calculate initial surprise bits (§5.2)
        const surpriseBits = calculateSurpriseBits(
          hypItem.predicted_test_outcome.probabilities,
          verdict
        );

        realizedFeedback.push({
          hypothesis_id: hypItem.hypothesis_id,
          your_predicted_test_outcome: hypItem.predicted_test_outcome.probabilities,
          prediction_note: hypItem.predicted_test_outcome.reason,
          observed_test_outcome: verdict,
          surprise_bits: surpriseBits,
        });
      }));
    }

    // 4. Generate Structured Noises per branch in parallel (§4.4)
    const newPools: DeepthinkStructuredSolutionPoolAgentData[] = [];
    if (!config.disableSolutionPool) {
      await Promise.all(this.state.initialStrategies.map(async (branch) => {
        this.checkStopRequested();

        const mappedHypPacket = newHypotheses
          .filter(h => !h.targetBranchIds || h.targetBranchIds.length === 0 || h.targetBranchIds.includes(branch.id))
          .map(h => `Hypothesis ${h.id}: ${h.hypothesisText}\nVerdict: ${h.testerVerdict}\nResult: ${h.testerAttempt}`)
          .join('\n\n') || null;

        const peerPoolsContext = buildCrossStrategyLatestPools(
          branch.id,
          this.state.structuredSolutionPoolAgents,
          config.isolateBranches
        );

        const poolPrompt = buildContextForSolutionPool(this.state.challenge, 
          branch.id,
          branch.strategyText,
          branch.refinedSolution || branch.solutionAttempt || 'None',
          branch.solutionCritique || 'None',
          this.state.structuredSolutionPoolAgents.filter(p => p.mainStrategyId === branch.id),
          peerPoolsContext,
          mappedHypPacket
        );

        const poolContract: OutputValidationContract<{
          strategy_id: string;
          solutions: Array<{ title: string; content: string; confidence: number }>;
        }> = {
          name: 'SolutionPoolContract',
          validate: (parsed) => {
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.solutions)) {
              throw new Error(`Structured noise for ${branch.id} must contain a solutions array.`);
            }
          },
        };

        const rawPool = await this.callAgentModelWithRetry({
          kind: 'structuredSolutionPool',
          promptText: poolPrompt,
          stepDescription: `Structured Noise for ${branch.id} (Heartbeat ${heartbeatNo})`,
          workingDirectory: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Solution_Pools`,
          jsonResponse: true,
          isCritical: false,
          contract: poolContract,
          executionGroupId: `group-heartbeat-${heartbeatNo}-pools`,
          executionGroupName: `Heartbeat ${heartbeatNo}: Structured Structured Noises (Parallel)`,
        });

        const parsedPool = this.parseJsonStrict<{
          strategy_id: string;
          solutions: Array<{ title: string; content: string; confidence: number }>;
        }>(rawPool, `Structured Noise for ${branch.id}`);

        const poolData: DeepthinkStructuredSolutionPoolAgentData = {
          mainStrategyId: branch.id,
          poolResponse: rawPool,
          parsedPoolResponse: parsedPool,
          status: 'completed',
          globalIteration: iteration,
          heartbeatNo,
        };

        newPools.push(poolData);
        this.state.structuredSolutionPoolAgents.push(poolData);

        // Record pool file in repository (§8.1)
        heartbeatFiles.push({
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Solution_Pools/Strategy-${branch.id.replace(/\D/g, '')}.md`,
          content: `# Structured Noise for ${branch.id}\n\n\`\`\`json\n${JSON.stringify(parsedPool, null, 2)}\n\`\`\``,
        });
      }));
    }

    // Record heartbeat block
    const heartbeatBlock: HeartbeatBlock = {
      heartbeat_no: heartbeatNo,
      iteration,
      hypotheses: newHypotheses,
      realized_feedback: realizedFeedback,
      pools: newPools,
    };
    this.state.heartbeats.push(heartbeatBlock);
    this.state.hypotheses = newHypotheses;

    // Commit heartbeat artifacts to repository (§8.2)
    await this.gitHarness.commitHeartbeat(heartbeatNo, heartbeatFiles);
    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Perform Global Update (§4.6)
  // ==========================================================================

  public async performGlobalUpdate(iteration: number, heartbeatNo: number): Promise<void> {
    const config = this.state.runConfig;
    const windowStart = iteration - config.j + 1;
    const updateNumber = Math.round(iteration / config.j);

    this.emitEvent('GlobalUpdate', `Step i: Running Step-i DOS and BSR across branches`, 'info');

    // i. Step-i DOS and BSR in parallel (§4.6 i)
    const activeBranchesState = this.state.initialStrategies.map(s => ({
      branchId: s.id,
      strategyText: s.strategyText,
      latestCorrection: s.refinedSolution || s.solutionAttempt || 'None',
      latestCritique: s.solutionCritique || 'None',
    }));

    const stepIDosContract: OutputValidationContract<DosOutput> = {
      name: 'StepIDosContract',
      validate: (parsed) => {
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Step-i DOS response must be an object.');
        }
      },
    };

    const stepIDosPrompt = buildContextForDos(this.state.challenge, 'step_i', activeBranchesState);
    const stepIDosPromise = this.callAgentModelWithRetry({
      kind: 'dos',
      promptText: stepIDosPrompt,
      stepDescription: `Step-i DOS (Global Update ${updateNumber})`,
      jsonResponse: true,
      isCritical: true,
      contract: stepIDosContract,
      executionGroupId: `group-global-update-${updateNumber}-step-i`,
      executionGroupName: `Global Update ${updateNumber}: Step-i DOS & BSR Evaluation (Parallel)`,
    });

    const bsrReportsPromise = Promise.all(this.state.initialStrategies.map(async (branch) => {
      const windowHistory = branch.iterationHistory?.iterations.filter(
        it => it.iterationNumber >= windowStart && it.iterationNumber <= iteration
      ) || [];

      const formattedWindow = windowHistory.map(it => (
        `Iteration ${it.iterationNumber}:\nCorrection: ${it.correctedSolution}\nCritique: ${it.critique}`
      )).join('\n\n');

      const ledger = this.state.branchLedgers[branch.id] || [];
      const earlierGraded = this.state.bsrRecords
        .filter(r => r.branch_id === branch.id && r.computed.surprisal_bits !== null)
        .map(r => ({
          windowOutcome: r.computed.window_outcome,
          surprisalBits: r.computed.surprisal_bits!,
        }));

      // NOTE: Hidden-prediction rule (§6.7): context_bsr never receives the prediction
      // for the window being judged.
      const bsrPrompt = buildContextForBsr(this.state.challenge, 
        branch.id,
        branch.strategyText,
        formattedWindow,
        branch.memoryBank,
        ledger,
        earlierGraded
      );

      const bsrContract: OutputValidationContract<BsrReport> = {
        name: 'BsrReportContract',
        validate: (parsed) => {
          if (!parsed || parsed.branch_id !== branch.id) {
            throw new Error(`BSR report branch_id mismatch or missing: expected ${branch.id}`);
          }
          if (!Array.isArray(parsed.confirmed_progress) || !Array.isArray(parsed.confirmed_regression)) {
            throw new Error('BSR report missing progress/regression events arrays.');
          }
          const p = parsed.next_window_prediction?.probabilities;
          if (!p) throw new Error('BSR report missing next_window_prediction probabilities.');
          const sum = (p.PROGRESS ?? 0) + (p.STALL ?? 0) + (p.REGRESS ?? 0);
          if (Math.abs(sum - 1.0) > 0.05) {
            throw new Error(`BSR prediction probabilities must sum to 1.0 (got ${sum.toFixed(3)}).`);
          }
        },
      };

      const rawBsr = await this.callAgentModelWithRetry({
        kind: 'bsr',
        promptText: bsrPrompt,
        stepDescription: `BSR for ${branch.id} (Global Update ${updateNumber})`,
        workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
        jsonResponse: true,
        isCritical: true,
        contract: bsrContract,
        executionGroupId: `group-global-update-${updateNumber}-step-i`,
        executionGroupName: `Global Update ${updateNumber}: Step-i DOS & BSR Evaluation (Parallel)`,
      });

      return this.parseJsonStrict<BsrReport>(rawBsr, `BSR for ${branch.id}`);
    }));

    const [rawStepIDos, bsrReports] = await Promise.all([stepIDosPromise, bsrReportsPromise]);
    const stepIDosOutput = this.parseJsonStrict<DosOutput>(rawStepIDos, `Step-i DOS (Global Update ${updateNumber})`);
    this.state.dosOutputs.push({ callType: 'step_i', iteration, output: stepIDosOutput });

    // Persist Step-i DOS in repository (§8.1, §12.13)
    await this.gitHarness.writeFilesAndCommit(
      `Step-i DOS for Global Update ${updateNumber}`,
      [{
        path: `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_i.md`,
        content: `# Step-i DOS Output (Global Update ${updateNumber})\n\n\`\`\`json\n${JSON.stringify(stepIDosOutput, null, 2)}\n\`\`\``,
      }]
    );

    // ii. Deterministic Code Computes Decisions (§4.6 ii, §6.3, §6.4, §6.5)
    const evaluatedRecords: Array<{ report: BsrReport; computed: BsrComputedScores }> = [];
    const consolidatedDecisions: Array<{
      slotId: string;
      decision: BsrAction;
      form?: BsrEvolveForm;
      rollbackTo?: number | 'window_start';
      eventReasons: string[];
    }> = [];

    const runConfigWeights = {
      small: this.state.runConfig?.bsrWeightSmall ?? SIZE_WEIGHTS.small,
      medium: this.state.runConfig?.bsrWeightMedium ?? SIZE_WEIGHTS.medium,
      large: this.state.runConfig?.bsrWeightLarge ?? SIZE_WEIGHTS.large,
    };
    const bsrOptions: BsrConfigOptions = {
      tau: this.state.runConfig?.bsrNoiseLevel ?? TAU,
      theta: this.state.runConfig?.bsrPressureFloor ?? THETA,
      weights: runConfigWeights,
    };

    for (const report of bsrReports) {
      const prevPrediction = this.state.openPredictions[report.branch_id]?.probabilities;
      const ledger = this.state.branchLedgers[report.branch_id] || [];

      const computed = evaluateBranchState(
        report,
        windowStart,
        iteration,
        ledger,
        prevPrediction,
        bsrOptions
      );

      evaluatedRecords.push({ report, computed });

      const allEventReasons = [
        ...report.confirmed_progress.map(e => `Progress (${e.size}): ${e.reason}`),
        ...report.confirmed_regression.map(e => `Regression (${e.size}): ${e.reason}`),
      ];

      consolidatedDecisions.push({
        slotId: report.branch_id,
        decision: computed.decision,
        form: computed.form,
        rollbackTo: computed.rollback_to,
        eventReasons: allEventReasons,
      });

      this.state.bsrRecords.push({
        updateNumber,
        iteration,
        branch_id: report.branch_id,
        report,
        computed,
      });
    }

    // iii. Strategy Generation for Changed Slots Only (§4.6 iii, §4.1)
    const changedSlots = consolidatedDecisions.filter(d => d.decision !== 'CONTINUE');
    if (changedSlots.length > 0) {
      const priorProximityHistory = buildStrategyProximityHistoryWithNotes(
        this.state.strategyProximityHistory || [],
        this.globalUpdateStrategyHistories,
        config.j
      );

      const evolveSlotIds = consolidatedDecisions.filter(d => d.decision === 'EVOLVE').map(d => d.slotId);
      const pruneSlotIds = consolidatedDecisions.filter(d => d.decision === 'PRUNE').map(d => d.slotId);

      const stratUpdateContract: OutputValidationContract<{
        evolved_slots?: Array<{ slot_id: string; updated_strategy_text: string }>;
        pruned_slots?: Array<{ slot_id: string; new_strategy_text: string }>;
      }> = {
        name: 'SurgicalGlobalUpdateStrategyContract',
        validate: (parsed) => {
          if (!parsed) throw new Error('Empty surgical strategy update.');
          const evolved = parsed.evolved_slots || [];
          const pruned = parsed.pruned_slots || [];

          for (const evId of evolveSlotIds) {
            if (!evolved.some(e => e.slot_id === evId && e.updated_strategy_text?.trim())) {
              throw new Error(`Missing required updated strategy for EVOLVE slot ${evId}.`);
            }
          }
          for (const prId of pruneSlotIds) {
            if (!pruned.some(p => p.slot_id === prId && p.new_strategy_text?.trim())) {
              throw new Error(`Missing required new strategy for PRUNE slot ${prId}.`);
            }
          }
          // Enforce: CONTINUE slots must not be present (§4.1, §4.6)
          const allTouched = [...evolved.map(e => e.slot_id), ...pruned.map(p => p.slot_id)];
          for (const id of allTouched) {
            if (!evolveSlotIds.includes(id) && !pruneSlotIds.includes(id)) {
              throw new Error(`Surgical update contained unexpected slot ID ${id}. CONTINUE slots cannot be modified.`);
            }
          }
        },
      };

      const currentGuTurns: ProximityTurn[] = [];
      let parsedStrat: {
        evolved_slots?: Array<{ slot_id: string; updated_strategy_text: string }>;
        pruned_slots?: Array<{ slot_id: string; new_strategy_text: string }>;
      } = {};

      const targetGuProximityReviews = Math.max(0, config.strategyProximityLoops ?? 1);

      for (let reviewIndex = 0; reviewIndex <= targetGuProximityReviews; reviewIndex++) {
        const turn = reviewIndex + 1;
        this.checkStopRequested();

        const currentTurnsText = currentGuTurns.length > 0
          ? '\n\n# Current Update Proximity Turns:\n' + currentGuTurns.map(t => `### ${t.role.toUpperCase()} (Turn ${t.turnNumber ?? reviewIndex})\n${t.content}`).join('\n\n')
          : '';
        const combinedHistoryText = `${priorProximityHistory}${currentTurnsText}`;

        const stratPrompt = buildContextForStrategyGlobalUpdate(
          this.state.challenge,
          updateNumber,
          config.j,
          this.state.initialStrategies,
          consolidatedDecisions,
          stepIDosOutput,
          this.strategiesUsedSoFar,
          combinedHistoryText
        );

        const rawStratUpdate = await this.callAgentModelWithRetry({
          kind: 'strategyGeneratorGlobalUpdate',
          promptText: stratPrompt,
          stepDescription: `Strategy Generator Update (Global Update ${updateNumber}, Turn ${turn})`,
          jsonResponse: true,
          isCritical: true,
          contract: stratUpdateContract,
          executionGroupId: `group-global-update-${updateNumber}-strategies`,
          executionGroupName: `Global Update ${updateNumber}: Strategy Revision Loop`,
        });

        currentGuTurns.push({
          role: 'generator',
          content: rawStratUpdate,
          timestamp: Date.now(),
          turnNumber: turn,
        });

        parsedStrat = this.parseJsonStrict<{
          evolved_slots?: Array<{ slot_id: string; updated_strategy_text: string }>;
          pruned_slots?: Array<{ slot_id: string; new_strategy_text: string }>;
        }>(rawStratUpdate, `Strategy Generator Update (Global Update ${updateNumber}, Turn ${turn})`);

        if (reviewIndex < targetGuProximityReviews) {
          const proxPrompt = [
            `# Core Challenge\n${this.state.challenge}`,
            `# Review Surgical Strategy Updates for Global Update ${updateNumber}`,
            `Review the proposed strategy changes for EVOLVE and PRUNE slots for orthogonality, independence from other branches, and alignment with BSR event reasons:`,
            '',
            rawStratUpdate,
          ].join('\n\n');

          const proxOutput = await this.callAgentModelWithRetry({
            kind: 'strategyProximity',
            promptText: proxPrompt,
            stepDescription: `Strategy Proximity Review (Global Update ${updateNumber}, Turn ${turn})`,
            isCritical: true,
            executionGroupId: `group-global-update-${updateNumber}-strategies`,
            executionGroupName: `Global Update ${updateNumber}: Strategy Revision Loop`,
          });

          currentGuTurns.push({
            role: 'proximity',
            content: proxOutput,
            timestamp: Date.now(),
            turnNumber: turn,
          });
        }
      }

      this.globalUpdateStrategyHistories.push({
        updateNumber,
        turns: currentGuTurns,
      });

      // Apply surgical slot changes onto active strategies (§4.1)
      if (parsedStrat.evolved_slots) {
        for (const ev of parsedStrat.evolved_slots) {
          const branch = this.state.initialStrategies.find(b => b.id === ev.slot_id);
          if (branch) {
            branch.strategyText = ev.updated_strategy_text;
            if (!branch.strategyTextHistory) branch.strategyTextHistory = [];
            branch.strategyTextHistory.push({ iteration, text: ev.updated_strategy_text });
            this.strategiesUsedSoFar.push({ slotId: branch.id, iterationFinalized: iteration, text: ev.updated_strategy_text });
          }
        }
      }

      if (parsedStrat.pruned_slots) {
        for (const pr of parsedStrat.pruned_slots) {
          const branch = this.state.initialStrategies.find(b => b.id === pr.slot_id);
          if (branch) {
            branch.strategyText = pr.new_strategy_text;
            branch.strategyTextHistory = [{ iteration: iteration, text: pr.new_strategy_text }];
            this.strategiesUsedSoFar.push({ slotId: branch.id, iterationFinalized: iteration, text: pr.new_strategy_text });
          }
        }
      }

      // Commit strategy update history and strategies used so far (§8.1)
      const guHistoryMarkdown = currentGuTurns.map(t => `### ${t.role.toUpperCase()} (Turn ${t.turnNumber ?? 1})\n${t.content}`).join('\n\n');
      await this.gitHarness.commitStrategyHistory(
        `strategies_global_update${String(updateNumber).padStart(2, '0')}.md`,
        guHistoryMarkdown
      );
      await this.updateStrategiesUsedSoFarFile();
    }

    // iv. Apply Decisions to Repository (§4.6 iv, §8.2)
    const newBranchSlotIds: string[] = [];
    const survivingBranches: DeepthinkMainStrategyData[] = [];

    for (let slotIdx = 0; slotIdx < this.state.initialStrategies.length; slotIdx++) {
      const branch = this.state.initialStrategies[slotIdx];
      const dec = consolidatedDecisions.find(d => d.slotId === branch.id);

      if (!dec || dec.decision === 'CONTINUE') {
        survivingBranches.push(branch);
        this.recordWindowEventsToLedger(branch.id, evaluatedRecords.find(r => r.report.branch_id === branch.id)?.report);
        this.state.openPredictions[branch.id] = {
          issuedAtUpdate: updateNumber,
          probabilities: evaluatedRecords.find(r => r.report.branch_id === branch.id)!.report.next_window_prediction.probabilities,
        };
      } else if (dec.decision === 'EVOLVE') {
        survivingBranches.push(branch);
        if (dec.form === 'rollback' && dec.rollbackTo !== undefined) {
          if (dec.rollbackTo === 'window_start') {
            // Rollback to window beginning (§6.3, §6.6, §8.2)
            const startCommit = this.commitHashesPerIteration.get(`${slotIdx}:start_${windowStart}`);
            if (startCommit) {
              await this.gitHarness.rollbackStrategy(slotIdx, startCommit);
            }
            // Discard all window events from ledger
            this.state.branchLedgers[branch.id] = (this.state.branchLedgers[branch.id] || []).filter(
              e => e.iteration < windowStart
            );
          } else {
            // Rollback to specific iteration
            const commitKey = `${slotIdx}:${dec.rollbackTo}`;
            const targetCommit = this.commitHashesPerIteration.get(commitKey);
            if (targetCommit) {
              await this.gitHarness.rollbackStrategy(slotIdx, targetCommit);
            }
            // Drop discarded events after rollback point from ledger (§6.8)
            this.state.branchLedgers[branch.id] = (this.state.branchLedgers[branch.id] || []).filter(
              e => e.iteration <= (dec.rollbackTo as number)
            );
          }
        } else {
          // In place: keep standing ledger
          this.recordWindowEventsToLedger(branch.id, evaluatedRecords.find(r => r.report.branch_id === branch.id)?.report);
        }
        // Prediction is voided on EVOLVE (§6.4)
        delete this.state.openPredictions[branch.id];
      } else if (dec.decision === 'PRUNE') {
        // Archive folder under ordinal name (§8.2)
        await this.gitHarness.pruneStrategy(slotIdx);
        // Archive pruned branch data for UI transparency before ledger is wiped
        if (!this.state.prunedBranches) this.state.prunedBranches = [];
        this.state.prunedBranches.push({
          id: `${branch.id}-pruned-it${iteration}`,
          originalId: branch.id,
          slotIndex: slotIdx,
          strategyText: branch.strategyText,
          strategyTextHistory: [...(branch.strategyTextHistory || [])],
          prunedAtIteration: iteration,
          reason: dec.eventReasons?.join('; ') || 'Pruned by BSR decision',
          solutionCritique: branch.solutionCritique,
          solutionCritiqueDisplay: branch.solutionCritiqueDisplay,
          iterationHistory: {
            iterations: [...(branch.iterationHistory?.iterations || [])],
            status: 'completed',
          },
        });
        // PRUNE permanently closes ledger; new branch starts with empty ledger (§6.8)
        this.state.branchLedgers[branch.id] = [];
        delete this.state.openPredictions[branch.id];
        branch.iterationHistory = { iterations: [], status: 'idle' };
        branch.memoryBank = undefined;
        newBranchSlotIds.push(branch.id);
      }
    }

    // v. Memory Bank Distillation on Survivors + First Execution & Critique on New Branches (§4.6 v)
    const distillationPromise = Promise.all(survivingBranches.map(async (branch) => {
      const dec = consolidatedDecisions.find(d => d.slotId === branch.id);
      // NOTE (§6.6): When none of the window is retained (rollbackTo === 'window_start'),
      // the previous memory bank stands and no new distillation runs.
      if (dec?.form === 'rollback' && dec.rollbackTo === 'window_start') {
        return;
      }

      const effectiveWindowEnd = dec?.form === 'rollback' && typeof dec.rollbackTo === 'number'
        ? dec.rollbackTo
        : iteration;

      const windowIterations = branch.iterationHistory?.iterations.filter(
        it => it.iterationNumber >= windowStart && it.iterationNumber <= effectiveWindowEnd
      ) || [];

      const memContext = [
        `# Core Challenge\n${this.state.challenge}`,
        `Branch ID: ${branch.id}`,
        `Strategy Text: ${branch.strategyText}`,
        branch.memoryBank ? `Previous Memory Bank:\n${branch.memoryBank}` : 'No previous memory bank.',
        `Window History:\n${windowIterations.map(it => `Iteration ${it.iterationNumber}:\nCorrection: ${it.correctedSolution}\nCritique: ${it.critique}`).join('\n\n')}`,
      ].join('\n\n');

      const memOutput = await this.callAgentModelWithRetry({
        kind: 'memoryBank',
        promptText: memContext,
        stepDescription: `Memory Bank Distillation for ${branch.id} (Update ${updateNumber})`,
        workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
        isCritical: false,
        executionGroupId: `group-global-update-${updateNumber}-distillation`,
        executionGroupName: `Global Update ${updateNumber}: Distillation & New Branch Seeding (Parallel)`,
      });

      branch.memoryBank = memOutput;

      // Write memory bank to Strategy-N/history/memory_bank_NN.md (§8.1)
      await this.gitHarness.writeFilesAndCommit(
        `Memory Bank distillation for ${branch.id} at update ${updateNumber}`,
        [{
          path: `Strategy-${branch.id.replace(/\D/g, '')}/history/memory_bank_${String(updateNumber).padStart(2, '0')}.md`,
          content: memOutput,
        }]
      );
    }));

    const newBranchesPromise = Promise.all(newBranchSlotIds.map(async (slotId) => {
      const branch = this.state.initialStrategies.find(b => b.id === slotId)!;
      const slotIndex = this.state.initialStrategies.findIndex(b => b.id === slotId);

      // First execution
      const attemptPrompt = [
        `# Core Challenge\n${this.state.challenge}`,
        `Assigned Strategy: ${branch.id}\n${branch.strategyText}`,
        `First execution for replacement branch in slot ${slotId}.`,
      ].join('\n\n');

      const attemptOutput = await this.callAgentModelWithRetry({
        kind: 'solutionAttempt',
        promptText: attemptPrompt,
        stepDescription: `First Execution for New Branch in ${slotId}`,
        workingDirectory: `Strategy-${slotIndex + 1}`,
        isCritical: false,
        executionGroupId: `group-global-update-${updateNumber}-distillation`,
        executionGroupName: `Global Update ${updateNumber}: Distillation & New Branch Seeding (Parallel)`,
      });

      branch.solutionAttempt = attemptOutput;
      branch.refinedSolution = attemptOutput;

      // Critique
      const critiquePrompt = buildContextForCritiqueAgent(this.state.challenge, 
        branch.id,
        branch.strategyText,
        'First execution of new branch.',
        attemptOutput
      );

      const critiqueOutput = await this.callAgentModelWithRetry({
        kind: 'solutionCritique',
        promptText: critiquePrompt,
        stepDescription: `First Critique for New Branch in ${slotId}`,
        workingDirectory: `Strategy-${slotIndex + 1}`,
        isCritical: false,
        executionGroupId: `group-global-update-${updateNumber}-distillation`,
        executionGroupName: `Global Update ${updateNumber}: Distillation & New Branch Seeding (Parallel)`,
      });

      branch.solutionCritique = critiqueOutput;

      if (!this.state.solutionCritiques) this.state.solutionCritiques = [];
      this.state.solutionCritiques.push({
        id: `critique-${branch.id}-${iteration}`,
        mainStrategyId: branch.id,
        globalIteration: iteration,
        status: 'completed',
        critiqueResponse: critiqueOutput,
        critiqueResponseDisplay: critiqueOutput,
      });
      this.state.solutionCritiquesStatus = 'completed';

      branch.iterationHistory = {
        iterations: [{
          iterationNumber: iteration, // Global iteration number (§3, §12.12)
          correctedSolution: attemptOutput,
          critique: critiqueOutput,
          timestamp: Date.now(),
        }],
        status: 'completed',
      };
    }));

    await Promise.all([distillationPromise, newBranchesPromise]);

    // Checkpoint next window_start for every active strategy folder (§6.3, §8.2)
    const nextWindowStart = iteration + 1;
    for (let slotIdx = 0; slotIdx < this.state.initialStrategies.length; slotIdx++) {
      const strat = this.state.initialStrategies[slotIdx];
      const contextFiles: DeepthinkResultsContextFile[] = [
        {
          path: `Strategy-${slotIdx + 1}/strategy.md`,
          content: `# Strategy ${slotIdx + 1} (${strat.id})\n\n${strat.strategyText}\n`,
        },
      ];
      const commit = await this.gitHarness.commitWindowStart(slotIdx, nextWindowStart, contextFiles);
      this.commitHashesPerIteration.set(`${slotIdx}:start_${nextWindowStart}`, commit);
    }

    // vi. Step-ii DOS on Post-Update State (§4.6 vi, §5.1)
    let stepIiDosOutput: DosOutput | undefined;
    if (config.hypothesisCount > 0) {
      const postUpdateState = this.state.initialStrategies.map(s => ({
        branchId: s.id,
        strategyText: s.strategyText,
        latestCorrection: s.refinedSolution || s.solutionAttempt || 'None',
        latestCritique: s.solutionCritique || 'None',
      }));

      const stepIiPrompt = buildContextForDos(this.state.challenge, 'step_ii', postUpdateState, {
        previousHeartbeat: this.state.heartbeats[this.state.heartbeats.length - 1],
        slotStatuses: consolidatedDecisions.map(d => ({
          slotId: d.slotId,
          action: d.decision,
          form: d.form,
          rollbackTo: d.rollbackTo,
        })),
        stepIOutput: stepIDosOutput,
      });

      const stepIiDosContract: OutputValidationContract<DosOutput> = {
        name: 'StepIiDosContract',
        validate: (parsed) => {
          if (!parsed || typeof parsed !== 'object') {
            throw new Error('Step-ii DOS response must be an object.');
          }
        },
      };

      const rawStepIiDos = await this.callAgentModelWithRetry({
        kind: 'dos',
        promptText: stepIiPrompt,
        stepDescription: `Step-ii DOS (Global Update ${updateNumber})`,
        jsonResponse: true,
        isCritical: true,
        contract: stepIiDosContract,
        executionGroupId: `group-global-update-${updateNumber}-step-ii`,
        executionGroupName: `Global Update ${updateNumber}: Step-ii DOS Synthesis`,
      });

      stepIiDosOutput = this.parseJsonStrict<DosOutput>(rawStepIiDos, `Step-ii DOS (Global Update ${updateNumber})`);
      this.state.dosOutputs.push({ callType: 'step_ii', iteration, output: stepIiDosOutput });

      // Save Step-ii DOS to repository (§8.1, §12.13)
      await this.gitHarness.writeFilesAndCommit(
        `Step-ii DOS for Global Update ${updateNumber}`,
        [{
          path: `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_ii.md`,
          content: `# Step-ii DOS Output (Global Update ${updateNumber})\n\n\`\`\`json\n${JSON.stringify(stepIiDosOutput, null, 2)}\n\`\`\``,
        }]
      );

      // Attach realized hypothesis feedback for the previous heartbeat (§5.1, §5.4)
      const previousHeartbeat = this.state.heartbeats[this.state.heartbeats.length - 1];
      if (stepIiDosOutput.hypothesis_feedback && previousHeartbeat) {
        await this.attachRealizedDosFeedback(stepIiDosOutput.hypothesis_feedback, previousHeartbeat.heartbeat_no);
      }
    }

    // vii. Run Curated Context Heartbeat, reusing Step-ii DOS (§4.6 vii, §4.5)
    await this.runCuratedContextHeartbeat(iteration, heartbeatNo, stepIiDosOutput);
  }

  // ==========================================================================
  // Final Judge (§7, §8.3, §9)
  // ==========================================================================

  private async runFinalJudge(): Promise<void> {
    const candidates = this.state.initialStrategies.map(s => ({
      branchId: s.id,
      strategyText: s.strategyText,
      finalSolution: s.refinedSolution || s.solutionAttempt || 'No solution recorded.',
    }));

    // NOTE: Final judge direct context receives only candidates, no critiques or pools (§7, §9)
    const judgePrompt = buildContextForFinalJudge(this.state.challenge, candidates);

    this.state.finalJudgingStatus = 'processing';
    this.callbacks.onStateChange?.(this.state);

    const validIds = candidates.map(c => c.branchId);
    const judgeContract: OutputValidationContract<{ best_solution_id: string; final_reasoning: string }> = {
      name: 'FinalJudgeContract',
      validate: (parsed) => {
        if (!parsed || !validIds.includes(parsed.best_solution_id)) {
          throw new Error(`Final judge selected invalid or unknown candidate ID: ${parsed?.best_solution_id}`);
        }
      },
    };

    const rawJudge = await this.callAgentModelWithRetry({
      kind: 'finalJudge',
      promptText: judgePrompt,
      stepDescription: 'Final Judge Evaluation',
      jsonResponse: true,
      isCritical: true,
      contract: judgeContract,
      executionGroupId: 'group-final-judge',
      executionGroupName: 'Final Judge Evaluation',
    });

    const parsed = this.parseJsonStrict<{
      best_solution_id: string;
      final_reasoning: string;
    }>(rawJudge, 'Final Judge Evaluation');

    const winningCandidate = candidates.find(c => c.branchId === parsed.best_solution_id);
    if (!winningCandidate) {
      throw new Error(`Final judge selected unknown candidate '${parsed.best_solution_id}'. Available candidates: ${candidates.map(c => c.branchId).join(', ')}`);
    }

    this.state.finalJudgingResponseText = parsed.final_reasoning;
    this.state.finalJudgedBestSolution = winningCandidate.finalSolution;
    this.state.finalJudgingStatus = 'completed';
    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Helpers & Execution with Retry (§9)
  // ==========================================================================

  private async attachRealizedDosFeedback(
    dosFeedback: DosHypothesisFeedbackItem[],
    targetHeartbeatNo: number
  ): Promise<void> {
    const heartbeatBlock = this.state.heartbeats.find(h => h.heartbeat_no === targetHeartbeatNo);
    if (!heartbeatBlock) return;

    const filesToWrite: DeepthinkResultsContextFile[] = [];

    for (const item of dosFeedback) {
      const existing = heartbeatBlock.realized_feedback.find(rf => rf.hypothesis_id === item.hypothesis_id);
      const targetHyp = heartbeatBlock.hypotheses.find(h => h.id === item.hypothesis_id);
      const hypIdx = heartbeatBlock.hypotheses.findIndex(h => h.id === item.hypothesis_id);
      const folderIndex = hypIdx >= 0 ? hypIdx + 1 : 1;

      const utilization = item.branch_utilization ? calculateUtilizationVector(item.branch_utilization) : undefined;

      if (existing) {
        if (utilization) {
          existing.utilization = utilization;
          existing.utilization_note = "Calculated programmatically from the DOS agent's observations.";
        }
        if (item.critique_counterevidence && item.critique_counterevidence.length > 0) {
          existing.critique_counterevidence = item.critique_counterevidence;
        }
        filesToWrite.push({
          path: `Custom_Curated_Context/Heartbeat-${targetHeartbeatNo}/Hypotheses/Hypothesis-${folderIndex}/feedback.json`,
          content: JSON.stringify(existing, null, 2),
        });
      } else if (targetHyp) {
        const surpriseBits = targetHyp.predicted_test_outcome
          ? calculateSurpriseBits(targetHyp.predicted_test_outcome.probabilities, targetHyp.testerVerdict || 'INCONCLUSIVE')
          : 0;

        const newFeedback: RealizedHypothesisFeedback = {
          hypothesis_id: item.hypothesis_id,
          your_predicted_test_outcome: targetHyp.predicted_test_outcome?.probabilities || { VALIDATED: 0.33, REJECTED: 0.33, INCONCLUSIVE: 0.34 },
          prediction_note: targetHyp.predicted_test_outcome?.reason || 'Hypothesis prediction.',
          observed_test_outcome: targetHyp.testerVerdict || 'INCONCLUSIVE',
          surprise_bits: surpriseBits,
          utilization,
          utilization_note: utilization ? "Calculated programmatically from the DOS agent's observations." : undefined,
          critique_counterevidence: item.critique_counterevidence,
        };

        heartbeatBlock.realized_feedback.push(newFeedback);
        filesToWrite.push({
          path: `Custom_Curated_Context/Heartbeat-${targetHeartbeatNo}/Hypotheses/Hypothesis-${folderIndex}/feedback.json`,
          content: JSON.stringify(newFeedback, null, 2),
        });
      }
    }

    if (filesToWrite.length > 0) {
      await this.gitHarness.writeFilesAndCommit(
        `Realized hypothesis feedback for Heartbeat ${targetHeartbeatNo}`,
        filesToWrite
      );
    }
  }

  private async updateStrategiesUsedSoFarFile(): Promise<void> {
    const markdown = [
      '# Strategies Finalized and Used So Far',
      ...this.strategiesUsedSoFar.map(s => `## Slot ${s.slotId} (Iteration ${s.iterationFinalized})\n${s.text}`),
    ].join('\n\n');

    await this.gitHarness.commitStrategyHistory('strategies_finalized_and_used_so_far.md', markdown);
  }

  private recordWindowEventsToLedger(branchId: string, report?: BsrReport): void {
    if (!report) return;
    const ledger = this.state.branchLedgers[branchId] || [];

    const weights = {
      small: this.state.runConfig?.bsrWeightSmall ?? SIZE_WEIGHTS.small,
      medium: this.state.runConfig?.bsrWeightMedium ?? SIZE_WEIGHTS.medium,
      large: this.state.runConfig?.bsrWeightLarge ?? SIZE_WEIGHTS.large,
    };

    for (const p of report.confirmed_progress) {
      ledger.push({
        iteration: p.iteration,
        direction: 'progress',
        size: p.size,
        weight: weights[p.size] ?? 1,
        reason: p.reason,
      });
    }

    for (const r of report.confirmed_regression) {
      ledger.push({
        iteration: r.iteration,
        direction: 'regression',
        size: r.size,
        weight: weights[r.size] ?? 1,
        reason: r.reason,
      });
    }

    this.state.branchLedgers[branchId] = ledger;
  }

  private async commitIterationBarriers(iteration: number): Promise<void> {
    for (let slotIdx = 0; slotIdx < this.state.initialStrategies.length; slotIdx++) {
      const branch = this.state.initialStrategies[slotIdx];
      const historyEntry = branch.iterationHistory?.iterations.find(it => it.iterationNumber === iteration);

      const files: DeepthinkResultsContextFile[] = [];
      if (historyEntry) {
        files.push({
          path: `Strategy-${slotIdx + 1}/history/iteration_${String(iteration).padStart(2, '0')}.md`,
          content: [
            `# Strategy ${branch.id} - Iteration ${iteration}`,
            `## Solution\n${historyEntry.correctedSolution}`,
            `\n## Critique\n${historyEntry.critique}`,
          ].join('\n\n'),
        });
      }

      const commit = await this.gitHarness.commitStrategyIteration(slotIdx, iteration, files);
      this.commitHashesPerIteration.set(`${slotIdx}:${iteration}`, commit);
    }
  }

  /**
   * Dispatches an agent model call with the strict failure and retry policy (§9):
   * - 4 total attempts
   * - Delays of 30s, 60s, 5m
   * - 30-minute shared timeout
   * - Output contract validation with auto-retry
   */
  private async callAgentModelWithRetry<T = unknown>(args: {
    kind: DeepthinkAgentKind;
    promptText: string;
    stepDescription: string;
    workingDirectory?: string;
    jsonResponse?: boolean;
    isCritical?: boolean;
    contract?: OutputValidationContract<T>;
    executionId?: string;
    executionGroupId?: string;
    executionGroupName?: string;
  }): Promise<string> {
    const config = this.state.runConfig;
    const prompts = this.state.customPrompts || (this.state.runConfig as any)?.prompts || createDefaultCustomPromptsDeepthink();
    const model = deepthinkAgentModel(args.kind, prompts, config.model);
    const systemInstruction = deepthinkAgentSystemInstruction(args.kind, prompts);
    const metadata = DEEPTHINK_AGENT_REGISTRY[args.kind];
    const displayAgentName = metadata ? `${metadata.label} Agent` : `${args.kind} Agent`;
    const executionId = args.executionId || `inv-${nanoid(10)}`;

    const startedAt = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt++) {
      this.checkStopRequested();

      this.emitEvent(displayAgentName, args.stepDescription, attempt === 1 ? 'agent_start' : 'agent_retry', {
        prompt: args.promptText,
        systemInstruction,
        modelName: model,
        attempt,
        executionId,
        executionGroupId: args.executionGroupId,
        executionGroupName: args.executionGroupName,
        codeExecutionEnabled: !!config.deepthinkCodeExecutionEnabled,
      });

      const timeRemaining = Math.max(1, TOTAL_AGENT_TIMEOUT_MS - (Date.now() - startedAt));
      if (timeRemaining <= 0) {
        break;
      }

      try {
        let outputText: string;
        let executionTraceText: string | undefined;

        if (config.deepthinkCodeExecutionEnabled) {
          const sessionId = `dtsb-${this.state.id}-${args.kind}-${nanoid(6)}`;
          const repositoryAccess: SandboxRepositoryAccess = {
            repositoryId: this.state.id,
            agentDirectory: args.workingDirectory,
            fullRepositoryRead: args.kind !== 'hypothesisTester',
          };

          const sharedWorkspaceHandler = args.kind !== 'hypothesisTester'
            ? (input: { action: 'read' | 'write' | 'append'; content?: string }) => this.sharedWorkspace.handleToolCall(input)
            : undefined;

          const runAgent = await getSandboxToolAgentRunner();
          if (!runAgent) {
            throw new Error('Sandbox tool agent runtime is not available in this environment');
          }
          const result = await runAgent({
            agentName: args.kind,
            sessionId,
            messages: [new HumanMessage({ content: parsePromptToGeminiParts(args.promptText) })],
            systemPrompt: systemInstruction,
            modelName: model,
            repositoryAccess,
            sharedWorkspaceHandler,
          });

          outputText = result.text || result.finalText;
          executionTraceText = result.executionTraceText;
        } else {
          outputText = await this.callbacks.callAI({
            prompt: args.promptText,
            model,
            systemInstruction,
            responseSchema: args.jsonResponse ? true : undefined,
            thinkingConfig: { thinkingLevel: config.thinkingLevel },
            agentKind: args.kind,
            stepDescription: args.stepDescription,
          });
        }

        if (!outputText || !outputText.trim()) {
          throw new Error('Empty response received from model.');
        }

        // Validate structured output contract if present (§9)
        if (args.contract) {
          const parsed = this.parseJsonStrict<T>(outputText, args.contract.name);
          args.contract.validate(parsed);
        }

        this.emitEvent(displayAgentName, args.stepDescription, 'agent_complete', {
          response: outputText,
          executionTraceText,
          prompt: args.promptText,
          systemInstruction,
          modelName: model,
          executionId,
          executionGroupId: args.executionGroupId,
          executionGroupName: args.executionGroupName,
          codeExecutionEnabled: !!config.deepthinkCodeExecutionEnabled,
        });

        return outputText;
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const shouldRetry = attempt < MAX_API_ATTEMPTS && (Date.now() - startedAt) < TOTAL_AGENT_TIMEOUT_MS;

        this.emitEvent(displayAgentName, `${args.stepDescription} failed: ${errMsg}`, shouldRetry ? 'agent_retry' : 'agent_error', {
          error: errMsg,
          modelName: model,
          attempt,
          executionId,
          executionGroupId: args.executionGroupId,
          executionGroupName: args.executionGroupName,
          codeExecutionEnabled: !!config.deepthinkCodeExecutionEnabled,
        });

        if (!shouldRetry) break;

        const retryDelays = this.callbacks.retryDelaysMs ?? RETRY_DELAYS_MS;
        const delay = retryDelays[attempt - 1] ?? 30_000;
        const availableDelay = Math.min(delay, Math.max(0, TOTAL_AGENT_TIMEOUT_MS - (Date.now() - startedAt)));
        const step = 200;
        let elapsed = 0;
        while (elapsed < availableDelay) {
          this.checkStopRequested();
          const waitTime = Math.min(step, availableDelay - elapsed);
          await new Promise(res => setTimeout(res, waitTime));
          elapsed += waitTime;
        }
        this.checkStopRequested();
      }
    }

    const finalErrorMessage = `Agent call for ${args.stepDescription} exhausted all ${MAX_API_ATTEMPTS} attempts: ${String(lastError)}`;

    if (args.isCritical) {
      // Required strategy generation fails the run when exhausted (§9)
      throw new Error(finalErrorMessage);
    } else {
      // Non-critical branch work records its error on that branch (§9)
      this.emitEvent(displayAgentName, finalErrorMessage, 'agent_error', {
        error: finalErrorMessage,
        executionId,
        executionGroupId: args.executionGroupId,
        executionGroupName: args.executionGroupName,
        codeExecutionEnabled: !!config.deepthinkCodeExecutionEnabled,
      });
      throw new Error(finalErrorMessage);
    }
  }

  private checkStopRequested(): void {
    if (this.state.isStopRequested) {
      this.state.status = 'stopped';
      throw new PipelineStopRequestedError();
    }
  }

  private emitEvent(
    agentName: string,
    stepDescription: string,
    eventType: DeepthinkLiveEvent['eventType'],
    extra?: Partial<DeepthinkLiveEvent>
  ): void {
    const event: DeepthinkLiveEvent = {
      id: nanoid(10),
      timestamp: Date.now(),
      agentName,
      stepDescription,
      eventType,
      ...extra,
    };
    if (!this.state.liveEvents) this.state.liveEvents = [];
    this.state.liveEvents.push(event);
    this.callbacks.onLiveEvent?.(event);
  }
}
