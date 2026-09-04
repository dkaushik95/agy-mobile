import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Terminal, Menu, Plus, Send, X, Check, ChevronDown, Trash2, Cpu, Zap, Brain, ArrowUp
} from 'lucide-react';

import './App.css';
import Message from './Message.jsx';

  const DEFAULT_MODELS = [
    { id: 'google/antigravity-gemini-3.8-flash', name: 'Gemini 3.8 Flash (Antigravity)', provider: 'Recent' },
    { id: 'opencode/muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free', provider: 'OpenCode Zen', isFree: true },
    { id: 'opencode/ling-3.0-flash-fin-free', name: 'Ling 3.0 Flash Fin Free', provider: 'OpenCode Zen', isFree: true },
    { id: 'opencode/nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free', provider: 'OpenCode Zen', isFree: true },
    { id: 'opencode/muse-spark-1.2-contributor-free', name: 'Muse Spark 1.2 Free', provider: 'OpenCode Zen', isFree: true },
    { id: 'opencode/nemotron-3-ultra-free', name: 'Nemotron 3 Ultra Free', provider: 'OpenCode Zen', isFree: true },
    { id: 'opencode/mimo-v2.5-free', name: 'MiMo V2.5 Free', provider: 'OpenCode Zen', isFree: true },
    { id: 'opencode/big-pickle', name: 'Big Pickle', provider: 'OpenCode Zen', isFree: true },
    { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google' },
    { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Google' },
    { id: 'google/gemini-flash-latest', name: 'Gemini Flash Latest', provider: 'Google' },
    { id: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', provider: 'Google' },
    { id: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Google' },
    { id: 'google/gemini-flash-lite-latest', name: 'Gemini Flash-Lite Latest', provider: 'Google' }
  ];

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);

  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS);
  const [model, setModel] = useState('google/antigravity-gemini-3.8-flash');
  const [effort, setEffort] = useState('high');
  const [mode, setMode] = useState('Build');
  const [showEffortMenu, setShowEffortMenu] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);

  const [showCommandsModal, setShowCommandsModal] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowCommandsModal(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const virtuosoRef = useRef(null);
  const wsRef = useRef(null);
  const textareaRef = useRef(null);
  const currentConversationIdRef = useRef(currentConversationId);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  const selectedModelObj = availableModels.find(m => m.id === model || m.name === model) || DEFAULT_MODELS[0];
  const selectedModelDisplayName = selectedModelObj ? selectedModelObj.name : model;

  const [modelSearch, setModelSearch] = useState('');
  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setAvailableModels(data);
        }
      }
    } catch (e) {}
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  };

  const loadSession = async (id) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        setCurrentConversationId(id);
        setDrawerOpen(false);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'attach', conversationId: id }));
        }
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  const deleteSession = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Delete session?')) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (currentConversationId === id) startNewChat();
        fetchSessions();
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentConversationId(null);
    setDrawerOpen(false);
    setInput('');
  };

  const initWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'session_id') {
          currentConversationIdRef.current = data.id;
          setCurrentConversationId(data.id);
          fetchSessions();
        } else if (data.type === 'tool_call') {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              const currentTools = last.toolCalls || [];
              const updatedTools = [...currentTools, data];
              return [...prev.slice(0, -1), { ...last, toolCalls: updatedTools }];
            } else {
              return [...prev, { role: 'assistant', content: '', toolCalls: [data], isStreaming: true, startTime: Date.now() }];
            }
          });
        } else if (data.type === 'tool_update' || data.type === 'state_change') {
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
            } else {
              return [...prev, { role: 'assistant', content: data.content, isStreaming: true, startTime: Date.now() }];
            }
          });
          if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({ index: 999999, align: 'end', behavior: 'auto' });
          }
        } else if (data.type === 'done' || data.type === 'error') {
          setIsGenerating(false);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              let finalContent = last.content;
              if (data.type === 'error') finalContent += `\n\n*Error: ${data.error}*`;
              return [...prev.slice(0, -1), { ...last, content: finalContent, isStreaming: false }];
            }
            return prev;
          });
          fetchSessions();
        }
      } catch (err) {
        console.error('WS Error:', err);
      }
    };

    ws.onclose = () => setTimeout(initWebSocket, 2000);
  }, []);

  const fetchTheme = async () => {
    try {
      const res = await fetch('/api/theme');
      if (res.ok) {
        const data = await res.json();
        if (data.colors && data.colors.accent) {
          const root = document.documentElement;
          const c = data.colors;
          if (c.dark_background) root.style.setProperty('--bg-dark', c.dark_background);
          if (c.background) root.style.setProperty('--bg-surface', c.background);
          if (c.lighter_background) root.style.setProperty('--bg-card', c.lighter_background);
          if (c.selection) root.style.setProperty('--bg-card-border', c.selection);
          if (c.foreground) root.style.setProperty('--text-main', c.foreground);
          if (c.dark_foreground) root.style.setProperty('--text-muted', c.dark_foreground);
          if (c.bright_foreground) root.style.setProperty('--text-heading', c.bright_foreground);
          if (c.accent || c.bright_magenta || c.magenta) root.style.setProperty('--accent-cyan', c.bright_magenta || c.magenta || c.accent);
          if (c.yellow) root.style.setProperty('--accent-yellow', c.yellow);
          if (c.green) root.style.setProperty('--accent-green', c.green);
          if (c.red) root.style.setProperty('--accent-red', c.red);
        }
      }
    } catch (e) {}
  };

  useEffect(() => {
    initWebSocket();
    fetchSessions();
    fetchModels();
    fetchTheme();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [initWebSocket]);

  const handleSend = useCallback((textOverride) => {
    const userText = (typeof textOverride === 'string' ? textOverride : input).trim();
    if (!userText) return;

    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setInput('');
    setIsGenerating(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true, startTime: Date.now() }]);

    const payload = {
      type: 'prompt',
      prompt: userText,
      model: model,
      effort: effort,
      conversationId: currentConversationId
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, [input, model, effort, currentConversationId]);

  return (
    <div className="tui-container">
      {/* Top Header */}
      <header className="tui-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="tui-icon-btn" onClick={() => setDrawerOpen(true)}>
            <Menu size={18} />
          </button>
          <div className="tui-brand">
            <span>opencode</span>
            <span className="tui-brand-badge">mobile</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button 
            className="tui-header-model-btn"
            onClick={() => setShowModelMenu(true)}
            title={selectedModelDisplayName}
          >
            <span className="tui-header-model-text">{selectedModelObj.shortName || selectedModelDisplayName}</span>
            <ChevronDown size={12} style={{ flexShrink: 0 }} />
          </button>
          <button className="tui-icon-btn" onClick={startNewChat}>
            <Plus size={18} />
          </button>
        </div>
      </header>

      {/* History Drawer & Backdrop Overlay */}
      <div 
        className={`tui-drawer-backdrop ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className={`tui-drawer-panel ${drawerOpen ? 'open' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-cyan)' }}>SESSIONS</span>
          <button className="tui-icon-btn" onClick={() => setDrawerOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sessions.map(s => (
            <div 
              key={s.id}
              style={{ padding: '8px 10px', borderRadius: 4, cursor: 'pointer', marginBottom: 4, background: currentConversationId === s.id ? 'var(--bg-card-border)' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}
              onClick={() => loadSession(s.id)}
            >
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginRight: 8 }}>{s.title}</span>
              <button 
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                onClick={(e) => deleteSession(e, s.id)}
                title="Delete Session"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Terminal Feed */}
      <div className="chat-container">
        {messages.length === 0 ? (
          <div className="welcome-container">
            <div className="welcome-banner">
              OpenCode Mobile Agent Terminal v1.0<br/>
              Connected to local repository instance.
            </div>

            <div className="welcome-commands">
              {[
                { prompt: "Audit repository for bugs", desc: "Scan files & find gaps" },
                { prompt: "Check system health and status", desc: "Inspect process & memory" },
                { prompt: "Run project tests & linter", desc: "Execute verify loop" },
                { prompt: "Summarize recent git commits", desc: "Show recent updates" }
              ].map((item, idx) => (
                <div key={idx} className="tui-chip" onClick={() => handleSend(item.prompt)}>
                  <span className="tui-chip-prompt">$ {item.prompt}</span>
                  <span className="tui-chip-desc">{item.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={messages}
            itemContent={(_index, msg) => <Message msg={msg} />}
            followOutput="smooth"
            initialTopMostItemIndex={messages.length - 1}
            components={{
              Header: () => <div style={{ height: 12 }} />,
              Footer: () => <div style={{ height: 80 }} />
            }}
          />
        )}
      </div>

      {/* Terminal Footer Status Bar & Input Box (Exact Reference Screenshot Match) */}
      <div className="tui-footer-area">
        <div className="tui-input-box">
          <div className="tui-input-top-row">
            <textarea
              ref={textareaRef}
              className="tui-textarea"
              placeholder="Ask a question..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              rows={1}
            />
            <button className="tui-send-btn" onClick={() => handleSend()}>
              <ArrowUp size={14} />
            </button>
          </div>
          <div className="tui-input-subline">
            <span 
              style={{ color: 'var(--accent-purple)', cursor: 'pointer', fontWeight: 600 }}
              onClick={() => setMode(mode === 'Build' ? 'Plan' : 'Build')}
              title="Click to toggle agent mode (Build / Plan)"
            >
              {mode}
            </span>
            <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
            <span 
              style={{ color: 'var(--accent-cyan)', cursor: 'pointer' }}
              onClick={() => setShowModelMenu(true)}
              title="Click to select model"
            >
              {selectedModelDisplayName}
            </span>
            <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>·</span>
            <strong 
              style={{ color: 'var(--accent-yellow)', fontWeight: 600, cursor: 'pointer' }}
              onClick={() => setShowEffortMenu(true)}
              title="Click to select variant / effort level"
            >
              {effort}
            </strong>
          </div>
        </div>

        {/* Footer Sub-Bar */}
        <div className="tui-status-bar">
          <div className="tui-status-left">
            <span style={{ color: 'var(--text-muted)' }}>/home/whirlpool/opencode-mobile</span>
          </div>

          <div className="tui-status-right" style={{ cursor: 'pointer' }} onClick={() => setShowCommandsModal(true)}>
            <span style={{ color: 'var(--text-muted)' }}>201.2K (19%)</span>
            <span style={{ margin: '0 4px', color: 'var(--text-muted)' }}></span>
            <span style={{ color: 'var(--accent-cyan)' }}>commands</span>
          </div>
        </div>
      </div>

      {/* Ctrl+P Commands Modal */}
      {showCommandsModal && (
        <div className="tui-modal-portal">
          <div className="tui-modal-backdrop" onClick={() => setShowCommandsModal(false)} />
          <div className="tui-modal-content">
            <div className="tui-modal-title">Command Palette (Ctrl+P)</div>
            {[
              { text: "Audit Repository for Bugs", prompt: "Audit repository for bugs and security vulnerabilities." },
              { text: "Check System Health & Status", prompt: "Check system health, running services, and git status." },
              { text: "Run Project Tests & Linter", prompt: "Run project tests and inspect code quality." },
              { text: "Summarize Recent Git Commits", prompt: "Summarize recent git commits and modified files." },
              { text: "New Conversation Session", action: () => { startNewChat(); setShowCommandsModal(false); } }
            ].map((item, idx) => (
              <div 
                key={idx} 
                className="tui-modal-item"
                onClick={() => {
                  if (item.action) item.action();
                  else if (item.prompt) {
                    handleSend(item.prompt);
                    setShowCommandsModal(false);
                  }
                }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-heading)' }}>{item.text}</div>
                  {item.prompt && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>$ {item.prompt}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model Modal (Matching Screenshot) */}
      {showModelMenu && (
        <div className="tui-modal-portal">
          <div className="tui-modal-backdrop" onClick={() => setShowModelMenu(false)} />
          <div className="tui-modal-content" style={{ width: 420, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-heading)' }}>Select model</span>
              <button 
                className="tui-icon-btn" 
                onClick={() => setShowModelMenu(false)}
                style={{ width: 24, height: 24, padding: 0 }}
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ background: 'var(--bg-dark)', borderRadius: 4, border: '1px solid var(--bg-card-border)', padding: '6px 10px', marginBottom: 12, display: 'flex', alignItems: 'center' }}>
              <input 
                type="text" 
                placeholder="Search" 
                value={modelSearch} 
                onChange={e => setModelSearch(e.target.value)}
                style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontSize: 13, width: '100%' }}
                autoFocus
              />
            </div>

            <div style={{ overflowY: 'auto', maxHeight: '55vh', paddingRight: 4 }}>
              {/* Filtered Search */}
              {(() => {
                const searchLower = modelSearch.toLowerCase();
                const filtered = availableModels.filter(m => m.name.toLowerCase().includes(searchLower) || (m.provider && m.provider.toLowerCase().includes(searchLower)));
                const order = ['Recent', 'OpenCode Zen', 'Google', 'Anthropic'];
                const detectedCats = Array.from(new Set(filtered.map(m => m.provider || 'Other')));
                const categories = order.filter(c => detectedCats.includes(c)).concat(detectedCats.filter(c => !order.includes(c)));

                return categories.map(cat => (
                  <div key={cat} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: 6 }}>{cat}</div>
                    {filtered.filter(m => (m.provider || 'Other') === cat).map(m => (
                      <div 
                        key={m.id}
                        style={{ 
                          padding: '7px 10px', 
                          borderRadius: 3, 
                          cursor: 'pointer', 
                          marginBottom: 3, 
                          background: model === m.id ? 'var(--accent-cyan)' : 'transparent',
                          color: model === m.id ? '#0d1117' : 'var(--text-main)',
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          fontSize: 12.5,
                          fontWeight: model === m.id ? 600 : 400
                        }}
                        onClick={() => { setModel(m.id); setShowModelMenu(false); }}
                      >
                        <span>{m.name}</span>
                        {m.isFree && <span style={{ fontSize: 11, color: model === m.id ? '#0d1117' : 'var(--text-muted)' }}>Free</span>}
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Variant / Effort Modal */}
      {showEffortMenu && (
        <div className="tui-modal-portal">
          <div className="tui-modal-backdrop" onClick={() => setShowEffortMenu(false)} />
          <div className="tui-modal-content">
            <div className="tui-modal-title">Select Variant / Effort Level</div>
            {[
              { id: 'high', name: 'high', desc: 'Maximum reasoning depth & thoroughness' },
              { id: 'medium', name: 'medium', desc: 'Balanced speed and analysis' },
              { id: 'low', name: 'low', desc: 'Fast lightweight responses' }
            ].map(eff => (
              <div 
                key={eff.id} 
                className={`tui-modal-item ${effort === eff.id ? 'active' : ''}`}
                onClick={() => { setEffort(eff.id); setShowEffortMenu(false); }}
              >
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#e0af68' }}>{eff.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{eff.desc}</div>
                </div>
                {effort === eff.id && <Check size={16} color="#e0af68" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
