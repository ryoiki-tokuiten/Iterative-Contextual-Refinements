import React, { useEffect, useState } from 'react';
import { ContextualPromptsManager } from './ContextualPromptsManager';
import { CustomizablePromptsContextual, createDefaultCustomPromptsContextual } from './ContextualPrompts';
import { PromptStylingEditor } from '../Styles/Components/PromptStyling';

interface ContextualPromptsContentProps {
    manager: ContextualPromptsManager;
}

/**
 * Contextual Mode Prompts Content
 * Prompts for Contextual correction mode
 */
export const ContextualPromptsContent: React.FC<ContextualPromptsContentProps> = ({ manager }) => {
    const [prompts, setPrompts] = useState<CustomizablePromptsContextual>(() => manager.getPrompts() || createDefaultCustomPromptsContextual());

    useEffect(() => {
        const unsubscribe = manager.subscribe((newPrompts) => {
            setPrompts(newPrompts);
        });
        return unsubscribe;
    }, [manager]);

    const handlePromptChange = (key: keyof CustomizablePromptsContextual, value: string) => {
        manager.updatePrompt(key, value);
    };

    const handleModelChange = (key: keyof CustomizablePromptsContextual, value: string) => {
        manager.updateModel(key, value);
    };

    return (
        <div id="contextual-prompts-container" className="prompts-mode-container">
            {/* Main Generation Agent */}
            <div className="prompt-content-pane" data-prompt-key="contextual-main-generator">
                <h4 className="prompt-pane-title">Main Generation Agent</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                data-agent="contextual-main-generator"
                                value={prompts.model_mainGenerator || ''}
                                onChange={(e) => handleModelChange('model_mainGenerator', e.target.value)}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            id="sys-contextual-main-generator"
                            className="prompt-textarea"
                            rows={12}
                            placeholder="Main generation agent (self-corrector) system prompt..."
                            value={prompts.sys_contextual_mainGenerator || ''}
                            onChange={(val) => handlePromptChange('sys_contextual_mainGenerator', val)}
                        />
                    </div>
                </div>
            </div>

            {/* Iterative Agent */}
            <div className="prompt-content-pane" data-prompt-key="contextual-iterative-agent">
                <h4 className="prompt-pane-title">Iterative Agent</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                data-agent="contextual-iterative-agent"
                                value={prompts.model_iterativeAgent || ''}
                                onChange={(e) => handleModelChange('model_iterativeAgent', e.target.value)}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            id="sys-contextual-iterative-agent"
                            className="prompt-textarea"
                            rows={12}
                            placeholder="Iterative agent (solution critique) system prompt..."
                            value={prompts.sys_contextual_iterativeAgent || ''}
                            onChange={(val) => handlePromptChange('sys_contextual_iterativeAgent', val)}
                        />
                    </div>
                </div>
            </div>

            {/* Solution Pool Agent */}
            <div className="prompt-content-pane" data-prompt-key="contextual-solution-pool">
                <h4 className="prompt-pane-title">Solution Pool Agent</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                data-agent="contextual-solution-pool"
                                value={prompts.model_solutionPoolAgent || ''}
                                onChange={(e) => handleModelChange('model_solutionPoolAgent', e.target.value)}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            id="sys-contextual-solution-pool"
                            className="prompt-textarea"
                            rows={12}
                            placeholder="Solution pool / strategy pool agent system prompt..."
                            value={prompts.sys_contextual_solutionPoolAgent || ''}
                            onChange={(val) => handlePromptChange('sys_contextual_solutionPoolAgent', val)}
                        />
                    </div>
                </div>
            </div>

            {/* Memory Agent */}
            <div className="prompt-content-pane" data-prompt-key="contextual-memory">
                <h4 className="prompt-pane-title">Memory Agent</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                data-agent="contextual-memory"
                                value={prompts.model_memoryAgent || ''}
                                onChange={(e) => handleModelChange('model_memoryAgent', e.target.value)}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            id="sys-contextual-memory"
                            className="prompt-textarea"
                            rows={12}
                            placeholder="Memory agent system prompt..."
                            value={prompts.sys_contextual_memoryAgent || ''}
                            onChange={(val) => handlePromptChange('sys_contextual_memoryAgent', val)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ContextualPromptsContent;
