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
export const MAX_STRATEGY_PROXIMITY_LOOPS = 2;
export const MAX_HYPOTHESIS_COUNT = 6;
export const MAX_HYPOTHESIS_PROXIMITY_LOOPS = 2;
export const MAX_DEEPTHINK_DEPTH = 10;

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | string;

export interface ModelParameters {
    strategiesCount: number;
    strategyProximityLoops: number;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    deepthinkDepth: number;
    i?: number;
    j?: number;
    k?: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
    deepthinkCodeExecutionEnabled: boolean;
    thinkingLevel: ThinkingLevel;
}

const DEFAULT_MODEL_PARAMETERS: ModelParameters = {
    strategiesCount: 3,
    strategyProximityLoops: 1,
    hypothesisCount: 3,
    hypothesisProximityLoops: 1,
    deepthinkDepth: 10,
    i: 10,
    j: 5,
    k: 3,
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
        return Math.max(1, Math.min(MAX_STRATEGY_PROXIMITY_LOOPS, Math.round(this.parameters.strategyProximityLoops || 1)));
    }

    public getHypothesisCount(): number {
        return Math.max(0, Math.min(MAX_HYPOTHESIS_COUNT, this.parameters.hypothesisCount));
    }

    public getHypothesisProximityLoops(): number {
        return Math.max(1, Math.min(MAX_HYPOTHESIS_PROXIMITY_LOOPS, Math.round(this.parameters.hypothesisProximityLoops || 1)));
    }

    public getDeepthinkDepth(): number {
        return this.getI();
    }

    public getI(): number {
        return Math.max(5, Math.min(20, Math.round(this.parameters.i ?? this.parameters.deepthinkDepth ?? 10)));
    }

    public setI(i: number): void {
        const val = Math.max(5, Math.min(20, Math.round(i)));
        this.parameters.i = val;
        this.parameters.deepthinkDepth = val;
    }

    public getJ(): number {
        return Math.max(3, Math.min(8, Math.round(this.parameters.j ?? 5)));
    }

    public setJ(j: number): void {
        this.parameters.j = Math.max(3, Math.min(8, Math.round(j)));
    }

    public getK(): number {
        const j = this.getJ();
        return Math.max(2, Math.min(j, Math.round(this.parameters.k ?? 3)));
    }

    public setK(k: number): void {
        const j = this.getJ();
        this.parameters.k = Math.max(2, Math.min(j, Math.round(k)));
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
