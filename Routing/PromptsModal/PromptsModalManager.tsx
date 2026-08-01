import React, { useEffect, useState } from 'react';
import PromptsModalLayout from './PromptsModalLayout';
import { PromptContent } from '../../Styles/Components/PromptContent';
import { globalAdaptiveDeepthinkPromptsManager } from '../../AdaptiveDeepthink/AdaptiveDeepthinkPromptsManager';
import {
    ADAPTIVE_PROMPT_PANES,
    CONTEXTUAL_PROMPT_PANES,
    DEEPTHINK_PROMPT_PANES
} from './PromptModeConfigs';
import { getRoutingManager } from '../index';

/**
 * Prompts Modal Manager
 * Mounts one shared prompt editor for each mode and supplies its typed configuration.
 */
export const PromptsModalManager: React.FC = () => {
    const [promptsManager, setPromptsManager] = useState(() => getRoutingManager().getPromptsManager());

    // This root is rendered independently from the app root. Its first render
    // can precede AppInitializer's effect, which creates the prompts manager.
    useEffect(() => {
        if (promptsManager) return;
        const retry = window.setInterval(() => {
            const manager = getRoutingManager().getPromptsManager();
            if (manager) setPromptsManager(manager);
        }, 25);
        return () => window.clearInterval(retry);
    }, [promptsManager]);

    if (!promptsManager) return null;

    const modelConfigManager = getRoutingManager().getModelConfigManager();
    const availableModels = modelConfigManager
        ? modelConfigManager.getAvailableModels().map((m: any) => m.value)
        : [];

    const contextualPromptsManager = promptsManager.getContextualPromptsManager();

    return (
        <PromptsModalLayout>
            <PromptContent
                containerId="deepthink-prompts-container"
                panes={DEEPTHINK_PROMPT_PANES}
                manager={promptsManager.getDeepthinkPromptsManager()}
                availableModels={availableModels}
            />
            <PromptContent
                containerId="adaptiveDeepthink-prompts-container"
                panes={ADAPTIVE_PROMPT_PANES}
                manager={globalAdaptiveDeepthinkPromptsManager}
            />
            {contextualPromptsManager ? (
                <PromptContent
                    containerId="contextual-prompts-container"
                    panes={CONTEXTUAL_PROMPT_PANES}
                    manager={contextualPromptsManager}
                />
            ) : null}
        </PromptsModalLayout>
    );
};

export default PromptsModalManager;
