/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ModeStateHandler - Unified interface for mode state management
 * Each mode implements this interface to provide consistent export/import behavior.
 */

import type { ApplicationMode } from '../Types';

/**
 * Interface that all mode modules implement for state export/import.
 * This abstracts away the internal state structure from ConfigManager.
 */
export interface ModeStateHandler<TState = unknown> {
    /** Mode identifier - must match ApplicationMode type */
    readonly modeName: ApplicationMode;

    /**
     * Get the complete current state for this mode.
     * Implementation should return the full state object without manual field listing.
     * @returns The current state or null if no active state
     */
    getFullState(): TState | null;

    /**
     * Restore state from an imported configuration.
     * The state will already be sanitized (processing states reset) before calling this.
     * @param state The state to restore
     */
    restoreState(state: TState | null): void;

    /**
     * Render/refresh UI after state import.
     * Called after restoreState to update the UI to reflect the imported state.
     */
    renderAfterImport(): void;

    /**
     * Optional: Get any embedded/auxiliary state that should be exported alongside main state.
     * @returns Embedded state object or null
     */
    getEmbeddedState?(): unknown | null;

    /**
     * Optional: Restore embedded/auxiliary state.
     * @param state The embedded state to restore
     */
    restoreEmbeddedState?(state: unknown | null): void;
}

/**
 * Registry of all mode state handlers.
 * Populated by individual mode handler modules.
 */
export const modeHandlerRegistry = new Map<ApplicationMode, ModeStateHandler>();

/**
 * Register a mode state handler.
 * @param handler The handler to register
 */
export function registerModeHandler(handler: ModeStateHandler): void {
    modeHandlerRegistry.set(handler.modeName, handler);
}

/**
 * Get the handler for a specific mode.
 * @param mode The application mode
 * @returns The handler or undefined if not registered
 */
export function getModeHandler(mode: ApplicationMode): ModeStateHandler | undefined {
    return modeHandlerRegistry.get(mode);
}
