import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { PromptBlockData } from './types';
import { BLOCK_CATEGORIES } from './constants';
import { EditIcon } from '../icons'; // A generic icon

const ALL_BLOCKS = BLOCK_CATEGORIES.flatMap(c => c.blocks);

export const PromptBlockNode: React.FC<NodeProps<PromptBlockData>> = ({ data }) => {
    const blockDefinition = ALL_BLOCKS.find(b => b.type === data.type);
    
    // Truncate content for preview
    const previewContent = data.content.length > 80 ? `${data.content.substring(0, 80)}...` : data.content;

    return (
        <div className="prompt-node">
            <Handle type="target" position={Position.Left} />
            <div className="prompt-node__header">
                {blockDefinition?.icon ? <blockDefinition.icon className="icon" /> : <EditIcon className="icon" />}
                <span>{data.name}</span>
            </div>
            <div className="prompt-node__content">
                <p style={{ margin: 0 }}>{previewContent}</p>
            </div>
            <Handle type="source" position={Position.Right} />
        </div>
    );
};

export default memo(PromptBlockNode);