import React from 'react';
import { BlocksIcon } from '../icons';
import { BLOCK_CATEGORIES } from './constants';

export const BlockLibrary: React.FC = () => {
    const onDragStart = (event: React.DragEvent, blockDefinition: any) => {
        const json = JSON.stringify(blockDefinition);
        event.dataTransfer.setData('application/reactflow', json);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <aside className="prompt-builder__panel prompt-builder__panel--left custom-scrollbar">
            <h2 className="prompt-builder__panel-title">
                <BlocksIcon className="icon" />
                Block Library
            </h2>
            <div className="block-library">
                 {BLOCK_CATEGORIES.map((category) => (
                    <React.Fragment key={category.name}>
                        <h3 className="block-library__category-title">{category.name}</h3>
                        {category.blocks.map((def) => (
                            <div
                                key={def.type}
                                className="block-library__item"
                                onDragStart={(event) => onDragStart(event, def)}
                                draggable
                                role="button"
                                aria-label={`Draggable prompt block: ${def.name}`}
                            >
                                <div className="block-library__item-name">
                                    <def.icon className="icon" />
                                    <span>{def.name}</span>
                                </div>
                                <div className="block-library__item-desc">{def.description}</div>
                            </div>
                        ))}
                    </React.Fragment>
                ))}
            </div>
        </aside>
    );
};