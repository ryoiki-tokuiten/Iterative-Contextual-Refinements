import React, { useEffect, useState } from 'react';
import { DeepthinkPromptsManager } from './DeepthinkPromptsManager';
import { CustomizablePromptsDeepthink } from './DeepthinkPrompts';
import { PromptCard, PromptPane } from '../Styles/Components/PromptCard';
import {
    DEEPTHINK_AGENT_REGISTRY,
    type DeepthinkAgentKind,
} from './DeepthinkAgentRegistry';

interface DeepthinkPromptsContentProps {
    promptsManager: DeepthinkPromptsManager;
    availableModels?: string[];
}

const SYSTEM_PROMPT_PANES = (Object.keys(DEEPTHINK_AGENT_REGISTRY) as DeepthinkAgentKind[])
    // Evolving correction intentionally shares the Self-Improvement prompt/model.
    .filter(agentKind => agentKind !== 'solutionCorrection');

function paneSlug(agentKind: DeepthinkAgentKind): string {
    return agentKind.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

const DeepthinkPromptsContent: React.FC<DeepthinkPromptsContentProps> = ({
    promptsManager,
    availableModels = []
}) => {
    const [prompts, setPrompts] = useState<CustomizablePromptsDeepthink>(promptsManager.getPrompts());

    useEffect(() => {
        const unsubscribe = promptsManager.subscribe(setPrompts);
        return unsubscribe;
    }, [promptsManager]);

    const onPromptChange = (key: keyof CustomizablePromptsDeepthink) => (text: string) => {
        promptsManager.updatePrompt(key, text);
    };

    const onModelChange = (key: keyof CustomizablePromptsDeepthink) => (value: string) => {
        promptsManager.updateModel(key, value);
    };

    return (
        <div id="deepthink-prompts-container" className="prompts-mode-container">
            {SYSTEM_PROMPT_PANES.map(agentKind => {
                const metadata = DEEPTHINK_AGENT_REGISTRY[agentKind];
                const slug = paneSlug(agentKind);
                return (
                    <PromptPane key={agentKind} promptKey={`deepthink-${slug}`} title={metadata.label}>
                        <PromptCard
                            title="System Instruction"
                            textareaId={`sys-deepthink-${slug}`}
                            agentName={agentKind}
                            value={prompts[metadata.systemPromptKey]}
                            onChange={onPromptChange(metadata.systemPromptKey)}
                            modelValue={(prompts[metadata.modelKey] as string) || ''}
                            onModelChange={onModelChange(metadata.modelKey)}
                            availableModels={availableModels}
                        />
                    </PromptPane>
                );
            })}
        </div>
    );
};

export default DeepthinkPromptsContent;
