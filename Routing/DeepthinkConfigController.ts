/** Centralized configuration for the single Deepthink pipeline. */

import {
    MAX_DEEPTHINK_DEPTH,
    MAX_DEEPTHINK_STRATEGIES,
    MAX_HYPOTHESIS_COUNT,
    ModelConfigManager,
} from './ModelConfig';

export interface DeepthinkConfigState {
    strategiesCount: number;
    strategyProximityLoops: number;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    hypothesisEnabled: boolean;
    pqfMode: string;
    deepthinkDepth: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
    codeExecutionEnabled: boolean;
}

type DeepthinkConfigChangeEvent = CustomEvent<{
    property: keyof DeepthinkConfigState | 'all';
    state: DeepthinkConfigState;
}>;

export class DeepthinkConfigController extends EventTarget {
    constructor(private readonly modelConfig: ModelConfigManager) {
        super();
    }

    public getState(): DeepthinkConfigState {
        return {
            strategiesCount: this.modelConfig.getStrategiesCount(),
            strategyProximityLoops: this.modelConfig.getStrategyProximityLoops(),
            hypothesisCount: this.modelConfig.getHypothesisCount(),
            hypothesisProximityLoops: this.modelConfig.getHypothesisProximityLoops(),
            hypothesisEnabled: this.modelConfig.getHypothesisCount() > 0,
            pqfMode: this.modelConfig.getPqfAggressiveness(),
            deepthinkDepth: this.modelConfig.getDeepthinkDepth(),
            isolateBranches: this.modelConfig.isIsolateBranchesEnabled(),
            disableSolutionPool: this.modelConfig.isSolutionPoolDisabled(),
            codeExecutionEnabled: this.modelConfig.isDeepthinkCodeExecutionEnabled(),
        };
    }

    public getStrategiesCount(): number { return this.modelConfig.getStrategiesCount(); }
    public getStrategyProximityLoops(): number { return this.modelConfig.getStrategyProximityLoops(); }
    public getHypothesisCount(): number { return this.modelConfig.getHypothesisCount(); }
    public getHypothesisProximityLoops(): number { return this.modelConfig.getHypothesisProximityLoops(); }
    public isHypothesisEnabled(): boolean { return this.getHypothesisCount() > 0; }
    public getPqfMode(): string { return this.modelConfig.getPqfAggressiveness(); }
    public getDeepthinkDepth(): number { return this.modelConfig.getDeepthinkDepth(); }
    public getMaxStrategies(): number { return MAX_DEEPTHINK_STRATEGIES; }
    public isIsolateBranchesEnabled(): boolean { return this.modelConfig.isIsolateBranchesEnabled(); }
    public isSolutionPoolDisabled(): boolean { return this.modelConfig.isSolutionPoolDisabled(); }
    public isCodeExecutionEnabled(): boolean { return this.modelConfig.isDeepthinkCodeExecutionEnabled(); }

    public setStrategiesCount(count: number): void {
        this.modelConfig.updateParameter('strategiesCount', Math.max(1, Math.min(Math.round(count), MAX_DEEPTHINK_STRATEGIES)));
        this.emitChange('strategiesCount');
    }

    public setStrategyProximityLoops(count: number): void {
        this.modelConfig.updateParameter('strategyProximityLoops', Math.max(1, Math.min(5, Math.round(count))));
        this.emitChange('strategyProximityLoops');
    }

    public setHypothesisCount(count: number): void {
        this.modelConfig.updateParameter('hypothesisCount', Math.max(0, Math.min(Math.round(count), MAX_HYPOTHESIS_COUNT)));
        this.emitChange('hypothesisCount');
    }

    public setHypothesisProximityLoops(count: number): void {
        this.modelConfig.updateParameter('hypothesisProximityLoops', Math.max(1, Math.min(5, Math.round(count))));
        this.emitChange('hypothesisProximityLoops');
    }

    public setHypothesisEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('hypothesisCount', enabled && this.getHypothesisCount() === 0 ? 4 : enabled ? this.getHypothesisCount() : 0);
        this.emitChange('hypothesisEnabled');
    }

    public setPqfMode(mode: string): void {
        this.modelConfig.updateParameter('pqfAggressiveness', mode === 'off' ? 'balanced' : mode);
        this.emitChange('pqfMode');
    }

    public setDeepthinkDepth(depth: number): void {
        this.modelConfig.updateParameter('deepthinkDepth', Math.max(1, Math.min(Math.round(depth), MAX_DEEPTHINK_DEPTH)));
        this.emitChange('deepthinkDepth');
    }

    public setIsolateBranchesEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('isolateBranches', enabled);
        this.emitChange('isolateBranches');
    }

    public setSolutionPoolDisabled(disabled: boolean): void {
        this.modelConfig.updateParameter('disableSolutionPool', disabled);
        this.emitChange('disableSolutionPool');
    }

    public setCodeExecutionEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('deepthinkCodeExecutionEnabled', enabled);
        this.emitChange('codeExecutionEnabled');
        window.dispatchEvent(new CustomEvent('sandboxToggled', { detail: { enabled } }));
    }

    private emitChange(property: keyof DeepthinkConfigState | 'all'): void {
        this.dispatchEvent(new CustomEvent('configchange', {
            detail: { property, state: this.getState() },
        }) as DeepthinkConfigChangeEvent);
    }

    public emitFullStateUpdate(): void {
        this.emitChange('all');
    }
}
