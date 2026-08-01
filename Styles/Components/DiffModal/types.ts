export type DiffViewMode = 'split' | 'unified';

export interface ContentState {
    content: string;
    title: string;
    iterationNumber: number;
    isBugFix: boolean;
}

export interface EvolutionViewerState {
    scrollContainer: HTMLElement;
    lastCount: number;
}
