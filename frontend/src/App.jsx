import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Mic, MicOff, ArrowUp, Square, Image as ImageIcon, 
  Check, MessageSquare, Trash2, Search, Cpu, X, ChevronDown,
  Zap, Brain, Bot, Code2, Terminal, FileText, SquarePen
} from 'lucide-react';
import Message from './Message';
import { marked } from 'marked';

// Performance: Selective highlight.js language imports
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import cpp from 'highlight.js/lib/languages/cpp';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);

import 'highlight.js/styles/github-dark.css';
import './App.css';

marked.setOptions({
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return code;
  },
  breaks: true
});

const DEFAULT_MODELS = [
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    shortName: '3.7 Flash',
    category: 'Google Gemini',
    badge: 'Default',
    desc: 'Fast multimodal speed & adaptive reasoning',
    icon: 'zap',
    iconColor: '#4285F4',
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high'
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    shortName: '3.6 Flash',
    category: 'Google Gemini',
    badge: 'Fast',
    desc: 'High efficiency everyday reasoning',
    icon: 'zap',
    iconColor: '#34A853',
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high'
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    shortName: '3.5 Flash',
    category: 'Google Gemini',
    badge: 'Lite',
    desc: 'Ultra-lightweight instant responses',
    icon: 'zap',
    iconColor: '#FBBC04',
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'high'
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    shortName: '3.1 Pro',
    category: 'Google Gemini',
    badge: 'Pro',
    desc: 'Deep reasoning, math & complex codebase engineering',
    icon: 'brain',
    iconColor: '#9B72CB',
    supportedEfforts: ['low', 'high'],
    defaultEffort: 'high'
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    shortName: 'Claude Sonnet',
    category: 'Anthropic Claude',
    badge: 'Thinking',
    desc: 'Nuanced synthesis, deep analysis & code architecture',
    icon: 'bot',
    iconColor: '#D96570',
    supportedEfforts: ['thinking'],
    defaultEffort: 'thinking'
  },
  {
    id: 'claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6',
    shortName: 'Claude Opus',
    category: 'Anthropic Claude',
    badge: 'Frontier',
    desc: 'Frontier reasoning & deep open-ended synthesis',
    icon: 'bot',
    iconColor: '#E06A55',
    supportedEfforts: ['thinking'],
    defaultEffort: 'thinking'
  },
  {
    id: 'gpt-oss-120b-medium',
    name: 'GPT-OSS 120B',
    shortName: 'GPT-OSS',
    category: 'Open Source',
    badge: 'Open Weights',
    desc: 'High-parameter open weights model',
    icon: 'cpu',
    iconColor: '#34D399',
    supportedEfforts: ['medium'],
    defaultEffort: 'medium'
  }
];

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState(null);
  
  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS);
  const [model, setModel] = useState(() => {
    return localStorage.getItem('agy_selected_model') || 'gemini-3.7-flash';
  });
  const [effort, setEffort] = useState(() => {
    return localStorage.getItem('agy_selected_effort') || 'high';
  });
  const [showModelMenu, setShowModelMenu] = useState(false);
  
  const [sessions, setSessions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [telemetry, setTelemetry] = useState({ memory: 'N/A', uptime: 'N/A' });
  
  const wsRef = useRef(null);
  const virtuosoRef = useRef(null);
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);
  const drawerPanelRef = useRef(null);

  // 120fps Native Gesture Touch Controller
  const touchState = useRef({
    isTracking: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    drawerWidth: 320,
    startTime: 0
  });

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    const width = Math.min(window.innerWidth * 0.85, 320);
    touchState.current = {
      isTracking: true,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      drawerWidth: width,
      startTime: Date.now()
    };

    if (!drawerOpen && touch.clientX > 40) {
      touchState.current.isTracking = false;
    }
  };

  const handleTouchMove = (e) => {
    if (!touchState.current.isTracking) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchState.current.startX;
    const deltaY = touch.clientY - touchState.current.startY;

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 15) {
      touchState.current.isTracking = false;
      if (drawerPanelRef.current) {
        drawerPanelRef.current.classList.remove('dragging');
        drawerPanelRef.current.style.transform = '';
      }
      return;
    }

    const drawer = drawerPanelRef.current;
    if (!drawer) return;

    drawer.classList.add('dragging');

    let currentTranslate = 0;
    if (drawerOpen) {
      currentTranslate = Math.min(0, Math.max(-touchState.current.drawerWidth, deltaX));
    } else {
      currentTranslate = Math.min(0, -touchState.current.drawerWidth + deltaX);
    }

    requestAnimationFrame(() => {
      if (drawer) {
        drawer.style.transform = `translate3d(${currentTranslate}px, 0, 0)`;
      }
    });
  };

  const handleTouchEnd = (e) => {
    if (!touchState.current.isTracking) return;
    touchState.current.isTracking = false;

    const drawer = drawerPanelRef.current;
    if (drawer) {
      drawer.classList.remove('dragging');
      drawer.style.transform = '';
    }

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchState.current.startX;
    const duration = Date.now() - touchState.current.startTime;
    const velocity = Math.abs(deltaX) / (duration || 1);

    if (drawerOpen) {
      if (deltaX < -60 || (deltaX < -20 && velocity > 0.3)) {
        setDrawerOpen(false);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    } else {
      if (deltaX > 50 || (deltaX > 20 && velocity > 0.3)) {
        setDrawerOpen(true);
        if (navigator.vibrate) navigator.vibrate(8);
      }
    }
  };

  // Auto-expand textarea height to accommodate multi-line typing
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollH, 24), 160)}px`;
    }
  }, [input]);

  // Splash Screen timer
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 850);
    return () => clearTimeout(timer);
  }, []);

  // Initialize Speech Recognition if supported
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        setInput(prev => (prev ? prev + ' ' : '') + transcript);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Voice dictation is not supported in this browser. Try Chrome/Safari.');
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        if (navigator.vibrate) navigator.vibrate(12);
      } catch {
        setIsListening(false);
      }
    }
  };

  const fetchTelemetry = async () => {
    try {
      const res = await fetch('/api/telemetry');
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch {
      // Ignore network errors
    }
  };

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setAvailableModels(data.map(item => {
            const existing = DEFAULT_MODELS.find(p => p.id === item.id);
            return {
              ...item,
              icon: existing?.icon || (item.category === 'claude' ? 'bot' : item.category === 'open' ? 'cpu' : item.id.includes('pro') ? 'brain' : 'zap'),
              iconColor: existing?.iconColor || (item.category === 'claude' ? '#D96570' : item.category === 'open' ? '#34D399' : item.id.includes('pro') ? '#9B72CB' : '#4285F4'),
              category: existing?.category || (item.category === 'claude' ? 'Anthropic Claude' : item.category === 'open' ? 'Open Source' : 'Google Gemini'),
              badge: existing?.badge || item.tag || null,
              desc: existing?.desc || item.description || ''
            };
          }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
    }
  };

  const currentModelObj = useMemo(() => {
    let targetId = model;
    if (model === 'flash') targetId = 'gemini-3.7-flash';
    else if (model === 'pro') targetId = 'gemini-3.1-pro';
    else if (model === 'claude') targetId = 'claude-sonnet-4-6';

    return availableModels.find(m => m.id === targetId || m.id === model) || availableModels[0] || DEFAULT_MODELS[0];
  }, [availableModels, model]);

  const effortDisplayLabel = useMemo(() => {
    if (currentModelObj.category === 'Anthropic Claude' || currentModelObj.id?.includes('claude') || currentModelObj.supportedEfforts?.includes('thinking')) {
      return 'Thinking';
    }
    if (currentModelObj.id === 'gpt-oss-120b-medium') {
      return 'Med';
    }
    if (effort === 'high') return 'High';
    if (effort === 'medium') return 'Med';
    if (effort === 'low') return 'Low';
    return typeof effort === 'string' ? (effort.charAt(0).toUpperCase() + effort.slice(1)) : 'High';
  }, [currentModelObj, effort]);

  const handleSelectModel = (selectedItem) => {
    setModel(selectedItem.id);
    localStorage.setItem('agy_selected_model', selectedItem.id);

    if (selectedItem.supportedEfforts) {
      if (selectedItem.supportedEfforts.includes('thinking')) {
        setEffort('thinking');
        localStorage.setItem('agy_selected_effort', 'thinking');
      } else if (selectedItem.supportedEfforts.length > 0 && !selectedItem.supportedEfforts.includes(effort)) {
        const fallbackEff = selectedItem.defaultEffort || selectedItem.supportedEfforts[0] || 'high';
        setEffort(fallbackEff);
        localStorage.setItem('agy_selected_effort', fallbackEff);
      }
    }

    if (navigator.vibrate) navigator.vibrate(10);
    setShowModelMenu(false);
  };

  const handleSelectEffort = (newEffort) => {
    setEffort(newEffort);
    localStorage.setItem('agy_selected_effort', newEffort);
    if (navigator.vibrate) navigator.vibrate(8);
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
        window.history.replaceState({}, document.title, `/?id=${id}`);

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
    if (!window.confirm('Delete this conversation?')) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (currentConversationId === id) {
          startNewChat();
        }
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
    setAttachedFile(null);
    window.history.replaceState({}, document.title, '/');
  };

  const pendingPromptRef = useRef(null);

  const initWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (currentConversationId) {
        ws.send(JSON.stringify({ type: 'attach', conversationId: currentConversationId }));
      }
      // Flush pending prompt if any
      if (pendingPromptRef.current) {
        ws.send(JSON.stringify(pendingPromptRef.current));
        pendingPromptRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'session_id') {
          setCurrentConversationId(data.id);
          window.history.replaceState({}, document.title, `/?id=${data.id}`);
          fetchSessions();
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
            }
            return prev;
          });
          if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({ index: 999999, align: 'end', behavior: 'auto' });
          }
        } else if (data.type === 'done' || data.type === 'error' || data.type === 'killed') {
          setIsGenerating(false);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) {
              let finalContent = last.content;
              if (data.type === 'error') finalContent += `\n\n*Error: ${data.error}*`;
              else if (data.type === 'killed') finalContent += `\n\n*(Cancelled by user)*`;
              
              const timeTakenMs = Date.now() - (last.startTime || Date.now());
              const seconds = (timeTakenMs / 1000).toFixed(1);
              const toolStr = last.tool ? `Worked for ${seconds}s` : null;
              
              return [...prev.slice(0, -1), { ...last, content: finalContent, isStreaming: false, tool: toolStr }];
            }
            return prev;
          });
          fetchSessions();
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      setTimeout(() => {
        initWebSocket();
      }, 2000);
    };

    ws.onerror = (err) => {
      console.warn('WebSocket error observed:', err);
    };
  }, [currentConversationId]);

  useEffect(() => {
    initWebSocket();
    fetchSessions();
    fetchTelemetry();
    fetchModels();

    const telemetryInterval = setInterval(fetchTelemetry, 20000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.update();
      }).catch((err) => {
        console.error('Service worker registration failed:', err);
      });
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const idFromUrl = urlParams.get('id');
    if (idFromUrl) {
      loadSession(idFromUrl);
    }

    return () => {
      clearInterval(telemetryInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [initWebSocket]);

  const handleSend = useCallback((textOverride) => {
    const userText = (typeof textOverride === 'string' ? textOverride : input).trim();
    const currentAttachment = attachedFile;

    if (!userText && !currentAttachment) return;

    setMessages(prev => [...prev, { role: 'user', content: userText, attachedFile: currentAttachment }]);
    setInput('');
    setAttachedFile(null);
    setIsGenerating(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true, startTime: Date.now() }]);

    const payload = {
      type: 'prompt',
      prompt: userText,
      model: model,
      effort: effort,
      conversationId: currentConversationId,
      attachedFilePath: currentAttachment?.path
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    } else {
      pendingPromptRef.current = payload;
      initWebSocket();
    }
  }, [input, attachedFile, model, effort, currentConversationId, initWebSocket]);

  const handleStop = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'kill', conversationId: currentConversationId }));
    }
    setIsGenerating(false);
  };

  const handleFileAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (res.ok) {
        const data = await res.json();
        setAttachedFile(data);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(s => s.title?.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  return (
    <div 
      className="app-container"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Edge Swipe Hit Zone */}
      <div className="edge-swipe-handle" />

      {/* Splash Screen */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="splash-screen"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <div className="splash-glow" />
              <div className="splash-sparkle" />
            </motion.div>

            <motion.div
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.12, duration: 0.4 }}
              style={{ textAlign: 'center' }}
            >
              <h1 style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.3px', color: '#ffffff', margin: 0, fontFamily: 'var(--font-main)' }}>
                Gemini
              </h1>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Antigravity Mobile
              </p>
            </motion.div>

            <motion.div 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 120, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5, ease: 'easeInOut' }}
              style={{ height: '3px', borderRadius: '4px', background: 'var(--gemini-gradient)', overflow: 'hidden', marginTop: 8 }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hardware-Accelerated 120fps CSS Drawer */}
      <div 
        className={`drawer-backdrop ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />

      <aside 
        ref={drawerPanelRef}
        className={`drawer-panel ${drawerOpen ? 'open' : ''}`}
      >
        <div style={{ padding: '12px 16px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 500, letterSpacing: '0.1px' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--gemini-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 13, color: '#fff' }}>✦</span>
            </div>
            <span>Gemini</span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <md-icon-button class="m3-drawer-icon-btn" onClick={startNewChat} title="New Chat"><Plus size={18} /></md-icon-button>
            <md-icon-button class="m3-drawer-icon-btn" onClick={() => setDrawerOpen(false)} title="Close"><X size={18} /></md-icon-button>
          </div>
        </div>

        {/* Telemetry info */}
        <div style={{ margin: '0 16px 10px', padding: '8px 12px', background: 'var(--md-sys-color-surface-container)', borderRadius: 'var(--md-sys-shape-corner-medium)', border: '1px solid var(--md-sys-color-outline-variant)', fontSize: 12, color: 'var(--md-sys-color-on-surface-variant)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Cpu size={14} color="var(--md-sys-color-primary)" /> RAM: {telemetry.memory}
          </span>
          <span>{telemetry.uptime}</span>
        </div>
        
        {/* Search Bar */}
        <div style={{ padding: '0 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--md-sys-color-surface-container-lowest)', padding: '8px 14px', borderRadius: 'var(--md-sys-shape-corner-full)', border: '1px solid var(--md-sys-color-outline-variant)' }}>
            <Search size={15} color="var(--md-sys-color-outline)" />
            <input 
              type="text" 
              placeholder="Search chats..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ background: 'none', border: 'none', color: 'var(--md-sys-color-on-surface)', fontSize: 14, outline: 'none', width: '100%', fontFamily: 'inherit' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--md-sys-color-outline)', cursor: 'pointer', display: 'flex', padding: 0 }}>
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: '8px 16px 4px', fontSize: 11, fontWeight: 500, color: 'var(--md-sys-color-outline)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Recent
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 16px', WebkitOverflowScrolling: 'touch' }}>
          {filteredSessions.length === 0 ? (
            <div style={{ padding: '28px 8px', color: 'var(--md-sys-color-outline)', fontSize: 14, textAlign: 'center' }}>
              {searchQuery ? 'No matching chats' : 'No chat history'}
            </div>
          ) : (
            filteredSessions.map(session => (
              <div 
                key={session.id} 
                onClick={() => loadSession(session.id)}
                className={`history-item ${currentConversationId === session.id ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <md-ripple></md-ripple>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', flex: 1 }}>
                  <MessageSquare size={16} style={{ flexShrink: 0 }} color="var(--md-sys-color-outline)" />
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{
                      fontSize: 14, 
                      fontWeight: 500,
                      color: currentConversationId === session.id ? '#ffffff' : 'var(--md-sys-color-on-surface)',
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden',
                      letterSpacing: '0.1px'
                    }}>
                      {session.title}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--md-sys-color-outline)' }}>
                      {session.messageCount || 0} msgs • {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>

                <md-icon-button 
                  class="history-delete-btn"
                  onClick={(e) => { e.stopPropagation(); deleteSession(e, session.id); }} 
                  title="Delete Chat"
                >
                  <Trash2 size={15} />
                </md-icon-button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-content-layout">
        {/* Gemini iOS Floating Top Navigation */}
        <header className="header-floating">
          <div className="header-left">
            {/* Circular Hamburger Menu Button */}
            <md-icon-button 
              class="m3-top-icon-btn" 
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(8);
                setDrawerOpen(true);
              }} 
              title="Chat History Menu"
              aria-label="Open Menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="4" y1="9" x2="20" y2="9"></line>
                <line x1="4" y1="15" x2="20" y2="15"></line>
              </svg>
            </md-icon-button>
          </div>
          
          <div className="header-center">
            <button 
              className="m3-model-pill"
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(8);
                setShowModelMenu(!showModelMenu);
              }}
              title="Select Model & Thinking Level"
              aria-label={`Model: ${currentModelObj.name}, Thinking: ${effortDisplayLabel}`}
            >
              <md-ripple></md-ripple>
              <div className="model-pill-content">
                <span className="model-pill-name">{currentModelObj.name}</span>
                <span className="model-pill-divider">·</span>
                <span className="model-pill-effort-badge">{effortDisplayLabel}</span>
              </div>
              <ChevronDown size={14} className={`model-pill-chevron ${showModelMenu ? 'open' : ''}`} />
              <div className="model-live-dot" />
            </button>
          </div>
          
          <div className="header-right">
            <md-icon-button 
              class="m3-top-icon-btn" 
              onClick={() => {
                if (navigator.vibrate) navigator.vibrate(8);
                startNewChat();
              }} 
              title="New Chat"
              aria-label="New Chat"
            >
              <SquarePen size={18} />
            </md-icon-button>
          </div>
        </header>

        {/* Model & Thinking Level Selection Modal */}
        <AnimatePresence>
          {showModelMenu && (
            <div className="model-menu-portal">
              <motion.div
                key="model-menu-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="model-menu-backdrop"
                onClick={() => setShowModelMenu(false)}
              />
              <motion.div 
                key="model-menu-dropdown"
                initial={{ opacity: 0, y: -12, scale: 0.95 }} 
                animate={{ opacity: 1, y: 0, scale: 1 }} 
                exit={{ opacity: 0, y: -12, scale: 0.95 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="model-menu-dropdown"
              >
                {/* M3 Drag Handle */}
                <div className="m3-drag-handle" />

                <div className="model-menu-scrollable">
                  {['Google Gemini', 'Anthropic Claude', 'Open Source'].map(cat => {
                    const catModels = availableModels.filter(m => m.category === cat);
                    if (catModels.length === 0) return null;
                    return (
                      <div key={cat} className="model-category-group">
                        <div className="model-category-header">{cat}</div>
                        {catModels.map((item) => {
                          const isSelected = currentModelObj.id === item.id;
                          const IconComp = item.icon === 'brain' ? Brain : item.icon === 'bot' ? Bot : item.icon === 'cpu' ? Cpu : Zap;
                          
                          return (
                            <div 
                              key={item.id}
                              className={`model-menu-item ${isSelected ? 'selected' : ''}`}
                              onClick={() => {
                                handleSelectModel(item);
                              }}
                            >
                              <md-ripple></md-ripple>
                              <div className="model-item-info">
                                <div className="model-item-icon" style={{ color: item.iconColor }}>
                                  <IconComp size={18} />
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="model-item-title-row">
                                    <span className="model-item-name">{item.name}</span>
                                    {item.badge && (
                                      <span 
                                        className="model-item-tag" 
                                        style={{ 
                                          background: item.badge === 'Pro' || item.badge === 'Frontier' ? 'rgba(155, 114, 203, 0.18)' : item.badge === 'Thinking' ? 'rgba(217, 101, 112, 0.18)' : item.badge === 'Open Weights' ? 'rgba(52, 211, 153, 0.18)' : 'rgba(66, 133, 244, 0.18)',
                                          color: item.badge === 'Pro' || item.badge === 'Frontier' ? 'var(--gemini-purple)' : item.badge === 'Thinking' ? 'var(--gemini-red)' : item.badge === 'Open Weights' ? 'var(--system-green)' : 'var(--gemini-blue)'
                                        }}
                                      >
                                        {item.badge}
                                      </span>
                                    )}
                                  </div>
                                  <div className="model-item-desc">{item.desc}</div>
                                </div>
                              </div>
                              {isSelected && <Check size={18} color="var(--gemini-blue)" style={{ flexShrink: 0, marginLeft: 8 }} />}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* M3 Reasoning Effort / Thinking Depth Control Section */}
                <div className="effort-section-container">
                  <div className="effort-section-header">
                    <span className="effort-section-title">Reasoning Effort</span>
                    <span style={{ fontSize: 11, color: 'var(--md-sys-color-outline)' }}>
                      {currentModelObj.supportedEfforts?.includes('thinking') ? 'Built-in Reasoning' : 'Thinking Depth'}
                    </span>
                  </div>

                  {currentModelObj.supportedEfforts?.includes('thinking') ? (
                    <div className="effort-info-badge">
                      <Brain size={15} color="var(--gemini-red)" style={{ flexShrink: 0 }} />
                      <span>Thinking reasoning is built into this model architecture</span>
                    </div>
                  ) : currentModelObj.supportedEfforts?.length > 0 ? (
                    <div>
                      <div className="m3-segmented-buttons">
                        {currentModelObj.supportedEfforts.map(eff => (
                          <button 
                            key={eff}
                            onClick={() => handleSelectEffort(eff)}
                            className={`m3-segment-btn ${effort === eff ? 'active' : ''}`}
                          >
                            <md-ripple></md-ripple>
                            {eff}
                          </button>
                        ))}
                      </div>
                      <div className="effort-subtext">
                        {effort === 'high' ? 'High: Maximum reasoning depth & thoroughness' : effort === 'medium' ? 'Medium: Balanced speed and depth' : 'Low: Instant lightweight responses'}
                      </div>
                    </div>
                  ) : (
                    <div className="m3-segmented-buttons">
                      {['low', 'medium', 'high'].map(eff => (
                        <button 
                          key={eff}
                          onClick={() => handleSelectEffort(eff)}
                          className={`m3-segment-btn ${effort === eff ? 'active' : ''}`}
                        >
                          <md-ripple></md-ripple>
                          {eff}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        
        <div className="chat-container">
          {messages.length === 0 ? (
            <div className="welcome-container">
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <div style={{ position: 'absolute', width: 90, height: 90, background: 'radial-gradient(circle, rgba(66, 133, 244, 0.25) 0%, transparent 70%)', filter: 'blur(20px)', borderRadius: '50%' }} />
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--gemini-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 2, boxShadow: '0 0 24px rgba(66, 133, 244, 0.4)' }}>
                  <span style={{ fontSize: 26, color: '#ffffff' }}>✦</span>
                </div>
              </div>

              <h1 style={{ fontSize: '24px', fontWeight: 500, color: 'var(--md-sys-color-on-surface)', marginBottom: '6px', letterSpacing: '-0.2px', fontFamily: 'var(--font-main)' }}>
                Hello, Dishant
              </h1>
              <p style={{ fontSize: '14px', maxWidth: '320px', lineHeight: 1.45, color: 'var(--md-sys-color-on-surface-variant)', marginBottom: '24px', letterSpacing: '0.15px' }}>
                How can Gemini assist you today?
              </p>

              {/* M3 Elevated Suggestion Grid */}
              <div className="m3-suggestion-grid">
                {[
                  { icon: <Code2 size={18} color="#4285F4" />, text: "Audit codebase", desc: "Find bugs & gaps", prompt: "Audit this repository and identify bugs and improvements." },
                  { icon: <Zap size={18} color="#34D399" />, text: "System status", desc: "RAM, health, services", prompt: "Check system health, running services, and git status." },
                  { icon: <Terminal size={18} color="#FBBC04" />, text: "Run diagnostics", desc: "Test suite & linter", prompt: "Run project tests and inspect code quality." },
                  { icon: <FileText size={18} color="#EA4335" />, text: "Recent commits", desc: "Explain modified files", prompt: "Summarize recent git commits and modified files." }
                ].map((chip, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSend(chip.prompt)}
                    className="m3-suggestion-card"
                  >
                    <md-ripple></md-ripple>
                    <md-elevation></md-elevation>
                    <div className="m3-card-icon-container">
                      {chip.icon}
                    </div>
                    <div>
                      <div className="m3-card-title">{chip.text}</div>
                      <div className="m3-card-desc">{chip.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Virtuoso
              ref={virtuosoRef}
              className="virtuoso-list"
              data={messages}
              itemContent={(_index, msg) => <Message msg={msg} />}
              followOutput="smooth"
              initialTopMostItemIndex={messages.length - 1}
              components={{
                Header: () => <div style={{ height: 'calc(68px + env(safe-area-inset-top, 0px))', width: '100%' }} />,
                Footer: () => <div style={{ height: 'calc(85px + env(safe-area-inset-bottom, 0px))', width: '100%' }} />
              }}
            />
          )}
        </div>

        {/* M3 Signature Floating Prompt Pill */}
        <div className="prompt-area-floating">
          <div className="prompt-pill-container">
            {attachedFile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', background: 'var(--md-sys-color-surface-container)', borderRadius: 'var(--md-sys-shape-corner-medium)', border: '1px solid var(--md-sys-color-outline-variant)', width: 'fit-content' }}>
                <ImageIcon size={16} color="var(--md-sys-color-primary)" /> 
                <span style={{ fontSize: 13, maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--md-sys-color-on-surface)' }}>{attachedFile.originalName}</span>
                <button onClick={() => setAttachedFile(null)} style={{ background: 'none', border: 'none', color: 'var(--md-sys-color-outline)', cursor: 'pointer', padding: 2, display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
            )}
            
            <div className="gemini-prompt-capsule">
              {/* Plus button on left */}
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <md-icon-button class="m3-prompt-icon-btn" title="Add Attachment">
                  <Plus size={20} />
                </md-icon-button>
                <input type="file" style={{ display: 'none' }} onChange={handleFileAttach} />
              </label>
              
              {/* Textarea */}
              <textarea 
                ref={textareaRef}
                placeholder={isListening ? "Listening..." : "Ask Gemini"} 
                value={input} 
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                rows={1}
              />
              
              {/* Right Action Cluster */}
              {isGenerating ? (
                <md-filled-icon-button onClick={handleStop} title="Stop" class="m3-stop-btn">
                  <Square size={16} fill="currentColor" />
                </md-filled-icon-button>
              ) : (
                input.trim() || attachedFile ? (
                  <md-filled-icon-button onClick={() => handleSend()} title="Send" class="m3-send-btn">
                    <ArrowUp size={20} />
                  </md-filled-icon-button>
                ) : (
                  <div className="prompt-right-cluster">
                    {/* Microphone icon */}
                    <md-icon-button 
                      onClick={toggleListening} 
                      title={isListening ? "Stop Dictation" : "Dictate"}
                      class="m3-prompt-icon-btn"
                    >
                      {isListening ? <MicOff size={20} style={{ color: 'var(--md-sys-color-error)' }} /> : <Mic size={20} />}
                    </md-icon-button>

                    {/* Gemini Live Sound Wave Button */}
                    <button 
                      className="gemini-live-btn"
                      title="Gemini Live"
                      onClick={() => alert("Gemini Live voice session")}
                    >
                      <md-ripple></md-ripple>
                      <div className="gemini-wave-bars">
                        <div className="wave-bar" />
                        <div className="wave-bar" />
                        <div className="wave-bar" />
                        <div className="wave-bar" />
                      </div>
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
