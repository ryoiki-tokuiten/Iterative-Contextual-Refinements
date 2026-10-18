/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth.
 */

import { deepthinkSharedDocument } from './sharedDocument.ts';
import { strategyGeneratorSeedPrompt, strategyGeneratorGlobalUpdatePrompt } from './strategyGenerator.ts';
import { strategyProximityPrompt } from './strategyProximity.ts';
import { hypothesisGeneratorPrompt } from './hypothesisGenerator.ts';
import { hypothesisProximityPrompt } from './hypothesisProximity.ts';
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
  sys_deepthink_strategyGeneratorGlobalUpdate: string;
  sys_deepthink_strategyProximity: string;
  sys_deepthink_solutionAttempt: string;
  sys_deepthink_solutionCritique: string;
  sys_deepthink_solutionCorrection: string;
  sys_deepthink_hypothesisGeneration: string;
  sys_deepthink_hypothesisProximity: string;
  sys_deepthink_hypothesisTester: string;
  sys_deepthink_memoryBank: string;
  sys_deepthink_dos: string;
  sys_deepthink_bsr: string;
  sys_deepthink_finalJudge: string;

  model_initialStrategy?: string | null;
  model_strategyGeneratorGlobalUpdate?: string | null;
  model_strategyProximity?: string | null;
  model_solutionAttempt?: string | null;
  model_solutionCritique?: string | null;
  model_solutionCorrection?: string | null;
  model_hypothesisGeneration?: string | null;
  model_hypothesisProximity?: string | null;
  model_hypothesisTester?: string | null;
  model_memoryBank?: string | null;
  model_dos?: string | null;
  model_bsr?: string | null;
  model_finalJudge?: string | null;
}

export function createDefaultCustomPromptsDeepthink(): CustomizablePromptsDeepthink {
  return {
    sys_deepthink_initialStrategy: strategyGeneratorSeedPrompt,
    sys_deepthink_strategyGeneratorGlobalUpdate: strategyGeneratorGlobalUpdatePrompt,
    sys_deepthink_strategyProximity: strategyProximityPrompt,
    sys_deepthink_solutionAttempt: solutionAttemptPrompt,
    sys_deepthink_solutionCritique: solutionCritiquePrompt,
    sys_deepthink_solutionCorrection: solutionCorrectionPrompt,
    sys_deepthink_hypothesisGeneration: hypothesisGeneratorPrompt,
    sys_deepthink_hypothesisProximity: hypothesisProximityPrompt,
    sys_deepthink_hypothesisTester: hypothesisTesterPrompt,
    sys_deepthink_memoryBank: memoryBankPrompt,
    sys_deepthink_dos: dosPrompt,
    sys_deepthink_bsr: bsrPrompt,
    sys_deepthink_finalJudge: finalJudgePrompt,
  };
}

export {
  deepthinkSharedDocument,
  strategyGeneratorSeedPrompt,
  strategyGeneratorGlobalUpdatePrompt,
  strategyProximityPrompt,
  hypothesisGeneratorPrompt,
  hypothesisProximityPrompt,
  hypothesisTesterPrompt,
  solutionAttemptPrompt,
  solutionCritiquePrompt,
  solutionCorrectionPrompt,
  memoryBankPrompt,
  dosPrompt,
  bsrPrompt,
  finalJudgePrompt,
};
