import { IterationData } from '../Core/Types';

export function getEmptyStateMessage(status: IterationData['status'] | string, contentType: string): string {
    switch (status) {
        case 'pending': return `${contentType} generation is pending.`;
        case 'processing':
        case 'retrying': return `Generating ${contentType}...`;
        case 'cancelled': return `${contentType} generation was cancelled by the user.`;
        case 'error': return `An error occurred while generating ${contentType}.`;
        default: return `No valid ${contentType} was generated.`;
    }
}
