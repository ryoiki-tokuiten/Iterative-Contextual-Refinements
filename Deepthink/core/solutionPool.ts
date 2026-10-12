/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared solution-pool response types used by the core and Curated Context UI.
 */

import type {
    SolutionPoolParsedSolution,
    SolutionPoolParsedResponse,
} from './deepthinkCore';

// Re-export types consumed by the TSX layer
export type { SolutionPoolParsedSolution, SolutionPoolParsedResponse };

// ═══════════════════════════════════════════════════════════════════════
// Actions (side-effectful but no DOM rendering)
// ═══════════════════════════════════════════════════════════════════════

