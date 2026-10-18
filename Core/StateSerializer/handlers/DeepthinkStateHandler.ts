import type { ModeStateHandler } from '../ModeStateHandler';
import type { DeepthinkPipelineState } from '../../../Deepthink/core/deepthinkCore';
import { activateTab } from '../../AppRouter';
import { ensureDeepthinkInitialized, getLoadedDeepthinkModule } from '../../ModeLoader';
import { globalState } from '../../State';

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
        if (state?.pipeline) {
            if (state.pipeline.status !== 'completed' && state.pipeline.status !== 'error') {
                state.pipeline.status = 'stopped';
            }
            state.pipeline.isStopRequested = false;
        }
        pendingState = state;
    },

    renderAfterImport(): void {
        void ensureDeepthinkInitialized().then(async (mod) => {
            const state = pendingState;
            pendingState = null;

            if (!state || !state.pipeline) {
                mod.setActiveDeepthinkPipelineForImport(null);
                window.dispatchEvent(new CustomEvent('deepthinkPipelineUpdated'));
                window.dispatchEvent(new CustomEvent('deepthinkPipelineStateChanged'));
                window.dispatchEvent(new CustomEvent('controlsStateUpdated'));
                return;
            }

            if (state.pipeline.status !== 'completed' && state.pipeline.status !== 'error') {
                state.pipeline.status = 'stopped';
            }
            state.pipeline.isStopRequested = false;

            // Resolve file references in the same directory if present
            try {
                const files = (state.pipeline as any).directContextFiles || globalState.directContextFiles || [];
                for (const file of files) {
                    if (!file.base64) {
                        const targetPath = file.relativePath || `user_uploaded/${file.name}`;
                        let res = await fetch(`/api/sandbox/workspace/file?repositoryId=${encodeURIComponent(state.pipeline.id)}&path=${encodeURIComponent(targetPath)}&scope=repository`);
                        if (!res.ok && targetPath.startsWith('direct_context/')) {
                            // Fallback to user_uploaded
                            const fallbackPath = targetPath.replace('direct_context/', 'user_uploaded/');
                            res = await fetch(`/api/sandbox/workspace/file?repositoryId=${encodeURIComponent(state.pipeline.id)}&path=${encodeURIComponent(fallbackPath)}&scope=repository`);
                        }
                        if (res.ok) {
                            const buf = await res.arrayBuffer();
                            const bytes = new Uint8Array(buf);
                            let binary = '';
                            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                            file.base64 = btoa(binary);
                        }
                    }
                }
                globalState.directContextFiles = files;

                // Re-hydrate any image refs back into challenge if needed for AI calls / display
                if (typeof state.pipeline.challenge === 'string') {
                    state.pipeline.challenge = state.pipeline.challenge.replace(
                        /<!-- EXECUTION_IMAGE_REF:\s*([^\s|]+)\s*\|\s*MIME_TYPE:\s*([^\s]+)\s*-->/g,
                        (_match, refPath, mime) => {
                            const cleanName = refPath.replace(/^(user_uploaded|direct_context)\//, '');
                            const matchedFile = files.find((f: any) => f.relativePath === refPath || f.name === cleanName);
                            if (matchedFile && matchedFile.base64) {
                                return `<!-- EXECUTION_IMAGE_START -->\n<!-- MIME_TYPE: ${mime} -->\n${matchedFile.base64}\n<!-- EXECUTION_IMAGE_END -->`;
                            }
                            return _match;
                        }
                    );
                }
            } catch (e) {
                console.warn('Notice: could not load referenced files from results directory:', e);
            }

            mod.setActiveDeepthinkPipelineForImport(state.pipeline);
            mod.renderActiveDeepthinkPipeline();

            if (state.activeTabId) {
                activateTab(state.activeTabId);
            }

            window.dispatchEvent(new CustomEvent('deepthinkPipelineUpdated'));
            window.dispatchEvent(new CustomEvent('deepthinkPipelineStateChanged'));
            window.dispatchEvent(new CustomEvent('controlsStateUpdated'));
        });
    },
};
