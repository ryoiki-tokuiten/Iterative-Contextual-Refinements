import React, { useState, useEffect } from 'react';
import { Prompt, PromptVersion } from '../types';
import { ChevronUpIcon, ChevronDownIcon, SparklesIcon, ClipboardDocumentListIcon, EditIcon, DeleteIcon, ClockIcon, CheckIcon, ArrowUturnLeftIcon, CopyIcon } from './icons';

type Tab = 'content' | 'config' | 'instructions' | 'rules';

interface PromptListItemProps {
    prompt: Prompt;
    isExpanded: boolean;
    displayedData: PromptVersion | null;
    currentPromptObject: Prompt | null | undefined;
    selectedHistoricalVersionNumber: number | null;
    onToggleExpand: (id: string) => void;
    onUpdateEvaluation: (id: string, versionNumber: number, value: number) => void;
    onRefine: (prompt: Prompt, dataForDisplay: PromptVersion | null) => void;
    onCopyFullPrompt: (prompt: Prompt) => void;
    onCopyContent: (prompt: Prompt) => void;
    onEdit: (prompt: Prompt) => void;
    onDelete: (id: string, title: string) => void;
    onSelectHistoricalVersion: (version: number) => void;
    onRestoreVersion: (id: string, version: PromptVersion) => void;
    onDeleteVersion: (promptId: string, promptTitle: string, versionNumber: number) => void;
    renderFormattedText: (text: string) => React.ReactNode;
}

export const PromptListItem: React.FC<PromptListItemProps> = ({
    prompt,
    isExpanded,
    displayedData,
    currentPromptObject,
    selectedHistoricalVersionNumber,
    onToggleExpand,
    onUpdateEvaluation,
    onRefine,
    onCopyFullPrompt,
    onCopyContent,
    onEdit,
    onDelete,
    onSelectHistoricalVersion,
    onRestoreVersion,
    onDeleteVersion,
    renderFormattedText,
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('content');

    useEffect(() => {
        if (isExpanded) {
            setActiveTab('content');
        }
    }, [isExpanded]);

    const handleTabClick = (tab: Tab) => {
        setActiveTab(tab);
    }
    
    if (!prompt || !displayedData) return null;

    return (
        <li id={`prompt-card-${prompt.id}`} className="prompt-card">
            <header
                className="prompt-card__header"
                onClick={() => onToggleExpand(prompt.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleExpand(prompt.id);}}
                tabIndex={0}
                role="button"
                aria-expanded={isExpanded}
                aria-controls={`prompt-details-${prompt.id}`}
            >
                <div 
                    className="prompt-card__evaluation" 
                    onClick={(e) => e.stopPropagation()} 
                    title={`Evaluation: ${displayedData.evaluation ? `${displayedData.evaluation}/10` : 'Not set'}`}
                >
                    <span className="prompt-card__evaluation-value">
                        {displayedData.evaluation || '—'}
                    </span>
                    <input
                        id={`eval-header-${prompt.id}-${displayedData.version}`}
                        type="range" min="1" max="10" step="1"
                        value={displayedData.evaluation || 0}
                        onChange={(e) => {
                            if (displayedData.version) {
                                onUpdateEvaluation(prompt.id, displayedData.version, parseInt(e.target.value, 10))
                            }
                        }}
                        disabled={!displayedData.version}
                    />
                </div>
                <div className="prompt-card__title-group">
                    <h3 className="prompt-card__title" title={prompt.title}>{prompt.title}</h3>
                    <span className="prompt-card__version-badge">v{prompt.currentVersion || 1}</span>
                </div>
                <div className="prompt-card__actions">
                   <button onClick={(e) => { e.stopPropagation(); onRefine(prompt, displayedData); }}
                          className="btn btn--ghost btn--icon" title="Refine content with Gemini">
                    <SparklesIcon className="icon"/>
                  </button>
                   <button onClick={(e) => { e.stopPropagation(); onCopyFullPrompt(prompt); }}
                          className="btn btn--ghost btn--icon"
                          title="Copy full prompt">
                          <ClipboardDocumentListIcon className="icon" />
                    </button>
                  <button onClick={(e) => { e.stopPropagation(); onEdit(prompt); }}
                          className="btn btn--ghost btn--icon" title="Edit Prompt">
                    <EditIcon className="icon" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(prompt.id, prompt.title); }}
                          className="btn btn--ghost btn--icon" title="Delete Prompt">
                    <DeleteIcon className="icon"/>
                  </button>
                  <button
                        className="btn btn--ghost btn--icon"
                        title={isExpanded ? "Collapse" : "Expand"}
                        aria-label={isExpanded ? `Collapse prompt ${prompt.title}` : `Expand prompt ${prompt.title}`}
                    >
                    {isExpanded ? <ChevronUpIcon className="icon"/> : <ChevronDownIcon className="icon" />}
                  </button>
                </div>
            </header>
            <div id={`prompt-details-${prompt.id}`} className={`prompt-card__details ${isExpanded ? 'expanded' : ''}`}>
               {isExpanded && currentPromptObject && displayedData && (
                    <div className="prompt-card__body">
                        <main className="prompt-card__main custom-scrollbar">
                             <div className="prompt-card__version-header">
                                <h4 className="prompt-card__version-title">
                                    Viewing Version {displayedData.version}
                                    {displayedData.version === currentPromptObject.currentVersion && (
                                        <span className="current-badge"><CheckIcon style={{width:'1em', height:'1em'}}/> Current</span>
                                    )}
                                </h4>
                                <div className="prompt-card__version-meta">
                                    Saved on {new Date(displayedData.updatedAt).toLocaleString()}
                                </div>
                            </div>

                            <div>
                                <nav className="prompt-card__tabs-nav">
                                    <button className={`prompt-card__tab ${activeTab === 'content' ? 'active' : ''}`} onClick={() => handleTabClick('content')}>Content</button>
                                    <button className={`prompt-card__tab ${activeTab === 'instructions' ? 'active' : ''}`} onClick={() => handleTabClick('instructions')}>Instructions</button>
                                    <button className={`prompt-card__tab ${activeTab === 'rules' ? 'active' : ''}`} onClick={() => handleTabClick('rules')}>Rules</button>
                                    <button className={`prompt-card__tab ${activeTab === 'config' ? 'active' : ''}`} onClick={() => handleTabClick('config')}>Config & Tags</button>
                                </nav>
                                <div className="prompt-card__tab-panel">
                                    {activeTab === 'content' && (
                                        <div className="prompt-card__content-panel">
                                            <div className="prompt-card__panel-header">
                                                <h5 className="prompt-card__panel-title">Prompt Content</h5>
                                                <button
                                                    onClick={(e) => {e.stopPropagation(); onCopyContent(prompt)}}
                                                    className="btn btn--ghost btn--icon btn--sm"
                                                    title="Copy content to clipboard"
                                                >
                                                    <CopyIcon className="icon"/>
                                                </button>
                                            </div>
                                            {renderFormattedText(displayedData.content)}
                                        </div>
                                    )}
                                    {activeTab === 'instructions' && (
                                         <div className="prompt-card__content-panel">
                                            <div className="prompt-card__panel-header"><h5 className="prompt-card__panel-title">System Instructions</h5></div>
                                            {(displayedData.systemInstructions && String(displayedData.systemInstructions).trim()) ? 
                                                renderFormattedText(displayedData.systemInstructions) : 
                                                "No system instructions for this version."}
                                         </div>
                                    )}
                                     {activeTab === 'rules' && (
                                         <div className="prompt-card__content-panel">
                                             <div className="prompt-card__panel-header"><h5 className="prompt-card__panel-title">Rules</h5></div>
                                            {(displayedData.rules && displayedData.rules.length > 0) ? (
                                                <ul>{displayedData.rules.map(rule => <li key={rule.id}>{renderFormattedText(rule.text)}</li>)}</ul>
                                            ) : (
                                                "No rules for this version."
                                            )}
                                         </div>
                                    )}
                                    {activeTab === 'config' && (
                                        <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)'}}>
                                            <div className="prompt-card__content-panel">
                                                <div className="prompt-card__panel-header"><h5 className="prompt-card__panel-title">Model Parameters</h5></div>
                                                <div style={{display: 'flex', gap: 'var(--space-xl)'}}>
                                                    <div>
                                                        <div style={{fontSize: '0.8rem', color: 'var(--text-tertiary)'}}>Temperature</div>
                                                        <div style={{fontSize: '1.2rem', fontWeight: 500}}>{displayedData.temperature?.toFixed(2) ?? '1.00'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{fontSize: '0.8rem', color: 'var(--text-tertiary)'}}>Top P</div>
                                                        <div style={{fontSize: '1.2rem', fontWeight: 500}}>{displayedData.topP?.toFixed(2) ?? '0.95'}</div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="prompt-card__content-panel">
                                                <div className="prompt-card__panel-header"><h5 className="prompt-card__panel-title">Tags</h5></div>
                                                {(displayedData.tags && displayedData.tags.length > 0) ? (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                                                        {displayedData.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                                                    </div>
                                                ) : ( "No tags for this version." )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </main>
                        <aside className="version-history custom-scrollbar">
                            <h4 className="version-history__header">
                                <ClockIcon className="icon" /> Version History
                            </h4>
                            <ul className="version-history__list">
                                {currentPromptObject.versionHistory.slice().sort((a,b) => b.version - a.version).map(v => {
                                    const isCurrentVersion = v.version === currentPromptObject.currentVersion;
                                    const isOnlyVersion = currentPromptObject.versionHistory.length <= 1;
                                    const canDelete = !isCurrentVersion && !isOnlyVersion;

                                    return (
                                        <li
                                            key={v.version}
                                            className={`version-history__item ${selectedHistoricalVersionNumber === v.version ? 'selected' : ''}`}
                                            onClick={() => onSelectHistoricalVersion(v.version)}
                                            tabIndex={0}
                                            onKeyDown={(e) => { if(e.key === 'Enter' || e.key === ' ') onSelectHistoricalVersion(v.version) }}
                                        >
                                            <div className="version-history__dot"></div>
                                            <div>
                                                <div className="version-history__item-title">
                                                    Version {v.version}
                                                    {isCurrentVersion && <span className="current-badge" style={{transform: 'scale(0.8)', marginLeft: 'var(--space-xs)'}}><CheckIcon style={{width:'1em', height:'1em'}}/> Current</span>}
                                                </div>
                                                <div className="version-history__item-meta">{new Date(v.updatedAt).toLocaleString()}</div>
                                                {selectedHistoricalVersionNumber === v.version && (
                                                    <div className="version-history__item-actions" style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)'}}>
                                                        {!isCurrentVersion && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onRestoreVersion(prompt.id, v); }}
                                                                className="btn btn--secondary btn--sm"
                                                                title={`Restore to Version ${v.version}`}
                                                            >
                                                                <ArrowUturnLeftIcon className="icon"/> Restore
                                                            </button>
                                                        )}
                                                        {canDelete && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onDeleteVersion(prompt.id, prompt.title, v.version); }}
                                                                className="btn btn--danger btn--icon btn--sm"
                                                                title={`Permanently delete Version ${v.version}`}
                                                            >
                                                                <DeleteIcon className="icon"/>
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </aside>
                    </div>
               )}
            </div>
        </li>
    );
};