/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth (§7, §8.5).
 */

import type { BsrAction, BsrEvolveForm } from './types.ts';

/**
 * Builds the active note injected before strategy generator global update turns (§7).
 */
export function buildStrategyGlobalUpdateNote(j: number): string {
  return [
    `These strategies were actually finalized and were executed, critiqued, and corrected for ${j} iterations.`,
    `The DOS output provides a synthesis of the critique across each branch so that you understand where each branch is failing exactly.`,
    `For richer context, you have also received the latest corrections in every branch.`,
    `Finally, you have received the consolidated BSR decisions calculated by the harness from the window's trajectory (EVOLVE, PRUNE, CONTINUE).`,
    `Now generate the surgical updated strategies object for the changed slots only.`
  ].join(' ');
}

/**
 * Builds the reframed note injected between earlier historical global update turns in proximity history (§7).
 */
export function buildStrategyReframedHistoricalNote(
  updateNumber: number,
  j: number,
  dosFilePath?: string
): string {
  const dosLocation = dosFilePath || `DOS_history/global_update_${String(updateNumber).padStart(2, '0')}.md`;
  return [
    `Yes, these strategies were actually finalized and were executed, critiqued, and corrected for ${j} iterations.`,
    `You received the DOS output for previous global update ${updateNumber} too, which you can find inside ${dosLocation}.`,
    `You can view past corrections by going to their corresponding strategy directories.`,
    `After this, you went back and forth with your proximity reviewer:`
  ].join(' ');
}

/**
 * Assembles the full historical proximity transcript with dynamically injected reframed notes
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
