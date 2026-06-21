/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { nanoid } from 'nanoid';
import { globalState } from '../../Core/State';
import { describeProviderError } from '../../Core/ProviderError';
import { callAI, getSelectedModel, getSelectedTemperature, getSelectedTopP } from '../../Routing';
import { parseJsonSafe } from "../../Core/JsonParser";
import { updateControlsState } from '../../UI/Controls';

export interface DCASolution {
    id: string;
    title: string;
    content: string;
    priority?: number;
    parentId?: string;
    type: 'root' | 'orthogonal' | 'evolution';
}

export interface DCAPipelineState {
    id: string;
    problem: string;
    status: 'idle' | 'processing' | 'completed' | 'error' | 'cancelled';
    error?: string;
    solutions: DCASolution[];
    isStopRequested?: boolean;
}

export let activeDCAPipeline: DCAPipelineState | null = null;
let render: () => void = () => { };

export function initializeDCACore(renderFn: () => void) {
    render = renderFn;
}

export function getActiveDCAPipeline() {
    return activeDCAPipeline;
}

export function setDCAStateForImport(state: DCAPipelineState) {
    activeDCAPipeline = state;
}

export async function startDCAProcess(problem: string) {
    activeDCAPipeline = {
        id: `dca-${nanoid(12)}`,
        problem,
        status: 'processing',
        solutions: [{ id: 'root', title: 'Problem', content: problem, type: 'root' }],
    };

    globalState.isDCARunning = true;
    updateControlsState();
    render();

    try {
        // Stage 1: Pool Generator
        const prompts = globalState.customPromptsDCAState;
        
        const poolResponse = await callAI(
            [{ text: problem }],
            getSelectedTemperature(),
            getSelectedModel(),
            prompts.sys_pool_generator,
            true,
            getSelectedTopP()
        );

        const poolData = parseJsonSafe(poolResponse.text || '', 'DCA Pool Generator');
        const orthogonalSolutions: any[] = poolData.solutions || [];

        const layer1Solutions: DCASolution[] = orthogonalSolutions.slice(0, 10).map((s, idx) => ({
            id: `ortho-${idx}`,
            title: s.title,
            content: s.content,
            priority: Math.min(Math.max(s.priority || 2, 2), 5),
            parentId: 'root',
            type: 'orthogonal'
        }));

        activeDCAPipeline.solutions.push(...layer1Solutions);
        render();

        // Stage 2: Local Pool Agents (Parallel)
        await Promise.all(layer1Solutions.map(async (solution) => {
            if (activeDCAPipeline?.isStopRequested) return;

            const fullPoolText = layer1Solutions
                .filter(s => s.id !== solution.id)
                .map((s, i) => `[ID: ortho-${i}] ${s.title}: ${s.content}`)
                .join('\n\n');

            const localPrompt = prompts.sys_local_pool_agent
                .replace('{{solutionId}}', solution.id)
                .replace('{{priority}}', (solution.priority || 2).toString())
                .replace('{{fullPool}}', fullPoolText);

            const localResponse = await callAI(
                [{ text: `Evolve solution ${solution.id}` }],
                getSelectedTemperature(),
                getSelectedModel(),
                localPrompt,
                true,
                getSelectedTopP()
            );

            const localData = parseJsonSafe(localResponse.text || '', `DCA Local Agent ${solution.id}`);
            const evolutions: any[] = localData.evolutions || [];

            const evolutionSolutions: DCASolution[] = evolutions.slice(0, solution.priority).map((e, idx) => ({
                id: `${solution.id}-evo-${idx}`,
                title: e.title,
                content: e.content,
                parentId: solution.id,
                type: 'evolution'
            }));

            activeDCAPipeline?.solutions.push(...evolutionSolutions);
            render();
        }));

        if (activeDCAPipeline) activeDCAPipeline.status = 'completed';
    } catch (error: any) {
        if (activeDCAPipeline) {
            activeDCAPipeline.status = 'error';
            activeDCAPipeline.error = describeProviderError(error);
        }
    } finally {
        globalState.isDCARunning = false;
        updateControlsState();
        render();
    }
}

export function stopDCAProcess() {
    if (activeDCAPipeline) {
        activeDCAPipeline.isStopRequested = true;
        activeDCAPipeline.status = 'cancelled';
        globalState.isDCARunning = false;
        updateControlsState();
    }
}
