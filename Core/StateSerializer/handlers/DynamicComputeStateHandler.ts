/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModeStateHandler } from '../ModeStateHandler';
import type { DCAPipelineState } from '../../../Deepthink/DCA/DCACore';
import { ensureDCAInitialized, getLoadedDCAModule } from '../../ModeLoader';

let pendingState: DCAPipelineState | null = null;

export const dynamicComputeStateHandler: ModeStateHandler<DCAPipelineState> = {
    modeName: 'dynamic-compute',

    getFullState(): DCAPipelineState | null {
        const mod = getLoadedDCAModule();
        return mod ? mod.getActiveDCAPipeline() : null;
    },

    restoreState(state: DCAPipelineState | null): void {
        pendingState = state;
    },

    renderAfterImport(): void {
        void ensureDCAInitialized().then((mod) => {
            if (pendingState) {
                mod.setDCAStateForImport(pendingState);
                pendingState = null;
            }
            const container = document.getElementById('view-stage');
            if (container) {
                mod.renderDCAMode(container);
            }
        });
    },
};
