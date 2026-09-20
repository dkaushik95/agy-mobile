import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { 
  Menu, Plus, X, Check, ChevronDown, Trash2, ArrowUp, Square, Bell, Smartphone, Key
} from 'lucide-react';

import './App.css';
import Message from './Message.jsx';

const DEFAULT_MODELS = [
  { id: 'opencode/big-pickle', name: 'Big Pickle', provider: 'OpenCode Zen', isFree: true },
  { id: 'google/antigravity-gemini-3.8-flash', name: 'Gemini 3.8 Flash (Antigravity)', provider: 'Recent' },
  { id: 'opencode/muse-spark-1.3-contributor-free', name: 'Muse Spark 1.3 Free', provider: 'OpenCode Zen', isFree: true },
  { id: 'opencode/ling-3.0-flash-fin-free', name: 'Ling 3.0 Flash Fin Free', provider: 'OpenCode Zen', isFree: true },
  { id: 'opencode/nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free', provider: 'OpenCode Zen', isFree: true },
  { id: 'opencode/muse-spark-1.2-contributor-free', name: 'Muse Spark 1.2 Free', provider: 'OpenCode Zen', isFree: true },
  { id: 'opencode/nemotron-3-ultra-free', name: 'Nemotron 3 Ultra Free', provider: 'OpenCode Zen', isFree: true },
  { id: 'opencode/mimo-v2.5-free', name: 'MiMo V2.5 Free', provider: 'OpenCode Zen', isFree: true },
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'Google' },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Google' },
  { id: 'google/gemini-flash-latest', name: 'Gemini Flash Latest', provider: 'Google' },
  { id: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', provider: 'Google' },
  { id: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash', provider: 'Google' },
  { id: 'google/gemini-flash-lite-latest', name: 'Gemini Flash-Lite Latest', provider: 'Google' }
];

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getStoredToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token');
  if (urlToken) {
    localStorage.setItem('opencode_token', urlToken);
    urlParams.delete('token');
    const newSearch = urlParams.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
    return urlToken;
  }
  return localStorage.getItem('opencode_token') || '';
}

function authFetch(url, options = {}) {
  const token = localStorage.getItem('opencode_token') || '';
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { credentials: 'same-origin', ...options, headers });
}

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [wsStatus, setWsStatus] = useState('connecting'); // connecting | open | reconnecting | offline
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [drawerDrag, setDrawerDrag] = useState(null);

  const [availableModels, setAvailableModels] = useState(DEFAULT_MODELS);
  const [model, setModel] = useState('opencode/big-pickle');
  const [effort, setEffort] = useState('high');
  const [mode, setMode] = useState('Build');
  const [showEffortMenu, setShowEffortMenu] = useState(false);

  const [sessions, setSessions] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [showCommandsModal, setShowCommandsModal] = useState(false);

  const [telemetry, setTelemetry] = useState({ cwd: '/workspace', memory: '19%', uptime: 'N/A' });
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  // Sunshine-style Pairing Modal State
  const [isPaired, setIsPaired] = useState(false);
  const isPairedRef = useRef(isPaired);
  useEffect(() => {
    isPairedRef.current = isPaired;
  }, [isPaired]);

  const [showPairModal, setShowPairModal] = useState(false);
  const [pairingPin, setPairingPin] = useState(null);
  const [pairingClientId, setPairingClientId] = useState(null);
  const [pairingStatus, setPairingStatus] = useState('idle'); // idle | waiting | success | error
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [pendingSessionId, setPendingSessionId] = useState(null);

  const virtuosoRef = useRef(null);
  const wsRef = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);
  const currentConversationIdRef = useRef(currentConversationId);
  const activeAssistantIdRef = useRef(null);
  const pendingPromptRef = useRef(null);
  const wsRetryRef = useRef({ n: 0, timer: null });
  const modelRef = useRef(model);
  const effortRef = useRef(effort);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => { effortRef.current = effort; }, [effort]);

  const drawerOpenRef = useRef(drawerOpen);
  useEffect(() => { drawerOpenRef.current = drawerOpen; }, [drawerOpen]);

  const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const selectedModelObj = availableModels.find(m => m.id === model || m.name === model) || DEFAULT_MODELS[0];
  const selectedModelDisplayName = selectedModelObj ? selectedModelObj.name : model;

  const connLabel = { open: 'connected', connecting: 'connecting…', reconnecting: 'reconnecting…', offline: 'offline' }[wsStatus] || wsStatus;

  const [modelSearch, setModelSearch] = useState('');

  const fetchModels = useCallback(async () => {
    try {
      const res = await authFetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setAvailableModels(data);
        }
      }
    } catch (_e) {}
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await authFetch('/api/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await authFetch('/api/telemetry');
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
      }
    } catch (_e) {}
  }, []);

  const fetchTheme = useCallback(async () => {
    try {
      const res = await authFetch('/api/theme');
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
    } catch (_e) {}
  }, []);

  const autoScroll = useCallback(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: 999999, align: 'end', behavior: 'auto' });
    }
  }, []);

  const finalizeAssistant = useCallback((status, payload) => {
    const activeId = activeAssistantIdRef.current;
    if (!activeId) return;
    activeAssistantIdRef.current = null;
    const error = payload && payload.error ? (typeof payload.error === 'string' ? payload.error : String(payload.error)) : null;
    setMessages(prev => prev.map(m =>
      m.id === activeId ? { ...m, status: error ? 'error' : status, error: error || m.error, isStreaming: false, endTime: Date.now() } : m
    ));
    setIsGenerating(false);
    fetchSessions();
  }, [fetchSessions]);

  const flushPendingPrompt = useCallback(() => {
    const payload = pendingPromptRef.current;
    if (!payload) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      pendingPromptRef.current = null;
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const initWebSocket = useCallback(() => {
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) return;
    if (existing) {
      try { existing.onclose = null; existing.close(); } catch (e) {}
    }

    setWsStatus('connecting');
    const token = localStorage.getItem('opencode_token') || '';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws${query}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      wsRetryRef.current.n = 0;
      setWsStatus('open');
      flushPendingPrompt();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'session_id') {
          currentConversationIdRef.current = data.id;
          setCurrentConversationId(data.id);
          if (activeAssistantIdRef.current) {
            setMessages(prev => prev.map(m =>
              m.id === activeAssistantIdRef.current ? { ...m, conversationId: data.id } : m
            ));
          }
          fetchSessions();
        } else if (data.type === 'chunk') {
          const activeId = activeAssistantIdRef.current;
          if (activeId) {
            setMessages(prev => prev.map(m => {
              if (m.id !== activeId || m.status === 'error') return m;
              return {
                ...m,
                content: m.content + data.content,
                status: m.status === 'thinking' ? 'streaming' : m.status
              };
            }));
          } else {
            setMessages(prev => [...prev, {
              id: newId('assistant'), role: 'assistant', content: data.content,
              status: 'streaming', isStreaming: true, startTime: Date.now(), toolCalls: []
            }]);
          }
          autoScroll();
        } else if (data.type === 'tool_call') {
          const activeId = activeAssistantIdRef.current;
          if (activeId) {
            setMessages(prev => prev.map(m => {
              if (m.id !== activeId || m.status === 'error') return m;
              return { ...m, toolCalls: [...(m.toolCalls || []), data], status: m.status === 'thinking' ? 'streaming' : m.status };
            }));
          } else {
            setMessages(prev => [...prev, {
              id: newId('assistant'), role: 'assistant', content: '', toolCalls: [data],
              status: 'streaming', isStreaming: true, startTime: Date.now()
            }]);
          }
        } else if (data.type === 'tool_update' || data.type === 'state_change') {
          const text = data.message || data.content || '';
          if (activeAssistantIdRef.current && text) {
            setMessages(prev => prev.map(m => m.id === activeAssistantIdRef.current ? { ...m, activity: text } : m));
          }
        } else if (data.type === 'done') {
          finalizeAssistant('done', data);
        } else if (data.type === 'stopped') {
          finalizeAssistant('stopped', data);
        } else if (data.type === 'error') {
          finalizeAssistant('error', { error: data.error || 'Request failed' });
        }
      } catch (err) {
        console.error('WS Error:', err);
      }
    };

    ws.onclose = () => {
      if (ws !== wsRef.current) return;
      if (activeAssistantIdRef.current) {
        finalizeAssistant('error', { error: 'Connection lost while the agent was responding.' });
      }
      if (!isPairedRef.current) {
        setWsStatus('offline');
        return;
      }
      const attempt = wsRetryRef.current.n++;
      setWsStatus('reconnecting');
      const delay = Math.min(1500 * Math.pow(2, Math.min(attempt, 4)), 15000);
      wsRetryRef.current.timer = setTimeout(initWebSocket, delay);
    };
  }, [autoScroll, finalizeAssistant, fetchSessions, flushPendingPrompt]);

  const requestPairingPin = useCallback(async () => {
    try {
      setPairingStatus('waiting');
      const clientName = navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Client Device';
      let clientId = localStorage.getItem('opencode_client_id');
      if (!clientId) {
        clientId = 'cli_' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('opencode_client_id', clientId);
      }

      const res = await fetch('/api/pair/request-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName, clientId })
      });
      const data = await res.json();
      if (data.pin) {
        setPairingPin(data.pin);
        setPairingClientId(data.clientId);
      }
    } catch (err) {
      console.error('Pair request error:', err);
      setPairingStatus('error');
    }
  }, []);

  const saveManualToken = useCallback(() => {
    if (!manualTokenInput.trim()) return;
    localStorage.setItem('opencode_token', manualTokenInput.trim());
    setIsPaired(true);
    setShowPairModal(false);
    initWebSocket();
    fetchSessions();
    fetchModels();
    fetchTheme();
    fetchTelemetry();
  }, [manualTokenInput, initWebSocket, fetchSessions, fetchModels, fetchTheme, fetchTelemetry]);

  // Check auth and pairing status on mount
  useEffect(() => {
    getStoredToken();
    let isCancelled = false;

    const urlParams = new URLSearchParams(window.location.search);
    const pushId = urlParams.get('id');
    if (pushId) setPendingSessionId(pushId);

    const checkAuthAndInit = async () => {
      try {
        const res = await authFetch('/api/pair/status');
        if (res.ok) {
          const d = await res.json();
          if (d.requireAuth && !d.authenticated) {
            if (!isCancelled) {
              setIsPaired(false);
              setShowPairModal(true);
              requestPairingPin();
            }
            return;
          }
        }
      } catch (err) {
        console.error('Auth check error:', err);
      }

      if (!isCancelled) {
        setIsPaired(true);
        initWebSocket();
        fetchSessions();
        fetchModels();
        fetchTheme();
        fetchTelemetry();
      }
    };

    checkAuthAndInit();

    return () => {
      isCancelled = true;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      if (wsRetryRef.current.timer) clearTimeout(wsRetryRef.current.timer);
    };
  }, [initWebSocket, fetchSessions, fetchModels, fetchTheme, fetchTelemetry, requestPairingPin]);

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

  // Swipe-right-anywhere gesture: drags the Sessions & Devices drawer open from the middle.
  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let pointerId = null;
    let claimed = false;

    const onDown = (e) => {
      if (drawerOpenRef.current || pointerId !== null) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      claimed = false;
    };
    const onMove = (e) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!claimed) {
        if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
        if (dx > 0 && dx > Math.abs(dy)) {
          claimed = true;
        } else {
          pointerId = null;
          return;
        }
      }
      setDrawerDrag(Math.min(dx, 320));
    };
    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      const be = e;
      const dx = be.clientX - startX;
      pointerId = null;
      claimed = false;
      setDrawerDrag(null);
      if (dx > 110) setDrawerOpen(true);
    };
    const release = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      claimed = false;
      setDrawerDrag(null);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', release);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', release);
    };
  }, []);

  // Poll for host confirmation of PIN
  useEffect(() => {
    let timer = null;
    if (showPairModal && pairingPin && pairingClientId && pairingStatus === 'waiting') {
      timer = setInterval(async () => {
        try {
          const res = await fetch('/api/pair/poll-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pairingPin, clientId: pairingClientId })
          });
          const data = await res.json();
          if (data.paired && data.token) {
            localStorage.setItem('opencode_token', data.token);
            setPairingStatus('success');
            setIsPaired(true);
            setTimeout(() => {
              setShowPairModal(false);
              initWebSocket();
              fetchSessions();
              fetchModels();
              fetchTheme();
              fetchTelemetry();
            }, 800);
          }
        } catch (_e) {}
      }, 2000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [showPairModal, pairingPin, pairingClientId, pairingStatus, initWebSocket, fetchSessions, fetchModels, fetchTheme, fetchTelemetry]);

  const enableNotifications = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push notifications are not supported in this browser.');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const keyRes = await authFetch('/api/vapidPublicKey');
      const publicKey = await keyRes.text();
      if (!publicKey) {
        alert('VAPID public key is not configured on server.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Notification permission was denied.');
        return;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      const subRes = await authFetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });

      if (subRes.ok) {
        setNotificationsEnabled(true);
        alert('Push notifications enabled successfully!');
      }
    } catch (err) {
      console.error('Push registration error:', err);
      alert('Failed to enable push notifications: ' + err.message);
    }
  };

  const loadSession = async (id) => {
    try {
      const res = await authFetch(`/api/sessions/${id}`);
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
      const res = await authFetch(`/api/sessions/${id}`, { method: 'DELETE' });
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

  // Open a session deep-linked from a push notification (?id=...)
  const loadSessionRef = useRef(loadSession);
  useEffect(() => {
    loadSessionRef.current = loadSession;
  });
  useEffect(() => {
    if (!isPaired || !pendingSessionId) return;
    loadSessionRef.current(pendingSessionId);
    setPendingSessionId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete('id');
    const qs = params.toString();
    window.history.replaceState({}, document.title, window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, [isPaired, pendingSessionId]);

  useEffect(() => {
    if (!isPaired) return;
    const interval = setInterval(fetchTelemetry, 30000);
    return () => clearInterval(interval);
  }, [isPaired, fetchTelemetry]);

  const handleSend = useCallback((textOverride) => {
    if (isGenerating) return;
    const userText = (typeof textOverride === 'string' ? textOverride : input).trim();
    if (!userText) return;

    const conversationId = currentConversationIdRef.current;
    const userMsg = { id: newId('user'), role: 'user', content: userText, time: Date.now() };
    const assistantMsg = {
      id: newId('assistant'),
      role: 'assistant',
      content: '',
      status: 'thinking',
      isStreaming: true,
      startTime: Date.now(),
      parent: userText,
      conversationId,
      toolCalls: []
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    activeAssistantIdRef.current = assistantMsg.id;
    setInput('');
    setIsGenerating(true);

    const payload = {
      type: 'prompt',
      prompt: userText,
      model: modelRef.current,
      effort: effortRef.current,
      conversationId
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    } else {
      pendingPromptRef.current = payload;
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        initWebSocket();
      }
    }
  }, [input, isGenerating, initWebSocket]);

  const stopGeneration = useCallback(() => {
    const conversationId = currentConversationIdRef.current;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop', conversationId }));
    } else {
      finalizeAssistant('stopped', {});
    }
  }, [finalizeAssistant]);

  const retryAssistant = useCallback((assistantMsg) => {
    const promptText = assistantMsg && assistantMsg.parent;
    if (!promptText || isGenerating) return;
    setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
    handleSendRef.current(promptText);
  }, [isGenerating]);

  const handleSendRef = useRef(handleSend);
  useEffect(() => { handleSendRef.current = handleSend; });

  return (
    <div className="tui-container">
      {/* Top Header */}
      <header className="tui-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="tui-icon-btn" onClick={() => setDrawerOpen(true)} title="Sessions & Settings">
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
          <button className="tui-icon-btn" onClick={startNewChat} title="New Chat">
            <Plus size={18} />
          </button>
        </div>
      </header>

      {/* History Drawer & Settings */}
      <div 
        className={`tui-drawer-backdrop ${drawerOpen || drawerDrag !== null ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div
        className={`tui-drawer-panel ${drawerOpen ? 'open' : ''} ${drawerDrag !== null ? 'dragging' : ''}`}
        style={drawerDrag !== null ? { transform: `translateX(calc(-100% + ${Math.max(0, drawerDrag)}px))` } : undefined}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-cyan)' }}>SESSIONS & DEVICES</span>
          <button className="tui-icon-btn" onClick={() => setDrawerOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <button 
            onClick={() => { setShowPairModal(true); setDrawerOpen(false); }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid var(--bg-card-border)',
              background: 'var(--bg-card)',
              color: 'var(--accent-cyan)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Smartphone size={14} />
            <span>Pair Device (PIN)</span>
          </button>

          <button 
            onClick={enableNotifications}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid var(--bg-card-border)',
              background: notificationsEnabled ? 'rgba(74, 222, 128, 0.15)' : 'var(--bg-card)',
              color: notificationsEnabled ? 'var(--accent-green)' : 'var(--text-heading)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Bell size={14} />
            <span>{notificationsEnabled ? 'Notifications Active' : 'Enable Web Notifications'}</span>
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
      <div className="chat-container" ref={chatContainerRef}>
        {messages.length === 0 ? (
          <div className="welcome-container">
            <div className="welcome-banner">
              OpenCode Mobile Terminal v1.0<br/>
              Connected to local agent instance.
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
            itemContent={(_index, msg) => <Message msg={msg} onRetry={retryAssistant} />}
            followOutput="smooth"
            initialTopMostItemIndex={messages.length - 1}
            components={{
              Header: () => <div style={{ height: 12 }} />,
              Footer: () => <div style={{ height: 80 }} />
            }}
          />
        )}
      </div>

      {/* Terminal Footer Status Bar & Input Box */}
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
              disabled={isGenerating}
            />
            {isGenerating ? (
              <button className="tui-stop-btn" onClick={stopGeneration} title="Stop generation" aria-label="Stop generation">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                className="tui-send-btn"
                onClick={() => handleSend()}
                aria-label="Send message"
                disabled={!input.trim()}
              >
                <ArrowUp size={14} />
              </button>
            )}
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

        {/* Dynamic Telemetry Footer Sub-Bar */}
        <div className="tui-status-bar">
          <div className="tui-status-left">
            <button
              className={`tui-conn-chip ${wsStatus}`}
              onClick={wsStatus !== 'open' ? () => initWebSocket() : undefined}
              title={wsStatus !== 'open' ? 'Tap to reconnect' : 'Connected to host'}
            >
              <span className="tui-conn-dot" />
              <span className="tui-conn-label">{connLabel}</span>
            </button>
            <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={telemetry.cwd}>{telemetry.cwd}</span>
          </div>

          <div className="tui-status-right" style={{ cursor: 'pointer' }} onClick={() => setShowCommandsModal(true)}>
            <span style={{ color: 'var(--text-muted)' }}>{telemetry.memory}</span>
            <span style={{ margin: '0 4px', color: 'var(--text-muted)' }}>·</span>
            <span style={{ color: 'var(--accent-cyan)' }}>commands</span>
          </div>
        </div>
      </div>

      {/* Sunshine-style Device Pairing Modal */}
      {showPairModal && (
        <div className="tui-modal-portal">
          <div className="tui-modal-backdrop" onClick={() => isPaired && setShowPairModal(false)} />
          <div className="tui-modal-content" style={{ maxWidth: 420, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Smartphone size={18} color="var(--accent-cyan)" />
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-heading)' }}>Pair Device</span>
              </div>
              {isPaired && (
                <button 
                  className="tui-icon-btn" 
                  onClick={() => setShowPairModal(false)}
                  style={{ width: 24, height: 24, padding: 0 }}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
              Pair this mobile device with your host PC like Moonlight/Sunshine. Open the <strong>OpenCode Mobile</strong> panel in Omarchy to confirm this PIN.
            </p>

            {pairingPin ? (
              <div style={{ 
                background: 'var(--bg-dark)', 
                padding: '20px', 
                borderRadius: 8, 
                border: '1px solid var(--bg-card-border)',
                textAlign: 'center',
                marginBottom: 16
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 600 }}>Pairing PIN</div>
                <div style={{ 
                  fontSize: 38, 
                  fontWeight: 800, 
                  fontFamily: 'var(--font-mono)', 
                  letterSpacing: 8,
                  color: pairingStatus === 'success' ? 'var(--accent-green)' : 'var(--accent-cyan)' 
                }}>
                  {pairingPin}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {pairingStatus === 'waiting' && (
                    <>
                      <span className="live-indicator" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-cyan)', display: 'inline-block' }} />
                      <span>Waiting for confirmation in Omarchy panel...</span>
                    </>
                  )}
                  {pairingStatus === 'success' && '✓ Paired successfully!'}
                </div>

                {pairingStatus === 'waiting' && (
                  <button
                    onClick={requestPairingPin}
                    style={{
                      marginTop: 14,
                      padding: '5px 12px',
                      background: 'transparent',
                      border: '1px solid var(--bg-card-border)',
                      borderRadius: 4,
                      color: 'var(--text-muted)',
                      fontSize: 11,
                      cursor: 'pointer'
                    }}
                  >
                    Generate New PIN
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={requestPairingPin}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: 'var(--accent-cyan)',
                  color: '#0d1117',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginBottom: 16
                }}
              >
                Generate 4-Digit PIN
              </button>
            )}

            <div style={{ borderTop: '1px solid var(--bg-card-border)', paddingTop: 14 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Key size={12} />
                <span>Or enter pre-shared token</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input 
                  type="text" 
                  placeholder="Bearer token"
                  value={manualTokenInput}
                  onChange={e => setManualTokenInput(e.target.value)}
                  style={{ 
                    flex: 1, 
                    background: 'var(--bg-dark)', 
                    border: '1px solid var(--bg-card-border)', 
                    color: 'var(--text-main)', 
                    padding: '6px 10px', 
                    borderRadius: 4,
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)'
                  }}
                />
                <button
                  onClick={saveManualToken}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--bg-card-border)',
                    color: 'var(--text-heading)',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ctrl+P Commands Modal */}
      {showCommandsModal && (
        <div className="tui-modal-portal">
          <div className="tui-modal-backdrop" onClick={() => setShowCommandsModal(false)} />
          <div className="tui-modal-content">
            <div className="tui-modal-title">Command Palette (Ctrl+P)</div>
            {[
              { text: "Pair Mobile Device (PIN)", action: () => { setShowPairModal(true); setShowCommandsModal(false); } },
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

      {/* Model Modal */}
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
