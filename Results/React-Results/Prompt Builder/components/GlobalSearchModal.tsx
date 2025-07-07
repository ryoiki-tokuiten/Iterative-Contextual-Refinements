import React, { useState, useMemo, useEffect } from 'react';
import { Modal } from './Modal';
import { Project, Prompt, GlobalSearchResultItem } from '../types';
import { SearchIcon, EyeIcon } from './icons';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  prompts: Prompt[];
  onSelectResult: (item: Project | Prompt) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  projects,
  prompts,
  onSelectResult,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSearchTerm(''); 
    }
  }, [isOpen]);
  
  const searchResults = useMemo((): GlobalSearchResultItem[] => {
    if (!searchTerm.trim()) {
      return [];
    }
    const lowerSearchTerm = searchTerm.toLowerCase();
    const foundProjects: GlobalSearchResultItem[] = projects
      .filter(p =>
        p.name.toLowerCase().includes(lowerSearchTerm) ||
        (p.description && p.description.toLowerCase().includes(lowerSearchTerm))
      )
      .map(p => ({ type: 'project', item: p }));

    const foundPrompts: GlobalSearchResultItem[] = prompts
      .filter(p =>
        p.title.toLowerCase().includes(lowerSearchTerm) ||
        p.content.toLowerCase().includes(lowerSearchTerm) ||
        (p.systemInstructions && p.systemInstructions.toLowerCase().includes(lowerSearchTerm)) ||
        (p.tags && p.tags.some(tag => tag.toLowerCase().includes(lowerSearchTerm)))
      )
      .map(p => ({ type: 'prompt', item: p }));
    
    return [...foundProjects, ...foundPrompts];

  }, [searchTerm, projects, prompts]);

  const handleSelect = (item: Project | Prompt) => {
    onSelectResult(item);
    onClose();
  };
  
  const resultItemStyle: React.CSSProperties = {
    padding: 'var(--space-md)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'background-color var(--transition-fast) ease-in-out',
  };

  const resultItemHoverStyle: React.CSSProperties = {
    backgroundColor: 'var(--surface-secondary)',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Global Search" size="xl">
      <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', minHeight: '60vh' }}>
        <div className="input-group">
          <SearchIcon className="icon" />
          <input
            type="search"
            placeholder="Search all projects and prompts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input"
            autoFocus
          />
        </div>

        {!searchTerm.trim() && (
            <div className="app-main__placeholder" style={{flexGrow:1}}>
                <SearchIcon className="icon" />
                <h2>Search Everything</h2>
                <p>Start typing to find projects and prompts.</p>
            </div>
        )}

        {searchTerm.trim() && searchResults.length === 0 && (
          <div className="app-main__placeholder" style={{flexGrow:1}}>
            <EyeIcon className="icon" />
            <h2>No results found</h2>
            <p>Try a different search term.</p>
          </div>
        )}
        
        {searchResults.length > 0 && (
          <div className="custom-scrollbar" style={{ flexGrow: 1, overflowY: 'auto', maxHeight: 'calc(60vh - 100px)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)'}}>
            {searchResults.map(({ type, item }) => (
              <div
                key={`${type}-${item.id}`}
                style={resultItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = resultItemHoverStyle.backgroundColor)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() => handleSelect(item)}
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSelect(item)}
                role="button"
                aria-label={`Select ${type} ${type === 'project' ? (item as Project).name : (item as Prompt).title}`}
              >
                {type === 'project' && (
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>{(item as Project).name}</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Project</div>
                  </div>
                )}
                {type === 'prompt' && (
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{(item as Prompt).title}</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      Prompt in: {projects.find(p => p.id === (item as Prompt).projectId)?.name || 'Unknown Project'}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};