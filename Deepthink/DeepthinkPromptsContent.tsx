import React, { useEffect, useState } from 'react';
import { DeepthinkPromptsManager } from './DeepthinkPromptsManager';
import { CustomizablePromptsDeepthink } from './DeepthinkPrompts';
import { PromptCard, PromptPane } from '../Styles/Components/PromptCard';

export interface DeepthinkPromptsContentProps {
    promptsManager: DeepthinkPromptsManager;
    availableModels?: string[];
}

type SystemPromptKey =
    | 'sys_deepthink_initialStrategy'
    | 'sys_deepthink_strategyProximity'
    | 'sys_deepthink_subStrategy'
    | 'sys_deepthink_solutionAttempt'
    | 'sys_deepthink_solutionCritique'
    | 'sys_deepthink_dissectedSynthesis'
    | 'sys_deepthink_selfImprovement'
    | 'sys_deepthink_hypothesisGeneration'
    | 'sys_deepthink_hypothesisProximity'
    | 'sys_deepthink_hypothesisTester'
    | 'sys_deepthink_postQualityFilter'
    | 'sys_deepthink_memoryBank'
    | 'sys_deepthink_finalJudge'
    | 'sys_deepthink_structuredSolutionPool';

type ModelPromptKey =
    | 'model_initialStrategy'
    | 'model_strategyProximity'
    | 'model_subStrategy'
    | 'model_solutionAttempt'
    | 'model_solutionCritique'
    | 'model_dissectedSynthesis'
    | 'model_selfImprovement'
    | 'model_hypothesisGeneration'
    | 'model_hypothesisProximity'
    | 'model_hypothesisTester'
    | 'model_postQualityFilter'
    | 'model_memoryBank'
    | 'model_finalJudge'
    | 'model_structuredSolutionPool';

interface SystemPaneDefinition {
    promptKey: string;
    title: string;
    textareaId: string;
    agentName: string;
    systemKey: SystemPromptKey;
    modelKey: ModelPromptKey;
}

const SYSTEM_PROMPT_PANES: SystemPaneDefinition[] = [
    {
        promptKey: 'deepthink-initial-strategy',
        title: 'Initial Strategy Generation',
        textareaId: 'sys-deepthink-initial-strategy',
        agentName: 'initialStrategy',
        systemKey: 'sys_deepthink_initialStrategy',
        modelKey: 'model_initialStrategy',
    },
    {
        promptKey: 'deepthink-strategy-proximity',
        title: 'Strategies Proximity',
        textareaId: 'sys-deepthink-strategy-proximity',
        agentName: 'strategyProximity',
        systemKey: 'sys_deepthink_strategyProximity',
        modelKey: 'model_strategyProximity',
    },
    {
        promptKey: 'deepthink-sub-strategy',
        title: 'Sub-Strategy Generation',
        textareaId: 'sys-deepthink-sub-strategy',
        agentName: 'subStrategy',
        systemKey: 'sys_deepthink_subStrategy',
        modelKey: 'model_subStrategy',
    },
    {
        promptKey: 'deepthink-solution-attempt',
        title: 'Solution Attempt',
        textareaId: 'sys-deepthink-solution-attempt',
        agentName: 'solutionAttempt',
        systemKey: 'sys_deepthink_solutionAttempt',
        modelKey: 'model_solutionAttempt',
    },
    {
        promptKey: 'deepthink-solution-critique',
        title: 'Solution Critique',
        textareaId: 'sys-deepthink-solution-critique',
        agentName: 'solutionCritique',
        systemKey: 'sys_deepthink_solutionCritique',
        modelKey: 'model_solutionCritique',
    },
    {
        promptKey: 'deepthink-dissected-synthesis',
        title: 'Dissected Observations Synthesis',
        textareaId: 'sys-deepthink-dissected-synthesis',
        agentName: 'dissectedSynthesis',
        systemKey: 'sys_deepthink_dissectedSynthesis',
        modelKey: 'model_dissectedSynthesis',
    },
    {
        promptKey: 'deepthink-self-improvement',
        title: 'Self-Improvement / Correction',
        textareaId: 'sys-deepthink-self-improvement',
        agentName: 'selfImprovement',
        systemKey: 'sys_deepthink_selfImprovement',
        modelKey: 'model_selfImprovement',
    },
    {
        promptKey: 'deepthink-hypothesis-generation',
        title: 'Hypothesis Generation',
        textareaId: 'sys-deepthink-hypothesis-generation',
        agentName: 'hypothesisGeneration',
        systemKey: 'sys_deepthink_hypothesisGeneration',
        modelKey: 'model_hypothesisGeneration',
    },
    {
        promptKey: 'deepthink-hypothesis-proximity',
        title: 'Hypothesis Proximity',
        textareaId: 'sys-deepthink-hypothesis-proximity',
        agentName: 'hypothesisProximity',
        systemKey: 'sys_deepthink_hypothesisProximity',
        modelKey: 'model_hypothesisProximity',
    },
    {
        promptKey: 'deepthink-hypothesis-tester',
        title: 'Hypothesis Testing',
        textareaId: 'sys-deepthink-hypothesis-tester',
        agentName: 'hypothesisTester',
        systemKey: 'sys_deepthink_hypothesisTester',
        modelKey: 'model_hypothesisTester',
    },
    {
        promptKey: 'deepthink-post-quality-filter',
        title: 'Post Quality Filter',
        textareaId: 'sys-deepthink-post-quality-filter',
        agentName: 'postQualityFilter',
        systemKey: 'sys_deepthink_postQualityFilter',
        modelKey: 'model_postQualityFilter',
    },
    {
        promptKey: 'deepthink-memory-bank',
        title: 'Memory Bank',
        textareaId: 'sys-deepthink-memory-bank',
        agentName: 'memoryBank',
        systemKey: 'sys_deepthink_memoryBank',
        modelKey: 'model_memoryBank',
    },
    {
        promptKey: 'deepthink-final-judge',
        title: 'Final Judge',
        textareaId: 'sys-deepthink-final-judge',
        agentName: 'finalJudge',
        systemKey: 'sys_deepthink_finalJudge',
        modelKey: 'model_finalJudge',
    },
    {
        promptKey: 'deepthink-structured-solution-pool',
        title: 'Structured Solution Pool Agent',
        textareaId: 'sys-deepthink-structured-solution-pool',
        agentName: 'structuredSolutionPool',
        systemKey: 'sys_deepthink_structuredSolutionPool',
        modelKey: 'model_structuredSolutionPool',
    },
];

export const DeepthinkPromptsContent: React.FC<DeepthinkPromptsContentProps> = ({
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
            {SYSTEM_PROMPT_PANES.map(pane => (
                <PromptPane key={pane.promptKey} promptKey={pane.promptKey} title={pane.title}>
                    <PromptCard
                        title="System Instruction"
                        textareaId={pane.textareaId}
                        agentName={pane.agentName}
                        value={prompts[pane.systemKey]}
                        onChange={onPromptChange(pane.systemKey)}
                        modelValue={(prompts[pane.modelKey] as string) || ''}
                        onModelChange={onModelChange(pane.modelKey)}
                        availableModels={availableModels}
                    />
                </PromptPane>
            ))}
        </div>
    );
};

export default DeepthinkPromptsContent;
