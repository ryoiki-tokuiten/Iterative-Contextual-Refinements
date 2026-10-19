/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth (§4, §5, §6, §7, §8).
 */

import { deepthinkSharedDocument } from './sharedDocument.ts';
import { strategyGeneratorPrompt } from './strategyGenerator.ts';
import { hypothesisGeneratorPrompt } from './hypothesisGenerator.ts';
import { hypothesisTesterPrompt } from './hypothesisTester.ts';
import { solutionAttemptPrompt } from './solutionAttempt.ts';
import { solutionCritiquePrompt } from './solutionCritique.ts';
import { solutionCorrectionPrompt } from './solutionCorrection.ts';
import { memoryBankPrompt } from './memoryBank.ts';
import { dosPrompt } from './dos.ts';
import { bsrPrompt } from './bsr.ts';
import { finalJudgePrompt } from './finalJudge.ts';

export interface CustomizablePromptsDeepthink {
  sys_deepthink_initialStrategy: string;
  sys_deepthink_hypothesisGeneration: string;
  sys_deepthink_hypothesisTester: string;
  sys_deepthink_solutionAttempt: string;
  sys_deepthink_solutionCritique: string;
  sys_deepthink_solutionCorrection: string;
  sys_deepthink_memoryBank: string;
  sys_deepthink_dos: string;
  sys_deepthink_bsr: string;
  sys_deepthink_finalJudge: string;

  model_initialStrategy?: string | null;
  model_hypothesisGeneration?: string | null;
  model_hypothesisTester?: string | null;
  model_solutionAttempt?: string | null;
  model_solutionCritique?: string | null;
  model_solutionCorrection?: string | null;
  model_memoryBank?: string | null;
  model_dos?: string | null;
  model_bsr?: string | null;
  model_finalJudge?: string | null;
}

export function createDefaultCustomPromptsDeepthink(): CustomizablePromptsDeepthink {
  return {
    sys_deepthink_initialStrategy: strategyGeneratorPrompt,
    sys_deepthink_hypothesisGeneration: hypothesisGeneratorPrompt,
    sys_deepthink_hypothesisTester: hypothesisTesterPrompt,
    sys_deepthink_solutionAttempt: solutionAttemptPrompt,
    sys_deepthink_solutionCritique: solutionCritiquePrompt,
    sys_deepthink_solutionCorrection: solutionCorrectionPrompt,
    sys_deepthink_memoryBank: memoryBankPrompt,
    sys_deepthink_dos: dosPrompt,
    sys_deepthink_bsr: bsrPrompt,
    sys_deepthink_finalJudge: finalJudgePrompt,
  };
}

export {
  deepthinkSharedDocument,
  strategyGeneratorPrompt,
  hypothesisGeneratorPrompt,
  hypothesisTesterPrompt,
  solutionAttemptPrompt,
  solutionCritiquePrompt,
  solutionCorrectionPrompt,
  memoryBankPrompt,
  dosPrompt,
  bsrPrompt,
  finalJudgePrompt,
};
