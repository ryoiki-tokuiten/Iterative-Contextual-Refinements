import React, { useState, useEffect } from 'react';
import { globalAdaptiveDeepthinkPromptsManager } from './AdaptiveDeepthinkPromptsManager';
import type { CustomizablePromptsAdaptiveDeepthink } from './AdaptiveDeepthinkPrompt';
import { PromptStylingEditor } from '../Styles/Components/PromptStyling';

/**
 * Adaptive Deepthink Mode Prompts Content
 * Prompts for Adaptive Deepthink mode
 */
export const AdaptivePromptsContent: React.FC = () => {
    const [prompts, setPrompts] = useState<CustomizablePromptsAdaptiveDeepthink>(
        globalAdaptiveDeepthinkPromptsManager.getPrompts()
    );

    useEffect(() => {
        const unsubscribe = globalAdaptiveDeepthinkPromptsManager.subscribe(setPrompts);
        return () => unsubscribe();
    }, []);

    const handleTextChange = (key: keyof CustomizablePromptsAdaptiveDeepthink) => (val: string) => {
        globalAdaptiveDeepthinkPromptsManager.updatePrompt(key, val);
    };

    const handleModelChange = (key: keyof CustomizablePromptsAdaptiveDeepthink) => (e: React.ChangeEvent<HTMLSelectElement>) => {
        globalAdaptiveDeepthinkPromptsManager.updatePrompt(key, e.target.value);
    };

    return (
        <div id="adaptiveDeepthink-prompts-container" className="prompts-mode-container">
            {/* Main Orchestrator */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-main">
                <h4 className="prompt-pane-title">Main Orchestrator</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_main || ''}
                                onChange={handleModelChange('model_main')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={12}
                            placeholder="Main Adaptive Deepthink orchestrator system prompt..."
                            value={prompts.sys_adaptiveDeepthink_main || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_main')}
                        />
                    </div>
                </div>
            </div>

            {/* Strategy Generation */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-strategy-gen">
                <h4 className="prompt-pane-title">Strategy Generator</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_strategyGeneration || ''}
                                onChange={handleModelChange('model_strategyGeneration')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Strategy generation agent system prompt..."
                            value={prompts.sys_adaptiveDeepthink_strategyGeneration || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_strategyGeneration')}
                        />
                    </div>
                </div>
            </div>

            {/* Strategies Proximity */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-strategy-proximity">
                <h4 className="prompt-pane-title">Strategies Proximity (Adversarial Reviewer)</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_strategyProximity || ''}
                                onChange={handleModelChange('model_strategyProximity')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Strategies proximity agent system prompt (adversarial reviewer)..."
                            value={prompts.sys_adaptiveDeepthink_strategyProximity || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_strategyProximity')}
                        />
                    </div>
                </div>
            </div>

            {/* Hypothesis Generation */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-hypothesis-gen">
                <h4 className="prompt-pane-title">Hypothesis Generator</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_hypothesisGeneration || ''}
                                onChange={handleModelChange('model_hypothesisGeneration')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Hypothesis generation agent system prompt..."
                            value={prompts.sys_adaptiveDeepthink_hypothesisGeneration || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_hypothesisGeneration')}
                        />
                    </div>
                </div>
            </div>

            {/* Hypothesis Proximity */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-hypothesis-proximity">
                <h4 className="prompt-pane-title">Hypothesis Proximity (Adversarial Reviewer)</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_hypothesisProximity || ''}
                                onChange={handleModelChange('model_hypothesisProximity')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Hypothesis proximity agent system prompt (adversarial reviewer)..."
                            value={prompts.sys_adaptiveDeepthink_hypothesisProximity || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_hypothesisProximity')}
                        />
                    </div>
                </div>
            </div>

            {/* Hypothesis Testing */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-hypothesis-test">
                <h4 className="prompt-pane-title">Hypothesis Testing</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_hypothesisTesting || ''}
                                onChange={handleModelChange('model_hypothesisTesting')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Hypothesis testing agent system prompt..."
                            value={prompts.sys_adaptiveDeepthink_hypothesisTesting || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_hypothesisTesting')}
                        />
                    </div>
                </div>
            </div>

            {/* Execution Agent */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-execution">
                <h4 className="prompt-pane-title">Execution Agent</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_execution || ''}
                                onChange={handleModelChange('model_execution')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Execution agent system prompt..."
                            value={prompts.sys_adaptiveDeepthink_execution || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_execution')}
                        />
                    </div>
                </div>
            </div>

            {/* Solution Critique */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-critique">
                <h4 className="prompt-pane-title">Solution Critique</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_solutionCritique || ''}
                                onChange={handleModelChange('model_solutionCritique')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Solution critique agent system prompt..."
                            value={prompts.sys_adaptiveDeepthink_solutionCritique || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_solutionCritique')}
                        />
                    </div>
                </div>
            </div>

            {/* Corrector Agent */}
            <div className="prompt-content-pane" data-prompt-key="adaptive-corrector">
                <h4 className="prompt-pane-title">Corrector Agent</h4>
                <div className="prompt-card">
                    <div className="prompt-card-header">
                        <span className="prompt-card-title">System Instruction</span>
                        <div className="prompt-model-selector">
                            <select
                                className="prompt-model-select"
                                value={prompts.model_corrector || ''}
                                onChange={handleModelChange('model_corrector')}
                            >
                                <option value="">Use Global Model</option>
                            </select>
                        </div>
                    </div>
                    <div className="prompt-card-body">
                        <PromptStylingEditor
                            className="prompt-textarea"
                            rows={10}
                            placeholder="Corrector agent system prompt..."
                            value={prompts.sys_adaptiveDeepthink_corrector || ''}
                            onChange={handleTextChange('sys_adaptiveDeepthink_corrector')}
                        />
                    </div>
                </div>
            </div>

        </div>
    );
};

export default AdaptivePromptsContent;
