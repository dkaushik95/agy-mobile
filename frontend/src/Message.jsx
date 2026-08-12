import React, { useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Copy, Share, Volume2, ThumbsUp, ThumbsDown, MoreHorizontal } from 'lucide-react';

export default function Message({ msg }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (msg.role !== 'assistant' || !contentRef.current) return;

    const codeBlocks = contentRef.current.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
      const pre = block.parentNode;
      
      // Prevent adding multiple buttons during streaming updates
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
          console.error('Failed to copy text: ', err);
        }
      };

      // Ensure the <pre> tag is positioned relatively so the absolute button aligns correctly
      pre.style.position = 'relative';
      pre.appendChild(button);
    });
  }, [msg.content, msg.role]);

  if (msg.role === 'user') {
    return (
      <div className="message-row user">
        <div className="user-bubble">
          {msg.attachedFile && (
            <div style={{marginBottom: 8}}>
              <img 
                src={msg.attachedFile.url} 
                style={{maxWidth: 100, borderRadius: 8}} 
                alt="attached" 
              />
            </div>
          )}
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'assistant_tools') {
    return (
      <div className="message-row assistant">
        <div className="assistant-block" style={{ flexDirection: 'column', gap: 8 }}>
          {msg.toolCalls?.map((tool, idx) => (
            <div key={idx} className="tool-pill">
              <div className="tool-pill-pulse" style={{ animation: 'none', background: 'var(--text-secondary)' }}></div>
              <span>{tool.name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const content = msg.content || '';
  const html = DOMPurify.sanitize(marked.parse(content));

  return (
    <div className="message-row assistant">
      <div className="assistant-block">
        <div className="sparkle-icon"></div>
        <div className="markdown-content">
          {msg.tool && (
            <div className="tool-pill">
              <div className="tool-pill-pulse"></div>
              <span>{msg.tool}</span>
            </div>
          )}
          <div ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />
          
          <div className="message-actions" style={{ display: 'flex', gap: '16px', marginTop: '12px', color: 'var(--text-secondary)' }}>
            <Volume2 size={18} style={{ cursor: 'pointer' }} />
            <Copy size={18} style={{ cursor: 'pointer' }} />
            <Share size={18} style={{ cursor: 'pointer' }} />
            <ThumbsUp size={18} style={{ cursor: 'pointer' }} />
            <ThumbsDown size={18} style={{ cursor: 'pointer' }} />
            <MoreHorizontal size={18} style={{ cursor: 'pointer' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
