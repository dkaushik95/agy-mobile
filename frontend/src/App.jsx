import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, Plus, Mic, Paperclip, Send, Square, Image as ImageIcon, Check, MessageSquare, Activity } from 'lucide-react';
import Message from './Message';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import './App.css';

marked.setOptions({
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true
});

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  const [model, setModel] = useState('flash');
  const [effort, setEffort] = useState('medium');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  
  const wsRef = useRef(null);
  const virtuosoRef = useRef(null);

  useEffect(() => {
    initWebSocket();
    fetchSessions();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch(err) {
      console.error(err);
    }
  };

  const loadSession = async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
      setCurrentConversationId(id);
      setDrawerOpen(false);
    } catch(err) {
      console.error(err);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentConversationId(null);
    setDrawerOpen(false);
  };

  const initWebSocket = () => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'tool_update' || data.type === 'state_change') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, tool: data.message || data.content }];
          }
          return prev;
        });
      } else if (data.type === 'chunk') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.isStreaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + data.content }];
          }
          return prev;
        });
      } else if (data.type === 'done' || data.type === 'error') {
        setIsGenerating(false);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.isStreaming) {
            let finalContent = last.content;
            if (data.type === 'error') finalContent += `\n\n*Error: ${data.error}*`;
            
            // Calculate time taken
            const timeTakenMs = Date.now() - (last.startTime || Date.now());
            const seconds = (timeTakenMs / 1000).toFixed(1);
            const toolStr = last.tool ? `Worked for ${seconds}s` : null;
            
            return [...prev.slice(0, -1), { ...last, content: finalContent, isStreaming: false, tool: toolStr }];
          }
          return prev;
        });
      }
    };
    
    ws.onclose = () => {
      setTimeout(initWebSocket, 2000);
    };
  };

  const handleSend = () => {
    if (!input.trim() && !attachedFile) return;
    
    setMessages(prev => [...prev, { role: 'user', content: input, attachedFile }]);
    setInput('');
    setAttachedFile(null);
    setIsGenerating(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true, startTime: Date.now() }]);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'prompt',
        prompt: input,
        model: model,
        effort: effort,
        conversationId: currentConversationId,
        attachedFilePath: attachedFile?.path
      }));
    }
    
  };

  const handleStop = () => {
    if (wsRef.current) wsRef.current.send(JSON.stringify({ type: 'kill' }));
  };

  const handleFileAttach = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      setAttachedFile(data);
    } catch(err) {
      console.error(err);
    }
  };

  // renderMessage moved to Message.jsx

  return (
    <div id="root" style={{ backgroundColor: '#131314', height: '100%', width: '100%', overflow: 'hidden', position: 'relative' }}>
      
      {/* Sidebar rendered underneath */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '80%', maxWidth: '300px', background: '#131314', zIndex: 1, paddingTop: 'env(safe-area-inset-top, 16px)' }}>
        <div style={{padding: '24px 16px 16px', fontSize: 18, fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <span>Gemini</span>
          <button className="icon-btn" style={{padding: 4}} onClick={startNewChat}><Plus size={20} /></button>
        </div>
        
        <div style={{padding: '8px 16px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 8}}>
          Recent
        </div>

        <div style={{flex:1, overflowY:'auto', padding: '0 8px', height: 'calc(100% - 100px)'}}>
          {sessions.length === 0 ? (
            <div style={{padding: '16px 8px', color: 'var(--text-secondary)', fontSize: 14}}>No history found.</div>
          ) : (
            sessions.map(session => (
              <div 
                key={session.id} 
                onClick={() => loadSession(session.id)}
                className={`history-item ${currentConversationId === session.id ? 'active' : ''}`}
              >
                <MessageSquare size={16} style={{flexShrink: 0}} color="var(--text-secondary)" />
                <div style={{ overflow: 'hidden' }}>
                  <div style={{
                    fontSize: 14, 
                    color: currentConversationId === session.id ? 'var(--accent-color)' : 'var(--text-primary)',
                    whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden'
                  }}>
                    {session.title}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content with scale-down drawer effect */}
      <motion.div 
        drag="x"
        dragConstraints={{ left: 0, right: window.innerWidth * 0.8 > 300 ? 300 : window.innerWidth * 0.8 }}
        dragElastic={0.1}
        onDragEnd={(e, { offset, velocity }) => {
           if (offset.x > 80 || velocity.x > 300) setDrawerOpen(true);
           else if (offset.x < -80 || velocity.x < -300) setDrawerOpen(false);
           else setDrawerOpen(drawerOpen);
        }}
        animate={{ 
          x: drawerOpen ? (window.innerWidth * 0.8 > 300 ? 300 : window.innerWidth * 0.8) : 0, 
          scale: drawerOpen ? 0.95 : 1,
          borderRadius: drawerOpen ? 32 : 0,
          opacity: drawerOpen ? 0.8 : 1
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 250, mass: 0.8 }}
        style={{ 
          position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, 
          background: 'var(--bg-primary)', zIndex: 2, display: 'flex', flexDirection: 'column',
          boxShadow: drawerOpen ? '-10px 0 30px rgba(0,0,0,0.7)' : 'none',
          overflow: 'hidden',
          touchAction: drawerOpen ? 'none' : 'auto'
        }}
        onClick={() => { if(drawerOpen) setDrawerOpen(false) }}
      >
        <header className="header" style={{ position: 'absolute', top: 0, left: 0, right: 0, background: 'rgba(19, 19, 20, 0.65)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div className="logo-container">
            <button className="icon-btn" onClick={() => setDrawerOpen(true)}><Menu size={20} /></button>
            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setShowModelMenu(!showModelMenu)}>
              Gemini {model === 'pro' ? 'Advanced' : ''}
              <span style={{ fontSize: 12, opacity: 0.6 }}>▼</span>
            </span>
          </div>
          <div>
            <button className="icon-btn" onClick={startNewChat}><Plus size={20} /></button>
          </div>
          
          <AnimatePresence>
            {showModelMenu && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: -10 }}
                style={{
                  position: 'absolute', top: 60, left: 60, background: 'var(--bg-secondary)', 
                  borderRadius: 16, padding: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 100, border: '1px solid var(--border-color)'
                }}
              >
                <div style={{ padding: '8px 16px', fontWeight: 500, fontSize: 12, color: 'var(--text-secondary)' }}>MODEL</div>
                <div 
                  style={{ padding: '12px 16px', borderRadius: 8, cursor: 'pointer', background: model === 'flash' ? 'var(--bg-tertiary)' : 'transparent', display: 'flex', justifyContent: 'space-between' }}
                  onClick={() => { setModel('flash'); setShowModelMenu(false); }}
                >
                  <span>3.6 Flash (Fast)</span> {model === 'flash' && <Check size={16} color="var(--accent-color)" />}
                </div>
                <div 
                  style={{ padding: '12px 16px', borderRadius: 8, cursor: 'pointer', background: model === 'pro' ? 'var(--bg-tertiary)' : 'transparent', display: 'flex', justifyContent: 'space-between' }}
                  onClick={() => { setModel('pro'); setShowModelMenu(false); }}
                >
                  <span>3.1 Pro (Advanced)</span> {model === 'pro' && <Check size={16} color="var(--accent-color)" />}
                </div>
                
                <div style={{ padding: '16px 16px 8px 16px', fontWeight: 500, fontSize: 12, color: 'var(--text-secondary)' }}>AGENT EFFORT</div>
                <div style={{ display: 'flex', gap: 8, padding: '0 8px 8px 8px' }}>
                  {['low', 'medium', 'high'].map(e => (
                    <button 
                      key={e}
                      onClick={() => setEffort(e)}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid var(--border-color)',
                        background: effort === e ? 'var(--bg-tertiary)' : 'transparent',
                        color: effort === e ? 'var(--accent-color)' : 'var(--text-primary)', cursor: 'pointer'
                      }}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>
        
        <div className="chat-container">
          {messages.length === 0 ? (
            <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-secondary)', background: 'linear-gradient(180deg, var(--bg-primary) 0%, rgba(13, 25, 48, 0.4) 100%)'}}>
              <div style={{ fontSize: '64px', background: 'linear-gradient(90deg, #4285f4, #d96570)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '24px' }}>
                ✦
              </div>
              <h1 style={{ fontSize: '24px', fontWeight: '500', color: 'var(--text-primary)' }}>What should we focus on?</h1>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              className="virtuoso-list"
              data={messages}
              itemContent={(index, msg) => <Message msg={msg} />}
              followOutput="smooth"
              initialTopMostItemIndex={messages.length - 1}
            />
          )}
        </div>

        <div className="input-area" style={{ padding: '16px', background: 'transparent' }}>
          {attachedFile && (
            <div style={{display:'flex', alignItems:'center', gap: 8, padding: 8, background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 8}}>
              <ImageIcon size={16} /> <span style={{fontSize: 12}}>{attachedFile.originalName}</span>
              <button onClick={() => setAttachedFile(null)} style={{marginLeft: 'auto', background: 'none', border:'none', color:'var(--text-secondary)'}}>x</button>
            </div>
          )}
          <div className="input-box" style={{ 
            background: 'rgba(30, 30, 30, 0.7)', 
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '32px', 
            padding: '8px 16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }}>
            <label style={{cursor:'pointer', color:'var(--text-secondary)', display: 'flex', alignItems: 'center'}}>
              <Plus size={24} />
              <input type="file" style={{display:'none'}} onChange={handleFileAttach} />
            </label>
            <textarea 
              placeholder="Ask Gemini" 
              value={input} 
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', resize: 'none', maxHeight: '120px', padding: '12px 0', outline: 'none', fontSize: '16px' }}
              rows={1}
            />
            {isGenerating ? (
              <button onClick={handleStop} style={{color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer'}}><Square size={20} fill="currentColor" /></button>
            ) : (
              input.trim() || attachedFile ? (
                <button onClick={handleSend} style={{background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer'}}><Send size={20} /></button>
              ) : (
                <div style={{ display: 'flex', gap: '16px', color: 'var(--text-secondary)', alignItems: 'center' }}>
                  <Mic size={24} style={{ cursor: 'pointer' }} />
                  <Activity size={24} style={{ cursor: 'pointer' }} />
                </div>
              )
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default App;
