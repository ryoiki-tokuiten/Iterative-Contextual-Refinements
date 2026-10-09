/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive End-to-End Specification Verification Suite for Deepthink Mode.
 * Source of truth: Deepthink_Consolidated_Specification.md
 *
 * Verifies all programmatic, mathematical, and orchestration mechanics:
 * 1. Specification §6.9 Worked Mathematical Examples (Example 1, Example 2, Example 3)
 * 2. Information theory, surprisal, credibility, and hypothesis utilization formulas (§5.2, §6.4)
 * 3. Loop controller schedules, barriers, gap rules, and bounds validation (§2, §3)
 * 4. Real-time shared workspace tool isolation and concurrent editing (§8.3, §8.4)
 * 5. Complete end-to-end DeepthinkPipelineOrchestrator execution with REALISTIC model outputs
 *    (simulating markdown code blocks, conversational preambles, and relaxed formatting),
 *    verifying durable repository files, branch state representations, barrier commits,
 *    prune archiving, rollback execution, and final judge constraints (§1-§9).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  scoreWindow,
  gradePrediction,
  computeForecastQuantities,
  computePressures,
  decideAction,
  computeCalibrationMetrics,
  calculateSurpriseBits,
  calculateUtilizationVector,
  PROBABILITY_FLOOR,
  LOG2_3,
} from '../core/formulas.ts';

import {
  validateLoopBounds,
  determinePostIterationStep,
} from '../core/loopController.ts';

import {
  SharedWorkspaceManager,
} from '../core/sharedWorkspace.ts';

import {
  DeepthinkPipelineOrchestrator,
} from '../core/pipelineOrchestrator.ts';
import { extractJsonString } from '../../Core/JsonParser.ts';

import type {
  BsrEvent,
  BsrLedgerEntry,
  DeepthinkLiveEvent,
  DeepthinkPipelineState,
  DosBranchUtilization,
} from '../core/types.ts';
import type { DeepthinkAgentKind } from '../core/agentRegistry.ts';

// Helper to simulate realistic LLM output wrapped in markdown code blocks and conversational text
function wrapInRealisticLLMFence(payload: unknown, preamble = 'Here is the requested output:'): string {
  return `${preamble}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\nHope this is helpful!`;
}

// ============================================================================
// SUITE 1: Specification §6.9 Mathematical Worked Examples
// ============================================================================

describe('Deepthink Consolidated Specification §6.9: Mathematical Worked Examples', () => {

  it('Example 1: Healthy branch produces PROGRESS, lost_ground = 0, and CONTINUE decision', () => {
    // Window: iterations 6 to 10
    // Events: it6 progress medium (2), it8 progress large (4), it9 regression small (-1), it10 progress small (1)
    const progressEvents: BsrEvent[] = [
      { iteration: 6, size: 'medium', reason: 'Resolved sub-lemma' },
      { iteration: 8, size: 'large', reason: 'Decisive breakthrough on main term' },
      { iteration: 10, size: 'small', reason: 'Notation and boundary cleanup' },
    ];
    const regressionEvents: BsrEvent[] = [
      { iteration: 9, size: 'small', reason: 'Minor sign flip in index' },
    ];

    // Ledger before window: net 6, movement 8
    const ledgerBefore: BsrLedgerEntry[] = [
      { iteration: 2, direction: 'progress', size: 'large', weight: 4, reason: 'Setup' },
      { iteration: 3, direction: 'progress', size: 'medium', weight: 2, reason: 'Bound' },
      { iteration: 4, direction: 'regression', size: 'small', weight: 1, reason: 'Oversight' },
      { iteration: 5, direction: 'progress', size: 'small', weight: 1, reason: 'Fix' },
    ];

    const windowScoring = scoreWindow(6, 10, progressEvents, regressionEvents, ledgerBefore);

    // 1. Running totals: +2, 0, +4, -1, +1 => totals: 2, 2, 6, 5, 6
    assert.equal(windowScoring.net, 6, 'Net change should equal 6');
    assert.equal(windowScoring.movement, 8, 'Total movement should equal 8');
    assert.equal(windowScoring.windowOutcome, 'PROGRESS', 'net >= 2 so windowOutcome is PROGRESS');
    assert.equal(windowScoring.bestTotal, 6, 'Best total reached is 6');
    assert.equal(windowScoring.lastGoodIteration, 10, 'Last good iteration is 10');

    // 2. Lost ground: (6 - 6) / (8 + 2) = 0
    assert.equal(windowScoring.lostGround, 0, 'Lost ground must be 0');

    // 3. Progress kept: net_life = 6 + 6 = 12, movement_life = 8 + 8 = 16 => 12 / (16 + 2) = 12/18 = 0.667
    assert.ok(Math.abs(windowScoring.progressKept - (12 / 18)) < 1e-4, 'Progress kept should be 12/18 ≈ 0.667');

    // 4. Grade prediction: prior gave PROGRESS 0.55 => surprisal = -log2(0.55) ≈ 0.8625 bits < 1.585 => credibility = 1
    const newPrediction = { PROGRESS: 0.45, STALL: 0.40, REGRESS: 0.15 };
    const priorPrediction = { PROGRESS: 0.55, STALL: 0.30, REGRESS: 0.15 };
    const graded = gradePrediction(priorPrediction, windowScoring.windowOutcome, newPrediction);

    assert.ok(Math.abs(graded.surprisalBits! - (-Math.log2(0.55))) < 1e-4, 'Surprisal bits should be -log2(0.55)');
    assert.equal(graded.credibility, 1.0, 'Credibility must be 1.0 since surprisal < 1.585');
    assert.deepEqual(graded.effectivePrediction, newPrediction, 'Effective prediction equals new prediction');

    // 5. Forecast quantities: expected_drift = 0.45 - 0.15 = +0.30
    const forecast = computeForecastQuantities(graded.effectivePrediction, 0.8);
    assert.ok(Math.abs(forecast.expectedDrift - 0.30) < 1e-4, 'Expected drift should be +0.30');
    assert.ok(Math.abs(forecast.certainty - 0.080) < 0.005, 'Certainty should be ≈ 0.080');
    assert.ok(Math.abs(forecast.stallEvidence - 0.035) < 0.005, 'Stall evidence should be ≈ 0.035');

    // 6. Pressures: CONTINUE = 0.30, EVOLVE = max(0, 0.035 * 0.667) = 0.023, PRUNE = 0.035 * (1 - 0.667) * 1 = 0.012
    const pressures = computePressures(forecast.expectedDrift, windowScoring.lostGround, windowScoring.progressKept, forecast.stallEvidence);
    assert.ok(Math.abs(pressures.CONTINUE - 0.30) < 1e-4, 'CONTINUE pressure should be 0.30');
    assert.ok(Math.abs(pressures.EVOLVE - 0.023) < 0.005, 'EVOLVE pressure should be ≈ 0.023');
    assert.ok(Math.abs(pressures.PRUNE - 0.012) < 0.005, 'PRUNE pressure should be ≈ 0.012');

    // 7. Decision: Both EVOLVE and PRUNE are far below theta (0.3) => CONTINUE
    const decisionResult = decideAction(pressures, windowScoring.lostGround, forecast.stallEvidence, windowScoring.progressKept, windowScoring.lastGoodIteration);
    assert.equal(decisionResult.decision, 'CONTINUE', 'Decision must be CONTINUE');
  });

  it('Example 2: Oscillating branch produces REGRESS, high lost_ground, and EVOLVE with rollback', () => {
    // Window: iterations 6 to 10
    // Events: it6 progress large (4), it7 progress small (1), it9 regression large (-4), it10 regression large (-4)
    const progressEvents: BsrEvent[] = [
      { iteration: 6, size: 'large', reason: 'Promising hypothesis exploration' },
      { iteration: 7, size: 'small', reason: 'Incremental bound tightening' },
    ];
    const regressionEvents: BsrEvent[] = [
      { iteration: 9, size: 'large', reason: 'Fatal counterexample encountered' },
      { iteration: 10, size: 'large', reason: 'Cascading contradiction throughout derivation' },
    ];

    // Ledger before window: net 6, movement 8
    const ledgerBefore: BsrLedgerEntry[] = [
      { iteration: 2, direction: 'progress', size: 'large', weight: 4, reason: 'Initial foundation' },
      { iteration: 3, direction: 'progress', size: 'medium', weight: 2, reason: 'Structure' },
      { iteration: 4, direction: 'regression', size: 'small', weight: 1, reason: 'Correction' },
      { iteration: 5, direction: 'progress', size: 'small', weight: 1, reason: 'Recovery' },
    ];

    const windowScoring = scoreWindow(6, 10, progressEvents, regressionEvents, ledgerBefore);

    // 1. Running totals: +4, +1, 0, -4, -4 => totals: 4, 5, 5, 1, -3
    assert.equal(windowScoring.net, -3, 'Net change should equal -3');
    assert.equal(windowScoring.movement, 13, 'Total movement should equal 4+1+4+4 = 13');
    assert.equal(windowScoring.windowOutcome, 'REGRESS', 'net <= -2 so windowOutcome is REGRESS');
    assert.equal(windowScoring.bestTotal, 5, 'Best total reached is 5');
    assert.equal(windowScoring.lastGoodIteration, 8, 'Last good iteration is 8 (maintained through iteration 8)');

    // 2. Lost ground: (5 - (-3)) / (13 + 2) = 8 / 15 = 0.533
    assert.ok(Math.abs(windowScoring.lostGround - (8 / 15)) < 1e-4, 'Lost ground must be 8/15 ≈ 0.533');

    // 3. Progress kept: net_life = 6 - 3 = 3, movement_life = 8 + 13 = 21 => 3 / (21 + 2) = 3/23 ≈ 0.130
    assert.ok(Math.abs(windowScoring.progressKept - (3 / 23)) < 1e-4, 'Progress kept should be 3/23 ≈ 0.130');

    // 4. Grade: prior gave REGRESS 0.20 => surprisal = -log2(0.20) ≈ 2.3219 bits
    const newPrediction = { PROGRESS: 0.10, STALL: 0.20, REGRESS: 0.70 };
    const priorPrediction = { PROGRESS: 0.50, STALL: 0.30, REGRESS: 0.20 };
    const graded = gradePrediction(priorPrediction, windowScoring.windowOutcome, newPrediction);

    assert.ok(Math.abs(graded.surprisalBits! - 2.3219) < 0.005, 'Surprisal should be ≈ 2.32 bits');
    // credibility = clip(2 - 2.3219 / 1.585, 0, 1) = 2 - 1.4649 = 0.535
    assert.ok(Math.abs(graded.credibility - 0.535) < 0.005, 'Credibility should be ≈ 0.535');

    // Effective prediction: 0.535 * (0.10, 0.20, 0.70) + 0.465 * (1/3, 1/3, 1/3)
    // PROGRESS: 0.0535 + 0.1550 = 0.2085 ≈ 0.209
    // STALL: 0.1070 + 0.1550 = 0.2620 ≈ 0.262
    // REGRESS: 0.3745 + 0.1550 = 0.5295 ≈ 0.530
    assert.ok(Math.abs(graded.effectivePrediction.PROGRESS - 0.209) < 0.005);
    assert.ok(Math.abs(graded.effectivePrediction.STALL - 0.262) < 0.005);
    assert.ok(Math.abs(graded.effectivePrediction.REGRESS - 0.530) < 0.005);

    // 5. Forecast quantities: expected_drift = 0.209 - 0.530 = -0.321
    const forecast = computeForecastQuantities(graded.effectivePrediction, 0.6);
    assert.ok(Math.abs(forecast.expectedDrift - (-0.321)) < 0.005, 'Expected drift should be ≈ -0.321');
    assert.ok(Math.abs(forecast.certainty - 0.077) < 0.005, 'Certainty should be ≈ 0.077');
    assert.ok(Math.abs(forecast.stallEvidence - 0.036) < 0.005, 'Stall evidence should be ≈ 0.036');

    // 6. Pressures: CONTINUE = 0, EVOLVE = max(0.533, 0.036 * 0.130) = 0.533, PRUNE = 0.036 * (1 - 0.130) * (1 - 0.533) = 0.015
    const pressures = computePressures(forecast.expectedDrift, windowScoring.lostGround, windowScoring.progressKept, forecast.stallEvidence);
    assert.equal(pressures.CONTINUE, 0.0, 'CONTINUE pressure must be 0');
    assert.ok(Math.abs(pressures.EVOLVE - 0.533) < 0.005, 'EVOLVE pressure should be ≈ 0.533');
    assert.ok(Math.abs(pressures.PRUNE - 0.015) < 0.005, 'PRUNE pressure should be ≈ 0.015');

    // 7. Decision: EVOLVE clears theta (0.3) and beats PRUNE. lost_ground > stall_evidence * progress_kept => rollback to 8
    const decisionResult = decideAction(pressures, windowScoring.lostGround, forecast.stallEvidence, windowScoring.progressKept, windowScoring.lastGoodIteration);
    assert.equal(decisionResult.decision, 'EVOLVE', 'Decision must be EVOLVE');
    assert.equal(decisionResult.form, 'rollback', 'Form must be rollback');
    assert.equal(decisionResult.rollbackTo, 8, 'Rollback target must be iteration 8');
  });

  it('Example 3: Stalled branches distinguish EVOLVE in place (saturated) vs PRUNE (failed)', () => {
    // Shared setup for main3 and main4:
    // Events: it6 progress small (1), it8 regression small (-1), it10 progress small (1)
    const progressEvents: BsrEvent[] = [
      { iteration: 6, size: 'small', reason: 'Tweak' },
      { iteration: 10, size: 'small', reason: 'Tweak 2' },
    ];
    const regressionEvents: BsrEvent[] = [
      { iteration: 8, size: 'small', reason: 'Minor slip' },
    ];

    // Shared window totals: changes +1, 0, -1, 0, +1 => totals: 1, 1, 0, 0, 1. net = 1 => STALL. movement = 3
    const newPrediction = { PROGRESS: 0.05, STALL: 0.85, REGRESS: 0.10 };
    const priorPrediction = { PROGRESS: 0.25, STALL: 0.60, REGRESS: 0.15 };
    const graded = gradePrediction(priorPrediction, 'STALL', newPrediction);
    assert.equal(graded.credibility, 1.0, 'Credibility must be 1.0');

    const forecast = computeForecastQuantities(graded.effectivePrediction, 0.9);
    assert.ok(Math.abs(forecast.certainty - 0.528) < 0.005, 'Certainty should be ≈ 0.528');
    assert.ok(Math.abs(forecast.stallEvidence - 0.452) < 0.005, 'Stall evidence should be ≈ 0.452');

    // Branch main3: High progress standing (net_life = 15, movement_life = 17 => progress_kept = 15/19 ≈ 0.789)
    const ledgerMain3: BsrLedgerEntry[] = [
      { iteration: 2, direction: 'progress', size: 'large', weight: 4, reason: 'P1' },
      { iteration: 3, direction: 'progress', size: 'large', weight: 4, reason: 'P2' },
      { iteration: 4, direction: 'progress', size: 'large', weight: 4, reason: 'P3' },
      { iteration: 5, direction: 'progress', size: 'medium', weight: 2, reason: 'P4' },
    ];
    const scoringMain3 = scoreWindow(6, 10, progressEvents, regressionEvents, ledgerMain3);
    assert.ok(Math.abs(scoringMain3.progressKept - (15 / 19)) < 1e-4);

    const pressuresMain3 = computePressures(forecast.expectedDrift, scoringMain3.lostGround, scoringMain3.progressKept, forecast.stallEvidence);
    // EVOLVE = max(0, 0.452 * 0.789) = 0.357
    // PRUNE = 0.452 * (1 - 0.789) * (1 - 0) = 0.095
    assert.ok(Math.abs(pressuresMain3.EVOLVE - 0.357) < 0.005);
    assert.ok(Math.abs(pressuresMain3.PRUNE - 0.095) < 0.005);
    const decisionMain3 = decideAction(pressuresMain3, scoringMain3.lostGround, forecast.stallEvidence, scoringMain3.progressKept, scoringMain3.lastGoodIteration);
    assert.equal(decisionMain3.decision, 'EVOLVE', 'main3 must be EVOLVE');
    assert.equal(decisionMain3.form, 'in_place', 'main3 form must be in_place (saturation re-aim)');

    // Branch main4: Failed branch with near-zero progress (net_life = 1, movement_life = 7 => progress_kept = 1/9 ≈ 0.111)
    const ledgerMain4: BsrLedgerEntry[] = [
      { iteration: 2, direction: 'progress', size: 'small', weight: 1, reason: 'P1' },
      { iteration: 3, direction: 'regression', size: 'small', weight: 1, reason: 'R1' },
      { iteration: 4, direction: 'progress', size: 'small', weight: 1, reason: 'P2' },
      { iteration: 5, direction: 'regression', size: 'small', weight: 1, reason: 'R2' },
    ];
    const scoringMain4 = scoreWindow(6, 10, progressEvents, regressionEvents, ledgerMain4);
    assert.ok(Math.abs(scoringMain4.progressKept - (1 / 9)) < 1e-4);

    const pressuresMain4 = computePressures(forecast.expectedDrift, scoringMain4.lostGround, scoringMain4.progressKept, forecast.stallEvidence);
    // EVOLVE = max(0, 0.452 * 0.111) = 0.050
    // PRUNE = 0.452 * (1 - 0.111) * 1 = 0.402
    assert.ok(Math.abs(pressuresMain4.EVOLVE - 0.050) < 0.005);
    assert.ok(Math.abs(pressuresMain4.PRUNE - 0.402) < 0.005);
    const decisionMain4 = decideAction(pressuresMain4, scoringMain4.lostGround, forecast.stallEvidence, scoringMain4.progressKept, scoringMain4.lastGoodIteration);
    assert.equal(decisionMain4.decision, 'PRUNE', 'main4 must be PRUNE (failure exhaustion)');
  });
});

// ============================================================================
// SUITE 2: Information Theory Formulas & Hypothesis Feedback (§5.2, §6.4)
// ============================================================================

describe('Deepthink Consolidated Specification §5.2 & §6.4: Information Theory Formulas', () => {

  it('calculates surprisal bits with floor protection and baseline calibration', () => {
    // 1. Uniform baseline guess (1/3) gives log2(3) ≈ 1.58496 bits
    const surpriseUniform = calculateSurpriseBits({ VALIDATED: 1 / 3, REJECTED: 1 / 3, INCONCLUSIVE: 1 / 3 }, 'VALIDATED');
    assert.ok(Math.abs(surpriseUniform - LOG2_3) < 1e-4, 'Uniform guess should produce log2(3) bits');

    // 2. Certain prediction (P = 1.0) produces 0 surprisal bits
    const surpriseCertain = calculateSurpriseBits({ VALIDATED: 1.0, REJECTED: 0.0, INCONCLUSIVE: 0.0 }, 'VALIDATED');
    assert.equal(surpriseCertain, 0.0, 'Certain observed event yields 0 surprisal');

    // 3. Stated 0.0 outcome is clamped to PROBABILITY_FLOOR (0.01) => -log2(0.01) ≈ 6.6438 bits (§6.4)
    const surpriseZero = calculateSurpriseBits({ VALIDATED: 0.0, REJECTED: 0.8, INCONCLUSIVE: 0.2 }, 'VALIDATED');
    assert.ok(Math.abs(surpriseZero - (-Math.log2(PROBABILITY_FLOOR))) < 1e-4, 'Zero probability must be clamped to floor');
  });

  it('computes utilization vector U(h) = [C/T, P/T, N/T, M/T] without collapsing', () => {
    const feedbackAssignments: DosBranchUtilization[] = [
      { branch_id: 'main1', utilization: { classification: 'USED_CORRECTLY', reason: 'Direct application' } },
      { branch_id: 'main2', utilization: { classification: 'USED_PARTIALLY', reason: 'Used auxiliary bound' } },
      { branch_id: 'main3', utilization: { classification: 'NOT_USED', reason: 'Ignored entirely' } },
      { branch_id: 'main4', utilization: { classification: 'USED_CORRECTLY', reason: 'Verified in solution' } },
    ];

    const u = calculateUtilizationVector(feedbackAssignments);
    assert.ok(u !== undefined, 'Utilization vector must be generated');
    assert.equal(u!.correct_use, 0.50, '2/4 = 0.50 correct_use');
    assert.equal(u!.partial_use, 0.25, '1/4 = 0.25 partial_use');
    assert.equal(u!.not_used, 0.25, '1/4 = 0.25 not_used');
    assert.equal(u!.misused, 0.00, '0/4 = 0.00 misused');
  });

  it('computes log-loss calibration metrics across graded predictions (§6.4)', () => {
    const bsrRecords = [
      { branch_id: 'main1', computed: { surprisal_bits: 1.2 } as any },
      { branch_id: 'main2', computed: { surprisal_bits: 1.4 } as any },
      { branch_id: 'main3', computed: { surprisal_bits: 0.9 } as any },
    ];
    const metrics = computeCalibrationMetrics(bsrRecords);
    assert.equal(Object.keys(metrics.branchMetrics).length, 3);
    assert.ok(Math.abs(metrics.meanSurprisal - ((1.2 + 1.4 + 0.9) / 3)) < 1e-4);
    assert.ok(metrics.isInformative, 'Mean surprisal below 1.585 indicates informative forecasting');
  });
});

// ============================================================================
// SUITE 3: Loop Schedules, Barriers, and Gap Calculations (§2, §3)
// ============================================================================

describe('Deepthink Consolidated Specification §2 & §3: Loop Schedules & Barriers', () => {

  it('enforces inclusive loop parameter bounds 5 <= i <= 20, 3 <= j <= 8, 2 <= k <= j (§2)', () => {
    assert.equal(validateLoopBounds(10, 5, 3).valid, true);
    assert.equal(validateLoopBounds(4, 5, 3).valid, false, 'i < 5 must fail');
    assert.equal(validateLoopBounds(21, 5, 3).valid, false, 'i > 20 must fail');
    assert.equal(validateLoopBounds(10, 2, 2).valid, false, 'j < 3 must fail');
    assert.equal(validateLoopBounds(10, 9, 3).valid, false, 'j > 8 must fail');
    assert.equal(validateLoopBounds(10, 5, 1).valid, false, 'k < 2 must fail');
    assert.equal(validateLoopBounds(10, 5, 6).valid, false, 'k > j must fail');
  });

  it('matches worked schedule example: i = 15, j = 5, k = 3 (§3 table)', () => {
    const config = { i: 15, j: 5, k: 3 };
    let sinceHeartbeat = 0;
    const scheduleTrace: Array<{ it: number; step: string; sinceAfter: number }> = [];

    for (let it = 1; it <= config.i; it++) {
      const step = determinePostIterationStep(it, sinceHeartbeat, config.i, config.j, config.k, true);
      if (step.action.type === 'FINAL_JUDGE') {
        scheduleTrace.push({ it, step: 'final_judge', sinceAfter: step.nextSinceHeartbeat });
      } else if (step.action.type === 'GLOBAL_UPDATE') {
        sinceHeartbeat = 0;
        scheduleTrace.push({ it, step: 'global_update', sinceAfter: step.nextSinceHeartbeat });
      } else if (step.action.type === 'HEARTBEAT') {
        sinceHeartbeat = 0;
        scheduleTrace.push({ it, step: 'heartbeat', sinceAfter: step.nextSinceHeartbeat });
      } else {
        sinceHeartbeat = step.nextSinceHeartbeat;
        scheduleTrace.push({ it, step: 'none', sinceAfter: step.nextSinceHeartbeat });
      }
    }

    assert.equal(scheduleTrace[2].step, 'heartbeat', 'Iteration 3 runs heartbeat');
    assert.equal(scheduleTrace[2].sinceAfter, 0);

    assert.equal(scheduleTrace[4].step, 'global_update', 'Iteration 5 runs global update');
    assert.equal(scheduleTrace[4].sinceAfter, 0);

    assert.equal(scheduleTrace[7].step, 'heartbeat', 'Iteration 8 runs heartbeat');
    assert.equal(scheduleTrace[7].sinceAfter, 0);

    assert.equal(scheduleTrace[9].step, 'global_update', 'Iteration 10 runs global update');
    assert.equal(scheduleTrace[9].sinceAfter, 0);

    assert.equal(scheduleTrace[12].step, 'heartbeat', 'Iteration 13 runs heartbeat');
    assert.equal(scheduleTrace[12].sinceAfter, 0);

    assert.equal(scheduleTrace[14].step, 'final_judge', 'Iteration 15 stops for final judge (no critique, no heartbeat)');
  });

  it('skips heartbeat when G - n < 2 (skip example: i = 14, j = 6, k = 5) (§3)', () => {
    // After iteration 5, since_heartbeat reaches 5 (k = 5). Next global update is iteration 6 (G = 6).
    // G - n = 6 - 5 = 1 < 2 => heartbeat_due(5) is false.
    const step = determinePostIterationStep(5, 4, 14, 6, 5, true);
    assert.equal(step.action.type, 'NONE', 'Heartbeat after iteration 5 must be skipped because G - n < 2');
  });
});

// ============================================================================
// SUITE 4: Shared Workspace Tool & Real-Time Isolation (§8.3, §8.4)
// ============================================================================

describe('Deepthink Consolidated Specification §8.3 & §8.4: Shared Workspace Concurrency', () => {

  it('supports real-time concurrent reads and writes with tool interface', async () => {
    const workspace = new SharedWorkspaceManager();
    await workspace.write('# Initial Workspace Setup\n');

    // Simulate concurrent agent contributions
    await Promise.all([
      workspace.handleToolCall({ action: 'append', content: 'Agent 1: Verified convex hull constraint.\n' }),
      workspace.handleToolCall({ action: 'append', content: 'Agent 2: Checked boundary condition.\n' }),
      workspace.handleToolCall({ action: 'append', content: 'Agent 3: Contact graph has 3 mutual tangencies.\n' }),
    ]);

    const readResult = await workspace.handleToolCall({ action: 'read' });
    assert.ok(readResult.includes('Agent 1'));
    assert.ok(readResult.includes('Agent 2'));
    assert.ok(readResult.includes('Agent 3'));

    // Overwrite works cleanly
    await workspace.handleToolCall({ action: 'write', content: '# Final Clean Workspace\n' });
    const finalResult = await workspace.read();
    assert.equal(finalResult, '# Final Clean Workspace\n');
  });
});

// ============================================================================
// SUITE 5: Full DeepthinkPipelineOrchestrator End-to-End Execution (§1-§9)
// ============================================================================

describe('Deepthink Consolidated Specification: Complete End-to-End Pipeline Orchestration', () => {

  it('runs full 6-iteration pipeline with realistic fenced model outputs, barrier commits, and durable git artifacts', async () => {
    // Pipeline configuration:
    // i = 6 total iterations
    // j = 3 iterations per global update (update at iteration 3)
    // k = 2 iterations between curated context heartbeats
    // 3 strategies (main1, main2, main3)
    const testChallenge = 'Solve the extremal configuration for the 3-circle packing problem in an equilateral triangle.';

    const state: DeepthinkPipelineState = {
      id: 'spec-test-pipeline-e2e',
      challenge: testChallenge,
      status: 'idle',
      activeTabId: 'live',
      runConfig: {
        i: 6,
        j: 3,
        k: 2,
        strategiesCount: 3,
        strategyProximityLoops: 2,
        hypothesisCount: 2,
        hypothesisProximityLoops: 1,
        disableSolutionPool: false,
        isolateBranches: false,
        deepthinkCodeExecutionEnabled: false,
        thinkingLevel: 'high',
        model: 'gemini-2.5-pro',
      } as any,
      initialStrategies: [],
      strategyGenerationHistory: [],
      strategyProximityHistory: [],
      hypothesisGenerationHistory: [],
      hypotheses: [],
      hypothesisHistory: [],
      hypothesisRounds: [],
      solutionCritiques: [],
      memoryBankAgents: [],
      structuredSolutionPoolAgents: [],
      heartbeats: [],
      hypothesisProximityHistory: [],
      bsrRecords: [],
      branchLedgers: {},
      openPredictions: {},
      dosOutputs: [],
      liveEvents: [],
    } as any;

    let bsrCallCount = 0;
    let finalJudgeCalled = false;
    let finalCritiqueAttempted = false;

    // Realistic LLM response simulator: wraps structured payloads in conversational text and markdown code blocks!
    const simulatedCallAI = async (args: {
      prompt: string;
      model: string;
      systemInstruction?: string;
      responseSchema?: unknown;
      thinkingConfig?: { thinkingLevel?: string };
      agentKind?: DeepthinkAgentKind;
      stepDescription?: string;
    }): Promise<string> => {
      const p = args.prompt;
      const kind = args.agentKind;
      const desc = args.stepDescription || '';

      // High-fidelity validation: assert that orchestrator always delivers a non-empty system instruction (§7, §8.5)
      assert.ok(
        args.systemInstruction && args.systemInstruction.trim().length > 0,
        `System instruction must never be empty for agent ${kind} (${desc})`
      );

      // 1. Initial Strategy Seed Generation (Turn 1 & 2)
      if (kind === 'initialStrategy' && desc.includes('Seed Strategy Generator')) {
        assert.ok(
          args.systemInstruction.includes('strategies'),
          'Seed strategy generator must receive seed schema system prompt'
        );
        return wrapInRealisticLLMFence({
          strategies: [
            'Strategy main1: Symmetry-based algebraic parameterization',
            'Strategy main2: Variational optimization via Lagrange multipliers',
            'Strategy main3: Geometric constraint propagation and contact graph analysis',
          ],
        }, 'Here are the seed strategies for the challenge:');
      }

      // 2. Surgical Strategy Generator for Global Update (§4.1, §4.6)
      if (kind === 'strategyGeneratorGlobalUpdate' && desc.includes('Strategy Generator Update')) {
        assert.ok(
          args.systemInstruction.includes('evolved_slots') && args.systemInstruction.includes('pruned_slots'),
          'Global update strategy generator must receive surgical schema system prompt'
        );
        return wrapInRealisticLLMFence({
          evolved_slots: [
            { slot_id: 'main2', updated_strategy_text: 'Evolved main2: Constrained gradient projection avoiding boundary singularities' },
          ],
          pruned_slots: [
            { slot_id: 'main3', new_strategy_text: 'New main3: Delaunay triangulation dual graph optimization' },
          ],
        }, 'Here are the changed slots for Global Update:');
      }

      // 3. Strategy Proximity Review
      if (kind === 'strategyProximity') {
        if (desc.includes('Global Update')) {
          return 'Proximity: Evolved main2 and New main3 maintain complete orthogonality from main1.';
        }
        return 'Proximity: All 3 strategies explore diverse, non-overlapping solution domains.';
      }

      // 4. Solution Attempt (Iteration 1 or First execution of new branch)
      if (kind === 'solutionAttempt' || desc.includes('Solution Attempt') || desc.includes('First Execution')) {
        return '# Iteration 1 Solution Attempt\nRadius relation derived: r = s / (2 + 2*sqrt(3)). Contact graph validated.';
      }

      // 5. Solution Critique
      if (kind === 'solutionCritique') {
        if (desc.includes('Iteration 6')) {
          finalCritiqueAttempted = true;
        }
        return '# Solution Critique\nVerified algebraic bound. Check corner tangencies for boundary slack.';
      }

      // 6. Solution Correction
      if (kind === 'solutionCorrection') {
        return '# Corrected Solution\nRefined corner tangency condition. Packing density strictly equals pi / (2 * sqrt(3)).';
      }

      // 7. Dissected Observations Synthesis (DOS) (§5.1)
      if (kind === 'dos') {
        if (desc.includes('Step-i DOS')) {
          return wrapInRealisticLLMFence({
            core_synthesis: { status: 'All branches show valid progress on radius computation.' },
          }, 'Step-i DOS synthesis:');
        }
        if (desc.includes('Step-ii DOS')) {
          return wrapInRealisticLLMFence({
            core_synthesis: { status: 'Post-update branches stabilized.' },
            hypothesis_feedback: [
              {
                hypothesis_id: 'h1',
                branch_utilization: [
                  { branch_id: 'main1', utilization: { classification: 'USED_CORRECTLY', reason: 'Applied tested bound' } },
                ],
                critique_counterevidence: [
                  { branch_id: 'main1', classification: 'STRONG', reason: 'Verified in sandbox derivation' },
                ],
              },
            ],
          }, 'Step-ii DOS post-update synthesis:');
        }
        // Heartbeat DOS
        return wrapInRealisticLLMFence({
          core_synthesis: { heartbeat: 'Synthesis of active branches.' },
          hypothesis_feedback: [],
        });
      }

      // 8. Branch State Representation (BSR) (§6.2)
      if (kind === 'bsr') {
        bsrCallCount++;
        if (desc.includes('main1') || p.includes('Branch ID: main1')) {
          // main1: Healthy branch => CONTINUE
          return wrapInRealisticLLMFence({
            branch_id: 'main1',
            confirmed_progress: [
              { iteration: 2, size: 'large', reason: 'Proved boundary tangency' },
              { iteration: 3, size: 'medium', reason: 'Tightened density estimate' },
            ],
            confirmed_regression: [],
            critique_alignment: { value: 0.85, reason: 'Followed critique points closely' },
            next_window_prediction: {
              reason: 'Clear trajectory towards optimality',
              probabilities: { PROGRESS: 0.60, STALL: 0.30, REGRESS: 0.10 },
            },
          }, 'BSR report for main1:');
        }
        if (desc.includes('main2') || p.includes('Branch ID: main2')) {
          // main2: Regressed branch => EVOLVE with rollback to iteration 2
          return wrapInRealisticLLMFence({
            branch_id: 'main2',
            confirmed_progress: [
              { iteration: 2, size: 'large', reason: 'Found initial constraint' },
            ],
            confirmed_regression: [
              { iteration: 3, size: 'large', reason: 'Lagrangian degenerated at boundaries' },
            ],
            critique_alignment: { value: 0.6, reason: 'Partial adherence' },
            next_window_prediction: {
              reason: 'Unstable local minimum',
              probabilities: { PROGRESS: 0.10, STALL: 0.20, REGRESS: 0.70 },
            },
          }, 'BSR report for main2:');
        }
        // main3: Stall on failing branch with no progress => PRUNE (§6.5, §6.9 Example 3)
        return wrapInRealisticLLMFence({
          branch_id: 'main3',
          confirmed_progress: [
            { iteration: 3, size: 'small', reason: 'Minor format adjustment' },
          ],
          confirmed_regression: [
            { iteration: 3, size: 'small', reason: 'Offsetting geometric error' },
          ],
          critique_alignment: { value: 0.90, reason: 'Followed critique recommendations' },
          next_window_prediction: {
            reason: 'Stuck in unresolvable geometric clash with no trajectory forward',
            probabilities: { PROGRESS: 0.05, STALL: 0.85, REGRESS: 0.10 },
          },
        }, 'BSR report for main3:');
      }

      // 9. Hypothesis Generation (§4.2)
      if (kind === 'hypothesisGeneration' || desc.includes('Hypothesis Generation')) {
        return wrapInRealisticLLMFence({
          hypotheses: [
            {
              hypothesis_id: 'h1',
              text: 'The optimal 3-circle center points form an equilateral triangle homothetic to the container.',
              target_branches: ['main1'],
              predicted_test_outcome: {
                reason: 'Symmetry preserves homothety',
                probabilities: { VALIDATED: 0.70, REJECTED: 0.20, INCONCLUSIVE: 0.10 },
              },
            },
            {
              hypothesis_id: 'h2',
              text: 'Any arrangement with 2 non-touching circles has strictly lower packing density.',
              target_branches: [], // Global hypothesis (§4.2)
              predicted_test_outcome: {
                reason: 'Slack in packing implies non-optimality',
                probabilities: { VALIDATED: 0.80, REJECTED: 0.10, INCONCLUSIVE: 0.10 },
              },
            },
          ],
        }, 'Generated hypotheses:');
      }

      // 10. Hypothesis Proximity
      if (kind === 'hypothesisProximity') {
        return 'Proximity: Hypotheses h1 and h2 are crisp, falsifiable, and orthogonal.';
      }

      // 11. Hypothesis Tester (§4.3)
      if (kind === 'hypothesisTester') {
        return 'Tested analytically. Result confirms centers form an equilateral triangle.\n\nCLASSIFICATION: VALIDATED';
      }

      // 12. Structured Noise (§4.4)
      if (kind === 'structuredSolutionPool' || desc.includes('Structured Noise')) {
        return wrapInRealisticLLMFence({
          strategy_id: 'main1',
          solutions: [
            { title: 'Alternative A', content: 'Polar coordinate framing', confidence: 0.88 },
            { title: 'Alternative B', content: 'Cartesian framing with symmetry reduction', confidence: 0.92 },
          ],
        });
      }

      // 13. Memory Bank Distillation (§4.6 v, §9)
      if (kind === 'memoryBank') {
        return '# Memory Bank Distillation\nDurable invariant: Center homothety holds. Inscribed radius r = s / (2 + 2*sqrt(3)). Avoid boundary singularities.';
      }

      // 14. Final Judge (§7, §9)
      if (kind === 'finalJudge') {
        finalJudgeCalled = true;
        // Verify final judge receives ONLY candidate solutions, no critiques, pools, or memory banks (§7, §8.3)
        assert.equal(p.includes('## Critique'), false, 'Final judge must NOT receive critiques');
        assert.equal(p.includes('## Structured Noise'), false, 'Final judge must NOT receive pools');
        assert.equal(p.includes('## Memory Bank'), false, 'Final judge must NOT receive memory banks');

        return wrapInRealisticLLMFence({
          best_solution_id: 'main1',
          final_reasoning: 'main1 provides the complete, mathematically rigorous proof with optimal packing ratio.',
        }, 'Final Judge selection:');
      }

      throw new Error(`Unexpected simulated AI call for agentKind=${args.agentKind}, step=${args.stepDescription}`);
    };

    const orchestrator = new DeepthinkPipelineOrchestrator(state, {
      callAI: simulatedCallAI,
      parseJsonStrict: <T>(raw: string): T => {
        const extracted = extractJsonString(raw);
        return JSON.parse(extracted) as T;
      },
      retryDelaysMs: [10, 10, 10],
      onLiveEvent: (event: DeepthinkLiveEvent) => {
        if (event.eventType === 'agent_error') {
          process.stderr.write(`[UNEXPECTED AGENT ERROR] ${event.stepDescription}: ${event.error ?? ''}\n`);
        }
      },
    });

    // Execute the complete pipeline run
    await orchestrator.run();

    // ========================================================================
    // Post-Execution Invariant Verification
    // ========================================================================

    // 1. Pipeline status completed
    assert.equal(state.status, 'completed', 'Pipeline must successfully complete');

    // 2. Exactly 3 initial strategies generated with slot IDs main1, main2, main3 (§1 Invariant 1)
    assert.equal(state.initialStrategies.length, 3);
    assert.equal(state.initialStrategies[0].id, 'main1');
    assert.equal(state.initialStrategies[1].id, 'main2');
    assert.equal(state.initialStrategies[2].id, 'main3');

    // 3. Seed proximity history recorded
    assert.ok(state.strategyProximityHistory && state.strategyProximityHistory.length >= 2);

    // 4. BSR ran at Global Update (iteration 3) across all 3 branches
    assert.equal(bsrCallCount, 3, 'BSR must execute once per branch at global update');
    assert.equal(state.bsrRecords.length, 3, 'Exactly 3 BSR records stored outside repository');

    // 5. Verify BSR decisions:
    // main1 => CONTINUE
    const bsrMain1 = state.bsrRecords.find(r => r.branch_id === 'main1');
    assert.equal(bsrMain1?.computed.decision, 'CONTINUE', 'main1 must be CONTINUE');

    // main2 => EVOLVE with rollback to iteration 2
    const bsrMain2 = state.bsrRecords.find(r => r.branch_id === 'main2');
    assert.equal(bsrMain2?.computed.decision, 'EVOLVE', 'main2 must be EVOLVE');
    assert.equal(bsrMain2?.computed.form, 'rollback', 'main2 form must be rollback');
    assert.equal(bsrMain2?.computed.rollback_to, 2, 'main2 rollback must target iteration 2');

    // main3 => PRUNE
    const bsrMain3 = state.bsrRecords.find(r => r.branch_id === 'main3');
    assert.equal(bsrMain3?.computed.decision, 'PRUNE', 'main3 must be PRUNE');

    // 6. Surgical strategy updates applied (§4.1):
    // main1 strategy text untouched
    assert.ok(state.initialStrategies[0].strategyText.includes('Symmetry-based algebraic parameterization'));
    // main2 strategy text updated
    assert.ok(state.initialStrategies[1].strategyText.includes('Constrained gradient projection'));
    // main3 new branch strategy text updated
    assert.ok(state.initialStrategies[2].strategyText.includes('Delaunay triangulation dual graph'));

    // 7. Check final iteration 6 behavior (§3):
    // Iteration 6 ran correction ONLY. Final critique is NEVER run!
    assert.equal(finalCritiqueAttempted, false, 'Final iteration i critique must NOT be called per §3');
    const main1History = state.initialStrategies[0].iterationHistory?.iterations || [];
    const it6Record = main1History.find(it => it.iterationNumber === 6);
    assert.ok(it6Record, 'Iteration 6 correction record must exist');
    assert.ok(it6Record.critique.includes('intentionally omitted per §3'), 'Iteration 6 critique must be omitted');

    // 8. Final Judge executed and selected winner (§7, §9)
    assert.equal(finalJudgeCalled, true, 'Final judge must be called at iteration i barrier');
    assert.equal(state.finalJudgingStatus, 'completed');
    assert.ok(state.finalJudgedBestSolution, 'Final judged solution must be set');
    assert.ok(state.finalJudgingResponseText?.includes('main1'), 'Final judge reason must reference winning branch');

    // 9. Curated Context Heartbeat artifacts exist (§4.5)
    assert.ok(state.heartbeats.length > 0, 'Heartbeats must be recorded');
    assert.ok(state.dosOutputs.length >= 2, 'Step-i and Step-ii DOS outputs must be recorded');

    // 10. Realized hypothesis feedback attached (§5.1, §5.4)
    const hb1 = state.heartbeats[0];
    assert.ok(hb1, 'Heartbeat 1 must exist');
    const realizedH1 = hb1.realized_feedback.find(rf => rf.hypothesis_id === 'h1');
    assert.ok(realizedH1, 'Realized feedback for h1 must be present');
    assert.equal(realizedH1.observed_test_outcome, 'VALIDATED');
    assert.ok(realizedH1.surprise_bits > 0, 'Surprise bits must be computed');

    // 11. Durable Repository Files Verification (§8.1, §8.2)
    const git = orchestrator.getGitHarness();
    const files = git.getCommittedFiles();

    // Verify seed strategies file
    assert.ok(files.has('strategies_history/seed_strategies.md'), 'Seed strategies history must be committed');
    assert.ok(files.get('strategies_history/seed_strategies.md')!.includes('Strategy main1'));

    // Verify strategies finalized and used so far
    assert.ok(files.has('strategies_history/strategies_finalized_and_used_so_far.md'), 'strategies_finalized_and_used_so_far.md must be committed');

    // Verify DOS history files (§8.1)
    assert.ok(files.has('DOS_history/DOS_global_update_01_step_i.md'), 'Step-i DOS must be recorded in repository');
    assert.ok(files.has('DOS_history/DOS_global_update_01_step_ii.md'), 'Step-ii DOS must be recorded in repository');

    // Verify per-iteration history files (§8.1, §12.13)
    assert.ok(files.has('Strategy-1/history/iteration_01.md'), 'Iteration 1 history must be recorded');
    assert.ok(files.has('Strategy-1/history/iteration_02.md'), 'Iteration 2 history must be recorded');

    // Verify memory bank distillation file for surviving branch (§8.1)
    assert.ok(files.has('Strategy-1/history/memory_bank_01.md'), 'Memory bank distillation must be committed');

    // Verify PRUNE archived directory (§8.2)
    const archived = git.getArchivedDirectories();
    assert.ok(archived.some(dir => dir.includes('Strategy-3_pruned')), 'Strategy-3 must be archived to Pruned_Strategies');

    // Verify EVOLVE rollback was recorded (§8.2)
    const rollbacks = git.getRollbacks();
    assert.ok(rollbacks.some(rb => rb.slotIndex === 1), 'Rollback must be recorded for slot 1 (main2)');
  });
});
