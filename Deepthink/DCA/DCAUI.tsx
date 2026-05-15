/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'motion/react';
import { DCASolution, getActiveDCAPipeline } from './DCACore';
import RenderMathMarkdown from '../../Styles/Components/RenderMathMarkdown';
import { Icon } from '../../UI/Icons';
import { BaseModal } from '../Deepthink.tsx';
import './DCACSS.css';
import '../SolutionPool.css';

interface DCAUIProps {
    pipeline: any;
}

const DCANode: React.FC<{
    node: d3.HierarchyPointNode<DCASolution>;
    onClick: (s: DCASolution) => void;
}> = ({ node, onClick }) => {
    const { data, x, y } = node;
    const isRoot = data.type === 'root';
    const isOrtho = data.type === 'orthogonal';
    const isEvo = data.type === 'evolution';

    return (
        <motion.g
            className="dca-node"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: node.depth * 0.1 }}
            transform={`translate(${y},${x})`}
            onClick={() => onClick(data)}
        >
            <circle
                r={isRoot ? 25 : isOrtho ? 18 : 12}
                className={`dca-node-circle ${data.type}`}
            />
            <text
                dy=".31em"
                x={isRoot ? 0 : 25}
                className="dca-node-text"
                style={{ textAnchor: isRoot ? 'middle' : 'start', fill: 'white' }}
            >
                {data.title.length > 15 ? data.title.slice(0, 15) + '...' : data.title}
            </text>
        </motion.g>
    );
};

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
                            <div className="red-team-agent-card" style={{ cursor: 'pointer' }} onClick={() => setSelectedSolution(rootSolution)}>
                                <div className="red-team-agent-header">
                                    <h4 className="red-team-agent-title">Root Problem</h4>
                                    <span className="status-badge status-completed">Completed</span>
                                </div>
                                <div className="red-team-results">
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
                            <div className="red-team-agents-grid">
                                {orthoSolutions.map(sol => (
                                    <div key={sol.id} className="red-team-agent-card" style={{ cursor: 'pointer' }} onClick={() => setSelectedSolution(sol)}>
                                        <div className="red-team-agent-header">
                                            <h4 className="red-team-agent-title">{sol.title.length > 25 ? sol.title.substring(0, 25) + "..." : sol.title}</h4>
                                            <span className="status-badge status-completed">Budget: {sol.priority || 2}</span>
                                        </div>
                                        <div className="red-team-results">
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
                            <div className="red-team-agents-grid">
                                {evoSolutions.map(sol => (
                                    <div key={sol.id} className="red-team-agent-card" style={{ cursor: 'pointer' }} onClick={() => setSelectedSolution(sol)}>
                                        <div className="red-team-agent-header">
                                            <h4 className="red-team-agent-title" style={{color: 'var(--accent-teal)'}}>{sol.title.length > 25 ? sol.title.substring(0, 25) + "..." : sol.title}</h4>
                                            <span className="status-badge" style={{background: 'rgba(20, 184, 166, 0.15)', color: 'var(--accent-teal)'}}>Evolved target</span>
                                        </div>
                                        <div className="red-team-results">
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
