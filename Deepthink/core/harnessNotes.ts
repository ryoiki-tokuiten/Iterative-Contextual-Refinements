/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth (§7, §8.5).
 */

import type { BsrAction, BsrEvolveForm, RealizedHypothesisFeedback } from './types.ts';

/**
 * Builds the active note injected before strategy generator & proximity global update turns (§7).
 */
export function buildStrategyGlobalUpdateNote(j: number): string {
  return [
    `These strategies were actually finalized and were executed, critiqued, and corrected for ${j} iterations.`,
    `The DOS output is a synthesis of the critique across each branch so that you understand where each branch is failing exactly.`,
    `For richer context, you have also received the latest corrections in every branch.`,
    `Finally, you will receive a BSR object calculated by the harness by running information-theory and related concepts on the window, containing the decisions about what to continue, evolve, and prune.`,
    `Now generate the new strategies object for the changed slots only.`
  ].join(' ');
}

/**
 * Builds the reframed note injected between earlier historical global update turns in strategy proximity history (§7).
 */
export function buildStrategyReframedHistoricalNote(
  updateNumber: number,
  j: number,
  dosFilePath?: string
): string {
  const dosLocation = dosFilePath || `DOS_history/DOS_global_update_${String(updateNumber).padStart(2, '0')}_step_i.md`;
  return [
    `Yes, these strategies were actually finalized and were executed, critiqued, and corrected for ${j} iterations.`,
    `You received the DOS output for previous global update ${updateNumber} too, which you can find inside ${dosLocation}.`,
    `You can view the past corrections by going to their corresponding Strategy-N/history/ directories.`,
    `After this, you went back and forth with your proximity friend:`
  ].join(' ');
}

/**
 * Assembles the historical strategy proximity transcript with dynamically injected reframed notes
 * between historical turns (§7).
 */
export function buildStrategyProximityHistoryWithNotes(
  seedHistory: Array<{ role: 'generator' | 'proximity'; content: string; turnNumber?: number }>,
  globalUpdateHistories: Array<{
    updateNumber: number;
    turns: Array<{ role: 'generator' | 'proximity'; content: string; turnNumber?: number }>;
  }>,
  j: number
): string {
  const sections: string[] = [];

  sections.push('# Seed Strategy Generation History');
  for (const turn of seedHistory) {
    sections.push(`### Strategy ${turn.role === 'generator' ? 'Generator' : 'Proximity Reviewer'} (Turn ${turn.turnNumber ?? 1})\n${turn.content}`);
  }

  for (const gu of globalUpdateHistories) {
    sections.push('');
    sections.push(`---\n${buildStrategyReframedHistoricalNote(gu.updateNumber, j)}\n---`);
    sections.push(`\n# Global Update ${gu.updateNumber} Strategy Revision History`);
    for (const turn of gu.turns) {
      sections.push(`### Strategy ${turn.role === 'generator' ? 'Generator' : 'Proximity Reviewer'} (Turn ${turn.turnNumber ?? 1})\n${turn.content}`);
    }
  }

  return sections.join('\n\n');
}

const LOG2_3 = Math.log2(3); // ≈ 1.584962500721156 bits (blind 1/3 guess across 3 outcomes)

/**
 * Empathetically states what the Hypothesis Generator predicted vs. what the tester actually found,
 * what the surprise bits are, and whether the generator should be surprised (§5.2, §5.3, §7).
 */
export function buildHypothesisSurpriseNote(
  surpriseBits: number,
  observedVerdict: 'VALIDATED' | 'REJECTED' | 'INCONCLUSIVE',
  predictedProbabilities?: { VALIDATED: number; REJECTED: number; INCONCLUSIVE: number }
): string {
  const assignedProb = predictedProbabilities?.[observedVerdict] !== undefined
    ? predictedProbabilities[observedVerdict]
    : Math.min(1, Math.max(0.01, Math.pow(2, -surpriseBits)));
  const pct = (assignedProb * 100).toFixed(0);
  const bitsStr = surpriseBits.toFixed(2);
  const predLine = predictedProbabilities
    ? `Your prediction for this hypothesis was: VALIDATED ${(predictedProbabilities.VALIDATED * 100).toFixed(0)}%, REJECTED ${(predictedProbabilities.REJECTED * 100).toFixed(0)}%, INCONCLUSIVE ${(predictedProbabilities.INCONCLUSIVE * 100).toFixed(0)}%.`
    : `Your prediction for this hypothesis gave ${observedVerdict} a ~${pct}% chance.`;
  const gradedLine = `When graded against the independent test, the actual outcome was: ${observedVerdict} (you gave this a ${pct}% chance).`;

  if (surpriseBits <= 0.50) {
    return `${predLine} ${gradedLine} Surprisal is ${bitsStr} bits. Should you be surprised? No — the test confirmed what you already strongly expected, so you can treat this as settled ground rather than re-testing it.`;
  }
  if (surpriseBits <= LOG2_3) {
    return `${predLine} ${gradedLine} Surprisal is ${bitsStr} bits. Should you be surprised? No — you leaned toward ${observedVerdict} and your intuition held up.`;
  }
  if (surpriseBits < 2 * LOG2_3) {
    return `${predLine} ${gradedLine} Surprisal is ${bitsStr} bits. Should you be surprised? Yes — you expected a different outcome, and the independent test went against your intuition. Look closely at the tester's output to see what you missed and adjust your assumptions for the next hypotheses.`;
  }
  return `${predLine} ${gradedLine} Surprisal is ${bitsStr} bits. Should you be surprised? Very much so — you were confident ${observedVerdict} would not happen, and the test proved that assumption wrong. Dig into why the test landed on ${observedVerdict} and build your new hypotheses around what actually happened.`;
}

/**
 * Builds the active note injected before hypothesis generator & proximity heartbeat turns (§7).
 */
export function buildHypothesisHeartbeatNote(heartbeatNo: number): string {
  if (heartbeatNo <= 1) {
    return [
      `The branches have executed, critiqued, and corrected up to this first heartbeat.`,
      `You have received the DOS synthesis of where each branch currently stands, along with the currently running strategies and their latest corrections.`,
      `Now generate the initial hypotheses object.`
    ].join(' ');
  }
  const prevHb = heartbeatNo - 1;
  return [
    `The hypotheses from Heartbeat ${prevHb} were finalized, tested independently by dedicated tester agents, and mapped as packets to the target branches, which then executed corrections with them.`,
    `Below is the context for Heartbeat ${heartbeatNo}: the finalized hypotheses from Heartbeat ${prevHb} and their independent test outputs,`,
    `the mapped branch packets showing the current running strategies, their latest corrections, and which hypotheses were routed to which branches,`,
    `the realized hypothesis feedback (your predicted test outcome, observed test outcome, surprise bits, utilization across branches, and critique counterevidence),`,
    `the ledger of hypotheses finalized and used so far across prior heartbeats,`,
    `and the new DOS synthesis. Now generate the new hypotheses object.`
  ].join(' ');
}

/**
 * Builds the <EarlierGradedPredictionsHistory> entries for BSR, clearly stating what BSR
 * predicted for each window, what actually happened when graded, what the surprisal is,
 * and whether BSR should be surprised (§6.4, §6.7, §7).
 */
export function buildBsrGradedPredictionsHistoryWithNote(
  earlierGradedPredictions: Array<{
    windowOutcome: string;
    surprisalBits: number;
    predictedProbabilities?: { PROGRESS: number; STALL: number; REGRESS: number };
    updateNumber?: number;
  }>
): string {
  if (!earlierGradedPredictions || earlierGradedPredictions.length === 0) {
    return 'No earlier predictions graded yet.';
  }

  return earlierGradedPredictions.map((g, idx) => {
    const outcomeKey = g.windowOutcome as 'PROGRESS' | 'STALL' | 'REGRESS';
    const assignedProb = g.predictedProbabilities?.[outcomeKey] !== undefined
      ? g.predictedProbabilities[outcomeKey]
      : Math.min(1, Math.max(0.01, Math.pow(2, -g.surprisalBits)));
    const pct = (assignedProb * 100).toFixed(0);
    const bitsStr = g.surprisalBits.toFixed(2);
    const cred = Math.max(0, Math.min(1, 2 - g.surprisalBits / LOG2_3));
    const windowNum = g.updateNumber !== undefined ? g.updateNumber : idx + 2;
    const guLabel = g.updateNumber !== undefined ? `Global Update ${g.updateNumber}` : `Global Update ${idx + 2}`;

    const predLine = g.predictedProbabilities
      ? `Your prediction for Window ${windowNum} was: PROGRESS ${(g.predictedProbabilities.PROGRESS * 100).toFixed(0)}%, STALL ${(g.predictedProbabilities.STALL * 100).toFixed(0)}%, REGRESS ${(g.predictedProbabilities.REGRESS * 100).toFixed(0)}%.`
      : `Your prediction for Window ${windowNum} gave ${g.windowOutcome} a ~${pct}% chance.`;

    const gradedLine = `It was graded in ${guLabel} and the actual outcome was: ${g.windowOutcome} (you gave this a ${pct}% chance).`;

    let surpriseLine: string;
    if (g.surprisalBits <= 0.50) {
      surpriseLine = `Surprisal is ${bitsStr} bits.\nShould you be surprised? No — you strongly called this outcome and your read of the branch held up, so your forecasting credibility stays at 1.00.`;
    } else if (g.surprisalBits <= LOG2_3) {
      surpriseLine = `Surprisal is ${bitsStr} bits.\nShould you be surprised? No — you saw this coming and your read of the branch held up, so your forecasting credibility stays at 1.00.`;
    } else if (g.surprisalBits < 2 * LOG2_3) {
      surpriseLine = `Surprisal is ${bitsStr} bits.\nShould you be surprised? Yes — the branch ended in ${g.windowOutcome} when you expected otherwise, which reduced your forecasting credibility to ${cred.toFixed(2)}. Look closely at what you misread in the branch's trajectory before making your next prediction.`;
    } else {
      surpriseLine = `Surprisal is ${bitsStr} bits.\nShould you be surprised? Very much so — you were confident ${g.windowOutcome} would not happen, and the window proved that read wrong, dropping your forecasting credibility to 0.00. Re-examine why the branch went the opposite way before making your next prediction.`;
    }

    return [
      predLine,
      gradedLine,
      surpriseLine,
    ].join('\n');
  }).join('\n\n');
}

/**
 * Builds the reframed note that replaces a completed heartbeat's heavy context in hypothesis proximity history (§7).
 */
export function buildHypothesisReframedHistoricalNote(
  heartbeatNo: number,
  dosFilePath?: string
): string {
  const dosLocation = dosFilePath || `DOS_history/DOS_heartbeat_${String(heartbeatNo).padStart(2, '0')}.md`;
  if (heartbeatNo <= 1) {
    return [
      `In Heartbeat 1, you received the initial DOS synthesis (${dosLocation}), the active strategies, and their latest corrections,`,
      `and went back and forth with your proximity friend:`
    ].join(' ');
  }
  const prevHb = heartbeatNo - 1;
  return [
    `Yes, the hypotheses from Heartbeat ${prevHb} were finalized, tested independently, and mapped to branches.`,
    `For Heartbeat ${heartbeatNo}, you received the DOS synthesis inside ${dosLocation}, the latest corrections from the corresponding strategy directories,`,
    `and the prior test outputs and realized feedback records inside Custom_Curated_Context/Heartbeat-${prevHb}/Hypotheses/.`,
    `After this, you went back and forth with your proximity friend:`
  ].join(' ');
}

/**
 * Assembles the historical hypothesis proximity transcript across prior heartbeats with dynamically
 * injected reframed notes (§7).
 */
export function buildHypothesisProximityHistoryWithNotes(
  priorHeartbeats: Array<{
    heartbeatNo: number;
    dosFilePath?: string;
    turns: Array<{ role: 'generator' | 'proximity'; content: string; turnNumber?: number }>;
  }>
): string {
  const sections: string[] = [];

  for (const hb of priorHeartbeats) {
    if (!hb.turns || hb.turns.length === 0) continue;
    sections.push(`---\n${buildHypothesisReframedHistoricalNote(hb.heartbeatNo, hb.dosFilePath)}\n---`);
    sections.push(`# Heartbeat ${hb.heartbeatNo} Hypothesis Generation History`);
    for (const turn of hb.turns) {
      sections.push(`### Hypothesis ${turn.role === 'generator' ? 'Generator' : 'Proximity Reviewer'} (Turn ${turn.turnNumber ?? 1})\n${turn.content}`);
    }
  }

  return sections.join('\n\n');
}

/**
 * DOS Heartbeat note (§7).
 */
export const DOS_HEARTBEAT_NOTE = [
  'The hypotheses below were generated at the previous heartbeat, tested independently and mapped to branches,',
  'and the branches then ran corrections with those mapped packets.',
  'You also have the latest correction and critique of every branch.',
  'Synthesize where each branch stands, and for every hypothesis → branch assignment report only what you can actually observe:',
  'whether the packet was used, and whether the later critique gives real counterevidence against the tester\'s verdict.'
].join(' ');

/**
 * DOS Step-i note (§7).
 */
export const DOS_STEP_I_NOTE = [
  'Your output is going to the strategy agents that are about to decide which strategies to continue, evolve or replace in this global update.',
  'So write it for them: where exactly each branch is failing, what the branches share, what looks worth keeping.',
  'Here you only receive the latest correction and critique of every branch, so there is no hypothesis feedback to produce in this call.'
].join(' ');

/**
 * Builds the DOS Step-ii note with dynamically populated slot statuses (§7).
 */
export function buildDosStepIiNote(
  slotStatuses: Array<{
    slotId: string;
    action: BsrAction;
    form?: BsrEvolveForm;
    rollbackTo?: number | 'window_start';
  }>
): string {
  const formattedSlots = slotStatuses.map(s => {
    if (s.action === 'CONTINUE') {
      return `- ${s.slotId}: CONTINUE (surviving uninterrupted)`;
    }
    if (s.action === 'EVOLVE') {
      if (s.form === 'rollback' && s.rollbackTo !== undefined) {
        const targetStr = s.rollbackTo === 'window_start' ? 'window start' : `iteration ${s.rollbackTo}`;
        return `- ${s.slotId}: EVOLVE with rollback (reverted to ${targetStr}, discarded later iterations)`;
      }
      return `- ${s.slotId}: EVOLVE in place (re-aimed strategy text, progress standing)`;
    }
    return `- ${s.slotId}: PRUNE (archived, freed slot now holds a new branch starting with first execution + critique)`;
  }).join('\n');

  return [
    'This is your second call in this global update. Since your first output, the decisions were applied and the status of every slot is listed below:',
    formattedSlots,
    '',
    'Branches that were pruned are gone and their slots now hold new branches that only have a first execution and critique.',
    'A branch that was rolled back no longer contains the iterations after its rollback point.',
    'You also receive your own first output from this global update, unchanged.',
    'The previous heartbeat\'s hypotheses, testing outputs and mappings are included now, so produce hypothesis feedback, but only for assignments you can really observe, which means the branches that survived.',
    'You cannot say anything about the new branches and that is fine, leave them out.',
    'Do not repeat your first output: use it as a base and give a more nuanced, natural synthesis of the state you see now.'
  ].join('\n');
}

export function buildRemainingToolCallsHarnessNote(
  remainingTurns: number,
  maxToolTurns: number
): string {
  return `[HARNESS NOTE — ${remainingTurns} TOOL CALLS REMAINING]: You have ${remainingTurns} tool-call iterations remaining out of your maximum budget of ${maxToolTurns}. Begin wrapping up your verification and prepare to submit your complete response via final_output.`;
}

export function buildOvertimeFinalSubmitHarnessNote(
  maxToolTurns: number,
  graceTurns = 5
): string {
  return [
    '================================================================================',
    `[CRITICAL HARNESS WARNING — MAXIMUM TOOL CALL BUDGET (${maxToolTurns}) REACHED]`,
    'STOP ALL NEW EXPLORATION AND SUBMIT YOUR FINAL OUTPUT NOW!',
    `You have exhausted your full budget of ${maxToolTurns} tool-call iterations without submitting via final_output.`,
    `Your run is NOT being restarted—all of your sandbox work and conversation history remain intact—and you have been granted a strict final grace window of ${graceTurns} turns to wrap up and call final_output.`,
    `If you do not submit via final_output within these ${graceTurns} turns, all other tool access (sandbox_exec, shared_workspace) will be completely revoked and only final_output will remain available.`,
    'Synthesize your findings and call final_output immediately!',
    '================================================================================',
  ].join('\n');
}

export function buildRevokedToolsFinalSubmitHarnessNote(): string {
  return [
    '================================================================================',
    '[CRITICAL HARNESS ENFORCEMENT — ALL OTHER TOOL ACCESS REVOKED]',
    'You did not submit within the 5-turn grace window after reaching the maximum tool call budget.',
    'Access to sandbox_exec and shared_workspace has now been revoked.',
    'Only the final_output tool is available. Call final_output immediately with your complete response.',
    '================================================================================',
  ].join('\n');
}

export function buildRemainingSandboxTimeHarnessNote(
  remainingMinutes: number,
  maxMinutes = 60
): string {
  return `[HARNESS NOTE — ${remainingMinutes} MINUTES REMAINING]: You have ${remainingMinutes} minutes of wall-clock time remaining out of your maximum ${maxMinutes}-minute sandbox budget. Begin wrapping up your verification and prepare to submit your complete response via final_output.`;
}

export function buildSandboxTimeExpiredFinalSubmitHarnessNote(
  maxMinutes = 60
): string {
  return [
    '================================================================================',
    `[CRITICAL HARNESS ENFORCEMENT — MAXIMUM SANDBOX TIME BUDGET (${maxMinutes} MINUTES) REACHED]`,
    'STOP ALL NEW EXPLORATION AND SUBMIT YOUR FINAL OUTPUT NOW!',
    `You have reached the ${maxMinutes}-minute wall-clock time limit for this agent invocation without submitting via final_output.`,
    'Your run is NOT being restarted—all of your sandbox work and conversation history remain intact.',
    'Access to sandbox_exec and shared_workspace has now been revoked.',
    'Only the final_output tool is available. Call final_output immediately with your complete response.',
    '================================================================================',
  ].join('\n');
}

export function buildFinalOutputTokenGateHarnessNote(
  agentName: string,
  actualTokens: number,
  maxOutputTokens: number
): string {
  return `[HARNESS NOTE — FINAL OUTPUT TOKEN LIMIT EXCEEDED]: Your final_output submission for ${agentName} was ${actualTokens} tokens, which exceeds the maximum allowed limit of ${maxOutputTokens} output tokens. Your tool call and its error remain in history. Please output at most ${maxOutputTokens} max output tokens for ${agentName} by condensing and tightening your response, then call final_output again.`;
}

export function buildSharedWorkspaceTokenGateHarnessNote(
  actualTokens: number,
  maxTokens = 5000
): string {
  return `[HARNESS NOTE — SHARED WORKSPACE TOKEN LIMIT EXCEEDED]: Your shared_workspace update resulted in ${actualTokens} tokens, which exceeds the maximum limit of ${maxTokens} tokens for shared_workspace.md. Your tool call and its error remain in history. Please output and maintain at most ${maxTokens} total tokens in shared_workspace.md by using shared_workspace(action="edit", old_string=..., new_string=...) to condense or replace existing sections.`;
}

