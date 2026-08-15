/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelOption {
    value: string;
    label: string;
    description?: string;
    provider?: string;
    providerLabel?: string;
}

export const MAX_DEEPTHINK_STRATEGIES = 5;
export const MAX_HYPOTHESIS_COUNT = 10;
export const MAX_DEEPTHINK_DEPTH = 10;

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | string;

export interface ModelParameters {
    strategiesCount: number;
    strategyProximityLoops: number;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    pqfAggressiveness: string;
    deepthinkDepth: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
    deepthinkCodeExecutionEnabled: boolean;
    thinkingLevel: ThinkingLevel;
}

const DEFAULT_MODEL_PARAMETERS: ModelParameters = {
    strategiesCount: 3,
    strategyProximityLoops: 2,
    hypothesisCount: 4,
    hypothesisProximityLoops: 2,
    pqfAggressiveness: 'balanced',
    deepthinkDepth: 3,
    isolateBranches: false,
    disableSolutionPool: false,
    deepthinkCodeExecutionEnabled: false,
    thinkingLevel: 'high',
};

export class ModelConfigManager {
    private parameters: ModelParameters;
    private selectedModel: string;
    private availableModels: ModelOption[] = [];

    constructor() {
        this.parameters = { ...DEFAULT_MODEL_PARAMETERS };
        this.selectedModel = 'gemini-3.5-flash';
    }

    public getSelectedModel(): string {
        return this.selectedModel;
    }

    public setSelectedModel(model: string): void {
        this.selectedModel = model;
        window.dispatchEvent(new CustomEvent('selectedModelChanged', { detail: { model } }));
    }

    public getParameters(): ModelParameters {
        return { ...this.parameters };
    }

    public updateParameter<K extends keyof ModelParameters>(key: K, value: ModelParameters[K]): void {
        this.parameters[key] = value;
    }

    public getStrategiesCount(): number {
        return Math.max(1, Math.min(MAX_DEEPTHINK_STRATEGIES, this.parameters.strategiesCount));
    }

    public getStrategyProximityLoops(): number {
        return Math.max(1, Math.min(5, Math.round(this.parameters.strategyProximityLoops || 2)));
    }

    public getHypothesisCount(): number {
        return Math.max(0, Math.min(MAX_HYPOTHESIS_COUNT, this.parameters.hypothesisCount));
    }

    public getHypothesisProximityLoops(): number {
        return Math.max(1, Math.min(5, Math.round(this.parameters.hypothesisProximityLoops || 2)));
    }

    public getPqfAggressiveness(): string {
        return this.parameters.pqfAggressiveness === 'off' ? 'balanced' : this.parameters.pqfAggressiveness;
    }

    public getDeepthinkDepth(): number {
        return Math.max(1, Math.min(MAX_DEEPTHINK_DEPTH, Math.round(this.parameters.deepthinkDepth)));
    }

    public isIsolateBranchesEnabled(): boolean {
        return this.parameters.isolateBranches === true;
    }

    public isSolutionPoolDisabled(): boolean {
        return this.parameters.disableSolutionPool === true;
    }

    public isDeepthinkCodeExecutionEnabled(): boolean {
        return this.parameters.deepthinkCodeExecutionEnabled;
    }

    public getThinkingLevel(): ThinkingLevel {
        return this.parameters.thinkingLevel || 'high';
    }

    public getModelProvider(modelValue?: string): string {
        const model = this.availableModels.find(candidate => candidate.value === (modelValue || this.selectedModel));
        return model?.provider || 'google';
    }

    public setAvailableModels(models: ModelOption[]): void {
        this.availableModels = models;
        if (!models.some(model => model.value === this.selectedModel) && models.length > 0) {
            this.setSelectedModel(models[0].value);
        }
    }

    public getAvailableModels(): ModelOption[] {
        return [...this.availableModels];
    }
}
