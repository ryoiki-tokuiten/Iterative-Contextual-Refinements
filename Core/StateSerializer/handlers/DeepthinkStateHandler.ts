/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * DeepthinkStateHandler - State management handler for Deepthink mode
 */

import type { ModeStateHandler } from '../ModeStateHandler';
import type { DeepthinkPipelineState } from '../../../Deepthink/DeepthinkCore';
import { activateTab } from '../../AppRouter';
import { ensureDeepthinkInitialized, getLoadedDeepthinkModule } from '../../ModeLoader';

interface DeepthinkExportState {
    pipeline: DeepthinkPipelineState | null;
    activeTabId: string;
}

let pendingState: DeepthinkExportState | null = null;

export const deepthinkStateHandler: ModeStateHandler<DeepthinkExportState> = {
    modeName: 'deepthink',

    getFullState(): DeepthinkExportState | null {
        const deepthink = getLoadedDeepthinkModule();
        if (!deepthink) return null;

        const pipeline = deepthink.getActiveDeepthinkPipeline();
        if (!pipeline) {
            return null;
        }

        return {
            pipeline,
            activeTabId: pipeline.activeTabId || 'strategic-solver',
        };
    },

    restoreState(state: DeepthinkExportState | null): void {
        pendingState = state;
    },

    renderAfterImport(): void {
        void ensureDeepthinkInitialized().then((mod) => {
            const state = pendingState;
            pendingState = null;

            if (!state || !state.pipeline) {
                mod.setActiveDeepthinkPipelineForImport(null);
                return;
            }

            mod.setActiveDeepthinkPipelineForImport(state.pipeline);

            mod.renderActiveDeepthinkPipeline();
            if (state.activeTabId) {
                activateTab(state.activeTabId);
            }
        });
    },
};
