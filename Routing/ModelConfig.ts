/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelOption {
    value: string;
    label: string;
    description?: string;
    provider?: string;
}

export interface ModelParameters {
    temperature: number;
    topP: number;
    strategiesCount: number;
    subStrategiesCount: number;
    hypothesisCount: number;
    pqfAggressiveness: string;
    refinementEnabled: boolean;
    skipSubStrategies: boolean;
    dissectedObservationsEnabled: boolean;
    evolvingDfsEnabled: boolean;
    evolvingDfsDepth: number;
    provideAllSolutionsToCorrectors: boolean;
    postQualityFilterEnabled: boolean;
    deepthinkCodeExecutionEnabled: boolean;
    hypothesisInjectionMode: 'parallel' | 'strategy_aware' | 'selective_injection';
    thinkingLevel: 'low' | 'medium' | 'high' | 'minimal';
    shareHypothesesToDissected: boolean;
}

export const AVAILABLE_MODELS: ModelOption[] = [
    // Default models - will be populated dynamically by ProviderManager
];

export const DEFAULT_TEMPERATURES = [0, 0.7, 1.0, 1.5, 2.0];

export const DEFAULT_MODEL_PARAMETERS: ModelParameters = {
    temperature: 1.0,
    topP: 0.95,
    strategiesCount: 3,
    subStrategiesCount: 3,
    hypothesisCount: 4,
    pqfAggressiveness: 'balanced',
    refinementEnabled: false,
    skipSubStrategies: false,
    dissectedObservationsEnabled: false,
    evolvingDfsEnabled: false,
    evolvingDfsDepth: 3,
    provideAllSolutionsToCorrectors: false,
    postQualityFilterEnabled: false,
    deepthinkCodeExecutionEnabled: false,
    hypothesisInjectionMode: 'selective_injection' as const,
    thinkingLevel: 'high',
    shareHypothesesToDissected: false
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

    public updateParameter<K extends keyof ModelParameters>(
        key: K,
        value: ModelParameters[K]
    ): void {
        this.parameters[key] = value;
    }

    public getTemperature(): number {
        return Math.max(0, Math.min(2, this.parameters.temperature));
    }

    public getTopP(): number {
        return Math.max(0, Math.min(1, this.parameters.topP));
    }

    public getStrategiesCount(): number {
        if (this.isEvolvingDfsEnabled()) {
            return Math.max(1, Math.min(5, this.parameters.strategiesCount));
        }
        return Math.max(1, Math.min(10, this.parameters.strategiesCount));
    }

    public getSubStrategiesCount(): number {
        const count = this.parameters.subStrategiesCount;
        if (count === 0) {
            return 0;
        }
        return Math.max(2, Math.min(5, count));
    }

    public getHypothesisCount(): number {
        return Math.max(0, Math.min(6, this.parameters.hypothesisCount));
    }

    public getPqfAggressiveness(): string {
        return this.parameters.pqfAggressiveness;
    }

    public isRefinementEnabled(): boolean {
        return this.parameters.refinementEnabled;
    }

    public isSkipSubStrategies(): boolean {
        return this.parameters.skipSubStrategies;
    }

    public isDissectedObservationsEnabled(): boolean {
        // Dissected observations can only be enabled if refinement is enabled
        return this.parameters.refinementEnabled && this.parameters.dissectedObservationsEnabled;
    }

    public isShareHypothesesToDissected(): boolean {
        return this.parameters.shareHypothesesToDissected === true;
    }

    public isEvolvingDfsEnabled(): boolean {
        // Iterative corrections can only be enabled if refinement is enabled
        return this.parameters.refinementEnabled && this.parameters.evolvingDfsEnabled;
    }

    public getEvolvingDfsDepth(): number {
        return Math.max(1, Math.min(10, this.parameters.evolvingDfsDepth));
    }

    public isProvideAllSolutionsToCorrectors(): boolean {
        // Can only be enabled if refinement is enabled
        return this.parameters.refinementEnabled && !this.isEvolvingDfsEnabled() && this.parameters.provideAllSolutionsToCorrectors;
    }

    public isPostQualityFilterEnabled(): boolean {
        return this.isEvolvingDfsEnabled() ? true : this.parameters.postQualityFilterEnabled;
    }

    public isDeepthinkCodeExecutionEnabled(): boolean {
        return this.parameters.deepthinkCodeExecutionEnabled;
    }

    public getHypothesisInjectionMode(): 'parallel' | 'strategy_aware' | 'selective_injection' {
        if (this.isEvolvingDfsEnabled()) {
            return 'selective_injection';
        }
        return this.parameters.hypothesisInjectionMode || 'selective_injection';
    }

    public getThinkingLevel(): 'low' | 'medium' | 'high' | 'minimal' {
        return this.parameters.thinkingLevel || 'high';
    }

    public getModelProvider(modelValue?: string): string {
        // Use instance's availableModels (dynamically populated), not the empty AVAILABLE_MODELS constant
        const model = this.availableModels.find(m => m.value === (modelValue || this.selectedModel));
        return model?.provider || 'google';
    }

    public getModelsByProvider(provider: string): ModelOption[] {
        return this.availableModels.filter(m => m.provider === provider);
    }

    public setAvailableModels(models: ModelOption[]): void {
        this.availableModels = models;
        // If current selected model is not available, select the first available model
        if (!models.some(m => m.value === this.selectedModel) && models.length > 0) {
            this.setSelectedModel(models[0].value);
        }
    }

    public getAvailableModels(): ModelOption[] {
        return [...this.availableModels];
    }
}
