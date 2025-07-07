import React, { useState, useEffect } from 'react';
import { Project } from '../types';

interface ProjectFormProps {
  project?: Project | null;
  onSave: (project: Project) => void;
  onCancel: () => void;
}

export const ProjectForm: React.FC<ProjectFormProps> = ({ project, onSave, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
    } else {
      setName('');
      setDescription('');
    }
  }, [project]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert("Project name cannot be empty."); 
      return;
    }
    const now = new Date().toISOString();
    onSave({
      id: project?.id || self.crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      createdAt: project?.createdAt || now,
      updatedAt: now,
    });
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      <div className="modal__body custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', flexGrow: 1}}>
        <div className="form-group">
          <label htmlFor="projectName" className="form-label">Project Name</label>
          <input
            id="projectName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="projectDescription" className="form-label">Description (Optional)</label>
          <textarea
            id="projectDescription"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="form-textarea"
          />
        </div>
      </div>
      <div className="modal__footer">
        <button
          type="button"
          onClick={onCancel}
          className="btn btn--secondary"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn--primary"
        >
          {project ? 'Save Changes' : 'Create Project'}
        </button>
      </div>
    </form>
  );
};