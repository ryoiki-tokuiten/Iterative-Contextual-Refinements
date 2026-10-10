/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth (§5.2, §6.2, §6.3, §6.4, §6.5, §6.9).
 */

import type {
  BsrAction,
  BsrComputedScores,
  BsrEvent,
  BsrEventSize,
  BsrEvolveForm,
  BsrLedgerEntry,
  BsrReport,
  BsrWindowOutcome,
  DosBranchUtilization,
} from './types.ts';

// ============================================================================
// Constants (§6.3)
// ============================================================================

export const SIZE_WEIGHTS: Record<BsrEventSize, number> = {
  small: 1,
  medium: 2,
  large: 4,
};

/** Noise level tau: smallest net change called a trend (§6.3) */
export const TAU = 2;

/** Pressure floor theta: least pressure that can trigger EVOLVE or PRUNE (§6.3, §6.5) */
export const THETA = 0.3;

/** Probability floor for information-theoretic surprisal (§6.3, §6.4) */
export const PROBABILITY_FLOOR = 0.01;

/** log2(3) baseline bits for uniform guess over 3 outcomes (§6.4) */
export const LOG2_3 = Math.log2(3); // ≈ 1.584962500721156

export interface BsrConfigOptions {
  tau?: number;
  theta?: number;
  weights?: Record<BsrEventSize, number>;
}

// ============================================================================
// Pure BSR Calculations (§6.3, §6.4, §6.5)
// ============================================================================

export function clip(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface WindowScoringResult {
  net: number;
  movement: number;
  windowOutcome: BsrWindowOutcome;
  bestTotal: number;
  lastGoodIteration: number | 'window_start';
  lostGround: number;
  progressKept: number;
}

/**
 * Turns window events into running totals, net, movement, outcome, and ground metrics.
 * Follows §6.3 exactly.
 */
export function scoreWindow(
  windowStartIteration: number,
  windowEndIteration: number,
  progressEvents: BsrEvent[],
  regressionEvents: BsrEvent[],
  ledgerBeforeWindow: BsrLedgerEntry[],
  options?: { tau?: number; weights?: Record<BsrEventSize, number> }
): WindowScoringResult {
  const tau = options?.tau ?? TAU;
  const weights = options?.weights ?? SIZE_WEIGHTS;

  // Aggregate changes per iteration in the window
  const iterationChanges = new Map<number, number>();
  for (let it = windowStartIteration; it <= windowEndIteration; it++) {
    iterationChanges.set(it, 0);
  }

  let windowMovement = 0;

  for (const ev of progressEvents) {
    const w = weights[ev.size] ?? 1;
    const cur = iterationChanges.get(ev.iteration) ?? 0;
    iterationChanges.set(ev.iteration, cur + w);
    windowMovement += w;
  }

  for (const ev of regressionEvents) {
    const w = weights[ev.size] ?? 1;
    const cur = iterationChanges.get(ev.iteration) ?? 0;
    iterationChanges.set(ev.iteration, cur - w);
    windowMovement += w;
  }

  // Running total starts at 0 (representing window starting state)
  let currentTotal = 0;
  let bestTotal = 0;
  let lastGoodIteration: number | 'window_start' = 'window_start';

  for (let it = windowStartIteration; it <= windowEndIteration; it++) {
    const change = iterationChanges.get(it) ?? 0;
    currentTotal += change;
    if (currentTotal > 0 && currentTotal >= bestTotal) {
      bestTotal = currentTotal;
      lastGoodIteration = it;
    }
  }

  const net = currentTotal;

  // Window outcome
  let windowOutcome: BsrWindowOutcome = 'STALL';
  if (net >= tau) {
    windowOutcome = 'PROGRESS';
  } else if (net <= -tau) {
    windowOutcome = 'REGRESS';
  }

  // Lost ground: (best_total - net) / (movement + tau)
  const lostGround = windowMovement === 0 && bestTotal === 0
    ? 0
    : (bestTotal - net) / (windowMovement + tau);

  // Progress kept over the whole life of the branch ledger
  let netLife = 0;
  let movementLife = 0;
  for (const entry of ledgerBeforeWindow) {
    if (entry.direction === 'progress') {
      netLife += entry.weight;
    } else {
      netLife -= entry.weight;
    }
    movementLife += entry.weight;
  }
  netLife += net;
  movementLife += windowMovement;

  const progressKept = movementLife === 0
    ? 0
    : Math.max(0, netLife) / (movementLife + tau);

  return {
    net,
    movement: windowMovement,
    windowOutcome,
    bestTotal,
    lastGoodIteration,
    lostGround,
    progressKept,
  };
}

/**
 * Grades the previous prediction against the actual window outcome (§6.4).
 */
export function gradePrediction(
  previousPrediction: { PROGRESS: number; STALL: number; REGRESS: number } | null | undefined,
  windowOutcome: BsrWindowOutcome,
  newRawPrediction: { PROGRESS: number; STALL: number; REGRESS: number }
): {
  surprisalBits: number | null;
  credibility: number;
  effectivePrediction: { PROGRESS: number; STALL: number; REGRESS: number };
} {
  if (!previousPrediction) {
    // With no graded prediction, credibility is 1.0 (§6.4)
    return {
      surprisalBits: null,
      credibility: 1.0,
      effectivePrediction: { ...newRawPrediction },
    };
  }

  const pObserved = Math.max(previousPrediction[windowOutcome] ?? 0.333, PROBABILITY_FLOOR);
  const surprisalBits = -Math.log2(pObserved);

  // credibility = clip(2 - surprisal / log2(3), 0, 1)
  const credibility = clip(2 - surprisalBits / LOG2_3, 0, 1);

  // effective_prediction = credibility * P + (1 - credibility) * (1/3, 1/3, 1/3)
  const uniform = 1 / 3;
  const effectivePrediction = {
    PROGRESS: credibility * newRawPrediction.PROGRESS + (1 - credibility) * uniform,
    STALL: credibility * newRawPrediction.STALL + (1 - credibility) * uniform,
    REGRESS: credibility * newRawPrediction.REGRESS + (1 - credibility) * uniform,
  };

  return {
    surprisalBits,
    credibility,
    effectivePrediction,
  };
}

/**
 * Computes expected drift, entropy, certainty, and stall evidence from effective prediction (§6.5).
 */
export function computeForecastQuantities(
  effectivePrediction: { PROGRESS: number; STALL: number; REGRESS: number },
  critiqueAlignmentValue: number
): {
  expectedDrift: number;
  certainty: number;
  stallEvidence: number;
} {
  const expectedDrift = effectivePrediction.PROGRESS - effectivePrediction.REGRESS;

  // Shannon entropy with base 2 (0 * log(0) = 0)
  const entropy = [effectivePrediction.PROGRESS, effectivePrediction.STALL, effectivePrediction.REGRESS]
    .reduce((acc, p) => (p > 0 ? acc - p * Math.log2(p) : acc), 0);

  const certainty = Math.max(0, 1 - entropy / LOG2_3);

  // stall_evidence = certainty * (1 - effective[PROGRESS]) * max(0, critique_alignment)
  const stallEvidence = certainty * (1 - effectivePrediction.PROGRESS) * Math.max(0, critiqueAlignmentValue);

  return {
    expectedDrift,
    certainty,
    stallEvidence,
  };
}

/**
 * Computes action pressures for CONTINUE, EVOLVE, PRUNE (§6.5).
 */
export function computePressures(
  expectedDrift: number,
  lostGround: number,
  progressKept: number,
  stallEvidence: number
): {
  CONTINUE: number;
  EVOLVE: number;
  PRUNE: number;
} {
  const pContinue = Math.max(0, expectedDrift);
  const pEvolve = Math.max(lostGround, stallEvidence * progressKept);
  const pPrune = stallEvidence * (1 - progressKept) * (1 - lostGround);

  return {
    CONTINUE: pContinue,
    EVOLVE: pEvolve,
    PRUNE: pPrune,
  };
}

/**
 * Selects deterministic action and EVOLVE form (§6.5).
 */
export function decideAction(
  pressures: { CONTINUE: number; EVOLVE: number; PRUNE: number },
  lostGround: number,
  stallEvidence: number,
  progressKept: number,
  lastGoodIteration: number | 'window_start',
  options?: { theta?: number }
): {
  decision: BsrAction;
  form?: BsrEvolveForm;
  rollbackTo?: number | 'window_start';
} {
  const theta = options?.theta ?? THETA;
  let decision: BsrAction = 'CONTINUE';

  if (pressures.EVOLVE < theta && pressures.PRUNE < theta) {
    decision = 'CONTINUE';
  } else if (pressures.CONTINUE >= Math.max(pressures.EVOLVE, pressures.PRUNE)) {
    decision = 'CONTINUE';
  } else if (pressures.EVOLVE >= pressures.PRUNE) {
    decision = 'EVOLVE';
  } else {
    decision = 'PRUNE';
  }

  if (decision === 'EVOLVE') {
    // Rollback to last_good_iteration when lost_ground > stall_evidence * progress_kept (§6.5)
    const isRollback = lostGround > stallEvidence * progressKept;
    if (isRollback) {
      return {
        decision: 'EVOLVE',
        form: 'rollback',
        rollbackTo: lastGoodIteration,
      };
    }
    return {
      decision: 'EVOLVE',
      form: 'in_place',
    };
  }

  return { decision };
}

/**
 * Computes calibration metrics (log loss) for all graded predictions in the run (§6.4).
 * Baseline is uniform guess (log2(3) ≈ 1.585 bits).
 */
export function computeCalibrationMetrics(
  bsrRecords: Array<{ branch_id: string; computed: BsrComputedScores }>
): {
  meanSurprisal: number;
  baselineBits: number;
  isInformative: boolean;
  branchMetrics: Record<string, { count: number; meanSurprisal: number; isInformative: boolean }>;
} {
  const graded = bsrRecords.filter(r => r.computed.surprisal_bits !== null);
  const totalCount = graded.length;
  const baselineBits = LOG2_3;

  if (totalCount === 0) {
    return {
      meanSurprisal: baselineBits,
      baselineBits,
      isInformative: false,
      branchMetrics: {},
    };
  }

  const sumSurprisal = graded.reduce((acc, r) => acc + (r.computed.surprisal_bits ?? 0), 0);
  const meanSurprisal = sumSurprisal / totalCount;
  const isInformative = meanSurprisal < baselineBits;

  const branchMetrics: Record<string, { count: number; meanSurprisal: number; isInformative: boolean }> = {};
  for (const r of graded) {
    if (!branchMetrics[r.branch_id]) {
      branchMetrics[r.branch_id] = { count: 0, meanSurprisal: 0, isInformative: false };
    }
    branchMetrics[r.branch_id].count++;
    branchMetrics[r.branch_id].meanSurprisal += r.computed.surprisal_bits ?? 0;
  }

  for (const bId of Object.keys(branchMetrics)) {
    const b = branchMetrics[bId];
    b.meanSurprisal = b.meanSurprisal / b.count;
    b.isInformative = b.meanSurprisal < baselineBits;
  }

  return {
    meanSurprisal,
    baselineBits,
    isInformative,
    branchMetrics,
  };
}

/**
 * Master function computing full BSR analysis for one branch at a global update.
 */
export function evaluateBranchState(
  report: BsrReport,
  windowStartIteration: number,
  windowEndIteration: number,
  ledgerBeforeWindow: BsrLedgerEntry[],
  previousPrediction: { PROGRESS: number; STALL: number; REGRESS: number } | null | undefined,
  options?: BsrConfigOptions
): BsrComputedScores {
  const scoring = scoreWindow(
    windowStartIteration,
    windowEndIteration,
    report.confirmed_progress,
    report.confirmed_regression,
    ledgerBeforeWindow,
    { tau: options?.tau, weights: options?.weights }
  );

  const graded = gradePrediction(
    previousPrediction,
    scoring.windowOutcome,
    report.next_window_prediction.probabilities
  );

  const forecast = computeForecastQuantities(
    graded.effectivePrediction,
    report.critique_alignment.value
  );

  const pressures = computePressures(
    forecast.expectedDrift,
    scoring.lostGround,
    scoring.progressKept,
    forecast.stallEvidence
  );

  const actionDecision = decideAction(
    pressures,
    scoring.lostGround,
    forecast.stallEvidence,
    scoring.progressKept,
    scoring.lastGoodIteration,
    { theta: options?.theta }
  );

  return {
    net: scoring.net,
    movement: scoring.movement,
    window_outcome: scoring.windowOutcome,
    last_good_iteration: scoring.lastGoodIteration,
    lost_ground: scoring.lostGround,
    progress_kept: scoring.progressKept,
    surprisal_bits: graded.surprisalBits,
    credibility: graded.credibility,
    effective_prediction: graded.effectivePrediction,
    expected_drift: forecast.expectedDrift,
    certainty: forecast.certainty,
    stall_evidence: forecast.stallEvidence,
    pressure: pressures,
    decision: actionDecision.decision,
    form: actionDecision.form,
    rollback_to: actionDecision.rollbackTo,
  };
}

// ============================================================================
// DOS Hypothesis Feedback Calculations (§5.2)
// ============================================================================

export function calculateSurpriseBits(
  predictedProbabilities: { VALIDATED: number; REJECTED: number; INCONCLUSIVE: number },
  observedVerdict: 'VALIDATED' | 'REJECTED' | 'INCONCLUSIVE'
): number {
  const p = Math.max(predictedProbabilities[observedVerdict] ?? 0.333, PROBABILITY_FLOOR);
  const bits = -Math.log2(p);
  return bits === 0 ? 0 : bits;
}

export function calculateUtilizationVector(
  branchUtilizations: DosBranchUtilization[]
): {
  correct_use: number;
  partial_use: number;
  not_used: number;
  misused: number;
} | undefined {
  let c = 0;
  let p = 0;
  let n = 0;
  let m = 0;

  for (const bu of branchUtilizations) {
    switch (bu.utilization.classification) {
      case 'USED_CORRECTLY':
        c++;
        break;
      case 'USED_PARTIALLY':
        p++;
        break;
      case 'NOT_USED':
        n++;
        break;
      case 'MISUSED':
        m++;
        break;
    }
  }

  const total = c + p + n + m;
  if (total === 0) return undefined;

  return {
    correct_use: c / total,
    partial_use: p / total,
    not_used: n / total,
    misused: m / total,
  };
}
