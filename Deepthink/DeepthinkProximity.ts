/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ProximityRole = 'generator' | 'proximity';

export interface ProximityTurn {
    role: ProximityRole;
    content: string;
    version: number;
}

export function normalizeProximityHistory(value: unknown): ProximityTurn[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const turn = entry as Partial<ProximityTurn>;
        if ((turn.role !== 'generator' && turn.role !== 'proximity') || typeof turn.content !== 'string') {
            return [];
        }
        return [{
            role: turn.role,
            content: turn.content,
            version: Number.isFinite(turn.version) ? Number(turn.version) : 1,
        }];
    });
}

export function formatProximityHistory(history: ProximityTurn[]): string {
    if (!history.length) return 'No earlier generator/proximity turns.';
    return history
        .map(turn => `<${turn.role === 'generator' ? 'Generator' : 'Proximity'}>\n${turn.content}\n</${turn.role === 'generator' ? 'Generator' : 'Proximity'}>`)
        .join('\n\n');
}

/** Runs G → (P → G) × loops on a copy of the pair's persistent history. */
export async function refineWithProximity<T>(args: {
    history?: ProximityTurn[];
    loops: number;
    version?: number;
    generate: (history: string, revision: boolean, round: number) => Promise<{ candidates: T[]; output: string }>;
    review: (candidates: T[], history: string, round: number) => Promise<string>;
    onHistory?: (history: ProximityTurn[]) => void;
}): Promise<{ candidates: T[]; history: ProximityTurn[] }> {
    const history = normalizeProximityHistory(args.history);
    const version = args.version || Math.max(0, ...history.map(turn => turn.version)) + 1;
    const append = (role: ProximityRole, content: string) => {
        history.push({ role, content, version });
        args.onHistory?.([...history]);
    };

    let generated = await args.generate(formatProximityHistory(history), false, 0);
    append('generator', generated.output);

    const loops = Math.max(1, Math.min(5, Math.round(Number.isFinite(args.loops) ? args.loops : 2)));
    for (let round = 1; round <= loops; round++) {
        append('proximity', await args.review(generated.candidates, formatProximityHistory(history), round));
        generated = await args.generate(formatProximityHistory(history), true, round);
        append('generator', generated.output);
    }
    return { candidates: generated.candidates, history };
}
