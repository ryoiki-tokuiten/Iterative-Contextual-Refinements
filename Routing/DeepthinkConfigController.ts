/**
 * DeepthinkConfigController.ts
 * 
 * Centralized controller for all Deepthink configuration logic.
 * This is the single source of truth for Deepthink parameter constraints and side-effects.
 * 
 * UI components should:
 * 1. Call controller methods on user interaction
 * 2. Subscribe to 'configchange' events to update their visual state
 * 3. Never implement business logic themselves
 */

import { ModelConfigManager } from './ModelConfig';

export interface DeepthinkConfigState {
    strategiesCount: number;
    subStrategiesCount: number;
    hypothesisCount: number;
    skipSubStrategies: boolean;
    hypothesisEnabled: boolean;
    redTeamMode: string;
    postQualityFilterEnabled: boolean;
    refinementEnabled: boolean;
    dissectedObservationsEnabled: boolean;
    iterativeCorrectionsEnabled: boolean;
    iterativeDepth: number;
    provideAllSolutionsEnabled: boolean;
    temperature: number;
    topP: number;
    codeExecutionEnabled: boolean;
    hypothesisInjectionMode: 'parallel' | 'strategy_aware' | 'selective_injection';
    shareHypothesesToDissected: boolean;
}

export type DeepthinkConfigChangeEvent = CustomEvent<{
    property: keyof DeepthinkConfigState | 'all';
    state: DeepthinkConfigState;
}>;

/**
 * Business rule constants
 */
const MAX_STRATEGIES_WITH_ITERATIVE = 5;
const MAX_STRATEGIES_DEFAULT = 10;

export class DeepthinkConfigController extends EventTarget {
    private modelConfig: ModelConfigManager;

    constructor(modelConfig: ModelConfigManager) {
        super();
        this.modelConfig = modelConfig;
    }

    // ========== GETTERS ==========

    public getState(): DeepthinkConfigState {
        const params = this.modelConfig.getParameters();
        return {
            strategiesCount: params.strategiesCount,
            subStrategiesCount: params.subStrategiesCount,
            hypothesisCount: params.hypothesisCount,
            skipSubStrategies: params.skipSubStrategies,
            hypothesisEnabled: params.hypothesisCount > 0,
            redTeamMode: params.redTeamAggressiveness,
            postQualityFilterEnabled: params.postQualityFilterEnabled,
            refinementEnabled: params.refinementEnabled,
            dissectedObservationsEnabled: params.dissectedObservationsEnabled,
            iterativeCorrectionsEnabled: params.iterativeCorrectionsEnabled,
            iterativeDepth: params.iterativeDepth,
            provideAllSolutionsEnabled: params.provideAllSolutionsToCorrectors,
            temperature: params.temperature,
            topP: params.topP,
            codeExecutionEnabled: params.deepthinkCodeExecutionEnabled,
            hypothesisInjectionMode: params.hypothesisInjectionMode || 'selective_injection',
            shareHypothesesToDissected: params.shareHypothesesToDissected === true
        };
    }

    public getStrategiesCount(): number {
        return this.modelConfig.getStrategiesCount();
    }

    public getSubStrategiesCount(): number {
        return this.modelConfig.getSubStrategiesCount();
    }

    public getHypothesisCount(): number {
        return this.modelConfig.getHypothesisCount();
    }

    public isHypothesisEnabled(): boolean {
        return this.modelConfig.getHypothesisCount() > 0;
    }

    public getSkipSubStrategies(): boolean {
        return this.modelConfig.isSkipSubStrategies();
    }

    public getRedTeamMode(): string {
        return this.modelConfig.getRedTeamAggressiveness();
    }

    public isPostQualityFilterEnabled(): boolean {
        return this.modelConfig.isPostQualityFilterEnabled();
    }

    public isRefinementEnabled(): boolean {
        return this.modelConfig.isRefinementEnabled();
    }

    public isDissectedObservationsEnabled(): boolean {
        return this.modelConfig.isDissectedObservationsEnabled();
    }

    public isIterativeCorrectionsEnabled(): boolean {
        return this.modelConfig.isIterativeCorrectionsEnabled();
    }

    public isProvideAllSolutionsEnabled(): boolean {
        return this.modelConfig.isProvideAllSolutionsToCorrectors();
    }

    public getMaxStrategies(): number {
        return this.isIterativeCorrectionsEnabled() ? MAX_STRATEGIES_WITH_ITERATIVE : MAX_STRATEGIES_DEFAULT;
    }

    public getIterativeDepth(): number {
        return this.modelConfig.getIterativeDepth();
    }

    public isCodeExecutionEnabled(): boolean {
        return this.modelConfig.isDeepthinkCodeExecutionEnabled();
    }

    public getHypothesisInjectionMode(): 'parallel' | 'strategy_aware' | 'selective_injection' {
        return this.modelConfig.getHypothesisInjectionMode();
    }

    // ========== SETTERS WITH BUSINESS LOGIC ==========

    /**
     * Set the strategies count.
     * Enforces max limit based on iterative corrections state.
     */
    public setStrategiesCount(count: number): void {
        const maxAllowed = this.getMaxStrategies();
        const clampedCount = Math.max(1, Math.min(count, maxAllowed));
        this.modelConfig.updateParameter('strategiesCount', clampedCount);
        this.emitChange('strategiesCount');
    }

    /**
     * Set the sub-strategies count.
     * When set to 0, also sets skipSubStrategies to true.
     */
    public setSubStrategiesCount(count: number): void {
        // Cannot change sub-strategies when iterative corrections is enabled
        if (this.isIterativeCorrectionsEnabled()) {
            return;
        }

        let clampedCount = count;
        if (count > 0) {
            clampedCount = Math.max(2, Math.min(count, 5));
        } else {
            clampedCount = 0;
        }
        this.modelConfig.updateParameter('subStrategiesCount', clampedCount);

        // Auto-set skipSubStrategies based on count
        this.modelConfig.updateParameter('skipSubStrategies', clampedCount === 0);

        this.emitChange('subStrategiesCount');
    }

    /**
     * Set skip sub-strategies flag.
     */
    public setSkipSubStrategies(skip: boolean): void {
        // Cannot change when iterative corrections is enabled
        if (this.isIterativeCorrectionsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('skipSubStrategies', skip);
        this.emitChange('skipSubStrategies');
    }

    /**
     * Set hypothesis count.
     * Setting to 0 effectively disables hypothesis.
     */
    public setHypothesisCount(count: number): void {
        const clampedCount = Math.max(0, Math.min(count, 6));
        this.modelConfig.updateParameter('hypothesisCount', clampedCount);
        this.emitChange('hypothesisCount');
    }

    /**
     * Enable or disable hypothesis.
     * When disabled, sets count to 0. When enabled, sets to default (4) if currently 0.
     */
    public setHypothesisEnabled(enabled: boolean): void {
        if (enabled) {
            const currentCount = this.modelConfig.getHypothesisCount();
            if (currentCount === 0) {
                this.modelConfig.updateParameter('hypothesisCount', 4); // Default
            }
        } else {
            this.modelConfig.updateParameter('hypothesisCount', 0);
        }
        this.emitChange('hypothesisEnabled');
    }

    /**
     * Set red team mode.
     */
    public setRedTeamMode(mode: string): void {
        this.modelConfig.updateParameter('redTeamAggressiveness', mode);
        this.emitChange('redTeamMode');
    }

    /**
     * Set refinement enabled state.
     * When disabled, cascades to disable all refinement sub-options.
     */
    public setRefinementEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('refinementEnabled', enabled);

        if (!enabled) {
            // Disable all refinement sub-options
            this.modelConfig.updateParameter('dissectedObservationsEnabled', false);
            this.modelConfig.updateParameter('iterativeCorrectionsEnabled', false);
            this.modelConfig.updateParameter('provideAllSolutionsToCorrectors', false);
            this.modelConfig.updateParameter('postQualityFilterEnabled', false);

            // Re-enable sub-strategies (since iterative corrections is now off)
            // Don't change the value, just allow it to be editable again
        }

        this.emitChange('refinementEnabled');
    }

    /**
     * Set dissected observations (critique synthesis) enabled.
     * Can only be enabled if refinement is on AND iterative corrections is off.
     */
    public setDissectedObservationsEnabled(enabled: boolean): void {
        // Guard: requires refinement enabled and iterative corrections disabled
        if (!this.isRefinementEnabled() || this.isIterativeCorrectionsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('dissectedObservationsEnabled', enabled);
        this.emitChange('dissectedObservationsEnabled');
    }

    /**
     * Set whether hypotheses are shared with dissected observations synthesis agent.
     */
    public setShareHypothesesToDissected(share: boolean): void {
        this.modelConfig.updateParameter('shareHypothesesToDissected', share);
        this.emitChange('shareHypothesesToDissected');
    }

    /**
     * Set iterative corrections enabled.
     * This has the most side-effects:
     * - Limits strategies to max 5
     * - Forces sub-strategies to 0 and disables the control
     * - Disables synthesis and full-context options
     * - Enables post-quality filter option
     */
    public setIterativeCorrectionsEnabled(enabled: boolean): void {
        // Guard: requires refinement enabled
        if (!this.isRefinementEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('iterativeCorrectionsEnabled', enabled);

        if (enabled) {
            // === SIDE EFFECTS WHEN ENABLING ===

            // 1. Limit strategies to max 5
            const currentStrategies = this.modelConfig.getStrategiesCount();
            if (currentStrategies > MAX_STRATEGIES_WITH_ITERATIVE) {
                this.modelConfig.updateParameter('strategiesCount', MAX_STRATEGIES_WITH_ITERATIVE);
            }

            // 2. Force sub-strategies to 0 and disable
            this.modelConfig.updateParameter('subStrategiesCount', 0);
            this.modelConfig.updateParameter('skipSubStrategies', true);

            // 3. Disable synthesis (dissected observations)
            this.modelConfig.updateParameter('dissectedObservationsEnabled', false);

            // 4. Disable full context (provide all solutions)
            this.modelConfig.updateParameter('provideAllSolutionsToCorrectors', false);

        } else {
            // === SIDE EFFECTS WHEN DISABLING ===

            // 1. Disable post-quality filter (requires iterative corrections)
            this.modelConfig.updateParameter('postQualityFilterEnabled', false);

            // Note: We don't auto-enable synthesis or change sub-strategies.
            // User must manually re-enable them if desired.
        }

        this.emitChange('iterativeCorrectionsEnabled');
    }

    /**
     * Set iterative depth (number of correction iterations).
     * Range: 1-10, default 3.
     */
    public setIterativeDepth(depth: number): void {
        const clampedDepth = Math.max(1, Math.min(depth, 10));
        this.modelConfig.updateParameter('iterativeDepth', clampedDepth);
        this.emitChange('iterativeDepth');
    }

    /**
     * Set provide all solutions to correctors (full context) enabled.
     * Can only be enabled if refinement is on AND iterative corrections is off.
     */
    public setProvideAllSolutionsEnabled(enabled: boolean): void {
        // Guard: requires refinement enabled and iterative corrections disabled
        if (!this.isRefinementEnabled() || this.isIterativeCorrectionsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('provideAllSolutionsToCorrectors', enabled);
        this.emitChange('provideAllSolutionsEnabled');
    }

    /**
     * Set post-quality filter enabled.
     * Can only be enabled if iterative corrections is on.
     */
    public setPostQualityFilterEnabled(enabled: boolean): void {
        // Guard: requires iterative corrections enabled
        if (!this.isIterativeCorrectionsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('postQualityFilterEnabled', enabled);
        this.emitChange('postQualityFilterEnabled');
    }

    /**
     * Set temperature.
     */
    public setTemperature(value: number): void {
        this.modelConfig.updateParameter('temperature', value);
        this.emitChange('temperature');
    }

    /**
     * Set top-p.
     */
    public setTopP(value: number): void {
        this.modelConfig.updateParameter('topP', value);
        this.emitChange('topP');
    }

    /**
     * Set code execution enabled for Deepthink agents.
     * Only applies when using Gemini provider.
     */
    public setCodeExecutionEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('deepthinkCodeExecutionEnabled', enabled);
        this.emitChange('codeExecutionEnabled');
    }

    /**
     * Set hypothesis injection mode.
     * Controls how hypotheses interact with strategies:
     * - 'parallel': Current behavior, hypothesis runs independently of strategies
     * - 'strategy_aware': Hypothesis runs after strategies finalize, full packet injected
     * - 'selective_injection': Hypothesis runs after strategies finalize, per-strategy packets
     */
    public setHypothesisInjectionMode(mode: 'parallel' | 'strategy_aware' | 'selective_injection'): void {
        this.modelConfig.updateParameter('hypothesisInjectionMode', mode);
        this.emitChange('hypothesisInjectionMode');
    }

    // ========== EVENT EMISSION ==========

    private emitChange(property: keyof DeepthinkConfigState | 'all'): void {
        const event = new CustomEvent('configchange', {
            detail: {
                property,
                state: this.getState()
            }
        }) as DeepthinkConfigChangeEvent;

        this.dispatchEvent(event);
    }

    /**
     * Force emit a full state update.
     * Useful after initial load or import.
     */
    public emitFullStateUpdate(): void {
        this.emitChange('all');
    }
}
