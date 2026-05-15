/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DCAUI } from './DCAUI';
import { getActiveDCAPipeline, startDCAProcess, stopDCAProcess } from './DCACore';
import { Icon } from '../../UI/Icons';

export const DCAView: React.FC = () => {
    const pipeline = getActiveDCAPipeline();

    if (!pipeline) {
        return (
            <div className="solution-pool-empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="dynamic_form" className="empty-icon" />
                <h4>Dynamic Compute Allocation</h4>
                <p>Enter a problem in the sidebar and press Generate to start.</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col">
            <div className="solution-pool-header" style={{ padding: '20px 40px', borderBottom: '1px solid var(--border-color)' }}>
                <div className="solution-pool-header-left">
                    <Icon name="workspaces" className="solution-pool-icon" />
                    <div className="solution-pool-title-group">
                        <h3 className="solution-pool-title">Dynamic Compute Allocation</h3>
                        <p className="solution-pool-subtitle">Process: {pipeline.id}</p>
                    </div>
                </div>
                <div className="solution-pool-header-buttons">
                    {pipeline.status === 'processing' && (
                        <button className="solution-pool-download-button" style={{color: '#f87171', border: '1px solid rgba(248, 113, 113, 0.2)'}} onClick={stopDCAProcess}>
                            <Icon name="stop" /> Stop Process
                        </button>
                    )}
                    <span className={`status-badge ${pipeline.status === 'completed' ? 'status-completed' : pipeline.status === 'error' ? 'status-error' : 'status-pending'}`}>
                        {pipeline.status.toUpperCase()}
                    </span>
                </div>
            </div>
            {pipeline.error && (
                <div className="p-4 bg-red-900/20 text-red-400 border-b border-red-900/40">
                    Error: {pipeline.error}
                </div>
            )}
            <div className="flex-1 overflow-hidden">
                <DCAUI pipeline={pipeline} />
            </div>
        </div>
    );
};

