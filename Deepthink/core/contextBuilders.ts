/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth (§4, §5, §6.7, §7).
 */

import type { Part } from "@google/genai";
import type {
  BsrAction,
  BsrEvolveForm,
  BsrLedgerEntry,
  DeepthinkBranchIteration,
  DeepthinkMainStrategyData,
  DosOutput,
  HeartbeatBlock,
} from './types.ts';
import {
  buildDosStepIiNote,
  buildHypothesisHeartbeatNote,
  buildStrategyGlobalUpdateNote,
  DOS_HEARTBEAT_NOTE,
  DOS_STEP_I_NOTE,
} from './harnessNotes.ts';

function fence(label: string, content: string | undefined): string {
  return `<${label}>\n${content?.trim() || 'Not available.'}\n</${label}>`;
}

// ============================================================================
// Strategy Generation & Proximity Context (§7)
// ============================================================================

export function buildContextForStrategySeed(
  challenge: string,
  strategiesCount: number,
  currentLoopTurns?: Array<{ role: 'generator' | 'proximity'; content: string; turnNumber?: number }>
): string {
  const parts: string[] = [
    `# Core Challenge`,
    challenge,
    '',
    `Requested Number of Strategies: ${strategiesCount}`,
  ];

  if (currentLoopTurns && currentLoopTurns.length > 0) {
    const formattedTurns = currentLoopTurns.map(
      t => `### Strategy ${t.role === 'generator' ? 'Generator' : 'Proximity Reviewer'} (Turn ${t.turnNumber ?? 1})\n${t.content}`
    ).join('\n\n');
    parts.push('', fence('SeedStrategyProximityTurns', formattedTurns));
  }

  return parts.join('\n');
}

export function buildContextForStrategyGlobalUpdate(
  challenge: string,
  updateNumber: number,
  j: number,
  activeStrategies: DeepthinkMainStrategyData[],
  bsrDecisions: Array<{
    slotId: string;
    decision: BsrAction;
    form?: BsrEvolveForm;
    rollbackTo?: number | 'window_start';
    eventReasons: string[];
  }>,
  stepIDosOutput: DosOutput,
  strategiesUsedSoFar: Array<{ slotId: string; iterationFinalized: number; text: string }>,
  priorProximityHistoryText?: string,
  currentGuTurns?: Array<{ role: 'generator' | 'proximity'; content: string; turnNumber?: number }>,
  strategiesCount?: number
): string {
  const count = strategiesCount ?? activeStrategies.length;
  const note = buildStrategyGlobalUpdateNote(j);

  const formattedActiveStrategies = activeStrategies.map(s => (
    `### ${s.id}\n${s.strategyText}\n\nLatest Correction:\n${s.refinedSolution || s.solutionAttempt || 'None'}`
  )).join('\n\n');

  // Consolidated BSR decisions carry decisions, forms, rollback points, and event reasons ONLY.
  // Never probabilities, surprisal, credibility, or scores (§6.7).
  const formattedDecisions = bsrDecisions.map(d => {
    let detail = `Decision: ${d.decision}`;
    if (d.form) {
      const rollbackTarget = d.rollbackTo !== undefined
        ? (d.rollbackTo === 'window_start' ? ' to window start' : ` to iteration ${d.rollbackTo}`)
        : '';
      detail += ` (${d.form}${rollbackTarget})`;
    }
    const reasons = d.eventReasons.length > 0
      ? `\nEvent reasons from window:\n${d.eventReasons.map(r => `  - ${r}`).join('\n')}`
      : '';
    return `### ${d.slotId}\n${detail}${reasons}`;
  }).join('\n\n');

  const formattedUsedSoFar = strategiesUsedSoFar.map(u => (
    `- [Iteration ${u.iterationFinalized}] ${u.slotId}: ${u.text}`
  )).join('\n');

  const parts: string[] = [
    `# Core Challenge (Global Update ${updateNumber})`,
    challenge,
    '',
    `Requested Number of Strategies: ${count}`,
  ];

  // 2. Prior Seed G↔P and Reframed Historical Global Update G↔P blocks
  if (priorProximityHistoryText && priorProximityHistoryText.trim()) {
    parts.push('', fence('StrategyProximityHistory', priorProximityHistoryText));
  }

  // 3. Active Note {GU_Note(u)} + [GU-u Context]
  parts.push(
    '',
    fence('HarnessNote', note),
    '',
    fence('CurrentActiveStrategies', formattedActiveStrategies),
    '',
    fence('ConsolidatedBsrDecisions', formattedDecisions),
    '',
    fence('DosSynthesisForStrategies', JSON.stringify(stepIDosOutput.core_synthesis || stepIDosOutput, null, 2)),
    '',
    fence('StrategiesFinalizedAndUsedSoFar', formattedUsedSoFar),
  );

  // 4. Current Global Update G↔P turns so far
  if (currentGuTurns && currentGuTurns.length > 0) {
    const formattedCurrentTurns = currentGuTurns.map(
      t => `### Strategy ${t.role === 'generator' ? 'Generator' : 'Proximity Reviewer'} (Turn ${t.turnNumber ?? 1})\n${t.content}`
    ).join('\n\n');
    parts.push('', fence('CurrentGlobalUpdateProximityTurns', formattedCurrentTurns));
  }

  return parts.join('\n\n');
}

// ============================================================================
// Hypothesis Generation & Proximity Context (§7)
// ============================================================================

export function buildContextForHypothesisGenerate(
  challenge: string,
  heartbeatNo: number,
  activeStrategies: DeepthinkMainStrategyData[],
  dosOutput?: DosOutput,
  previousHeartbeat?: HeartbeatBlock,
  priorProximityHistoryText?: string,
  currentHbTurns?: Array<{ role: 'generator' | 'proximity'; content: string; turnNumber?: number }>,
  hypothesisCount?: number
): string {
  const count = hypothesisCount ?? 1;
  const note = buildHypothesisHeartbeatNote(heartbeatNo);

  const parts: string[] = [
    `# Core Challenge`,
    challenge,
    '',
    `Requested Number of Hypotheses: ${count}`,
  ];

  // 2. Prior Heartbeat Reframed Notes + G↔P histories (for Heartbeat >= 2)
  if (priorProximityHistoryText && priorProximityHistoryText.trim()) {
    parts.push('', fence('HypothesisProximityHistory', priorProximityHistoryText));
  }

  // 3. Active Note {HB_Note(h)}
  parts.push(
    '',
    `# Hypothesis Generation Context for Heartbeat ${heartbeatNo}`,
    fence('HarnessNote', note),
  );

  // 4. [HB-h Context]
  if (!previousHeartbeat) {
    // Heartbeat 1: Active Running Strategies + Latest Corrections + DOS Synthesis
    const formattedActiveStrategies = activeStrategies.map(s => (
      `### ${s.id}\nStrategy: ${s.strategyText}\n\nLatest Correction:\n${s.refinedSolution || s.solutionAttempt || 'None'}`
    )).join('\n\n');
    parts.push(
      '',
      fence('ActiveRunningStrategies', formattedActiveStrategies),
    );
    if (dosOutput?.core_synthesis && Object.keys(dosOutput.core_synthesis).length > 0) {
      parts.push('', fence('DosCoreSynthesis', JSON.stringify(dosOutput.core_synthesis, null, 2)));
    }
  } else {
    // Heartbeat h >= 2:
    // (1) Final generated hypothesis object from Heartbeat h-1 + independent testing outputs & verdicts
    const prevHypothesesAndTests = previousHeartbeat.hypotheses.map(h => ({
      hypothesis_id: h.id,
      text: h.hypothesisText,
      target_branches: h.targetBranchIds || [],
      predicted_test_outcome: h.predicted_test_outcome,
      observed_verdict: h.testerVerdict || 'INCONCLUSIVE',
      testing_output: h.testerAttempt || 'None',
    }));

    // (2) Mapped branch packets schema (current running strategies + latest corrections + which hypotheses were mapped to which branches)
    const mappedBranchPackets = activeStrategies.map(s => {
      const mappedHypothesisIds = previousHeartbeat.hypotheses
        .filter(h => !h.targetBranchIds || h.targetBranchIds.length === 0 || h.targetBranchIds.includes(s.id))
        .map(h => h.id);
      return {
        branch_id: s.id,
        strategy_text: s.strategyText,
        latest_correction: s.refinedSolution || s.solutionAttempt || 'None',
        mapped_hypotheses_from_previous_heartbeat: mappedHypothesisIds,
      };
    });

    // (3) Realized hypothesis feedback (predicted test outcome, observed test outcome, surprise bits, utilization, counterevidence)
    const feedbackText = previousHeartbeat.realized_feedback.length > 0
      ? JSON.stringify(previousHeartbeat.realized_feedback, null, 2)
      : 'No prior feedback recorded.';

    parts.push(
      '',
      fence('PreviousHeartbeatHypothesesAndTests', JSON.stringify({
        heartbeat_no: previousHeartbeat.heartbeat_no,
        hypotheses: prevHypothesesAndTests,
      }, null, 2)),
      '',
      fence('MappedBranchPackets', JSON.stringify(mappedBranchPackets, null, 2)),
      '',
      fence('RealizedHypothesisFeedback', feedbackText),
    );

    // (4) DOS Core Synthesis for Heartbeat h
    if (dosOutput?.core_synthesis && Object.keys(dosOutput.core_synthesis).length > 0) {
      parts.push('', fence('DosCoreSynthesis', JSON.stringify(dosOutput.core_synthesis, null, 2)));
    }
  }

  // 5. Current Heartbeat G↔P turns so far
  if (currentHbTurns && currentHbTurns.length > 0) {
    const formattedCurrentTurns = currentHbTurns.map(
      t => `### Hypothesis ${t.role === 'generator' ? 'Generator' : 'Proximity Reviewer'} (Turn ${t.turnNumber ?? 1})\n${t.content}`
    ).join('\n\n');
    parts.push('', fence('CurrentHeartbeatProximityTurns', formattedCurrentTurns));
  }

  return parts.join('\n\n');
}

// ============================================================================
// DOS Context (§7)
// ============================================================================

export function buildContextForDos(
  challenge: string,
  kind: 'heartbeat' | 'step_i' | 'step_ii',
  activeBranches: Array<{
    branchId: string;
    strategyText: string;
    latestCorrection: string;
    latestCritique: string;
  }>,
  options?: {
    previousHeartbeat?: HeartbeatBlock;
    slotStatuses?: Array<{
      slotId: string;
      action: BsrAction;
      form?: BsrEvolveForm;
      rollbackTo?: number | 'window_start';
    }>;
    stepIOutput?: DosOutput;
  }
): string {
  const formattedBranches = activeBranches.map(b => (
    `### Branch ${b.branchId}\nStrategy: ${b.strategyText}\n\nLatest Correction:\n${b.latestCorrection}\n\nLatest Critique:\n${b.latestCritique}`
  )).join('\n\n');

  if (kind === 'step_i') {
    return [
      `# Core Challenge`,
      challenge,
      '',
      `# Dissected Observations Synthesis - Global Update (Step-i)`,
      fence('HarnessNote', DOS_STEP_I_NOTE),
      '',
      fence('ActiveBranchesState', formattedBranches),
    ].join('\n\n');
  }

  if (kind === 'heartbeat') {
    const prevHypotheses = options?.previousHeartbeat?.hypotheses.map(h => (
      `Hypothesis ${h.id}: ${h.hypothesisText}\nVerdict: ${h.testerVerdict || 'INCONCLUSIVE'}\nTesting Output: ${h.testerAttempt || 'None'}\nTarget Branches: ${JSON.stringify(h.targetBranchIds || [])}`
    )).join('\n\n') || 'None.';

    return [
      `# Core Challenge`,
      challenge,
      '',
      `# Dissected Observations Synthesis - Heartbeat DOS`,
      fence('HarnessNote', DOS_HEARTBEAT_NOTE),
      '',
      fence('PreviousHeartbeatHypothesesAndTests', prevHypotheses),
      '',
      fence('ActiveBranchesState', formattedBranches),
    ].join('\n\n');
  }

  // Step-ii DOS
  const note = buildDosStepIiNote(options?.slotStatuses || []);
  const prevHypotheses = options?.previousHeartbeat?.hypotheses.map(h => (
    `Hypothesis ${h.id}: ${h.hypothesisText}\nVerdict: ${h.testerVerdict || 'INCONCLUSIVE'}\nTesting Output: ${h.testerAttempt || 'None'}\nTarget Branches: ${JSON.stringify(h.targetBranchIds || [])}`
  )).join('\n\n') || 'None.';

  return [
    `# Core Challenge`,
    challenge,
    '',
    `# Dissected Observations Synthesis - Global Update (Step-ii)`,
    fence('HarnessNote', note),
    '',
    fence('StepIOutputBaseline', JSON.stringify(options?.stepIOutput, null, 2)),
    '',
    fence('PreviousHeartbeatHypothesesAndTests', prevHypotheses),
    '',
    fence('SurvivingAndNewBranchesState', formattedBranches),
  ].join('\n\n');
}

// ============================================================================
// Branch History & Correction/Critique Context (§7)
// ============================================================================

export function buildCritiqueCorrectionMemoryBankHistory(
  memoryBank: string | undefined,
  iterationsInWindow: DeepthinkBranchIteration[]
): string {
  const parts: string[] = [];

  if (memoryBank && memoryBank.trim().length > 0) {
    parts.push(fence('DistilledMemoryBank', memoryBank));
  }

  if (iterationsInWindow.length === 0) {
    parts.push('No prior iteration history in this window.');
  } else {
    const formatted = iterationsInWindow.map(it => (
      `<Iteration n="${it.iterationNumber}">\n` +
      fence('Correction', it.correctedSolution) + '\n' +
      fence('Critique', it.critique) + '\n' +
      `</Iteration>`
    )).join('\n\n');
    parts.push(fence('WindowCorrectionCritiqueHistory', formatted));
  }

  return parts.join('\n\n');
}

export function buildCrossStrategyLatestCorrectionCritique(
  currentBranchId: string,
  allBranches: DeepthinkMainStrategyData[],
  isolateBranches: boolean
): string | null {
  if (isolateBranches) return null;

  const peers = allBranches.filter(b => b.id !== currentBranchId);
  if (peers.length === 0) return null;

  return peers.map(p => {
    const latestCorrection = p.refinedSolution || p.solutionAttempt || 'None';
    const latestCritique = p.solutionCritique || 'None';
    return (
      `Strategy ${p.id}: ${p.strategyText}\n` +
      fence('LatestCorrection', latestCorrection) + '\n' +
      fence('LatestCritique', latestCritique)
    );
  }).join('\n\n');
}

export function buildContextForCorrectionAgent(
  challenge: string,
  branchId: string,
  strategyText: string,
  historyObject: string,
  curatedContextPacket: string | null,
  crossStrategyContext: string | null
): string {
  const parts: string[] = [
    `# Core Challenge`,
    challenge,
    '',
    `Assigned Strategy ID: ${branchId}`,
    `Assigned Strategy Text: ${strategyText}`,
    '',
    fence('BranchHistoryAndMemory', historyObject),
  ];

  if (curatedContextPacket) {
    parts.push('', fence('LatestCustomCuratedContext', curatedContextPacket));
  }

  if (crossStrategyContext) {
    parts.push('', fence('CrossStrategyPeerIntelligence', crossStrategyContext));
  }

  return parts.join('\n');
}

export function buildContextForCritiqueAgent(
  challenge: string,
  branchId: string,
  strategyText: string,
  historyObject: string,
  latestCorrectionContent: string
): string {
  return [
    `# Core Challenge`,
    challenge,
    '',
    `Assigned Strategy ID: ${branchId}`,
    `Assigned Strategy Text: ${strategyText}`,
    '',
    fence('BranchHistoryAndMemory', historyObject),
    '',
    fence('CorrectionToCritique', latestCorrectionContent),
  ].join('\n');
}

// ============================================================================
// BSR Context (§7, §6.7)
// ============================================================================

export function buildContextForBsr(
  challenge: string,
  branchId: string,
  strategyText: string,
  windowHistoryText: string,
  distilledMemoryBeforeWindow: string | undefined,
  ledgerEntries: BsrLedgerEntry[],
  earlierGradedPredictions: Array<{
    windowOutcome: string;
    surprisalBits: number;
  }>
): string {
  // HIDDEN PREDICTION RULE (§6.7):
  // Never pass the prediction for the window being judged!
  const formattedLedger = ledgerEntries.length > 0
    ? ledgerEntries.map(e => `[Iter ${e.iteration}] ${e.direction.toUpperCase()} (${e.size}): ${e.reason}`).join('\n')
    : 'Empty ledger.';

  const formattedGraded = earlierGradedPredictions.length > 0
    ? earlierGradedPredictions.map(g => `- Outcome: ${g.windowOutcome}, Surprisal: ${g.surprisalBits.toFixed(2)} bits`).join('\n')
    : 'No earlier predictions graded yet.';

  return [
    `# Core Challenge`,
    challenge,
    '',
    `Branch ID: ${branchId}`,
    `Current Strategy: ${strategyText}`,
    '',
    fence('WindowCorrectionCritiqueHistory', windowHistoryText),
    '',
    fence('MemoryBankBeforeWindow', distilledMemoryBeforeWindow || 'None available.'),
    '',
    fence('StandingEventLedger', formattedLedger),
    '',
    fence('EarlierGradedPredictionsHistory', formattedGraded),
  ].join('\n\n');
}

// ============================================================================
// Final Judge Context (§7, §8.3, §9)
// ============================================================================

export function buildContextForFinalJudge(
  challenge: string,
  candidates: Array<{
    branchId: string;
    strategyText: string;
    finalSolution: string;
  }>
): string {
  const formattedCandidates = candidates.map(c => (
    `### Candidate ${c.branchId}\nStrategy: ${c.strategyText}\n\n` +
    fence('FinalSolution', c.finalSolution)
  )).join('\n\n');

  return [
    `# Core Challenge`,
    challenge,
    '',
    `# Competing Candidate Solutions`,
    formattedCandidates,
  ].join('\n\n');
}

export function parsePromptToGeminiParts(promptText: string): Part[] {
    const parts: Part[] = [];
    const regex = /<!-- EXECUTION_IMAGE_START -->\s*<!-- MIME_TYPE:\s*([^\s]+)\s*-->\s*([\s\S]*?)<!-- EXECUTION_IMAGE_END -->/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(promptText)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ text: promptText.substring(lastIndex, match.index) });
        }
        parts.push({ inlineData: { mimeType: match[1], data: match[2].trim() } });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < promptText.length) {
        parts.push({ text: promptText.substring(lastIndex) });
    }
    return parts;
}
