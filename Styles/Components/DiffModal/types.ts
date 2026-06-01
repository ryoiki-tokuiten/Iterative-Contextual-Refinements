export type DiffContentType = 'html' | 'text';
export type DiffViewMode = 'split' | 'unified';

export interface ContentState {
    content: string;
    title: string;
    iterationNumber: number;
    isBugFix: boolean;
}

export interface SequentialState {
    contentStates: Array<{ title: string; content: string }>;
    currentIteration: number;
    isPlaying: boolean;
    speed: number;
    animationFrame: number | null;
    currentLineIndex: number;
    viewMode: DiffViewMode;
}

export interface EvolutionViewerState {
    scrollContainer: HTMLElement;
    lastCount: number;
}
