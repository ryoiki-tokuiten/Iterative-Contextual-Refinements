/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigManager, type ModelParameters } from './ModelConfig';

/**
 * Pure function: calculates the estimated API call range for Deepthink mode.
 * Returns { min, max } to account for variable retry loops.
 */
export function calculateDeepthinkApiCallsFromParams(params: ModelParameters): { min: number; max: number } {
    const evolvingDfsEnabled = params.refinementEnabled && params.evolvingDfsEnabled;
    const strategiesCount = evolvingDfsEnabled ? Math.min(params.strategiesCount, 5) : params.strategiesCount;
    const subStrategiesCount = params.subStrategiesCount;
    const hypothesisCount = params.hypothesisCount;
    const skipSubStrategies = evolvingDfsEnabled ? true : params.skipSubStrategies;
    const refinementEnabled = params.refinementEnabled;
    const dissectedObservationsEnabled = params.dissectedObservationsEnabled;

    let minCalls = 0;
    let maxCalls = 0;

    // 1. Initial Strategy Generation (1 call)
    minCalls += 1;
    maxCalls += 1;

    // 2. Sub-Strategy Generation (N calls - one per strategy, if not skipped)
    if (!skipSubStrategies && !evolvingDfsEnabled) {
        minCalls += strategiesCount;
        maxCalls += strategiesCount;
    }

    const solutionCount = skipSubStrategies ? strategiesCount : (strategiesCount * subStrategiesCount);

    if (evolvingDfsEnabled) {
        const evolvingDfsDepth = Math.max(1, Math.min(params.evolvingDfsDepth, 10));

        // Initial hypothesis round, plus a heartbeat at every even completed global iteration.
        if (hypothesisCount > 0) {
            const hypothesisRounds = 1 + Math.floor(evolvingDfsDepth / 2);
            minCalls += hypothesisRounds * (1 + hypothesisCount);
            maxCalls += hypothesisRounds * (1 + hypothesisCount);
        }

        // For each active strategy branch:
        // depth 1: execution + critique + pool
        // later depths: correction + critique + pool
        minCalls += strategiesCount * evolvingDfsDepth * 3;
        maxCalls += strategiesCount * evolvingDfsDepth * 3;

        // Every five completed branch iterations: memory per branch + ceil(N/2) PQF agents.
        // If PQF requests updates, one strategy-update call plus execution+critique for each updated branch.
        const maintenancePasses = Math.floor(evolvingDfsDepth / 5);
        const pqfAgentCount = Math.ceil(strategiesCount / 2);
        minCalls += maintenancePasses * (strategiesCount + pqfAgentCount);
        maxCalls += maintenancePasses * (strategiesCount + pqfAgentCount + 1 + (strategiesCount * 2));
    } else {
        // 3. Solution Attempts
        minCalls += solutionCount;
        maxCalls += solutionCount;

        // 4-5. Hypothesis Track (only if hypothesis count > 0)
        if (hypothesisCount > 0) {
            minCalls += 1 + hypothesisCount;
            maxCalls += 1 + hypothesisCount;
        }

        if (refinementEnabled) {
            // Standard Refinement Mode
            minCalls += solutionCount;
            maxCalls += solutionCount;

            if (dissectedObservationsEnabled) {
                minCalls += 1;
                maxCalls += 1;
            }

            minCalls += solutionCount;
            maxCalls += solutionCount;
        }
    }

    // Final Judging (1 call to select best solution)
    minCalls += 1;
    maxCalls += 1;

    return { min: minCalls, max: maxCalls };
}

export class ApiCallEstimator {
    private modelConfig: ModelConfigManager;
    private countElement: HTMLElement | null;
    private warningElement: HTMLElement | null;
    private pqfWarningElement: HTMLElement | null;

    constructor(modelConfig: ModelConfigManager) {
        this.modelConfig = modelConfig;
        this.countElement = document.getElementById('api-call-count');
        this.warningElement = document.getElementById('api-call-warning');
        this.pqfWarningElement = document.getElementById('api-call-pqf-warning');
    }

    /**
     * Calculate estimated API calls for Deepthink mode
     * Returns a range { min, max } to account for variable retry loops
     */
    /**
     * Calculate estimated API calls for Deepthink mode.
     * Delegates to the pure standalone function.
     */
    public calculateDeepthinkApiCalls(): { min: number; max: number } {
        return calculateDeepthinkApiCallsFromParams(this.modelConfig.getParameters());
    }

    /**
     * Update the UI with the estimated API call count
     */
    public updateApiCallDisplay(): void {
        const { min, max } = this.calculateDeepthinkApiCalls();
        const params = this.modelConfig.getParameters();
        const evolvingDfsEnabled = params.refinementEnabled && params.evolvingDfsEnabled;

        // Update the count display
        if (this.countElement) {
            if (min === max) {
                this.countElement.textContent = `~${min}`;
            } else {
                this.countElement.textContent = `~${min} to ${max}`;
            }
        }

        // The evaluation warning is no longer shown.
        if (this.warningElement) {
            this.warningElement.style.display = 'none';
        }

        // Show/hide the PQF warning icon
        if (this.pqfWarningElement) {
            if (evolvingDfsEnabled) {
                this.pqfWarningElement.style.display = 'block';
            } else {
                this.pqfWarningElement.style.display = 'none';
            }
        }
    }

    /**
     * Attach event listeners to update on parameter changes
     */
    public attachListeners(): void {
        // Listen to all parameter changes
        const sliders = [
            'strategies-slider',
            'sub-strategies-slider',
            'hypothesis-slider',
            'dt-evolving-dfs-depth-slider'
        ];

        sliders.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', () => this.updateApiCallDisplay());
            }
        });

        // Listen to toggle changes
        const toggles = [
            'refinement-toggle',
            'skip-sub-strategies-toggle',
            'dissected-observations-toggle',
            'evolving-dfs-toggle',
            'hypothesis-toggle'
        ];

        toggles.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.updateApiCallDisplay());
            }
        });

        // Listen to PQF aggressiveness button clicks
        const pqfButtons = document.querySelectorAll('.pqf-button');
        pqfButtons.forEach(button => {
            button.addEventListener('click', () => {
                setTimeout(() => this.updateApiCallDisplay(), 50);
            });
        });

        // Initial update
        this.updateApiCallDisplay();
    }
}
