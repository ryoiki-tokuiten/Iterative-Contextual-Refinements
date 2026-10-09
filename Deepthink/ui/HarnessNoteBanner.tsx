/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Literal Harness Note Banner.
 * Displays the exact instructions and operational reminders provided by
 * the multi-agent harness to guiding agents, ensuring full operational transparency.
 */

import React, { useState } from 'react';
import { Icon } from '../../UI/Icons';
import MathHTML from '../../Styles/Components/RenderMathMarkdown';

interface HarnessNoteBannerProps {
  title?: string;
  note: string;
  agentKind?: string;
  className?: string;
  defaultExpanded?: boolean;
}

export const HarnessNoteBanner: React.FC<HarnessNoteBannerProps> = ({
  title = 'Harness Operational Note',
  note,
  agentKind,
  className = '',
  defaultExpanded = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!note || !note.trim()) return null;

  return (
    <div className={`harness-note-card ${className}`}>
      <div className="harness-note-header" onClick={() => setExpanded(e => !e)}>
        <div className="harness-note-title-group">
          <Icon name="terminal" className="harness-note-icon" />
          <span className="harness-note-title">{title}</span>
          {agentKind && (
            <span className="harness-note-agent-pill">{agentKind}</span>
          )}
        </div>
        <button
          type="button"
          className="harness-note-toggle-btn"
          aria-label={expanded ? 'Collapse note' : 'Expand note'}
        >
          <Icon name={expanded ? 'expand_less' : 'expand_more'} />
        </button>
      </div>

      {expanded && (
        <div className="harness-note-body">
          <MathHTML content={note} className="harness-note-content" />
        </div>
      )}
    </div>
  );
};
