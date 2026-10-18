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
  buildContextForStrategyGlobalUpdate,
  buildContextForStrategySeed,
  buildCritiqueCorrectionMemoryBankHistory,
  buildCrossStrategyLatestCorrectionCritique,
  parsePromptToGeminiParts,
} from './contextBuilders.ts';
import {
  DEEPTHINK_AGENT_REGISTRY,
  deepthinkAgentMaxOutputTokens,
  deepthinkAgentModel,
  deepthinkAgentSystemInstruction,
  type DeepthinkAgentKind,
} from './agentRegistry.ts';
import { createDefaultCustomPromptsDeepthink } from '../prompts/index.ts';
import { GitRepositoryHarness } from './gitRepository.ts';
import { SharedWorkspaceManager, type SharedWorkspaceToolInput } from './sharedWorkspace.ts';
import {
  buildHypothesisProximityHistoryWithNotes,
  buildStrategyProximityHistoryWithNotes,
} from './harnessNotes.ts';
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
  private abortController = new AbortController();

  public stop(): void {
    this.state.isStopRequested = true;
    this.state.status = 'stopped';
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(new PipelineStopRequestedError());
    }
  }

  public get isStopRequested(): boolean {
    return Boolean(
      this.state.isStopRequested ||
      this.state.status === 'stopped' ||
      this.abortController.signal.aborted
    );
  }

  constructor(
    state: DeepthinkPipelineState,
    callbacks: PipelineExecutionCallbacks
  ) {
    this.state = state;
    this.callbacks = callbacks;
    this.gitHarness = new GitRepositoryHarness(state.id);
    this.sharedWorkspace = new SharedWorkspaceManager();

    if (Array.isArray((state as any).commitHashesPerIteration)) {
      this.commitHashesPerIteration = new Map((state as any).commitHashesPerIteration);
    } else if ((state as any).commitHashesPerIteration && typeof (state as any).commitHashesPerIteration === 'object') {
      this.commitHashesPerIteration = new Map(Object.entries((state as any).commitHashesPerIteration));
    }
    if (Array.isArray((state as any).strategiesUsedSoFar)) {
      this.strategiesUsedSoFar = [...(state as any).strategiesUsedSoFar];
    }
    if (Array.isArray((state as any).globalUpdateStrategyHistories)) {
      this.globalUpdateStrategyHistories = [...(state as any).globalUpdateStrategyHistories];
    }
  }

  public syncCheckpointState(iteration?: number, heartbeatNo?: number, sinceHeartbeat?: number): void {
    if (iteration !== undefined) (this.state as any).currentIteration = iteration;
    if (heartbeatNo !== undefined) (this.state as any).heartbeatNo = heartbeatNo;
    if (sinceHeartbeat !== undefined) (this.state as any).sinceHeartbeat = sinceHeartbeat;
    (this.state as any).commitHashesPerIteration = Array.from(this.commitHashesPerIteration.entries());
    (this.state as any).strategiesUsedSoFar = this.strategiesUsedSoFar;
    (this.state as any).globalUpdateStrategyHistories = this.globalUpdateStrategyHistories;
    void this.sharedWorkspace.read().then(content => {
      (this.state as any).sharedWorkspaceContent = content;
    }).catch(() => {});
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

    // Initialize or restore shared workspace file (§8.1, §8.3)
    const existingShared = (this.state as any).sharedWorkspaceContent;
    if (existingShared) {
      await this.sharedWorkspace.write(existingShared);
    } else {
      await this.sharedWorkspace.write(`# Shared Workspace\nChallenge: ${this.state.challenge}\n`);
    }

    // 1. Initial Strategy Generation + Proximity (§4.1)
    const hasInitialStrategies = Array.isArray(this.state.initialStrategies) &&
      this.state.initialStrategies.length >= config.strategiesCount &&
      this.state.initialStrategies.every(s => typeof s.strategyText === 'string' && s.strategyText.trim().length > 0);

    if (!hasInitialStrategies) {
      await this.runInitialStrategyGeneration();
    } else {
      this.emitEvent('Orchestrator', 'Initial strategies already present; resuming execution loop', 'info');
    }

    // Checkpoint initial window start for window 1 (iterations 1 to j) (§6.3, §8.2)
    for (let slotIdx = 0; slotIdx < this.state.initialStrategies.length; slotIdx++) {
      const commitKey = `${slotIdx}:start_1`;
      if (!this.commitHashesPerIteration.has(commitKey)) {
        const strat = this.state.initialStrategies[slotIdx];
        const latestGenTurn = [...(this.state.strategyProximityHistory || [])]
          .reverse()
          .find(h => h.role === 'generator') as any;
        const stratJsonl = latestGenTurn?.trajectoryJsonl || JSON.stringify({
          role: 'assistant',
          message_type: 'ai',
          agent_kind: 'initialStrategy',
          slot_id: strat.id,
          content: strat.strategyText,
        });
        const contextFiles: DeepthinkResultsContextFile[] = [
          {
            path: `Strategy-${slotIdx + 1}/strategy.md`,
            content: `# Strategy ${slotIdx + 1} (${strat.id})\n\n${strat.strategyText}\n`,
          },
          {
            path: `Strategy-${slotIdx + 1}/strategy.jsonl`,
            content: stratJsonl,
          },
        ];
        const commit = await this.gitHarness.commitWindowStart(slotIdx, 1, contextFiles);
        this.commitHashesPerIteration.set(commitKey, commit);
      }
    }

    let sinceHeartbeat = 0;
    let heartbeatNo = 0;
    const curatedContextEnabled = config.hypothesisCount > 0;

    // Helper to check if an iteration was fully completed
    const isIterationFullyComplete = (it: number, currentSinceHeartbeat: number): { complete: boolean; nextSinceHeartbeat: number; nextHeartbeatNo: number } => {
      const branches = this.state.initialStrategies || [];
      if (!branches.length) return { complete: false, nextSinceHeartbeat: currentSinceHeartbeat, nextHeartbeatNo: heartbeatNo };
      const allBranchesDone = branches.every(b => {
        const entry = b.iterationHistory?.iterations?.find(e => e.iterationNumber === it);
        if (!entry || !entry.correctedSolution) return false;
        if (it < config.i && !entry.critique) return false;
        return true;
      });
      if (!allBranchesDone) return { complete: false, nextSinceHeartbeat: currentSinceHeartbeat, nextHeartbeatNo: heartbeatNo };

      const step = determinePostIterationStep(
        it,
        currentSinceHeartbeat,
        config.i,
        config.j,
        config.k,
        curatedContextEnabled
      );

      let stepDone = true;
      if (step.action.type === 'GLOBAL_UPDATE') {
        const guDone = this.state.bsrRecords?.some(r => r.iteration === it) &&
                       (!curatedContextEnabled || this.state.heartbeats?.some(h => (h as any).iteration === it));
        if (!guDone) stepDone = false;
      } else if (step.action.type === 'HEARTBEAT') {
        const hbDone = !curatedContextEnabled || this.state.heartbeats?.some(h => (h as any).iteration === it);
        if (!hbDone) stepDone = false;
      }

      if (!stepDone) {
        return { complete: false, nextSinceHeartbeat: currentSinceHeartbeat, nextHeartbeatNo: heartbeatNo };
      }

      let nextHbNo = heartbeatNo;
      let nextSince = step.nextSinceHeartbeat;
      if (step.action.type === 'GLOBAL_UPDATE' || step.action.type === 'HEARTBEAT') {
        nextHbNo++;
        nextSince = 0;
      }
      return { complete: true, nextSinceHeartbeat: nextSince, nextHeartbeatNo: nextHbNo };
    };

    // 2. Iteration Loop (§3)
    for (let iteration = 1; iteration <= config.i; iteration++) {
      this.checkStopRequested();

      const completionCheck = isIterationFullyComplete(iteration, sinceHeartbeat);
      if (completionCheck.complete) {
        this.emitEvent('Loop', `Iteration ${iteration} of ${config.i} already completed, advancing`, 'info');
        sinceHeartbeat = completionCheck.nextSinceHeartbeat;
        heartbeatNo = completionCheck.nextHeartbeatNo;
        continue;
      }

      this.syncCheckpointState(iteration, heartbeatNo, sinceHeartbeat);
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
        if (!this.state.finalJudgedBestSolution || this.state.finalJudgingStatus !== 'completed') {
          this.emitEvent('Loop', 'Reached final iteration barrier. Calling Final Judge.', 'info');
          await this.runFinalJudge();
        }
        break;
      } else if (step.action.type === 'GLOBAL_UPDATE') {
        const alreadyDone = this.state.bsrRecords?.some(r => r.iteration === iteration) &&
                            (!curatedContextEnabled || this.state.heartbeats?.some(h => (h as any).iteration === iteration));
        if (!alreadyDone) {
          this.emitEvent('Loop', `Running Global Update at iteration ${iteration}`, 'info');
          heartbeatNo++;
          this.syncCheckpointState(iteration, heartbeatNo, sinceHeartbeat);
          await this.performGlobalUpdate(iteration, heartbeatNo);
          sinceHeartbeat = 0; // GU ends with heartbeat, since_heartbeat resets (§3)
        }
      } else if (step.action.type === 'HEARTBEAT') {
        const alreadyDone = this.state.heartbeats?.some(h => (h as any).iteration === iteration);
        if (!alreadyDone) {
          this.emitEvent('Loop', `Running Curated Context Heartbeat at iteration ${iteration}`, 'info');
          heartbeatNo++;
          this.syncCheckpointState(iteration, heartbeatNo, sinceHeartbeat);
          await this.runCuratedContextHeartbeat(iteration, heartbeatNo);
          sinceHeartbeat = 0; // Heartbeat resets counter (§3)
        }
      }

      this.syncCheckpointState(iteration + 1, heartbeatNo, sinceHeartbeat);
      this.callbacks.onStateChange?.(this.state);
    }

    this.state.status = 'completed';
    this.syncCheckpointState();
    this.callbacks.onStateChange?.(this.state);
  }

  // ==========================================================================
  // Strategy Generation (§4.1)
  // ==========================================================================

  private async runInitialStrategyGeneration(): Promise<void> {
    const config = this.state.runConfig;

    this.emitEvent('Orchestrator', 'Starting seed strategy generation', 'info');

    const history: ProximityTurn[] = Array.isArray(this.state.strategyProximityHistory)
      ? [...this.state.strategyProximityHistory]
      : [];

    let currentStrategies: string[] = [];
    const lastGen = history.slice().reverse().find(h => h.role === 'generator');
    if (lastGen) {
      try {
        const parsed = this.parseJsonStrict<{ strategies: string[] }>(lastGen.content, 'Seed Strategy Generator');
        currentStrategies = parsed.strategies.slice(0, config.strategiesCount);
      } catch {}
    }

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

      const existingGen = history.find(h => h.role === 'generator' && h.turnNumber === turn);
      if (!existingGen) {
        const promptText = buildContextForStrategySeed(
          this.state.challenge,
          config.strategiesCount,
          history
        );

        // Generator turn with contract validation and retry policy (§9)
        let genTrajectoryJsonl = '';
        const genOutput = await this.callAgentModelWithRetry({
          kind: 'initialStrategy',
          promptText,
          stepDescription: `Seed Strategy Generator (Turn ${turn})`,
          jsonResponse: true,
          isCritical: true, // Strategy generation failure halts run (§9)
          contract: seedContract,
          executionGroupId,
          executionGroupName,
          onTrajectoryJsonl: (jsonl) => {
            genTrajectoryJsonl = jsonl;
          },
        });

        const parsed = this.parseJsonStrict<{ strategies: string[] }>(genOutput, 'Seed Strategy Generator');
        currentStrategies = parsed.strategies.slice(0, config.strategiesCount);

        history.push({
          role: 'generator',
          content: genOutput,
          timestamp: Date.now(),
          turnNumber: turn,
          trajectoryJsonl: genTrajectoryJsonl,
        } as any);
        this.state.strategyProximityHistory = [...history];
        this.callbacks.onStateChange?.(this.state);
      }

      if (reviewIndex < targetProximityReviews) {
        const existingProx = history.find(h => h.role === 'proximity' && h.turnNumber === turn);
        if (!existingProx) {
          // Proximity review turn receives the exact same full context as the generator (§4.1, §7)
          const proxPrompt = buildContextForStrategySeed(
            this.state.challenge,
            config.strategiesCount,
            history
          );
          let proxTrajectoryJsonl = '';
          const proxOutput = await this.callAgentModelWithRetry({
            kind: 'strategyProximity',
            promptText: proxPrompt,
            stepDescription: `Strategy Proximity Review (Turn ${turn})`,
            isCritical: true,
            executionGroupId,
            executionGroupName,
            onTrajectoryJsonl: (jsonl) => {
              proxTrajectoryJsonl = jsonl;
            },
          });

          history.push({
            role: 'proximity',
            content: proxOutput,
            timestamp: Date.now(),
            turnNumber: turn,
            trajectoryJsonl: proxTrajectoryJsonl,
          } as any);
          this.state.strategyProximityHistory = [...history];
          this.callbacks.onStateChange?.(this.state);
        }
      }
    }

    this.state.strategyProximityHistory = history;

    const latestSeedGenTurn = [...history].reverse().find(h => h.role === 'generator') as any;
    // Initialize N branches (main1 to mainN) (§1 Invariant 1)
    this.state.initialStrategies = currentStrategies.map((text, idx) => {
      const slotId = `main${idx + 1}`;
      this.strategiesUsedSoFar.push({
        slotId,
        iterationFinalized: 0,
        text,
        trajectoryJsonl: latestSeedGenTurn?.trajectoryJsonl,
      });
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
    const seedHistoryJsonl = history
      .map(h => (h as any).trajectoryJsonl || JSON.stringify({
        role: 'assistant',
        message_type: 'ai',
        turn_role: h.role,
        turn_number: h.turnNumber,
        content: h.content,
      }))
      .filter(Boolean)
      .join('\n');

    await this.gitHarness.commitStrategyHistory('seed_strategies.md', seedHistoryMarkdown, seedHistoryJsonl);
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
      if (branch.solutionAttempt && branch.status === 'completed') {
        return;
      }
      branch.status = 'processing';
      this.callbacks.onStateChange?.(this.state);

      const prompt = [
        `# Core Challenge\n${this.state.challenge}`,
        `Assigned Strategy: ${branch.id}\n${branch.strategyText}`,
        'Produce iteration 1 solution attempt.',
      ].join('\n\n');

      try {
        let attemptTrajectoryJsonl = '';
        const attemptOutput = await this.callAgentModelWithRetry({
          kind: 'solutionAttempt',
          promptText: prompt,
          stepDescription: `Solution Attempt for ${branch.id} (Iteration 1)`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false, // Non-critical branch work records error (§9)
          executionGroupId: 'group-iter-1-attempt',
          executionGroupName: 'Iteration 1: Initial Solution Attempts (Parallel)',
          onTrajectoryJsonl: (jsonl) => {
            attemptTrajectoryJsonl = jsonl;
          },
        });

        branch.solutionAttempt = attemptOutput;
        branch.solutionAttemptDisplay = attemptOutput;
        branch.refinedSolution = attemptOutput;
        branch.status = 'completed';

        if (!branch.iterationHistory) {
          branch.iterationHistory = { iterations: [], status: 'completed' };
        }
        const existingIdx = branch.iterationHistory.iterations.findIndex(it => it.iterationNumber === 1);
        if (existingIdx >= 0) {
          branch.iterationHistory.iterations[existingIdx].correctedSolution = attemptOutput;
          (branch.iterationHistory.iterations[existingIdx] as any).solutionTrajectoryJsonl = attemptTrajectoryJsonl;
        } else {
          branch.iterationHistory.iterations.push({
            iterationNumber: 1,
            correctedSolution: attemptOutput,
            critique: '',
            timestamp: Date.now(),
            solutionTrajectoryJsonl: attemptTrajectoryJsonl,
          } as any);
        }
      } catch (err: any) {
        if (
          err instanceof PipelineStopRequestedError ||
          err?.name === 'PipelineStopRequestedError' ||
          this.isStopRequested
        ) {
          throw err;
        }
        branch.status = 'error';
        branch.error = err.message || String(err);
      }
    }));

    // Run Critique in parallel across all branches
    await Promise.all(branches.map(async (branch) => {
      this.checkStopRequested();
      if (branch.solutionCritique && branch.solutionCritiqueStatus === 'completed') {
        return;
      }
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
        let critiqueTrajectoryJsonl = '';
        const critiqueOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCritique',
          promptText: critiquePrompt,
          stepDescription: `Solution Critique for ${branch.id} (Iteration 1)`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: 'group-iter-1-critique',
          executionGroupName: 'Iteration 1: Solution Critiques (Parallel)',
          onTrajectoryJsonl: (jsonl) => {
            critiqueTrajectoryJsonl = jsonl;
          },
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
        const existingCritIdx = branch.iterationHistory.iterations.findIndex(it => it.iterationNumber === 1);
        if (existingCritIdx >= 0) {
          branch.iterationHistory.iterations[existingCritIdx].correctedSolution = branch.solutionAttempt || '';
          branch.iterationHistory.iterations[existingCritIdx].critique = critiqueOutput;
          branch.iterationHistory.iterations[existingCritIdx].timestamp = Date.now();
          (branch.iterationHistory.iterations[existingCritIdx] as any).critiqueTrajectoryJsonl = critiqueTrajectoryJsonl;
        } else {
          branch.iterationHistory.iterations.push({
            iterationNumber: 1,
            correctedSolution: branch.solutionAttempt || '',
            critique: critiqueOutput,
            timestamp: Date.now(),
            critiqueTrajectoryJsonl,
          } as any);
        }
      } catch (err: any) {
        if (
          err instanceof PipelineStopRequestedError ||
          err?.name === 'PipelineStopRequestedError' ||
          this.isStopRequested
        ) {
          throw err;
        }
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
      const existingIteration = branch.iterationHistory?.iterations?.find(it => it.iterationNumber === iteration);
      if (existingIteration && existingIteration.correctedSolution) {
        return;
      }
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
        let correctionTrajectoryJsonl = '';
        const correctedOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCorrection',
          promptText: correctionPrompt,
          stepDescription: `Solution Correction for ${branch.id} (Iteration ${iteration})`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: `group-iter-${iteration}-correction`,
          executionGroupName: `Iteration ${iteration}: Branch Corrections (Parallel)`,
          onTrajectoryJsonl: (jsonl) => {
            correctionTrajectoryJsonl = jsonl;
          },
        });

        branch.refinedSolution = correctedOutput;
        branch.refinedSolutionDisplay = correctedOutput;
        branch.correctionStatus = 'completed';

        if (!branch.iterationHistory) {
          branch.iterationHistory = { iterations: [], status: 'completed' };
        }
        const existingIdx = branch.iterationHistory.iterations.findIndex(it => it.iterationNumber === iteration);
        if (existingIdx >= 0) {
          branch.iterationHistory.iterations[existingIdx].correctedSolution = correctedOutput;
          branch.iterationHistory.iterations[existingIdx].timestamp = Date.now();
          (branch.iterationHistory.iterations[existingIdx] as any).solutionTrajectoryJsonl = correctionTrajectoryJsonl;
        } else {
          branch.iterationHistory.iterations.push({
            iterationNumber: iteration,
            correctedSolution: correctedOutput,
            critique: '',
            timestamp: Date.now(),
            solutionTrajectoryJsonl: correctionTrajectoryJsonl,
          } as any);
        }
      } catch (err: any) {
        if (
          err instanceof PipelineStopRequestedError ||
          err?.name === 'PipelineStopRequestedError' ||
          this.isStopRequested
        ) {
          throw err;
        }
        branch.correctionStatus = 'error';
        branch.error = err.message || String(err);
      }
    }));

    // Run Critique in parallel
    await Promise.all(branches.map(async (branch) => {
      this.checkStopRequested();
      const existingIteration = branch.iterationHistory?.iterations?.find(it => it.iterationNumber === iteration);
      if (existingIteration && existingIteration.critique) {
        return;
      }
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
        let critiqueTrajectoryJsonl = '';
        const critiqueOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCritique',
          promptText: critiquePrompt,
          stepDescription: `Solution Critique for ${branch.id} (Iteration ${iteration})`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: `group-iter-${iteration}-critique`,
          executionGroupName: `Iteration ${iteration}: Branch Critiques (Parallel)`,
          onTrajectoryJsonl: (jsonl) => {
            critiqueTrajectoryJsonl = jsonl;
          },
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

        // Append or update iteration history
        if (!branch.iterationHistory) {
          branch.iterationHistory = { iterations: [], status: 'completed' };
        }
        const existingIdx = branch.iterationHistory.iterations.findIndex(it => it.iterationNumber === iteration);
        if (existingIdx >= 0) {
          branch.iterationHistory.iterations[existingIdx].correctedSolution = branch.refinedSolution || '';
          branch.iterationHistory.iterations[existingIdx].critique = critiqueOutput;
          branch.iterationHistory.iterations[existingIdx].timestamp = Date.now();
          (branch.iterationHistory.iterations[existingIdx] as any).critiqueTrajectoryJsonl = critiqueTrajectoryJsonl;
        } else {
          branch.iterationHistory.iterations.push({
            iterationNumber: iteration,
            correctedSolution: branch.refinedSolution || '',
            critique: critiqueOutput,
            timestamp: Date.now(),
            critiqueTrajectoryJsonl,
          } as any);
        }
      } catch (err: any) {
        if (
          err instanceof PipelineStopRequestedError ||
          err?.name === 'PipelineStopRequestedError' ||
          this.isStopRequested
        ) {
          throw err;
        }
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
      const existingIteration = branch.iterationHistory?.iterations?.find(it => it.iterationNumber === iteration);
      if (existingIteration && existingIteration.correctedSolution) {
        return;
      }
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
        let correctionTrajectoryJsonl = '';
        const correctedOutput = await this.callAgentModelWithRetry({
          kind: 'solutionCorrection',
          promptText: correctionPrompt,
          stepDescription: `Final Solution Correction for ${branch.id} (Iteration ${iteration})`,
          workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
          isCritical: false,
          executionGroupId: `group-iter-${iteration}-final-correction`,
          executionGroupName: `Iteration ${iteration}: Final Corrections (Parallel)`,
          onTrajectoryJsonl: (jsonl) => {
            correctionTrajectoryJsonl = jsonl;
          },
        });

        branch.refinedSolution = correctedOutput;
        branch.refinedSolutionDisplay = correctedOutput;
        branch.correctionStatus = 'completed';

        // Record final iteration correction only (no critique) in history (§3, §8.1)
        if (!branch.iterationHistory) {
          branch.iterationHistory = { iterations: [], status: 'completed' };
        }
        const existingIdx = branch.iterationHistory.iterations.findIndex(it => it.iterationNumber === iteration);
        if (existingIdx >= 0) {
          branch.iterationHistory.iterations[existingIdx].correctedSolution = correctedOutput;
          branch.iterationHistory.iterations[existingIdx].timestamp = Date.now();
          (branch.iterationHistory.iterations[existingIdx] as any).solutionTrajectoryJsonl = correctionTrajectoryJsonl;
        } else {
          branch.iterationHistory.iterations.push({
            iterationNumber: iteration,
            correctedSolution: correctedOutput,
            critique: '[Iteration i critique intentionally omitted per §3]',
            timestamp: Date.now(),
            solutionTrajectoryJsonl: correctionTrajectoryJsonl,
          } as any);
        }
      } catch (err: any) {
        if (
          err instanceof PipelineStopRequestedError ||
          err?.name === 'PipelineStopRequestedError' ||
          this.isStopRequested
        ) {
          throw err;
        }
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
    reusedDos?: DosOutput,
    reusedDosFilePath?: string
  ): Promise<void> {
    const config = this.state.runConfig;
    if (config.hypothesisCount === 0) {
      return; // Curated context disabled (§3, §4.5)
    }

    const previousHeartbeat = this.state.heartbeats[this.state.heartbeats.length - 1];
    const currentDosFilePath = reusedDosFilePath || `DOS_history/DOS_heartbeat_${String(heartbeatNo).padStart(2, '0')}.md`;

    // 1. DOS (if hypotheses are enabled)
    let dosOutput = reusedDos;
    if (!dosOutput && config.hypothesisCount > 0) {
      const existingDos = this.state.dosOutputs?.find(
        d => d.callType === 'heartbeat' && d.iteration === iteration
      );
      if (existingDos) {
        dosOutput = existingDos.output;
      }
    }
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
      let dosTrajectoryJsonl = '';
      const rawDos = await this.callAgentModelWithRetry({
        kind: 'dos',
        promptText: dosPrompt,
        stepDescription: `Heartbeat DOS (Heartbeat ${heartbeatNo})`,
        jsonResponse: true,
        isCritical: true,
        contract: dosContract,
        executionGroupId: `group-heartbeat-${heartbeatNo}-dos`,
        executionGroupName: `Heartbeat ${heartbeatNo}: DOS Synthesis`,
        onTrajectoryJsonl: (jsonl) => {
          dosTrajectoryJsonl = jsonl;
        },
      });

      dosOutput = this.parseJsonStrict<DosOutput>(rawDos, `Heartbeat DOS (Heartbeat ${heartbeatNo})`);
      this.state.dosOutputs.push({ callType: 'heartbeat', iteration, output: dosOutput });

      // Save DOS output and trajectory to repository (§8.1, §12.13)
      await this.gitHarness.writeFilesAndCommit(
        `Heartbeat ${heartbeatNo} DOS output`,
        [
          {
            path: currentDosFilePath,
            content: `# DOS Heartbeat ${heartbeatNo} Output\n\n\`\`\`json\n${JSON.stringify(dosOutput, null, 2)}\n\`\`\``,
          },
          {
            path: `DOS_history/DOS_heartbeat_${String(heartbeatNo).padStart(2, '0')}.jsonl`,
            content: dosTrajectoryJsonl,
          },
        ]
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

      // Assemble reframed historical hypothesis proximity transcript across prior heartbeats 1..heartbeatNo-1 (§7)
      const priorHeartbeatEntries: Array<{
        heartbeatNo: number;
        dosFilePath?: string;
        turns: ProximityTurn[];
      }> = [];
      for (let m = 1; m < heartbeatNo; m++) {
        const hbBlock = this.state.heartbeats.find(h => h.heartbeat_no === m);
        const defaultDosPath = hbBlock && hbBlock.iteration % config.j === 0
          ? `DOS_history/DOS_global_update_${String(Math.round(hbBlock.iteration / config.j)).padStart(2, '0')}_step_ii.md`
          : `DOS_history/DOS_heartbeat_${String(m).padStart(2, '0')}.md`;
        const turnsForHb = Array.isArray(this.state.hypothesisProximityHistory)
          ? this.state.hypothesisProximityHistory.filter(h => (h as any).roundNumber === m)
          : [];
        if (turnsForHb.length > 0) {
          priorHeartbeatEntries.push({
            heartbeatNo: m,
            dosFilePath: hbBlock?.dosFilePath || defaultDosPath,
            turns: turnsForHb,
          });
        }
      }
      const priorHypProximityHistory = buildHypothesisProximityHistoryWithNotes(priorHeartbeatEntries);

      const hypHistory: ProximityTurn[] = Array.isArray(this.state.hypothesisProximityHistory)
        ? this.state.hypothesisProximityHistory.filter(h => (h as any).roundNumber === heartbeatNo)
        : [];

      const targetHypProximityReviews = Math.max(0, config.hypothesisProximityLoops ?? 1);

      for (let reviewIndex = 0; reviewIndex <= targetHypProximityReviews; reviewIndex++) {
        const turn = reviewIndex + 1;
        this.checkStopRequested();

        let rawHypGen: string;
        const existingGen = hypHistory.find(h => h.role === 'generator' && h.turnNumber === turn);
        if (existingGen) {
          rawHypGen = existingGen.content;
        } else {
          const hypContext = buildContextForHypothesisGenerate(
            this.state.challenge,
            heartbeatNo,
            this.state.initialStrategies,
            dosOutput,
            previousHeartbeat,
            priorHypProximityHistory,
            hypHistory,
            config.hypothesisCount
          );

          let hypGenTrajectoryJsonl = '';
          rawHypGen = await this.callAgentModelWithRetry({
            kind: 'hypothesisGeneration',
            promptText: hypContext,
            stepDescription: `Hypothesis Generation (Heartbeat ${heartbeatNo}, Turn ${turn})`,
            jsonResponse: true,
            isCritical: true,
            contract: hypContract,
            executionGroupId: `group-heartbeat-${heartbeatNo}-hypotheses`,
            executionGroupName: `Heartbeat ${heartbeatNo}: Hypothesis Proximity Loop`,
            onTrajectoryJsonl: (jsonl) => {
              hypGenTrajectoryJsonl = jsonl;
            },
          });

          hypHistory.push({
            role: 'generator',
            content: rawHypGen,
            timestamp: Date.now(),
            turnNumber: turn,
            roundNumber: heartbeatNo,
            trajectoryJsonl: hypGenTrajectoryJsonl,
          } as any);

          this.state.hypothesisProximityHistory = [
            ...(this.state.hypothesisProximityHistory || []).filter(h => (h as any).roundNumber !== heartbeatNo),
            ...hypHistory,
          ];
          this.callbacks.onStateChange?.(this.state);
        }

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

        if (reviewIndex < targetHypProximityReviews) {
          const existingProx = hypHistory.find(h => h.role === 'proximity' && h.turnNumber === turn);
          if (existingProx) {
            // Already completed proximity review for this turn
          } else {
            // Proximity review turn receives the exact same full context as the generator (§4.2, §7)
            const proxPrompt = buildContextForHypothesisGenerate(
              this.state.challenge,
              heartbeatNo,
              this.state.initialStrategies,
              dosOutput,
              previousHeartbeat,
              priorHypProximityHistory,
              hypHistory,
              config.hypothesisCount
            );

            let hypProxTrajectoryJsonl = '';
            const proxOutput = await this.callAgentModelWithRetry({
              kind: 'hypothesisProximity',
              promptText: proxPrompt,
              stepDescription: `Hypothesis Proximity Review (Heartbeat ${heartbeatNo}, Turn ${turn})`,
              isCritical: true,
              executionGroupId: `group-heartbeat-${heartbeatNo}-hypotheses`,
              executionGroupName: `Heartbeat ${heartbeatNo}: Hypothesis Proximity Loop`,
              onTrajectoryJsonl: (jsonl) => {
                hypProxTrajectoryJsonl = jsonl;
              },
            });

            hypHistory.push({
              role: 'proximity',
              content: proxOutput,
              timestamp: Date.now(),
              turnNumber: turn,
              roundNumber: heartbeatNo,
              trajectoryJsonl: hypProxTrajectoryJsonl,
            } as any);

            this.state.hypothesisProximityHistory = [
              ...(this.state.hypothesisProximityHistory || []).filter(h => (h as any).roundNumber !== heartbeatNo),
              ...hypHistory,
            ];
            this.callbacks.onStateChange?.(this.state);
          }
        }
      }

      this.state.hypothesisProximityHistory = [
        ...(this.state.hypothesisProximityHistory || []).filter(h => (h as any).roundNumber !== heartbeatNo),
        ...hypHistory,
      ];

      // Save generation & proximity history into repository (§8.1) along with .jsonl trajectories
      const hypHistoryMarkdown = hypHistory.map(h => `### ${h.role.toUpperCase()} (Turn ${h.turnNumber ?? 1})\n${h.content}`).join('\n\n');
      const genOnlyTrajectoriesJsonl = hypHistory
        .filter(h => h.role === 'generator')
        .map(h => (h as any).trajectoryJsonl || JSON.stringify({ role: 'assistant', message_type: 'ai', turn_role: h.role, turn_number: h.turnNumber, content: h.content }))
        .filter(Boolean)
        .join('\n');
      const fullHypProximityJsonl = hypHistory
        .map(h => (h as any).trajectoryJsonl || JSON.stringify({ role: 'assistant', message_type: 'ai', turn_role: h.role, turn_number: h.turnNumber, content: h.content }))
        .filter(Boolean)
        .join('\n');

      heartbeatFiles.push(
        {
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/generation_history.md`,
          content: `# Hypothesis Generation Heartbeat ${heartbeatNo}\n\n\`\`\`json\n${JSON.stringify(parsedGen, null, 2)}\n\`\`\``,
        },
        {
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/generation_history.jsonl`,
          content: genOnlyTrajectoriesJsonl,
        },
        {
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/hypothesis_proximity_history_heartbeat_${String(heartbeatNo).padStart(2, '0')}.md`,
          content: `# Hypothesis Proximity History (Heartbeat ${heartbeatNo})\n\n${hypHistoryMarkdown}`,
        },
        {
          path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/hypothesis_proximity_history_heartbeat_${String(heartbeatNo).padStart(2, '0')}.jsonl`,
          content: fullHypProximityJsonl,
        }
      );

      // 3. Test Hypotheses in parallel (§4.3)
      await Promise.all(parsedGen.hypotheses.slice(0, config.hypothesisCount).map(async (hypItem, idx) => {
        this.checkStopRequested();

        const testerPrompt = [
          `# Core Challenge\n${this.state.challenge}`,
          `Assigned Hypothesis ${hypItem.hypothesis_id}:\n${hypItem.text}`,
          'Test this hypothesis within your assigned folder.',
        ].join('\n\n');

        const folderIndex = idx + 1;
        let testerTrajectoryJsonl = '';
        const testResult = await this.callAgentModelWithRetry({
          kind: 'hypothesisTester',
          promptText: testerPrompt,
          stepDescription: `Hypothesis Tester for ${hypItem.hypothesis_id}`,
          workingDirectory: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/Hypothesis-${folderIndex}`,
          isCritical: false,
          executionGroupId: `group-heartbeat-${heartbeatNo}-testing`,
          executionGroupName: `Heartbeat ${heartbeatNo}: Independent Hypothesis Testers (Parallel)`,
          onTrajectoryJsonl: (jsonl) => {
            testerTrajectoryJsonl = jsonl;
          },
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

        // Record hypothesis file and .jsonl trajectory in repository (§8.1)
        heartbeatFiles.push(
          {
            path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/Hypothesis-${folderIndex}/hypothesis.md`,
            content: [
              `# Hypothesis ${hypItem.hypothesis_id}`,
              `**Claim**: ${hypItem.text}`,
              `**Target Branches**: ${hypItem.target_branches?.join(', ') || 'Global'}`,
              `**Predicted Outcome**: ${JSON.stringify(hypItem.predicted_test_outcome)}`,
              `**Verdict**: ${verdict}`,
              `\n## Tester Execution & Output\n${testResult}`,
            ].join('\n\n'),
          },
          {
            path: `Custom_Curated_Context/Heartbeat-${heartbeatNo}/Hypotheses/Hypothesis-${folderIndex}/hypothesis.jsonl`,
            content: testerTrajectoryJsonl,
          }
        );

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

    // Record heartbeat block
    const heartbeatBlock: HeartbeatBlock = {
      heartbeat_no: heartbeatNo,
      iteration,
      dosFilePath: currentDosFilePath,
      hypotheses: newHypotheses,
      realized_feedback: realizedFeedback,
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
    let stepIDosTrajectoryJsonl = '';
    const stepIDosPromise = this.callAgentModelWithRetry({
      kind: 'dos',
      promptText: stepIDosPrompt,
      stepDescription: `Step-i DOS (Global Update ${updateNumber})`,
      jsonResponse: true,
      isCritical: true,
      contract: stepIDosContract,
      executionGroupId: `group-global-update-${updateNumber}-step-i`,
      executionGroupName: `Global Update ${updateNumber}: Step-i DOS & BSR Evaluation (Parallel)`,
      onTrajectoryJsonl: (jsonl) => {
        stepIDosTrajectoryJsonl = jsonl;
      },
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

    // Persist Step-i DOS and trajectory in repository (§8.1, §12.13)
    await this.gitHarness.writeFilesAndCommit(
      `Step-i DOS for Global Update ${updateNumber}`,
      [
        {
          path: `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_i.md`,
          content: `# Step-i DOS Output (Global Update ${updateNumber})\n\n\`\`\`json\n${JSON.stringify(stepIDosOutput, null, 2)}\n\`\`\``,
        },
        {
          path: `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_i.jsonl`,
          content: stepIDosTrajectoryJsonl,
        },
      ]
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

      const existingGuHistory = this.globalUpdateStrategyHistories.find(h => h.updateNumber === updateNumber);
      const currentGuTurns: ProximityTurn[] = existingGuHistory ? [...existingGuHistory.turns] : [];
      let parsedStrat: {
        evolved_slots?: Array<{ slot_id: string; updated_strategy_text: string }>;
        pruned_slots?: Array<{ slot_id: string; new_strategy_text: string }>;
      } = {};

      const targetGuProximityReviews = Math.max(0, config.strategyProximityLoops ?? 1);

      for (let reviewIndex = 0; reviewIndex <= targetGuProximityReviews; reviewIndex++) {
        const turn = reviewIndex + 1;
        this.checkStopRequested();

        let rawStratUpdate: string;
        const existingGen = currentGuTurns.find(t => t.role === 'generator' && t.turnNumber === turn);
        if (existingGen) {
          rawStratUpdate = existingGen.content;
        } else {
          const stratPrompt = buildContextForStrategyGlobalUpdate(
            this.state.challenge,
            updateNumber,
            config.j,
            this.state.initialStrategies,
            consolidatedDecisions,
            stepIDosOutput,
            this.strategiesUsedSoFar,
            priorProximityHistory,
            currentGuTurns,
            config.strategiesCount
          );

          let guGenTrajectoryJsonl = '';
          rawStratUpdate = await this.callAgentModelWithRetry({
            kind: 'strategyGeneratorGlobalUpdate',
            promptText: stratPrompt,
            stepDescription: `Strategy Generator Update (Global Update ${updateNumber}, Turn ${turn})`,
            jsonResponse: true,
            isCritical: true,
            contract: stratUpdateContract,
            executionGroupId: `group-global-update-${updateNumber}-strategies`,
            executionGroupName: `Global Update ${updateNumber}: Strategy Revision Loop`,
            onTrajectoryJsonl: (jsonl) => {
              guGenTrajectoryJsonl = jsonl;
            },
          });

          currentGuTurns.push({
            role: 'generator',
            content: rawStratUpdate,
            timestamp: Date.now(),
            turnNumber: turn,
            trajectoryJsonl: guGenTrajectoryJsonl,
          } as any);

          const histIdx = this.globalUpdateStrategyHistories.findIndex(h => h.updateNumber === updateNumber);
          if (histIdx >= 0) {
            this.globalUpdateStrategyHistories[histIdx].turns = [...currentGuTurns];
          } else {
            this.globalUpdateStrategyHistories.push({ updateNumber, turns: [...currentGuTurns] });
          }
          (this.state as any).globalUpdateStrategyHistories = this.globalUpdateStrategyHistories;
          this.callbacks.onStateChange?.(this.state);
        }

        parsedStrat = this.parseJsonStrict<{
          evolved_slots?: Array<{ slot_id: string; updated_strategy_text: string }>;
          pruned_slots?: Array<{ slot_id: string; new_strategy_text: string }>;
        }>(rawStratUpdate, `Strategy Generator Update (Global Update ${updateNumber}, Turn ${turn})`);

        if (reviewIndex < targetGuProximityReviews) {
          const existingProx = currentGuTurns.find(t => t.role === 'proximity' && t.turnNumber === turn);
          if (existingProx) {
            // Already completed proximity review for this turn
          } else {
            // Proximity review turn receives the exact same full context as the generator (§4.1, §7)
            const proxPrompt = buildContextForStrategyGlobalUpdate(
              this.state.challenge,
              updateNumber,
              config.j,
              this.state.initialStrategies,
              consolidatedDecisions,
              stepIDosOutput,
              this.strategiesUsedSoFar,
              priorProximityHistory,
              currentGuTurns,
              config.strategiesCount
            );

            let guProxTrajectoryJsonl = '';
            const proxOutput = await this.callAgentModelWithRetry({
              kind: 'strategyProximity',
              promptText: proxPrompt,
              stepDescription: `Strategy Proximity Review (Global Update ${updateNumber}, Turn ${turn})`,
              isCritical: true,
              executionGroupId: `group-global-update-${updateNumber}-strategies`,
              executionGroupName: `Global Update ${updateNumber}: Strategy Revision Loop`,
              onTrajectoryJsonl: (jsonl) => {
                guProxTrajectoryJsonl = jsonl;
              },
            });

            currentGuTurns.push({
              role: 'proximity',
              content: proxOutput,
              timestamp: Date.now(),
              turnNumber: turn,
              trajectoryJsonl: guProxTrajectoryJsonl,
            } as any);

            const histIdx = this.globalUpdateStrategyHistories.findIndex(h => h.updateNumber === updateNumber);
            if (histIdx >= 0) {
              this.globalUpdateStrategyHistories[histIdx].turns = [...currentGuTurns];
            } else {
              this.globalUpdateStrategyHistories.push({ updateNumber, turns: [...currentGuTurns] });
            }
            (this.state as any).globalUpdateStrategyHistories = this.globalUpdateStrategyHistories;
            this.callbacks.onStateChange?.(this.state);
          }
        }
      }

      const histIdx = this.globalUpdateStrategyHistories.findIndex(h => h.updateNumber === updateNumber);
      if (histIdx >= 0) {
        this.globalUpdateStrategyHistories[histIdx].turns = currentGuTurns;
      } else {
        this.globalUpdateStrategyHistories.push({
          updateNumber,
          turns: currentGuTurns,
        });
      }

      const latestGuGenTurn = [...currentGuTurns].reverse().find(t => t.role === 'generator') as any;

      // Apply surgical slot changes onto active strategies (§4.1)
      if (parsedStrat.evolved_slots) {
        for (const ev of parsedStrat.evolved_slots) {
          const branch = this.state.initialStrategies.find(b => b.id === ev.slot_id);
          if (branch) {
            branch.strategyText = ev.updated_strategy_text;
            if (!branch.strategyTextHistory) branch.strategyTextHistory = [];
            branch.strategyTextHistory.push({ iteration, text: ev.updated_strategy_text });
            this.strategiesUsedSoFar.push({
              slotId: branch.id,
              iterationFinalized: iteration,
              text: ev.updated_strategy_text,
              trajectoryJsonl: latestGuGenTurn?.trajectoryJsonl,
            });
          }
        }
      }

      if (parsedStrat.pruned_slots) {
        for (const pr of parsedStrat.pruned_slots) {
          const branch = this.state.initialStrategies.find(b => b.id === pr.slot_id);
          if (branch) {
            branch.strategyText = pr.new_strategy_text;
            branch.strategyTextHistory = [{ iteration: iteration, text: pr.new_strategy_text }];
            this.strategiesUsedSoFar.push({
              slotId: branch.id,
              iterationFinalized: iteration,
              text: pr.new_strategy_text,
              trajectoryJsonl: latestGuGenTurn?.trajectoryJsonl,
            });
          }
        }
      }

      // Commit strategy update history and strategies used so far (§8.1)
      const guHistoryMarkdown = currentGuTurns.map(t => `### ${t.role.toUpperCase()} (Turn ${t.turnNumber ?? 1})\n${t.content}`).join('\n\n');
      const guHistoryJsonl = currentGuTurns
        .map(t => (t as any).trajectoryJsonl || JSON.stringify({
          role: 'assistant',
          message_type: 'ai',
          turn_role: t.role,
          turn_number: t.turnNumber,
          content: t.content,
        }))
        .filter(Boolean)
        .join('\n');
      await this.gitHarness.commitStrategyHistory(
        `strategies_global_update${String(updateNumber).padStart(2, '0')}.md`,
        guHistoryMarkdown,
        guHistoryJsonl
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
          status: 'completed',
          solutionAttempt: branch.solutionAttempt,
          solutionAttemptDisplay: branch.solutionAttemptDisplay,
          solutionAttemptExecutionTraceText: branch.solutionAttemptExecutionTraceText,
          solutionCritique: branch.solutionCritique,
          solutionCritiqueDisplay: branch.solutionCritiqueDisplay,
          solutionCritiqueExecutionTraceText: branch.solutionCritiqueExecutionTraceText,
          solutionCritiqueStatus: branch.solutionCritiqueStatus,
          correctionStatus: branch.correctionStatus,
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

      let memTrajectoryJsonl = '';
      const memOutput = await this.callAgentModelWithRetry({
        kind: 'memoryBank',
        promptText: memContext,
        stepDescription: `Memory Bank Distillation for ${branch.id} (Update ${updateNumber})`,
        workingDirectory: `Strategy-${branch.id.replace(/\D/g, '')}`,
        isCritical: false,
        executionGroupId: `group-global-update-${updateNumber}-distillation`,
        executionGroupName: `Global Update ${updateNumber}: Distillation & New Branch Seeding (Parallel)`,
        onTrajectoryJsonl: (jsonl) => {
          memTrajectoryJsonl = jsonl;
        },
      });

      branch.memoryBank = memOutput;

      // Write memory bank and trajectory to Strategy-N/history/memory_bank_NN.md & .jsonl (§8.1)
      await this.gitHarness.writeFilesAndCommit(
        `Memory Bank distillation for ${branch.id} at update ${updateNumber}`,
        [
          {
            path: `Strategy-${branch.id.replace(/\D/g, '')}/history/memory_bank_${String(updateNumber).padStart(2, '0')}.md`,
            content: memOutput,
          },
          {
            path: `Strategy-${branch.id.replace(/\D/g, '')}/history/memory_bank_${String(updateNumber).padStart(2, '0')}.jsonl`,
            content: memTrajectoryJsonl,
          },
        ]
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

      let attemptTrajectoryJsonl = '';
      const attemptOutput = await this.callAgentModelWithRetry({
        kind: 'solutionAttempt',
        promptText: attemptPrompt,
        stepDescription: `First Execution for New Branch in ${slotId}`,
        workingDirectory: `Strategy-${slotIndex + 1}`,
        isCritical: false,
        executionGroupId: `group-global-update-${updateNumber}-distillation`,
        executionGroupName: `Global Update ${updateNumber}: Distillation & New Branch Seeding (Parallel)`,
        onTrajectoryJsonl: (jsonl) => {
          attemptTrajectoryJsonl = jsonl;
        },
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

      let critiqueTrajectoryJsonl = '';
      const critiqueOutput = await this.callAgentModelWithRetry({
        kind: 'solutionCritique',
        promptText: critiquePrompt,
        stepDescription: `First Critique for New Branch in ${slotId}`,
        workingDirectory: `Strategy-${slotIndex + 1}`,
        isCritical: false,
        executionGroupId: `group-global-update-${updateNumber}-distillation`,
        executionGroupName: `Global Update ${updateNumber}: Distillation & New Branch Seeding (Parallel)`,
        onTrajectoryJsonl: (jsonl) => {
          critiqueTrajectoryJsonl = jsonl;
        },
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
          solutionTrajectoryJsonl: attemptTrajectoryJsonl,
          critiqueTrajectoryJsonl,
        } as any],
        status: 'completed',
      };
    }));

    await Promise.all([distillationPromise, newBranchesPromise]);

    // Checkpoint next window_start for every active strategy folder (§6.3, §8.2)
    const nextWindowStart = iteration + 1;
    for (let slotIdx = 0; slotIdx < this.state.initialStrategies.length; slotIdx++) {
      const strat = this.state.initialStrategies[slotIdx];
      const latestStratEntry = [...this.strategiesUsedSoFar].reverse().find(s => s.slotId === strat.id);
      const stratJsonl = latestStratEntry?.trajectoryJsonl || JSON.stringify({
        role: 'assistant',
        message_type: 'ai',
        agent_kind: 'strategyGeneratorGlobalUpdate',
        slot_id: strat.id,
        content: strat.strategyText,
      });
      const contextFiles: DeepthinkResultsContextFile[] = [
        {
          path: `Strategy-${slotIdx + 1}/strategy.md`,
          content: `# Strategy ${slotIdx + 1} (${strat.id})\n\n${strat.strategyText}\n`,
        },
        {
          path: `Strategy-${slotIdx + 1}/strategy.jsonl`,
          content: stratJsonl,
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

      let stepIiDosTrajectoryJsonl = '';
      const rawStepIiDos = await this.callAgentModelWithRetry({
        kind: 'dos',
        promptText: stepIiPrompt,
        stepDescription: `Step-ii DOS (Global Update ${updateNumber})`,
        jsonResponse: true,
        isCritical: true,
        contract: stepIiDosContract,
        executionGroupId: `group-global-update-${updateNumber}-step-ii`,
        executionGroupName: `Global Update ${updateNumber}: Step-ii DOS Synthesis`,
        onTrajectoryJsonl: (jsonl) => {
          stepIiDosTrajectoryJsonl = jsonl;
        },
      });

      stepIiDosOutput = this.parseJsonStrict<DosOutput>(rawStepIiDos, `Step-ii DOS (Global Update ${updateNumber})`);
      this.state.dosOutputs.push({ callType: 'step_ii', iteration, output: stepIiDosOutput });

      // Save Step-ii DOS and trajectory to repository (§8.1, §12.13)
      await this.gitHarness.writeFilesAndCommit(
        `Step-ii DOS for Global Update ${updateNumber}`,
        [
          {
            path: `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_ii.md`,
            content: `# Step-ii DOS Output (Global Update ${updateNumber})\n\n\`\`\`json\n${JSON.stringify(stepIiDosOutput, null, 2)}\n\`\`\``,
          },
          {
            path: `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_ii.jsonl`,
            content: stepIiDosTrajectoryJsonl,
          },
        ]
      );

      // Attach realized hypothesis feedback for the previous heartbeat (§5.1, §5.4)
      const previousHeartbeat = this.state.heartbeats[this.state.heartbeats.length - 1];
      if (stepIiDosOutput.hypothesis_feedback && previousHeartbeat) {
        await this.attachRealizedDosFeedback(stepIiDosOutput.hypothesis_feedback, previousHeartbeat.heartbeat_no);
      }
    }

    // vii. Run Curated Context Heartbeat, reusing Step-ii DOS (§4.6 vii, §4.5)
    const stepIiDosFilePath = `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_ii.md`;
    await this.runCuratedContextHeartbeat(iteration, heartbeatNo, stepIiDosOutput, stepIiDosFilePath);
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

    // NOTE: Final judge direct context receives only candidates, no critiques (§7, §9)
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
    const jsonl = this.strategiesUsedSoFar
      .map(s => s.trajectoryJsonl || JSON.stringify({
        role: 'assistant',
        message_type: 'ai',
        slot_id: s.slotId,
        iteration_finalized: s.iterationFinalized,
        content: s.text,
      }))
      .filter(Boolean)
      .join('\n');

    await this.gitHarness.commitStrategyHistory('strategies_finalized_and_used_so_far.md', markdown, jsonl);
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
      const commitKey = `${slotIdx}:${iteration}`;
      if (this.commitHashesPerIteration.has(commitKey)) {
        continue;
      }
      const branch = this.state.initialStrategies[slotIdx];
      const historyEntry = branch.iterationHistory?.iterations.find(it => it.iterationNumber === iteration);

      const files: DeepthinkResultsContextFile[] = [];
      if (historyEntry) {
        const paddedIter = String(iteration).padStart(2, '0');
        files.push({
          path: `Strategy-${slotIdx + 1}/history/iteration_${paddedIter}.md`,
          content: [
            `# Strategy ${branch.id} - Iteration ${iteration}`,
            `## Solution\n${historyEntry.correctedSolution}`,
            `\n## Critique\n${historyEntry.critique}`,
          ].join('\n\n'),
        });
        const solJsonl = (historyEntry as any).solutionTrajectoryJsonl || JSON.stringify({
          role: 'assistant',
          message_type: 'ai',
          agent_kind: iteration === 1 ? 'solutionAttempt' : 'solutionCorrection',
          branch_id: branch.id,
          iteration,
          content: historyEntry.correctedSolution,
        });
        const critJsonl = (historyEntry as any).critiqueTrajectoryJsonl || (
          historyEntry.critique && !historyEntry.critique.startsWith('[Iteration i critique')
            ? JSON.stringify({
                role: 'assistant',
                message_type: 'ai',
                agent_kind: 'solutionCritique',
                branch_id: branch.id,
                iteration,
                content: historyEntry.critique,
              })
            : ''
        );
        files.push({
          path: `Strategy-${slotIdx + 1}/history/iteration_${paddedIter}.jsonl`,
          content: [solJsonl, critJsonl].filter(Boolean).join('\n'),
        });
      }

      const commit = await this.gitHarness.commitStrategyIteration(slotIdx, iteration, files);
      this.commitHashesPerIteration.set(commitKey, commit);
    }
    this.syncCheckpointState(iteration);
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
    onTrajectoryJsonl?: (jsonl: string) => void;
  }): Promise<string> {
    const config = this.state.runConfig;
    const prompts = this.state.customPrompts || (this.state.runConfig as any)?.prompts || createDefaultCustomPromptsDeepthink();
    const model = deepthinkAgentModel(args.kind, prompts, config.model);
    const systemInstruction = deepthinkAgentSystemInstruction(args.kind, prompts);
    const maxOutputTokens = deepthinkAgentMaxOutputTokens(args.kind);
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
        let rawTrajectoryJsonl: string;

        const abortPromise = new Promise<never>((_, reject) => {
          if (this.isStopRequested) return reject(new PipelineStopRequestedError());
          this.abortController.signal.addEventListener('abort', () => reject(new PipelineStopRequestedError()), { once: true });
        });

        const executePromise = (async () => {
          if (config.deepthinkCodeExecutionEnabled) {
            const sessionId = `dtsb-${this.state.id}-${args.kind}-${nanoid(6)}`;
            const repositoryAccess: SandboxRepositoryAccess = {
              repositoryId: this.state.id,
              agentDirectory: args.workingDirectory,
              agentDirectoryReadOnly: args.kind === 'bsr' || args.kind === 'memoryBank',
              fullRepositoryRead: true,
            };

            const sharedWorkspaceHandler = (input: SharedWorkspaceToolInput) =>
              this.sharedWorkspace.handleToolCall(input);

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
              maxOutputTokens,
              repositoryAccess,
              sharedWorkspaceHandler,
            });

            const fallbackJsonl = [
              JSON.stringify({ role: 'system', message_type: 'system', content: systemInstruction }),
              JSON.stringify({ role: 'user', message_type: 'human', content: args.promptText }),
              JSON.stringify({ role: 'assistant', message_type: 'ai', content: result.text || result.finalText }),
            ].join('\n');

            return {
              text: result.text || result.finalText,
              trace: result.executionTraceText,
              jsonl: result.rawTrajectoryJsonl || fallbackJsonl,
            };
          } else {
            const text = await this.callbacks.callAI({
              prompt: args.promptText,
              model,
              systemInstruction,
              responseSchema: args.jsonResponse ? true : undefined,
              thinkingConfig: { thinkingLevel: config.thinkingLevel },
              agentKind: args.kind,
              stepDescription: args.stepDescription,
            });
            const jsonl = [
              JSON.stringify({
                role: 'system',
                message_type: 'system',
                agent_kind: args.kind,
                step_description: args.stepDescription,
                model,
                content: systemInstruction,
              }),
              JSON.stringify({
                role: 'user',
                message_type: 'human',
                agent_kind: args.kind,
                step_description: args.stepDescription,
                model,
                content: args.promptText,
              }),
              JSON.stringify({
                role: 'assistant',
                message_type: 'ai',
                agent_kind: args.kind,
                step_description: args.stepDescription,
                model,
                content: text,
              }),
            ].join('\n');
            return {
              text,
              trace: undefined,
              jsonl,
            };
          }
        })();

        const executionResult = await Promise.race([executePromise, abortPromise]);
        outputText = executionResult.text;
        executionTraceText = executionResult.trace;
        rawTrajectoryJsonl = executionResult.jsonl;

        if (this.isStopRequested) {
          this.checkStopRequested();
          throw new PipelineStopRequestedError();
        }

        if (!outputText || !outputText.trim()) {
          throw new Error('Empty response received from model.');
        }

        // Validate structured output contract if present (§9)
        if (args.contract) {
          const parsed = this.parseJsonStrict<T>(outputText, args.contract.name);
          args.contract.validate(parsed);
        }

        args.onTrajectoryJsonl?.(rawTrajectoryJsonl);

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
        if (
          err instanceof PipelineStopRequestedError ||
          err?.name === 'PipelineStopRequestedError' ||
          this.isStopRequested
        ) {
          this.checkStopRequested();
          throw err;
        }

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
    if (this.isStopRequested) {
      this.state.status = 'stopped';
      this.state.isStopRequested = false;
      if (!this.abortController.signal.aborted) {
        this.abortController.abort(new PipelineStopRequestedError());
      }
      this.syncCheckpointState();
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
