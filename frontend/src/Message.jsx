import React, { useState, useEffect, useRef, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ChevronDown, ChevronRight } from 'lucide-react';

function MessageComponent({ msg, onRetry }) {
  const contentRef = useRef(null);
  const [expandedTools, setExpandedTools] = useState({});

  useEffect(() => {
    if (msg.role !== 'assistant' || !contentRef.current) return;

    const codeBlocks = contentRef.current.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
      const pre = block.parentNode;
      if (!pre) return;
      if (pre.querySelector('.copy-btn')) return;

      const button = document.createElement('button');
      button.className = 'copy-btn';
      button.innerText = 'Copy';
      
      button.onclick = async () => {
        try {
          await navigator.clipboard.writeText(block.innerText);
          button.innerText = 'Copied!';
          setTimeout(() => {
            if (button) button.innerText = 'Copy';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy code: ', err);
        }
      };

      pre.style.position = 'relative';
      pre.appendChild(button);
    });
  }, [msg.content, msg.role]);

  const toggleToolExpand = (index) => {
    setExpandedTools(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const content = msg.content || '';

  const html = useMemo(() => {
    if (!content) return '';
    return DOMPurify.sanitize(marked.parse(content));
  }, [content]);

  // Render User Message Block (Clean Plain Text / Natural Prompt Styling)
  if (msg.role === 'user') {
    return (
      <div className="message-row">
        <div className="tui-user-msg-block">
          <span className="tui-user-prompt-text">{msg.content}</span>
        </div>
      </div>
    );
  }

  const toolCalls = msg.toolCalls || [];
  const thinking = msg.status === 'thinking';
  const streaming = msg.status === 'streaming';
  const failed = msg.status === 'error';
  const stopped = msg.status === 'stopped';

  return (
    <div className={`message-row ${msg.status ? 'msg-' + msg.status : ''}`}>
      {/* Individual Tool Call Execution Cards ($ bash / tool) */}
      {toolCalls.map((tool, idx) => {
        const isExpanded = !!expandedTools[idx];
        const cmdTitle = tool.content || (tool.input && tool.input.command ? `$ ${tool.input.command}` : `$ ${tool.toolName || 'tool'}`);
        const outputText = tool.output || (tool.input ? JSON.stringify(tool.input, null, 2) : '');

        return (
          <div key={idx} className="tui-cmd-card" style={{ cursor: outputText ? 'pointer' : 'default' }} onClick={() => outputText && toggleToolExpand(idx)}>
            <div className="tui-cmd-header" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="tui-cmd-prompt">$</span>
                <span>{cmdTitle}</span>
              </div>
              {outputText && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 12 }}>
                  <span>{isExpanded ? 'Collapse' : 'Click to expand'}</span>
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
              )}
            </div>

            {isExpanded && outputText && (
              <pre style={{ 
                marginTop: 8, 
                padding: '8px 10px', 
                background: '#0d0f17', 
                borderRadius: 4, 
                fontSize: 12, 
                color: 'var(--text-main)', 
                overflowX: 'auto', 
                maxHeight: 280,
                border: '1px solid var(--bg-card-border)'
              }}>
                <code>{outputText}</code>
              </pre>
            )}
          </div>
        );
      })}

      {/* Fallback Single Tool Pill */}
      {toolCalls.length === 0 && msg.tool && (
        <div className="tui-expand-box">
          <div className="tui-expand-title">
            <span style={{ color: 'var(--accent-cyan)' }}>{msg.tool}</span>
          </div>
        </div>
      )}

      {/* Assistant Response Card */}
      <div className="tui-response-card">
        {thinking && (
          <div className="tui-thinking">
            <span className="tui-thinking-dots"><i /><i /><i /></span>
            <span className="tui-thinking-label">{msg.activity || 'Thinking…'}</span>
          </div>
        )}

        {content && (
          <div className="markdown-content">
            <div ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />
            {streaming && <span className="m3-streaming-cursor" />}
          </div>
        )}

        {stopped && (
          <div className="tui-stopped-tag">Stopped by user</div>
        )}

        {failed && (
          <div className="tui-error-banner">
            <span className="tui-error-text">{msg.error || 'Request failed'}</span>
            {onRetry && (
              <button className="tui-retry-btn" onClick={() => onRetry(msg)}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const Message = React.memo(MessageComponent);
export default Message;
