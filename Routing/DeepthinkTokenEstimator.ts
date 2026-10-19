/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    MAX_HYPOTHESIS_COUNT,
    MAX_STRATEGY_PROXIMITY_LOOPS,
    MAX_HYPOTHESIS_PROXIMITY_LOOPS,
    MAX_DEEPTHINK_DEPTH,
    MAX_DEEPTHINK_STRATEGIES,
} from './ModelConfig.ts';
import { determinePostIterationStep } from '../Deepthink/core/loopController.ts';
import {
    calculateDeepthinkApiCallsFromParams,
    type DeepthinkApiCallBreakdown,
} from './ApiCallEstimator.ts';

export interface DeepthinkTokenEstimateInput {
    strategiesCount: number;
    strategyProximityLoops?: number;
    hypothesisCount: number;
    hypothesisProximityLoops?: number;
    deepthinkDepth?: number;
    i?: number;
    j?: number;
    k?: number;
    isolateBranches?: boolean;
    codeExecutionEnabled?: boolean;
}

interface TokenRange {
    average: number;
    worst: number;
}

export interface ApiCallRange {
    min: number;
    max: number;
    baseMin?: number;
    baseMax?: number;
    breakdown?: DeepthinkApiCallBreakdown;
    sandboxMultiplier?: { min: number; max: number };
}

export interface DeepthinkTokenEstimate {
    depth: number;
    strategiesCount: number;
    hypothesisCount: number;
    input: TokenRange;
    output: TokenRange;
    total: TokenRange;
    apiCalls: ApiCallRange;
}

/**
 * Per-role output token caps enforced by the harness (§8.3, agentRegistry.ts):
 * - 5,000 tokens for Strategy Generator, Strategy Proximity, Hypothesis Generator,
 *   Hypothesis Proximity, Hypothesis Tester, Solution Attempt, Solution Critique,
 *   DOS, BSR, and Final Judge.
 * - 10,000 tokens for Solution Correction and Memory Bank.
 */
const DEFAULT_ROLE_MAX_OUTPUT_TOKENS = 5_000;
const EXTENDED_ROLE_MAX_OUTPUT_TOKENS = 10_000;

interface TokenProfile {
    /** System instruction + Core Challenge + base XML framing */
    promptBase: number;
    /** Active harness note ({GU_Note}, {HB_Note}, {dos_*_note}) */
    harnessNoteTokens: number;
    /** Compact reframed note ({GU_Reframed_Note}, {HB_Reframed_Note}) */
    reframedNoteTokens: number;
    /** Single strategy text size */
    strategyGenerationOutputPerStrategy: number;
    /** Single hypothesis object entry size */
    hypothesisGenerationOutputPerHypothesis: number;
    /** Strategy Proximity Reviewer output (5k cap) */
    strategyProximityOutput: number;
    /** Hypothesis Proximity Reviewer output (5k cap) */
    hypothesisProximityOutput: number;
    /** Iteration 1 & Pruned replacement first execution output (5k cap) */
    solutionAttemptOutput: number;
    /** Iterations 2..i Solution Correction output (10k cap) */
    solutionCorrectionOutput: number;
    /** Solution Critique output (5k cap) */
    critiqueOutput: number;
    /** Memory Bank distillation output (10k cap) */
    memoryOutput: number;
    /** Independent Hypothesis Tester output (5k cap) */
    hypothesisTestOutput: number;
    /** Step-i DOS output (core_synthesis only, 5k cap) */
    dosStepIOutput: number;
    /** Heartbeat DOS & Step-ii DOS output (core_synthesis + hypothesis_feedback, 5k cap) */
    dosFullOutput: number;
    /** DOS core_synthesis portion routed into Strategy/Hypothesis generators */
    dosCoreSynthesisContext: number;
    /** BSR report output per branch (5k cap) */
    bsrOutput: number;
    /** Per-update standing ledger & graded prediction history growth for BSR */
    bsrLedgerGrowthPerUpdate: number;
    /** Final Judge output (5k cap) */
    finalJudgeOutput: number;
    /** Share of hypotheses routed to each branch in mapped packets */
    branchPacketShare: number;
}

export const SANDBOX_PER_CALL = {
    input: {
        average: 50_000,
        worst: 350_000,
    },
    output: {
        average: 30_000,
        worst: 250_000,
    },
};

export const SANDBOX_ITERATION_NOISE = {
    min: 256_000,
    max: 512_000,
};

export function getRandomSandboxIterationNoise(): number {
    return Math.floor(Math.random() * (SANDBOX_ITERATION_NOISE.max - SANDBOX_ITERATION_NOISE.min + 1)) + SANDBOX_ITERATION_NOISE.min;
}

const WORST_PROFILE: TokenProfile = {
    promptBase: 5_000,
    harnessNoteTokens: 400,
    reframedNoteTokens: 250,
    strategyGenerationOutputPerStrategy: 1_000,
    hypothesisGenerationOutputPerHypothesis: 800,
    strategyProximityOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    hypothesisProximityOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    solutionAttemptOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    solutionCorrectionOutput: EXTENDED_ROLE_MAX_OUTPUT_TOKENS,
    critiqueOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    memoryOutput: EXTENDED_ROLE_MAX_OUTPUT_TOKENS,
    hypothesisTestOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    dosStepIOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    dosFullOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    dosCoreSynthesisContext: 3_500,
    bsrOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    bsrLedgerGrowthPerUpdate: 800,
    finalJudgeOutput: DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
    branchPacketShare: 1.0,
};

const AVERAGE_PROFILE: TokenProfile = {
    promptBase: 3_500,
    harnessNoteTokens: 250,
    reframedNoteTokens: 150,
    strategyGenerationOutputPerStrategy: 550,
    hypothesisGenerationOutputPerHypothesis: 450,
    strategyProximityOutput: 2_000,
    hypothesisProximityOutput: 2_000,
    solutionAttemptOutput: 3_200,
    solutionCorrectionOutput: 6_000,
    critiqueOutput: 2_400,
    memoryOutput: 5_500,
    hypothesisTestOutput: 2_800,
    dosStepIOutput: 2_200,
    dosFullOutput: 3_000,
    dosCoreSynthesisContext: 1_800,
    bsrOutput: 1_800,
    bsrLedgerGrowthPerUpdate: 400,
    finalJudgeOutput: 2_800,
    branchPacketShare: 0.5,
};

type SampledBsrDecision = 'CONTINUE' | 'EVOLVE' | 'PRUNE';

/**
 * Randomly samples BSR branch decisions at a Global Update with a 70% bias
 * toward surviving (CONTINUE or EVOLVE) and 30% toward PRUNE.
 */
function sampleGlobalUpdateDecisions(strategyCount: number): SampledBsrDecision[] {
    const decisions: SampledBsrDecision[] = [];
    for (let s = 0; s < strategyCount; s++) {
        const roll = Math.random();
        if (roll < 0.35) {
            decisions.push('CONTINUE');
        } else if (roll < 0.70) {
            decisions.push('EVOLVE');
        } else {
            decisions.push('PRUNE');
        }
    }
    return decisions;
}

/**
 * Computes exact input and output tokens for a Generator ↔ Proximity loop (§4.1, §4.2, §7).
 * Both Generator and Proximity share the exact same system prompt and base context prefix,
 * and each subsequent turn re-reads all prior Generator and Proximity turns in the loop.
 */
function computeProximityLoopTokens(
    baseContextInput: number,
    proximityLoops: number,
    generatorTurnOutput: number,
    proximityTurnOutput: number
): {
    inputTokens: number;
    outputTokens: number;
    transcriptTokens: number;
} {
    let inputTokens = 0;
    let outputTokens = 0;
    let accumulatedLoopTranscript = 0;

    for (let reviewIdx = 0; reviewIdx <= proximityLoops; reviewIdx++) {
        // Generator turn (runs proximityLoops + 1 times)
        inputTokens += baseContextInput + accumulatedLoopTranscript;
        outputTokens += generatorTurnOutput;
        accumulatedLoopTranscript += generatorTurnOutput;

        // Proximity review turn (runs proximityLoops times, receives identical context + generator turn)
        if (reviewIdx < proximityLoops) {
            inputTokens += baseContextInput + accumulatedLoopTranscript;
            outputTokens += proximityTurnOutput;
            accumulatedLoopTranscript += proximityTurnOutput;
        }
    }

    return {
        inputTokens,
        outputTokens,
        transcriptTokens: accumulatedLoopTranscript,
    };
}

function clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.round(value)));
}

interface BranchSimState {
    hasMemoryBank: boolean;
    preUpdatePairTokens: number;
    windowHistoryTokens: number;
    latestSolutionTokens: number;
    latestCritiqueTokens: number;
    updatesSurvived: number;
}

/**
 * Simulates the exact Deepthink pipeline chronologically across iterations 1..i (§3, §4, §5, §6, §7)
 * to compute accurate input and output token totals.
 */
function simulatePipelineTokens(
    profile: TokenProfile,
    strategyCount: number,
    strategyProximityLoops: number,
    hypothesisCount: number,
    hypothesisProximityLoops: number,
    i: number,
    j: number,
    k: number,
    isolateBranches: boolean,
    sampledDecisionsPerUpdate?: SampledBsrDecision[][]
): { input: number; output: number } {
    let totalInput = 0;
    let totalOutput = 0;

    const strategyTextTokens = profile.strategyGenerationOutputPerStrategy;
    const hypothesisItemTokens = profile.hypothesisGenerationOutputPerHypothesis;

    // 1. Seed Strategy Generation & Proximity Loop (§4.1, §7)
    const seedGenTurnOutput = Math.min(
        DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
        strategyCount * strategyTextTokens
    );
    const seedLoop = computeProximityLoopTokens(
        profile.promptBase,
        strategyProximityLoops,
        seedGenTurnOutput,
        profile.strategyProximityOutput
    );
    totalInput += seedLoop.inputTokens;
    totalOutput += seedLoop.outputTokens;

    // Track strategy proximity history for Global Updates: starts with [Seed G↔P]
    let priorStrategyProximityHistoryTokens = seedLoop.transcriptTokens;
    let strategiesFinalizedAndUsedCount = strategyCount;

    // Track hypothesis proximity history across Heartbeats
    let priorHypothesisProximityHistoryTokens = 0;
    let hypothesesFinalizedAndUsedCount = 0;

    // Initialize N active branch states
    const branches: BranchSimState[] = Array.from({ length: strategyCount }, () => ({
        hasMemoryBank: false,
        preUpdatePairTokens: 0,
        windowHistoryTokens: 0,
        latestSolutionTokens: 0,
        latestCritiqueTokens: 0,
        updatesSurvived: 0,
    }));

    const curatedContextEnabled = hypothesisCount > 0;
    let sinceHeartbeat = 0;
    let heartbeatNo = 0;
    let globalUpdateNo = 0;

    // Helper to execute a Hypothesis Generation ↔ Proximity + Independent Testing heartbeat (§4.2, §4.3, §4.4, §7)
    const runHeartbeatHypothesesAndTesters = (currentHbNo: number) => {
        // [HB-h Context] (§7 context_for_hypothesis_generate)
        let hbActiveContextTokens = profile.harnessNoteTokens;
        if (currentHbNo === 1) {
            // Heartbeat 1: ActiveRunningStrategies (strategy + latest correction) + DosCoreSynthesis
            const activeStrategiesTokens = branches.reduce(
                (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens,
                0
            );
            hbActiveContextTokens += activeStrategiesTokens + profile.dosCoreSynthesisContext;
        } else {
            // Heartbeat h >= 2:
            // (1) PreviousHeartbeatHypothesesAndTests (H hypotheses + H independent testing outputs)
            const prevHypAndTestsTokens = hypothesisCount * (hypothesisItemTokens + profile.hypothesisTestOutput);
            // (2) MappedBranchPackets (S strategies + latest corrections + mapped IDs)
            const mappedPacketsSchemaTokens = branches.reduce(
                (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens + 80,
                0
            );
            // (3) RealizedHypothesisFeedback (predicted, observed, surprise_bits, surprise_note, utilization, counterevidence)
            const realizedFeedbackTokens = hypothesisCount * 350;
            // (4) HypothesesFinalizedAndUsedSoFar
            const usedSoFarTokens = hypothesesFinalizedAndUsedCount * hypothesisItemTokens;
            // (5) DosCoreSynthesis
            hbActiveContextTokens +=
                prevHypAndTestsTokens +
                mappedPacketsSchemaTokens +
                realizedFeedbackTokens +
                usedSoFarTokens +
                profile.dosCoreSynthesisContext;
        }

        const hbBaseInput =
            profile.promptBase +
            priorHypothesisProximityHistoryTokens +
            hbActiveContextTokens;

        const hypGenTurnOutput = Math.min(
            DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
            hypothesisCount * hypothesisItemTokens
        );

        const hypLoop = computeProximityLoopTokens(
            hbBaseInput,
            hypothesisProximityLoops,
            hypGenTurnOutput,
            profile.hypothesisProximityOutput
        );
        totalInput += hypLoop.inputTokens;
        totalOutput += hypLoop.outputTokens;

        // Once Heartbeat h is in the past, {HB_Note(h)} + [HB-h Context] is replaced by {HB_Reframed_Note(h)} + [HB-h G↔P]
        priorHypothesisProximityHistoryTokens += profile.reframedNoteTokens + hypLoop.transcriptTokens;
        hypothesesFinalizedAndUsedCount += hypothesisCount;

        // Independent Hypothesis Testers (H calls in parallel, §4.3)
        // Each tester receives Challenge + its single assigned hypothesis
        const testerInputPerHyp = profile.promptBase + hypothesisItemTokens;
        totalInput += hypothesisCount * testerInputPerHyp;
        totalOutput += hypothesisCount * profile.hypothesisTestOutput;
    };

    // 2. Main Iteration Loop (1 .. i) (§3)
    for (let n = 1; n <= i; n++) {
        if (n === 1) {
            // Iteration 1: Solution Attempt + Solution Critique in parallel across all S branches (§3, §7)
            // Note: No heartbeat has run before Iteration 1, so no curated context packet exists.
            for (const branch of branches) {
                // Solution Attempt receives Challenge + Assigned Strategy
                const attemptInput = profile.promptBase + strategyTextTokens;
                const attemptOutput = profile.solutionAttemptOutput;
                totalInput += attemptInput;
                totalOutput += attemptOutput;

                // Solution Critique receives Challenge + Assigned Strategy + Iteration 1 Solution Attempt
                const critiqueInput = profile.promptBase + strategyTextTokens + attemptOutput;
                const critiqueOutput = profile.critiqueOutput;
                totalInput += critiqueInput;
                totalOutput += critiqueOutput;

                branch.latestSolutionTokens = attemptOutput;
                branch.latestCritiqueTokens = critiqueOutput;
                branch.windowHistoryTokens = attemptOutput + critiqueOutput;
            }
        } else {
            // Iterations 2 .. i: Solution Correction + Solution Critique in parallel (§3, §7)
            // Snapshot peer intelligence before parallel execution (latest correction + critique from n - 1)
            const totalAllBranchesLatestPairs = branches.reduce(
                (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens + b.latestCritiqueTokens,
                0
            );

            // Mapped curated context packet exists ONLY after at least one heartbeat has completed
            const mappedPacketTokens = (curatedContextEnabled && heartbeatNo >= 1)
                ? hypothesisCount * profile.branchPacketShare * (hypothesisItemTokens + profile.hypothesisTestOutput)
                : 0;

            for (const branch of branches) {
                const ownLatestPair = strategyTextTokens + branch.latestSolutionTokens + branch.latestCritiqueTokens;
                const peerContextTokens = isolateBranches
                    ? 0
                    : Math.max(0, totalAllBranchesLatestPairs - ownLatestPair);

                const memBankTokens = branch.hasMemoryBank ? profile.memoryOutput : 0;
                const preUpdateTokens = branch.preUpdatePairTokens;
                const windowTokens = branch.windowHistoryTokens;

                // Correction Agent (§7 context_for_correction_agent):
                // Challenge + Strategy + <BranchHistoryAndMemory> (preUpdateIteration + DistilledMemoryBank +
                // LatestCustomCuratedContext + WindowCorrectionCritiqueHistory) + CrossStrategyPeerIntelligence
                const correctionInput =
                    profile.promptBase +
                    strategyTextTokens +
                    preUpdateTokens +
                    memBankTokens +
                    mappedPacketTokens +
                    windowTokens +
                    peerContextTokens;
                const correctionOutput = profile.solutionCorrectionOutput;
                totalInput += correctionInput;
                totalOutput += correctionOutput;

                // Critique Agent (§7 context_for_critique_agent):
                // Challenge + Strategy + <BranchHistoryAndMemory> (preUpdateIteration + DistilledMemoryBank +
                // WindowCorrectionCritiqueHistory + newly produced iteration-n Correction).
                // Receives NO hypothesis packets and NO cross-strategy peer context.
                const critiqueInput =
                    profile.promptBase +
                    strategyTextTokens +
                    preUpdateTokens +
                    memBankTokens +
                    windowTokens +
                    correctionOutput;
                const critiqueOutput = profile.critiqueOutput;
                totalInput += critiqueInput;
                totalOutput += critiqueOutput;

                branch.latestSolutionTokens = correctionOutput;
                branch.latestCritiqueTokens = critiqueOutput;
                branch.windowHistoryTokens += correctionOutput + critiqueOutput;
            }
        }

        // Post-iteration barrier step (§3)
        const step = determinePostIterationStep(
            n,
            sinceHeartbeat,
            i,
            j,
            k,
            curatedContextEnabled
        );
        sinceHeartbeat = step.nextSinceHeartbeat;

        if (step.action.type === 'FINAL_JUDGE') {
            // Final Judge (§7, §9): receives Challenge + each active branch's strategy, final solution, and final critique
            const candidatesTokens = branches.reduce(
                (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens + b.latestCritiqueTokens,
                0
            );
            totalInput += profile.promptBase + candidatesTokens;
            totalOutput += profile.finalJudgeOutput;
            break;
        } else if (step.action.type === 'HEARTBEAT') {
            // Standalone Curated Context Heartbeat (§4.4, §5.1, §7)
            heartbeatNo++;

            if (curatedContextEnabled) {
                // 1. Standalone Heartbeat DOS
                const activeBranchesTokens = branches.reduce(
                    (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens + b.latestCritiqueTokens,
                    0
                );
                // PreviousHeartbeatHypothesesAndTests is only present when a previous heartbeat exists (heartbeatNo >= 2)
                const prevHypAndTestsForDos = heartbeatNo >= 2
                    ? hypothesisCount * (hypothesisItemTokens + profile.hypothesisTestOutput)
                    : 0;

                const hbDosInput =
                    profile.promptBase +
                    profile.harnessNoteTokens +
                    activeBranchesTokens +
                    prevHypAndTestsForDos;
                totalInput += hbDosInput;
                totalOutput += profile.dosFullOutput;

                // 2. Hypothesis Generation ↔ Proximity + Testers
                runHeartbeatHypothesesAndTesters(heartbeatNo);
            }
            sinceHeartbeat = 0;
        } else if (step.action.type === 'GLOBAL_UPDATE') {
            // Global Update (§4.5, §5.1, §6, §7)
            globalUpdateNo++;
            const decisions = sampledDecisionsPerUpdate?.[globalUpdateNo - 1] ??
                sampleGlobalUpdateDecisions(strategyCount);

            // Step i: Step-i DOS and S BSR agents in parallel
            const activeBranchesTokens = branches.reduce(
                (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens + b.latestCritiqueTokens,
                0
            );
            const stepIDosInput =
                profile.promptBase +
                profile.harnessNoteTokens +
                activeBranchesTokens;
            totalInput += stepIDosInput;
            totalOutput += profile.dosStepIOutput;

            for (const branch of branches) {
                // BSR receives Challenge + Strategy + StandingEventLedger + EarlierGradedPredictionsHistory +
                // MemoryBankBeforeWindow (only if branch already distilled a memory bank before this window) +
                // WindowCorrectionCritiqueHistory
                const memBeforeWindowTokens = branch.hasMemoryBank ? profile.memoryOutput : 0;
                const ledgerAndGradedTokens = branch.updatesSurvived * profile.bsrLedgerGrowthPerUpdate;
                const bsrInput =
                    profile.promptBase +
                    strategyTextTokens +
                    memBeforeWindowTokens +
                    ledgerAndGradedTokens +
                    branch.windowHistoryTokens;
                totalInput += bsrInput;
                totalOutput += profile.bsrOutput;
            }

            // Step ii & iii: Surgical Strategy Generation for Changed Slots (EVOLVE or PRUNE) (§4.1, §4.5 iii, §7)
            const changedCount = decisions.filter(d => d !== 'CONTINUE').length;
            if (changedCount > 0) {
                const activeStrategiesAndLatestCorrections = branches.reduce(
                    (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens,
                    0
                );
                const consolidatedBsrDecisionsTokens = strategyCount * 250;
                const strategiesUsedSoFarTokens = strategiesFinalizedAndUsedCount * strategyTextTokens;

                const guContextTokens =
                    profile.harnessNoteTokens +
                    activeStrategiesAndLatestCorrections +
                    consolidatedBsrDecisionsTokens +
                    profile.dosCoreSynthesisContext +
                    strategiesUsedSoFarTokens;

                const guStratBaseInput =
                    profile.promptBase +
                    priorStrategyProximityHistoryTokens +
                    guContextTokens;

                const guStratGenTurnOutput = Math.min(
                    DEFAULT_ROLE_MAX_OUTPUT_TOKENS,
                    changedCount * strategyTextTokens
                );

                const guStratLoop = computeProximityLoopTokens(
                    guStratBaseInput,
                    strategyProximityLoops,
                    guStratGenTurnOutput,
                    profile.strategyProximityOutput
                );
                totalInput += guStratLoop.inputTokens;
                totalOutput += guStratLoop.outputTokens;

                // Replace {GU_Note(u)} + [GU-u Context] with {GU_Reframed_Note(u)} + [GU-u G↔P] for future updates
                priorStrategyProximityHistoryTokens += profile.reframedNoteTokens + guStratLoop.transcriptTokens;
                strategiesFinalizedAndUsedCount += changedCount;
            }

            // Step iv & v: Apply decisions, run Memory Bank Distillation on survivors (CONTINUE / EVOLVE)
            // and First Execution + Critique on replacement branches (PRUNE) in parallel (§4.5 iv-v)
            for (let s = 0; s < strategyCount; s++) {
                const branch = branches[s];
                const decision = decisions[s];

                if (decision === 'CONTINUE' || decision === 'EVOLVE') {
                    // Surviving branch distills window history + previous memory bank into new memory bank
                    const prevMemTokens = branch.hasMemoryBank ? profile.memoryOutput : 0;
                    const distillInput =
                        profile.promptBase +
                        strategyTextTokens +
                        prevMemTokens +
                        branch.windowHistoryTokens;
                    totalInput += distillInput;
                    totalOutput += profile.memoryOutput;

                    branch.hasMemoryBank = true;
                    branch.preUpdatePairTokens = branch.latestSolutionTokens + branch.latestCritiqueTokens;
                    branch.windowHistoryTokens = 0;
                    branch.updatesSurvived += 1;
                } else {
                    // PRUNE: old branch archived, replacement branch runs First Execution + First Critique
                    const attemptInput = profile.promptBase + strategyTextTokens;
                    const attemptOutput = profile.solutionAttemptOutput;
                    totalInput += attemptInput;
                    totalOutput += attemptOutput;

                    const critiqueInput = profile.promptBase + strategyTextTokens + attemptOutput;
                    const critiqueOutput = profile.critiqueOutput;
                    totalInput += critiqueInput;
                    totalOutput += critiqueOutput;

                    branch.hasMemoryBank = false;
                    branch.latestSolutionTokens = attemptOutput;
                    branch.latestCritiqueTokens = critiqueOutput;
                    // First execution + critique at iteration n acts as pre-update baseline for n + 1
                    branch.preUpdatePairTokens = attemptOutput + critiqueOutput;
                    branch.windowHistoryTokens = 0;
                    branch.updatesSurvived = 0;
                }
            }

            // Step vi & vii: Step-ii DOS (when hypotheses enabled) + Ending Heartbeat reusing Step-ii DOS (§4.5 vi-vii)
            heartbeatNo++;
            if (curatedContextEnabled) {
                const postUpdateBranchesTokens = branches.reduce(
                    (acc, b) => acc + strategyTextTokens + b.latestSolutionTokens + b.latestCritiqueTokens,
                    0
                );
                // PreviousHeartbeatHypothesesAndTests is included if at least one heartbeat ran before this GU
                const prevHypAndTestsForStepIi = heartbeatNo >= 2
                    ? hypothesisCount * (hypothesisItemTokens + profile.hypothesisTestOutput)
                    : 0;
                const slotStatusesTokens = strategyCount * 80;

                const stepIiDosInput =
                    profile.promptBase +
                    profile.harnessNoteTokens +
                    slotStatusesTokens +
                    profile.dosStepIOutput +
                    prevHypAndTestsForStepIi +
                    postUpdateBranchesTokens;
                totalInput += stepIiDosInput;
                totalOutput += profile.dosFullOutput;

                // Ending Heartbeat reuses Step-ii DOS output and runs Hypothesis G↔P + Testers
                runHeartbeatHypothesesAndTesters(heartbeatNo);
            }
            sinceHeartbeat = 0;
        }
    }

    return {
        input: Math.round(totalInput),
        output: Math.round(totalOutput),
    };
}

export function calculateDeepthinkTokenEstimate(args: DeepthinkTokenEstimateInput): DeepthinkTokenEstimate {
    const strategiesCount = clampInteger(args.strategiesCount, 1, MAX_DEEPTHINK_STRATEGIES);
    const strategyProximityLoops = clampInteger(args.strategyProximityLoops ?? 1, 0, MAX_STRATEGY_PROXIMITY_LOOPS);
    const hypothesisCount = clampInteger(args.hypothesisCount, 0, MAX_HYPOTHESIS_COUNT);
    const hypothesisProximityLoops = clampInteger(args.hypothesisProximityLoops ?? 1, 0, MAX_HYPOTHESIS_PROXIMITY_LOOPS);
    const depth = clampInteger(args.i ?? args.deepthinkDepth ?? 10, 1, MAX_DEEPTHINK_DEPTH);
    const i = depth;
    const j = clampInteger(args.j ?? 5, 3, 8);
    const k = clampInteger(args.k ?? 3, 2, j);
    const isolateBranches = args.isolateBranches === true;

    // Pre-sample biased Global Update decisions (70% CONTINUE/EVOLVE, 30% PRUNE)
    const maxUpdates = Math.floor(Math.max(0, i - 1) / j);
    const sampledDecisionsPerUpdate = Array.from({ length: maxUpdates }, () =>
        sampleGlobalUpdateDecisions(strategiesCount)
    );

    const averageSim = simulatePipelineTokens(
        AVERAGE_PROFILE,
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k,
        isolateBranches,
        sampledDecisionsPerUpdate
    );

    const worstSim = simulatePipelineTokens(
        WORST_PROFILE,
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k,
        isolateBranches,
        sampledDecisionsPerUpdate
    );

    const averageInput = averageSim.input;
    const worstInput = worstSim.input;
    const averageOutput = averageSim.output;
    const worstOutput = worstSim.output;

    const apiCalls = calculateDeepthinkApiCallsFromParams({
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k,
        codeExecutionEnabled: args.codeExecutionEnabled,
        deepthinkCodeExecutionEnabled: args.codeExecutionEnabled,
    } as any);

    // When sandbox code execution is enabled, every agent invocation runs a multi-turn tool loop
    // (12x to 36x calls), re-sending its prompt context on every turn plus accumulating tool trace tokens.
    const minMultiplier = args.codeExecutionEnabled ? (apiCalls.sandboxMultiplier?.min ?? 12) : 1;
    const maxMultiplier = args.codeExecutionEnabled ? (apiCalls.sandboxMultiplier?.max ?? 36) : 1;

    const sandboxInputAvg = args.codeExecutionEnabled && apiCalls.baseMin ? apiCalls.baseMin * SANDBOX_PER_CALL.input.average : 0;
    const sandboxInputWorst = args.codeExecutionEnabled && apiCalls.baseMax ? apiCalls.baseMax * SANDBOX_PER_CALL.input.worst : 0;
    const sandboxOutputAvg = args.codeExecutionEnabled && apiCalls.baseMin ? apiCalls.baseMin * SANDBOX_PER_CALL.output.average : 0;
    const sandboxOutputWorst = args.codeExecutionEnabled && apiCalls.baseMax ? apiCalls.baseMax * SANDBOX_PER_CALL.output.worst : 0;

    let sandboxIterationNoiseAvg = 0;
    let sandboxIterationNoiseWorst = 0;
    if (args.codeExecutionEnabled) {
        for (let iter = 1; iter <= i; iter++) {
            sandboxIterationNoiseAvg += getRandomSandboxIterationNoise();
            sandboxIterationNoiseWorst += getRandomSandboxIterationNoise();
        }
        if (sandboxIterationNoiseWorst < sandboxIterationNoiseAvg) {
            const temp = sandboxIterationNoiseAvg;
            sandboxIterationNoiseAvg = sandboxIterationNoiseWorst;
            sandboxIterationNoiseWorst = temp;
        }
    }

    const totalAverageInput = (averageInput * minMultiplier) + sandboxInputAvg + sandboxIterationNoiseAvg;
    const totalWorstInput = (worstInput * maxMultiplier) + sandboxInputWorst + sandboxIterationNoiseWorst;
    const totalAverageOutput = averageOutput + sandboxOutputAvg;
    const totalWorstOutput = worstOutput + sandboxOutputWorst;

    return {
        depth: i,
        strategiesCount,
        hypothesisCount,
        input: {
            average: totalAverageInput,
            worst: totalWorstInput,
        },
        output: {
            average: totalAverageOutput,
            worst: totalWorstOutput,
        },
        total: {
            average: totalAverageInput + totalAverageOutput,
            worst: totalWorstInput + totalWorstOutput,
        },
        apiCalls,
    };
}

export function buildDeepthinkTokenTrend(args: Omit<DeepthinkTokenEstimateInput, 'deepthinkDepth' | 'i'> & { maxDepth?: number }): DeepthinkTokenEstimate[] {
    const maxDepth = clampInteger(args.maxDepth ?? MAX_DEEPTHINK_DEPTH, 1, MAX_DEEPTHINK_DEPTH);
    return Array.from({ length: maxDepth }, (_, index) => calculateDeepthinkTokenEstimate({
        ...args,
        deepthinkDepth: index + 1,
        i: index + 1,
    }));
}
