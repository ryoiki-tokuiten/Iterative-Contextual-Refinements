/** Centralized configuration for the single Deepthink pipeline. */

import {
    MAX_DEEPTHINK_STRATEGIES,
    MAX_HYPOTHESIS_COUNT,
    MAX_STRATEGY_PROXIMITY_LOOPS,
    MAX_HYPOTHESIS_PROXIMITY_LOOPS,
    ModelConfigManager,
    type BsrWeightPresetId,
} from './ModelConfig';

export interface DeepthinkConfigState {
    strategiesCount: number;
    strategyProximityLoops: number;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    hypothesisEnabled: boolean;
    deepthinkDepth: number;
    i: number;
    j: number;
    k: number;
    isolateBranches: boolean;
    codeExecutionEnabled: boolean;
    bsrNoiseLevel: number;
    bsrPressureFloor: number;
    bsrWeightSmall: number;
    bsrWeightMedium: number;
    bsrWeightLarge: number;
    bsrWeightPreset: BsrWeightPresetId;
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
            deepthinkDepth: this.modelConfig.getDeepthinkDepth(),
            i: this.modelConfig.getI(),
            j: this.modelConfig.getJ(),
            k: this.modelConfig.getK(),
            isolateBranches: this.modelConfig.isIsolateBranchesEnabled(),
            codeExecutionEnabled: this.modelConfig.isDeepthinkCodeExecutionEnabled(),
            bsrNoiseLevel: this.modelConfig.getBsrNoiseLevel(),
            bsrPressureFloor: this.modelConfig.getBsrPressureFloor(),
            bsrWeightSmall: this.modelConfig.getBsrWeightSmall(),
            bsrWeightMedium: this.modelConfig.getBsrWeightMedium(),
            bsrWeightLarge: this.modelConfig.getBsrWeightLarge(),
            bsrWeightPreset: this.modelConfig.getBsrWeightPreset(),
        };
    }

    public getStrategiesCount(): number { return this.modelConfig.getStrategiesCount(); }
    public getStrategyProximityLoops(): number { return this.modelConfig.getStrategyProximityLoops(); }
    public getHypothesisCount(): number { return this.modelConfig.getHypothesisCount(); }
    public getHypothesisProximityLoops(): number { return this.modelConfig.getHypothesisProximityLoops(); }
    public isHypothesisEnabled(): boolean { return this.getHypothesisCount() > 0; }
    public getDeepthinkDepth(): number { return this.modelConfig.getDeepthinkDepth(); }
    public getI(): number { return this.modelConfig.getI(); }
    public getJ(): number { return this.modelConfig.getJ(); }
    public getK(): number { return this.modelConfig.getK(); }
    public getMaxStrategies(): number { return MAX_DEEPTHINK_STRATEGIES; }
    public isIsolateBranchesEnabled(): boolean { return this.modelConfig.isIsolateBranchesEnabled(); }
    public isCodeExecutionEnabled(): boolean { return this.modelConfig.isDeepthinkCodeExecutionEnabled(); }
    public getBsrNoiseLevel(): number { return this.modelConfig.getBsrNoiseLevel(); }
    public getBsrPressureFloor(): number { return this.modelConfig.getBsrPressureFloor(); }
    public getBsrWeightSmall(): number { return this.modelConfig.getBsrWeightSmall(); }
    public getBsrWeightMedium(): number { return this.modelConfig.getBsrWeightMedium(); }
    public getBsrWeightLarge(): number { return this.modelConfig.getBsrWeightLarge(); }
    public getBsrWeightPreset(): BsrWeightPresetId { return this.modelConfig.getBsrWeightPreset(); }

    public setStrategiesCount(count: number): void {
        this.modelConfig.updateParameter('strategiesCount', Math.max(1, Math.min(Math.round(count), MAX_DEEPTHINK_STRATEGIES)));
        this.emitChange('strategiesCount');
    }

    public setStrategyProximityLoops(count: number): void {
        this.modelConfig.updateParameter('strategyProximityLoops', Math.max(1, Math.min(MAX_STRATEGY_PROXIMITY_LOOPS, Math.round(count))));
        this.emitChange('strategyProximityLoops');
    }

    public setHypothesisCount(count: number): void {
        this.modelConfig.updateParameter('hypothesisCount', Math.max(0, Math.min(Math.round(count), MAX_HYPOTHESIS_COUNT)));
        this.emitChange('hypothesisCount');
    }

    public setHypothesisProximityLoops(count: number): void {
        this.modelConfig.updateParameter('hypothesisProximityLoops', Math.max(1, Math.min(MAX_HYPOTHESIS_PROXIMITY_LOOPS, Math.round(count))));
        this.emitChange('hypothesisProximityLoops');
    }

    public setHypothesisEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('hypothesisCount', enabled && this.getHypothesisCount() === 0 ? 4 : enabled ? this.getHypothesisCount() : 0);
        this.emitChange('hypothesisEnabled');
    }

    public setDeepthinkDepth(depth: number): void {
        this.setI(depth);
    }

    public setI(i: number): void {
        this.modelConfig.setI(i);
        this.emitChange('i');
        this.emitChange('deepthinkDepth');
    }

    public setJ(j: number): void {
        this.modelConfig.setJ(j);
        this.emitChange('j');
    }

    public setK(k: number): void {
        this.modelConfig.setK(k);
        this.emitChange('k');
    }

    public setIsolateBranchesEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('isolateBranches', enabled);
        this.emitChange('isolateBranches');
    }

    public setCodeExecutionEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('deepthinkCodeExecutionEnabled', enabled);
        this.emitChange('codeExecutionEnabled');
        window.dispatchEvent(new CustomEvent('sandboxToggled', { detail: { enabled } }));
    }

    public setBsrNoiseLevel(val: number): void {
        this.modelConfig.updateParameter('bsrNoiseLevel', val);
        this.emitChange('bsrNoiseLevel');
    }

    public setBsrPressureFloor(val: number): void {
        this.modelConfig.updateParameter('bsrPressureFloor', val);
        this.emitChange('bsrPressureFloor');
    }

    public setBsrWeightSmall(val: number): void {
        this.modelConfig.updateParameter('bsrWeightSmall', val);
        this.emitChange('bsrWeightSmall');
    }

    public setBsrWeightMedium(val: number): void {
        this.modelConfig.updateParameter('bsrWeightMedium', val);
        this.emitChange('bsrWeightMedium');
    }

    public setBsrWeightLarge(val: number): void {
        this.modelConfig.updateParameter('bsrWeightLarge', val);
        this.emitChange('bsrWeightLarge');
    }

    public setBsrWeightPreset(presetId: BsrWeightPresetId): void {
        this.modelConfig.setBsrWeightPreset(presetId);
        this.emitChange('bsrWeightPreset');
        this.emitChange('all');
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
