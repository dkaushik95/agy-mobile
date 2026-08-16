import React, { useState, useEffect, useRef, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Copy, Check, Share2, Volume2, VolumeX, FileText, ThumbsUp, ThumbsDown, MoreHorizontal, Brain, Terminal, Sparkles } from 'lucide-react';

function MessageComponent({ msg }) {
  const contentRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [thumb, setThumb] = useState(null);

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

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(msg.content || '');
      setCopied(true);
      if (navigator.vibrate) navigator.vibrate(10);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const handleToggleSpeech = () => {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported in this browser.');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      window.speechSynthesis.cancel();
      const plainText = (msg.content || '').replace(/<[^>]+>/g, '').replace(/```[\s\S]*?```/g, 'Code block omitted.');
      const utterance = new SpeechSynthesisUtterance(plainText);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleShare = async () => {
    const textToShare = msg.content || '';
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Gemini Response',
          text: textToShare
        });
      } catch {
        // User canceled or failed
      }
    } else {
      handleCopyMessage();
    }
  };

  const content = msg.content || '';

  // Performance Optimization: Memoize markdown rendering
  const html = useMemo(() => {
    if (!content) return '';
    return DOMPurify.sanitize(marked.parse(content));
  }, [content]);

  if (msg.role === 'user') {
    return (
      <div className="message-row user">
        <div className="user-bubble">
          {msg.attachedFile && (
            <div style={{ marginBottom: 8 }}>
              {/\.(png|jpe?g|gif|webp|svg)$/i.test(msg.attachedFile.originalName || '') ? (
                <img 
                  src={msg.attachedFile.url} 
                  style={{ maxWidth: 180, maxHeight: 180, borderRadius: 12, objectFit: 'cover', display: 'block' }} 
                  alt={msg.attachedFile.originalName || "attachment"} 
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 13 }}>
                  <FileText size={16} />
                  <span>{msg.attachedFile.originalName || 'Attached File'}</span>
                </div>
              )}
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
        <div className="assistant-block" style={{ gap: 8 }}>
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

  // Assistant Streaming & Intermediate Thinking State
  const isStreamingWithoutContent = msg.isStreaming && !content;

  return (
    <div className="message-row assistant">
      <div className="assistant-block">
        {/* M3 Thinking / Loading Card when waiting for model or tools */}
        {isStreamingWithoutContent && (
          <div className="m3-thinking-card">
            <div className="m3-thinking-header">
              <div className="m3-thinking-avatar">
                <span className="m3-sparkle-icon">✦</span>
              </div>
              <div className="m3-thinking-meta">
                <span className="m3-thinking-title">
                  {msg.tool || "Reasoning & synthesizing..."}
                </span>
                <span className="m3-thinking-sub">
                  Gemini Active Process
                </span>
              </div>
            </div>
            <div className="m3-progress-wrapper">
              <md-linear-progress indeterminate class="m3-linear-loader"></md-linear-progress>
            </div>
          </div>
        )}

        {/* Tool update pill when content is streaming or completed */}
        {!isStreamingWithoutContent && msg.tool && (
          <div className={`tool-pill ${msg.isStreaming ? 'active' : 'done'}`}>
            <div className="tool-pill-pulse"></div>
            <span>{msg.tool}</span>
          </div>
        )}

        {/* Render content if available */}
        {content && (
          <div className="markdown-content">
            <div ref={contentRef} dangerouslySetInnerHTML={{ __html: html }} />
            {msg.isStreaming && <span className="m3-streaming-cursor" />}
            
            {!msg.isStreaming && (
              <>
                {/* M3 Action Toolbar */}
                <div className="gemini-action-bar">
                  <md-icon-button 
                    class="m3-msg-action-btn" 
                    onClick={handleCopyMessage} 
                    title="Copy text"
                    style={{ color: copied ? 'var(--md-sys-color-success)' : 'inherit' }}
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                  </md-icon-button>

                  <md-icon-button 
                    class="m3-msg-action-btn" 
                    onClick={handleShare} 
                    title="Share response"
                  >
                    <Share2 size={17} />
                  </md-icon-button>

                  <md-icon-button 
                    class="m3-msg-action-btn" 
                    onClick={handleToggleSpeech} 
                    title={isSpeaking ? "Stop Reading" : "Read Aloud"}
                    style={{ color: isSpeaking ? 'var(--md-sys-color-primary)' : 'inherit' }}
                  >
                    {isSpeaking ? <VolumeX size={17} /> : <Volume2 size={17} />}
                  </md-icon-button>

                  <md-icon-button 
                    class="m3-msg-action-btn" 
                    onClick={() => setThumb(thumb === 'up' ? null : 'up')} 
                    title="Good response"
                    style={{ color: thumb === 'up' ? 'var(--md-sys-color-primary)' : 'inherit' }}
                  >
                    <ThumbsUp size={17} />
                  </md-icon-button>

                  <md-icon-button 
                    class="m3-msg-action-btn" 
                    onClick={() => setThumb(thumb === 'down' ? null : 'down')} 
                    title="Bad response"
                    style={{ color: thumb === 'down' ? 'var(--md-sys-color-error)' : 'inherit' }}
                  >
                    <ThumbsDown size={17} />
                  </md-icon-button>

                  <md-icon-button 
                    class="m3-msg-action-btn" 
                    title="More"
                  >
                    <MoreHorizontal size={17} />
                  </md-icon-button>
                </div>

                {/* Gemini Disclaimer */}
                <div className="gemini-disclaimer">
                  Gemini is AI and can make mistakes.
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Wrap with React.memo to prevent unnecessary re-rendering
const Message = React.memo(MessageComponent);
export default Message;
