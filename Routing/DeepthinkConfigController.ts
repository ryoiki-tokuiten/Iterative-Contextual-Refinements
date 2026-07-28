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

import { MAX_HYPOTHESIS_COUNT, ModelConfigManager } from './ModelConfig';

export interface DeepthinkConfigState {
    strategiesCount: number;
    strategyProximityLoops: number;
    subStrategiesCount: number;
    hypothesisCount: number;
    hypothesisProximityLoops: number;
    skipSubStrategies: boolean;
    hypothesisEnabled: boolean;
    pqfMode: string;
    postQualityFilterEnabled: boolean;
    refinementEnabled: boolean;
    dissectedObservationsEnabled: boolean;
    evolvingDfsEnabled: boolean;
    evolvingDfsDepth: number;
    isolateBranches: boolean;
    disableSolutionPool: boolean;
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
const MAX_STRATEGIES_WITH_EVOLVING_DFS = 5;
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
            strategyProximityLoops: this.modelConfig.getStrategyProximityLoops(),
            subStrategiesCount: params.subStrategiesCount,
            hypothesisCount: this.modelConfig.getHypothesisCount(),
            hypothesisProximityLoops: this.modelConfig.getHypothesisProximityLoops(),
            skipSubStrategies: params.skipSubStrategies,
            hypothesisEnabled: params.hypothesisCount > 0,
            pqfMode: params.pqfAggressiveness,
            postQualityFilterEnabled: params.evolvingDfsEnabled && params.refinementEnabled ? true : params.postQualityFilterEnabled,
            refinementEnabled: params.refinementEnabled,
            dissectedObservationsEnabled: params.dissectedObservationsEnabled,
            evolvingDfsEnabled: params.evolvingDfsEnabled,
            evolvingDfsDepth: params.evolvingDfsDepth,
            isolateBranches: params.isolateBranches === true,
            disableSolutionPool: params.disableSolutionPool === true,
            provideAllSolutionsEnabled: params.provideAllSolutionsToCorrectors,
            temperature: params.temperature,
            topP: params.topP,
            codeExecutionEnabled: params.deepthinkCodeExecutionEnabled,
            hypothesisInjectionMode: params.evolvingDfsEnabled && params.refinementEnabled
                ? 'selective_injection'
                : params.hypothesisInjectionMode || 'selective_injection',
            shareHypothesesToDissected: params.shareHypothesesToDissected === true
        };
    }

    public getStrategiesCount(): number {
        return this.modelConfig.getStrategiesCount();
    }

    public getSubStrategiesCount(): number {
        return this.modelConfig.getSubStrategiesCount();
    }

    public getStrategyProximityLoops(): number {
        return this.modelConfig.getStrategyProximityLoops();
    }

    public getHypothesisCount(): number {
        return this.modelConfig.getHypothesisCount();
    }

    public getHypothesisProximityLoops(): number {
        return this.modelConfig.getHypothesisProximityLoops();
    }

    public isHypothesisEnabled(): boolean {
        return this.modelConfig.getHypothesisCount() > 0;
    }

    public getSkipSubStrategies(): boolean {
        return this.modelConfig.isSkipSubStrategies();
    }

    public getPqfMode(): string {
        return this.modelConfig.getPqfAggressiveness();
    }

    public isPostQualityFilterEnabled(): boolean {
        return this.isEvolvingDfsEnabled() || this.modelConfig.isPostQualityFilterEnabled();
    }

    public isRefinementEnabled(): boolean {
        return this.modelConfig.isRefinementEnabled();
    }

    public isDissectedObservationsEnabled(): boolean {
        return this.modelConfig.isDissectedObservationsEnabled();
    }

    public isEvolvingDfsEnabled(): boolean {
        return this.modelConfig.isEvolvingDfsEnabled();
    }

    public isProvideAllSolutionsEnabled(): boolean {
        return this.modelConfig.isProvideAllSolutionsToCorrectors();
    }

    public getMaxStrategies(): number {
        return this.isEvolvingDfsEnabled() ? MAX_STRATEGIES_WITH_EVOLVING_DFS : MAX_STRATEGIES_DEFAULT;
    }

    public getEvolvingDfsDepth(): number {
        return this.modelConfig.getEvolvingDfsDepth();
    }

    public isIsolateBranchesEnabled(): boolean {
        return this.modelConfig.isIsolateBranchesEnabled();
    }

    public isSolutionPoolDisabled(): boolean {
        return this.modelConfig.isSolutionPoolDisabled();
    }

    public isCodeExecutionEnabled(): boolean {
        return this.modelConfig.isDeepthinkCodeExecutionEnabled();
    }

    public getHypothesisInjectionMode(): 'parallel' | 'strategy_aware' | 'selective_injection' {
        return this.isEvolvingDfsEnabled() ? 'selective_injection' : this.modelConfig.getHypothesisInjectionMode();
    }

    // ========== SETTERS WITH BUSINESS LOGIC ==========

    /**
     * Set the strategies count.
     * Enforces max limit based on Evolving Depth First Search state.
     */
    public setStrategiesCount(count: number): void {
        const maxAllowed = this.getMaxStrategies();
        const clampedCount = Math.max(1, Math.min(count, maxAllowed));
        this.modelConfig.updateParameter('strategiesCount', clampedCount);
        this.emitChange('strategiesCount');
    }

    public setStrategyProximityLoops(count: number): void {
        const clampedCount = Math.max(1, Math.min(5, Math.round(count)));
        this.modelConfig.updateParameter('strategyProximityLoops', clampedCount);
        this.emitChange('strategyProximityLoops');
    }

    /**
     * Set the sub-strategies count.
     * When set to 0, also sets skipSubStrategies to true.
     */
    public setSubStrategiesCount(count: number): void {
        // Cannot change sub-strategies when Evolving DFS is enabled
        if (this.isEvolvingDfsEnabled()) {
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
        // Cannot change while Evolving DFS is enabled
        if (this.isEvolvingDfsEnabled()) {
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
        const clampedCount = Math.max(0, Math.min(count, MAX_HYPOTHESIS_COUNT));
        this.modelConfig.updateParameter('hypothesisCount', clampedCount);
        this.emitChange('hypothesisCount');
    }

    public setHypothesisProximityLoops(count: number): void {
        const clampedCount = Math.max(1, Math.min(5, Math.round(count)));
        this.modelConfig.updateParameter('hypothesisProximityLoops', clampedCount);
        this.emitChange('hypothesisProximityLoops');
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
     * Set PQF aggressiveness mode.
     */
    public setPqfMode(mode: string): void {
        this.modelConfig.updateParameter('pqfAggressiveness', this.isEvolvingDfsEnabled() && mode === 'off' ? 'balanced' : mode);
        this.emitChange('pqfMode');
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
            this.modelConfig.updateParameter('evolvingDfsEnabled', false);
            this.modelConfig.updateParameter('provideAllSolutionsToCorrectors', false);
            this.modelConfig.updateParameter('postQualityFilterEnabled', false);

            // Re-enable sub-strategies (since Evolving Depth First Search is now off)
            // Don't change the value, just allow it to be editable again
        }

        this.emitChange('refinementEnabled');
    }

    /**
     * Set dissected observations (critique synthesis) enabled.
     * Can only be enabled if refinement is on AND Evolving Depth First Search is off.
     */
    public setDissectedObservationsEnabled(enabled: boolean): void {
        // Guard: requires refinement enabled and Evolving Depth First Search disabled
        if (!this.isRefinementEnabled() || this.isEvolvingDfsEnabled()) {
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
     * Set Evolving Depth First Search enabled.
     * This has the most side-effects:
     * - Limits strategies to max 5
     * - Forces sub-strategies to 0 and disables the control
     * - Disables synthesis and full-context options
     * - Enables post-quality filter option
     */
    public setEvolvingDfsEnabled(enabled: boolean): void {
        // Guard: requires refinement enabled
        if (!this.isRefinementEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('evolvingDfsEnabled', enabled);

        if (enabled) {
            // === SIDE EFFECTS WHEN ENABLING ===

            // 1. Limit strategies to max 5
            const currentStrategies = this.modelConfig.getStrategiesCount();
            if (currentStrategies > MAX_STRATEGIES_WITH_EVOLVING_DFS) {
                this.modelConfig.updateParameter('strategiesCount', MAX_STRATEGIES_WITH_EVOLVING_DFS);
            }

            // 2. Force sub-strategies to 0 and disable
            this.modelConfig.updateParameter('subStrategiesCount', 0);
            this.modelConfig.updateParameter('skipSubStrategies', true);

            // 3. Disable synthesis (dissected observations)
            this.modelConfig.updateParameter('dissectedObservationsEnabled', false);

            // 4. Disable full context (provide all solutions)
            this.modelConfig.updateParameter('provideAllSolutionsToCorrectors', false);

            // 5. PQF is required for Evolving Depth First Search
            this.modelConfig.updateParameter('postQualityFilterEnabled', true);

            // 6. Hypothesis injection must be selective in Evolving DFS
            this.modelConfig.updateParameter('hypothesisInjectionMode', 'selective_injection');

            // 7. PQF aggressiveness cannot be "off" while the mode is active
            if (this.modelConfig.getPqfAggressiveness() === 'off') {
                this.modelConfig.updateParameter('pqfAggressiveness', 'balanced');
            }

        } else {
            // === SIDE EFFECTS WHEN DISABLING ===

            // 1. Disable post-quality filter (requires Evolving DFS)
            this.modelConfig.updateParameter('postQualityFilterEnabled', false);

            // Note: We don't auto-enable synthesis or change sub-strategies.
            // User must manually re-enable them if desired.
        }

        this.emitChange('evolvingDfsEnabled');
    }

    /**
     * Set Evolving DFS depth (number of correction iterations).
     * Range: 1-10, default 3.
     */
    public setEvolvingDfsDepth(depth: number): void {
        const clampedDepth = Math.max(1, Math.min(depth, 10));
        this.modelConfig.updateParameter('evolvingDfsDepth', clampedDepth);
        this.emitChange('evolvingDfsDepth');
    }

    /**
     * Keep correction and solution-pool context local to each Evolving DFS branch.
     */
    public setIsolateBranchesEnabled(enabled: boolean): void {
        if (!this.isEvolvingDfsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('isolateBranches', enabled);
        this.emitChange('isolateBranches');
    }

    /**
     * Skip solution-pool agent calls while preserving the Evolving DFS stage lifecycle.
     */
    public setSolutionPoolDisabled(disabled: boolean): void {
        if (!this.isEvolvingDfsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('disableSolutionPool', disabled);
        this.emitChange('disableSolutionPool');
    }

    /**
     * Set provide all solutions to correctors (full context) enabled.
     * Can only be enabled if refinement is on AND Evolving Depth First Search is off.
     */
    public setProvideAllSolutionsEnabled(enabled: boolean): void {
        // Guard: requires refinement enabled and Evolving Depth First Search disabled
        if (!this.isRefinementEnabled() || this.isEvolvingDfsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('provideAllSolutionsToCorrectors', enabled);
        this.emitChange('provideAllSolutionsEnabled');
    }

    /**
     * Set post-quality filter enabled.
     * Can only be enabled if Evolving Depth First Search is on.
     */
    public setPostQualityFilterEnabled(_enabled: boolean): void {
        // Guard: requires Evolving DFS enabled
        if (!this.isEvolvingDfsEnabled()) {
            return;
        }

        this.modelConfig.updateParameter('postQualityFilterEnabled', true);
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
     * Set backend sandbox tool access for every Deepthink agent.
     */
    public setCodeExecutionEnabled(enabled: boolean): void {
        this.modelConfig.updateParameter('deepthinkCodeExecutionEnabled', enabled);
        this.emitChange('codeExecutionEnabled');
        window.dispatchEvent(new CustomEvent('sandboxToggled', { detail: { enabled } }));
    }

    /**
     * Set hypothesis injection mode.
     * Controls how hypotheses interact with strategies:
     * - 'parallel': Current behavior, hypothesis runs independently of strategies
     * - 'strategy_aware': Hypothesis runs after strategies finalize, full packet injected
     * - 'selective_injection': Hypothesis runs after strategies finalize, per-strategy packets
     */
    public setHypothesisInjectionMode(mode: 'parallel' | 'strategy_aware' | 'selective_injection'): void {
        this.modelConfig.updateParameter('hypothesisInjectionMode', this.isEvolvingDfsEnabled() ? 'selective_injection' : mode);
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
