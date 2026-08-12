/* ==========================================================================
   Gemini App Material Design Motion Engine
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const feedContent = document.getElementById('feed-content');
    const emptyState = document.getElementById('empty-state');
    const promptInput = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('send-btn');
    const micBtn = document.getElementById('mic-btn');
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input');
    const stopBtn = document.getElementById('stop-btn');
    const stopBtnWrap = document.getElementById('stop-btn-wrap');
    const attachedPreview = document.getElementById('attached-preview');
    const attachedThumbContainer = document.getElementById('attached-thumb-container');
    const removeAttachedBtn = document.getElementById('remove-attached-btn');
    
    // Header Controls
    const menuBtn = document.getElementById('menu-btn');
    const advancedToggle = document.getElementById('advanced-toggle');
    const controlsDrawer = document.getElementById('controls-drawer');
    const newChatBtn = document.getElementById('new-chat-btn');
    const profilePic = document.querySelector('.profile-pic');

    if (profilePic) {
        profilePic.addEventListener('click', () => {
            alert('Settings & Account panel coming soon!');
        });
    }

    // History Drawer Elements
    const historyOverlay = document.getElementById('history-overlay');
    const historyDrawer = document.getElementById('history-drawer');
    const closeDrawerBtn = document.getElementById('close-drawer-btn');
    const sessionList = document.getElementById('session-list');
    const sessionSearchInput = document.getElementById('session-search-input');

    // Chips
    const modeChips = document.querySelectorAll('.mode-chip');
    const effortChips = document.querySelectorAll('.effort-chip');
    const modelChips = document.querySelectorAll('.model-chip');

    // State Variables
    let currentConversationId = null;
    let selectedMode = 'default';
    let selectedEffort = 'medium';
    let selectedModel = 'pro';
    let attachedFilePath = null;
    let attachedFileUrl = null;
    let ws = null;
    let currentResponseDoc = null;
    let currentResponseContent = null;
    let currentResponseText = '';
    let isGenerating = false;
    let streamingCursor = null;
    let toolPill = null;
    let parseThrottle = null;
    let allSessions = [];

    // Configure Marked.js
    if (window.marked) {
        marked.setOptions({
            highlight: function(code, lang) {
                if (window.hljs && lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return code;
            },
            breaks: true
        });
    }

    // Toggle Advanced Controls
    advancedToggle.addEventListener('click', () => {
        controlsDrawer.classList.toggle('open');
    });

    // History Drawer Logic
    menuBtn.addEventListener('click', () => {
        historyOverlay.classList.add('open');
        historyDrawer.classList.add('open');
        loadSessionsList();
    });

    const closeDrawer = () => {
        historyOverlay.classList.remove('open');
        historyDrawer.classList.remove('open');
    };

    closeDrawerBtn.addEventListener('click', closeDrawer);
    historyOverlay.addEventListener('click', closeDrawer);

    sessionSearchInput.addEventListener('input', () => {
        const query = sessionSearchInput.value.toLowerCase();
        const filtered = allSessions.filter(s => s.title.toLowerCase().includes(query));
        renderSessionItems(filtered);
    });

    // Initialize WebSocket
    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => console.log('Connected to Gemini Server');
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'session_id') {
                currentConversationId = data.id;
            } else if (data.type === 'tool_update') {
                updateToolPill(data.content);
            } else if (data.type === 'state_change') {
                updateToolPill(data.message || 'Thinking...');
            } else if (data.type === 'chunk') {
                appendAssistantChunk(data.content);
            } else if (data.type === 'done') {
                finishAssistantResponse();
            } else if (data.type === 'error') {
                appendAssistantChunk(`\n\n*Error: ${data.error}*`);
                finishAssistantResponse();
            }
        };

        ws.onclose = () => setTimeout(initWebSocket, 2000);
    }
    initWebSocket();

    function updateToolPill(text) {
        if (!currentResponseDoc) {
            hideEmptyState();
            currentResponseDoc = createGeminiResponseBlock();
            currentResponseText = '';
        }
        
        if (!toolPill) {
            toolPill = document.createElement('div');
            toolPill.className = 'tool-pill';
            toolPill.innerHTML = `<div class="tool-pill-pulse"></div><span></span>`;
            currentResponseDoc.insertBefore(toolPill, currentResponseContent);
        }
        
        toolPill.querySelector('span').textContent = text.substring(0, 60) + (text.length > 60 ? '...' : '');
    }

    function appendAssistantChunk(text) {
        if (!currentResponseDoc) {
            hideEmptyState();
            currentResponseDoc = createGeminiResponseBlock();
            currentResponseText = '';

            streamingCursor = document.createElement('span');
            streamingCursor.className = 'streaming-cursor';
        }

        currentResponseText += text;

        if (window.marked) {
            if (parseThrottle) clearTimeout(parseThrottle);
            parseThrottle = setTimeout(() => {
                currentResponseContent.innerHTML = marked.parse(currentResponseText);
                if (streamingCursor) currentResponseContent.appendChild(streamingCursor);
                scrollToBottom();
            }, 60);
        } else {
            currentResponseContent.textContent = currentResponseText;
        }
        
        scrollToBottom();
    }

    function finishAssistantResponse() {
        isGenerating = false;
        if (parseThrottle) clearTimeout(parseThrottle);
        
        if (streamingCursor && streamingCursor.parentNode) {
            streamingCursor.parentNode.removeChild(streamingCursor);
            streamingCursor = null;
        }
        if (toolPill && toolPill.parentNode) {
            toolPill.parentNode.removeChild(toolPill);
            toolPill = null;
        }

        if (currentResponseContent && window.marked) {
            currentResponseContent.innerHTML = marked.parse(currentResponseText);
            addDocumentActions(currentResponseDoc, currentResponseText);
        }

        currentResponseDoc = null;
        currentResponseContent = null;
        sendBtn.disabled = false;
        sendBtn.style.color = "var(--text-primary)";
        stopBtnWrap.style.display = 'none';
    }

    // Create User Bubble
    function createUserBubble(content, imageUrl = null) {
        const row = document.createElement('div');
        row.className = 'user-message-row';
        
        const bubble = document.createElement('div');
        bubble.className = 'user-bubble';
        
        if (imageUrl) {
            bubble.innerHTML = `<img src="${imageUrl}" class="user-image-preview">`;
        }
        
        bubble.innerHTML += escapeHtml(content);
        
        row.appendChild(bubble);
        feedContent.appendChild(row);
        scrollToBottom();
    }

    // Create Gemini Response Block
    function createGeminiResponseBlock() {
        const row = document.createElement('div');
        row.className = 'gemini-message-row';
        
        row.innerHTML = `
            <div class="gemini-header">
                <div class="gemini-sparkle"></div>
            </div>
        `;
        
        currentResponseContent = document.createElement('div');
        currentResponseContent.className = 'gemini-content';
        
        row.appendChild(currentResponseContent);
        feedContent.appendChild(row);
        scrollToBottom();
        return row;
    }

    function addDocumentActions(doc, fullText) {
        const actionsRow = document.createElement('div');
        actionsRow.className = 'msg-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-icon-btn';
        copyBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(fullText);
            copyBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#30d158" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            setTimeout(() => { copyBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`; }, 2000);
        });

        actionsRow.appendChild(copyBtn);
        doc.appendChild(actionsRow);
    }

    function hideEmptyState() {
        if (emptyState) emptyState.style.display = 'none';
    }

    function scrollToBottom() {
        const container = document.getElementById('canvas-feed');
        container.scrollTop = container.scrollHeight;
    }

    // Input Handling
    promptInput.addEventListener('input', () => {
        promptInput.style.height = 'auto';
        promptInput.style.height = `${Math.min(promptInput.scrollHeight, 150)}px`;
        const hasText = promptInput.value.trim().length > 0;
        sendBtn.disabled = !hasText && !attachedFilePath;
        sendBtn.style.color = hasText || attachedFilePath ? 'var(--text-primary)' : '#444746';
    });

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendPrompt();
        }
    });

    sendBtn.addEventListener('click', () => sendPrompt());

    function sendPrompt(textOverride) {
        const text = textOverride || promptInput.value.trim();
        if (!text && !attachedFilePath) return;

        hideEmptyState();
        controlsDrawer.classList.remove('open'); // Auto close drawer

        createUserBubble(text, attachedFileUrl);

        promptInput.value = '';
        promptInput.style.height = 'auto';
        sendBtn.disabled = true;
        sendBtn.style.color = '#444746';
        stopBtnWrap.style.display = 'flex';
        isGenerating = true;

        // Show thinking indicator immediately
        if (!currentResponseDoc) {
            currentResponseDoc = createGeminiResponseBlock();
            currentResponseText = '';
            
            // Add streaming cursor early to show it's alive
            streamingCursor = document.createElement('span');
            streamingCursor.className = 'streaming-cursor';
            currentResponseContent.appendChild(streamingCursor);
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'prompt',
                prompt: text,
                conversationId: currentConversationId,
                mode: selectedMode,
                effort: selectedEffort,
                model: selectedModel,
                attachedFilePath: attachedFilePath
            }));
        }

        clearAttachment();
    }

    stopBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN && isGenerating) {
            ws.send(JSON.stringify({ type: 'kill' }));
        }
    });

    // File Upload
    attachBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
        if (!fileInput.files || fileInput.files.length === 0) return;
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            
            if (data.path) {
                attachedFilePath = data.path;
                attachedFileUrl = data.url;
                
                let isImg = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(data.originalName);
                attachedThumbContainer.innerHTML = isImg ? `<img src="${data.url}">` : '📄';
                document.getElementById('attached-filename').textContent = data.originalName;
                attachedPreview.style.display = 'flex';
                
                sendBtn.disabled = false;
                sendBtn.style.color = 'var(--text-primary)';
            }
        } catch (err) {}
    });

    removeAttachedBtn.addEventListener('click', clearAttachment);

    function clearAttachment() {
        attachedFilePath = null;
        attachedFileUrl = null;
        attachedPreview.style.display = 'none';
        fileInput.value = '';
        sendBtn.disabled = promptInput.value.trim().length === 0;
        sendBtn.style.color = sendBtn.disabled ? '#444746' : 'var(--text-primary)';
    }

    // Chips Logic
    document.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', () => sendPrompt(btn.getAttribute('data-prompt')));
    });

    const setupChips = (chips, callback) => {
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                chips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                callback(chip);
            });
        });
    };

    setupChips(modeChips, (chip) => selectedMode = chip.getAttribute('data-mode'));
    setupChips(effortChips, (chip) => selectedEffort = chip.getAttribute('data-effort'));
    setupChips(modelChips, (chip) => selectedModel = chip.getAttribute('data-model'));

    // New Chat
    newChatBtn.addEventListener('click', () => {
        currentConversationId = null;
        feedContent.innerHTML = '';
        feedContent.appendChild(emptyState);
        emptyState.style.display = 'flex';
    });

    // API: Load Session List
    async function loadSessionsList() {
        try {
            sessionList.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-secondary);">Loading...</div>';
            const res = await fetch('/api/sessions');
            allSessions = await res.json();
            renderSessionItems(allSessions);
        } catch (err) {
            sessionList.innerHTML = `<div style="color:var(--gemini-red); padding:16px;">Failed to load history</div>`;
        }
    }

    function renderSessionItems(sessions) {
        if (sessions.length === 0) {
            sessionList.innerHTML = '<div style="padding:16px; text-align:center; color:var(--text-secondary);">No history found.</div>';
            return;
        }

        sessionList.innerHTML = '';
        sessions.forEach(sess => {
            const item = document.createElement('div');
            item.className = 'session-item';
            const dateStr = new Date(sess.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            
            item.innerHTML = `
                <div>
                    <div class="session-item-title">${escapeHtml(sess.title)}</div>
                    <div class="session-item-meta">${sess.messageCount} msgs • ${dateStr}</div>
                </div>
                <button class="session-del-btn">✕</button>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('session-del-btn')) return;
                loadSessionMessages(sess.id);
                closeDrawer();
            });

            const delBtn = item.querySelector('.session-del-btn');
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('Delete this chat?')) {
                    await fetch(`/api/sessions/${sess.id}`, { method: 'DELETE' });
                    loadSessionsList();
                }
            });

            sessionList.appendChild(item);
        });
    }

    async function loadSessionMessages(sessionId) {
        try {
            currentConversationId = sessionId;
            feedContent.innerHTML = '';
            hideEmptyState();

            const res = await fetch(`/api/sessions/${sessionId}`);
            const data = await res.json();

            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    if (msg.role === 'user') {
                        createUserBubble(msg.content);
                    } else if (msg.role === 'assistant') {
                        const doc = createGeminiResponseBlock();
                        currentResponseContent.innerHTML = window.marked ? marked.parse(msg.content) : msg.content;
                        addDocumentActions(doc, msg.content);
                    }
                });
            }
            scrollToBottom();
        } catch (err) {
            console.error(err);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;'> '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
    }
});
