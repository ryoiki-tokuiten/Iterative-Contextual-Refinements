import React from 'react';
import { IdTextPair } from '../types';
import { PlusIcon, DeleteIcon } from './icons';

interface EditableListProps {
  label: string;
  items: IdTextPair[];
  setItems: React.Dispatch<React.SetStateAction<IdTextPair[]>>;
  placeholder?: string;
}

// Local utility function to avoid modifying String.prototype
const toSingular = (str: string): string => {
  if (!str) return '';
  if (str.toLowerCase() === 'system instructions') return 'Instruction';
  if (str.endsWith('s') && !str.endsWith('ss') && str.length > 1) {
    return str.substring(0, str.length - 1);
  }
  return str;
};

export const EditableListItem: React.FC<EditableListProps> = ({ label, items, setItems, placeholder = "Enter text..." }) => {
  const handleAddItem = () => {
    setItems([...items, { id: self.crypto.randomUUID(), text: '' }]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const handleChangeItemText = (id: string, text: string) => {
    setItems(items.map(item => (item.id === id ? { ...item, text } : item)));
  };
  
  return (
    <div className="form-group editable-list">
      <label className="form-label editable-list__label">{label}</label>
      <div className="editable-list__items">
        {items.map((item, index) => (
          <div key={item.id} className="editable-list__item">
            <input
              type="text"
              value={item.text}
              onChange={(e) => handleChangeItemText(item.id, e.target.value)}
              placeholder={`${placeholder} #${index + 1}`}
              className="form-input editable-list__input"
            />
            <button
              type="button"
              onClick={() => handleRemoveItem(item.id)}
              className="btn btn--ghost btn--icon"
              aria-label="Remove item"
            >
              <DeleteIcon className="icon editable-list__delete-icon" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleAddItem}
        className="btn btn--secondary btn--sm editable-list__add-btn"
      >
        <PlusIcon className="icon" /> Add {toSingular(label) || 'Item'}
      </button>
    </div>
  );
};
