/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MANDATORY REFERENCE: Read Deepthink_Consolidated_Specification.md before modifying!
 * The specification document (Deepthink/docs/Deepthink_Consolidated_Specification.md)
 * is the absolute source of truth (§2, §3).
 */

export interface LoopState {
  iteration: number;
  since_heartbeat: number;
  heartbeat_no: number;
}

export type PostIterationAction =
  | { type: 'FINAL_JUDGE' }
  | { type: 'GLOBAL_UPDATE' }
  | { type: 'HEARTBEAT' }
  | { type: 'NONE' };

/**
 * Validates configuration bounds according to §2:
 * 5 <= i <= 20
 * 3 <= j <= 8
 * 2 <= k <= j
 */
export function validateLoopBounds(i: number, j: number, k: number): { valid: boolean; error?: string } {
  if (i < 5 || i > 20) {
    return { valid: false, error: `Iteration count i must be between 5 and 20 (got ${i}).` };
  }
  if (j < 3 || j > 8) {
    return { valid: false, error: `Global update frequency j must be between 3 and 8 (got ${j}).` };
  }
  if (k < 2 || k > j) {
    return { valid: false, error: `Heartbeat interval k must be between 2 and j (${j}) (got ${k}).` };
  }
  return { valid: true };
}

/**
 * Pure function determining whether a curated-context heartbeat is due after iteration n (§3).
 *
 * It is true when:
 * 1. `since_heartbeat == k`
 * 2. And the heartbeat would feed at least two correction + critique iterations before the next global update.
 *    Let G be the next multiple of j after n.
 *    If G < i, global update will run at G. Heartbeat feeds iterations n+1 up to G.
 *    When (G - n) < 2, the heartbeat would only feed 1 iteration before being replaced by GU's heartbeat, so skip it.
 *    If no global update lies ahead (G >= i), the gap check does not apply.
 */
export function isHeartbeatDue(n: number, since_heartbeat: number, k: number, j: number, i: number): boolean {
  if (since_heartbeat !== k) {
    return false;
  }

  // Next global update iteration
  const nextGlobalUpdate = Math.ceil((n + 0.0001) / j) * j;

  // A global update does not run at G >= i (step 1 stops at i)
  if (nextGlobalUpdate < i) {
    const gap = nextGlobalUpdate - n;
    if (gap < 2) {
      return false; // Skip: would only feed one iteration before being replaced
    }
  }

  return true;
}

/**
 * Pure function determining the post-iteration barrier action (§3).
 * Executed after iteration n completes:
 * 1. n == i -> stop (final judge)
 * 2. n is multiple of j -> global update (ends with heartbeat, since_heartbeat resets to 0)
 * 3. otherwise -> since_heartbeat increments; if heartbeat_due(n) -> heartbeat (since_heartbeat resets to 0)
 */
export function determinePostIterationStep(
  n: number,
  currentSinceHeartbeat: number,
  i: number,
  j: number,
  k: number,
  curatedContextEnabled: boolean
): {
  action: PostIterationAction;
  nextSinceHeartbeat: number;
} {
  // 1. n == i: stop. Straight to final judge.
  if (n >= i) {
    return {
      action: { type: 'FINAL_JUDGE' },
      nextSinceHeartbeat: currentSinceHeartbeat,
    };
  }

  // 2. n is multiple of j: run perform_global_update().
  // It ends with a heartbeat regardless of k. since_heartbeat resets to 0.
  if (n % j === 0) {
    return {
      action: { type: 'GLOBAL_UPDATE' },
      nextSinceHeartbeat: 0,
    };
  }

  // 3. Otherwise: since_heartbeat += 1.
  const incrementedSinceHeartbeat = currentSinceHeartbeat + 1;

  if (curatedContextEnabled && isHeartbeatDue(n, incrementedSinceHeartbeat, k, j, i)) {
    return {
      action: { type: 'HEARTBEAT' },
      nextSinceHeartbeat: 0,
    };
  }

  return {
    action: { type: 'NONE' },
    nextSinceHeartbeat: incrementedSinceHeartbeat,
  };
}
