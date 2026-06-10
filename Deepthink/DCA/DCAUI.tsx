import React, { useState } from 'react';
import { DCASolution } from './DCACore';
import RenderMathMarkdown from '../../Styles/Components/RenderMathMarkdown';
import { Icon } from '../../UI/Icons';
import { BaseModal } from '../Deepthink.tsx';
import './DCACSS.css';
import '../SolutionPool.css';

interface DCAUIProps {
    pipeline: any;
}

export const DCAUI: React.FC<DCAUIProps> = ({ pipeline }) => {
    const [selectedSolution, setSelectedSolution] = useState<DCASolution | null>(null);

    const solutions = pipeline.solutions as DCASolution[];
    if (!solutions || solutions.length === 0) return null;

    const rootSolution = solutions.find(s => s.type === 'root');
    const orthoSolutions = solutions.filter(s => s.type === 'orthogonal');
    const evoSolutions = solutions.filter(s => s.type === 'evolution');

    return (
        <div className="dca-container" style={{ overflowY: 'auto' }}>
            <div className="solution-pool-content-wrapper">
                {/* Root Problem */}
                {rootSolution && (
                    <div className="pool-iteration-container">
                        <div className="pool-iteration-header">
                            <h4 className="pool-iteration-title">Core Problem</h4>
                        </div>
                        <div className="pool-iteration-content">
                            <div className="agent-card" style={{ cursor: 'pointer' }} onClick={() => setSelectedSolution(rootSolution)}>
                                <div className="agent-header">
                                    <h4 className="agent-title">Root Problem</h4>
                                    <span className="status-badge status-completed">Completed</span>
                                </div>
                                <div className="agent-results">
                                    <span className="sp-count-badge">Original Challenge</span>
                                    <button className="view-argument-button view-pool-button">
                                        <Icon name="visibility" /> View Detail
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Orthogonal Solutions */}
                {orthoSolutions.length > 0 && (
                    <div className="pool-iteration-container">
                        <div className="pool-iteration-header">
                            <h4 className="pool-iteration-title">Orthogonal Solutions (Stage 1)</h4>
                        </div>
                        <div className="pool-iteration-content">
                            <div className="agent-grid">
                                {orthoSolutions.map(sol => (
                                    <div key={sol.id} className="agent-card" style={{ cursor: 'pointer' }} onClick={() => setSelectedSolution(sol)}>
                                        <div className="agent-header">
                                            <h4 className="agent-title">{sol.title.length > 25 ? sol.title.substring(0, 25) + "..." : sol.title}</h4>
                                            <span className="status-badge status-completed">Budget: {sol.priority || 2}</span>
                                        </div>
                                        <div className="agent-results">
                                            <span className="sp-count-badge">Orthogonal Pool</span>
                                            <button className="view-argument-button view-pool-button">
                                                <Icon name="visibility" /> View Detail
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Evolved Solutions */}
                {evoSolutions.length > 0 && (
                    <div className="pool-iteration-container">
                        <div className="pool-iteration-header">
                            <h4 className="pool-iteration-title">Dynamic Compute Target Actions (Stage 2)</h4>
                        </div>
                        <div className="pool-iteration-content">
                            <div className="agent-grid">
                                {evoSolutions.map(sol => (
                                    <div key={sol.id} className="agent-card" style={{ cursor: 'pointer' }} onClick={() => setSelectedSolution(sol)}>
                                        <div className="agent-header">
                                            <h4 className="agent-title" style={{color: 'var(--accent-teal)'}}>{sol.title.length > 25 ? sol.title.substring(0, 25) + "..." : sol.title}</h4>
                                            <span className="status-badge" style={{background: 'rgba(20, 184, 166, 0.15)', color: 'var(--accent-teal)'}}>Evolved target</span>
                                        </div>
                                        <div className="agent-results">
                                            <span className="sp-count-badge">Local Agent Action</span>
                                            <button className="view-argument-button view-pool-button">
                                                <Icon name="visibility" /> View Detail
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {selectedSolution && (
                <BaseModal
                    title={selectedSolution.title}
                    isEmbedded={true}
                    onClose={() => setSelectedSolution(null)}
                >
                    <div className="sp-card-content-wrapper p-6" style={{ height: '100%', padding: '1.5rem' }}>
                        {selectedSolution.priority && (
                            <div style={{ marginBottom: '1rem' }}>
                                <span className="sp-confidence-badge high">
                                    Budget: {selectedSolution.priority}
                                </span>
                            </div>
                        )}
                        <RenderMathMarkdown content={selectedSolution.content} className="sp-card-content" />
                    </div>
                </BaseModal>
            )}
        </div>
    );
};
