import React, { useMemo, useState, useCallback } from 'react';
import { EyeIcon, EditIcon, CopyIcon, CheckIcon } from '../icons';
import { PromptBlockData } from './types';
import type { Node, Edge } from 'reactflow';
import { getSortedNodes } from './constants';

interface PropertiesPanelProps {
    selectedNode: Node<PromptBlockData> | undefined;
    onNodeDataChange: (nodeId: string, newData: Partial<PromptBlockData>) => void;
    nodes: Node<PromptBlockData>[];
    edges: Edge[];
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ selectedNode, onNodeDataChange, nodes, edges }) => {
    const [isCopied, setIsCopied] = useState(false);

    const livePrompt = useMemo(() => {
        const sorted = getSortedNodes(nodes, edges);
        return sorted.map(node => node.data.content).join('\n\n---\n\n');
    }, [nodes, edges]);

    const handleCopy = useCallback(() => {
        if (!livePrompt) return;
        navigator.clipboard.writeText(livePrompt).then(() => {
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        });
    }, [livePrompt]);

    const handleDataChange = (key: keyof PromptBlockData, value: string) => {
        if (selectedNode) {
            onNodeDataChange(selectedNode.id, { [key]: value });
        }
    }

    return (
        <aside className="prompt-builder__panel prompt-builder__panel--right custom-scrollbar">
            {selectedNode ? (
                <>
                    <h2 className="prompt-builder__panel-title">
                        <EditIcon className="icon" />
                        Block Properties
                    </h2>
                    <div className="form-group">
                        <label htmlFor="nodeName" className="form-label">Block Name</label>
                        <input
                            id="nodeName"
                            type="text"
                            value={selectedNode.data.name}
                            onChange={(e) => handleDataChange('name', e.target.value)}
                            className="form-input"
                        />
                    </div>
                    <div className="form-group" style={{flex: '1 1 auto', display: 'flex', flexDirection: 'column'}}>
                        <label htmlFor="nodeContent" className="form-label">Block Content</label>
                        <textarea
                            id="nodeContent"
                            value={selectedNode.data.content}
                            onChange={(e) => handleDataChange('content', e.target.value)}
                            className="form-textarea"
                            style={{flexGrow: 1}}
                        />
                    </div>
                </>
            ) : (
                <div className="properties-panel__placeholder">
                    <EditIcon className="icon" style={{width: '2rem', height: '2rem'}}/>
                    <h2 style={{color: 'var(--text-primary)', fontSize: '1.2rem'}}>Properties</h2>
                    <p>Select a block on the canvas to edit its properties here.</p>
                </div>
            )}
            
            <div className="form-group" style={{flex: '1 1 auto', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border-primary)', paddingTop: 'var(--space-lg)'}}>
                <h2 className="prompt-builder__panel-title" style={{borderBottom: 'none', paddingBottom: 0, marginBottom: 'var(--space-md)', justifyContent: 'space-between', alignItems: 'center'}}>
                    <span style={{display: 'flex', alignItems: 'center', gap: 'var(--space-sm)'}}>
                        <EyeIcon className="icon" />
                        Live Prompt Preview
                    </span>
                    <button className="btn btn--secondary btn--icon btn--sm" onClick={handleCopy} disabled={!livePrompt || isCopied} title="Copy live prompt">
                        {isCopied ? <CheckIcon className="icon" /> : <CopyIcon className="icon" />}
                    </button>
                </h2>
                <textarea
                    readOnly
                    value={livePrompt}
                    className="form-textarea"
                    style={{flexGrow: 1, backgroundColor: 'var(--bg-primary)'}}
                    placeholder="Your complete prompt will appear here as you build."
                />
            </div>
        </aside>
    );
};