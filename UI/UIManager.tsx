import React from 'react';
import { getCurrentMode, getModeTitle } from './UIManager';
import { Icon } from './Icons';

export const ModeHeaderTitle: React.FC = () => {
    const mode = getCurrentMode();
    return <>{getModeTitle(mode)}</>;
};

export const EmptyState: React.FC = () => {
    return (
        <div className="empty-state">
            <div className="empty-state-icon"><Icon name="lightbulb" /></div>
            <h3>Ready to Create</h3>
            <p>Enter your idea above and click "Generate" to start the iterative refinement process.</p>
        </div>
    );
};
