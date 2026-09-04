const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const crypto = require('crypto');
const multer = require('multer');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3900;
const BRAIN_DIR = path.join(process.env.HOME, '.gemini/antigravity-cli/brain');
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');

// Locate agy executable dynamically or fallback to standard paths
let AGY_PATH = 'agy';
try {
    const whichAgy = execSync('which agy 2>/dev/null || echo ""', { env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` } }).toString().trim();
    if (whichAgy && fs.existsSync(whichAgy)) {
        AGY_PATH = whichAgy;
    } else if (fs.existsSync(`${process.env.HOME}/.local/bin/agy`)) {
        AGY_PATH = `${process.env.HOME}/.local/bin/agy`;
    }
} catch (e) {
    if (fs.existsSync(`${process.env.HOME}/.local/bin/agy`)) {
        AGY_PATH = `${process.env.HOME}/.local/bin/agy`;
    }
}
console.log(`📌 Using AGY executable binary path: ${AGY_PATH}`);

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, 'upload-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage });

// Web Push Configuration
let vapidKeys = { publicKey: '', privateKey: '' };
const VAPID_FILE = path.join(__dirname, 'vapid_keys.json');
try {
    if (fs.existsSync(VAPID_FILE)) {
        vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
        if (vapidKeys.publicKey && vapidKeys.privateKey) {
            webpush.setVapidDetails('mailto:test@test.com', vapidKeys.publicKey, vapidKeys.privateKey);
        }
    }
} catch (err) {
    console.error('Error initializing VAPID keys:', err);
}

let pushSubscriptions = [];
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');
if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
    try {
        pushSubscriptions = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
    } catch(e) {}
}

function saveSubscriptions() {
    try {
        fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(pushSubscriptions, null, 2));
    } catch (e) {
        console.error('Failed to save subscriptions:', e);
    }
}

function sendPushNotification(payload) {
    if (!vapidKeys.publicKey || !vapidKeys.privateKey) return;
    const promises = pushSubscriptions.map((sub) => 
        webpush.sendNotification(sub, JSON.stringify(payload)).catch(err => {
            if (err.statusCode === 410 || err.statusCode === 404) {
                // Subscription has expired or is no longer valid
                pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
                saveSubscriptions();
            }
        })
    );
    Promise.all(promises).catch(() => {});
}

const OPENCODE_DB_PATH = path.join(process.env.HOME, '.local/share/opencode/opencode.db');

// UUID validation helper for path security
function isValidUUID(id) {
    return typeof id === 'string' && (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) || /^ses_[a-zA-Z0-9]+$/.test(id));
}

// ANSI Escape Code Stripper
function stripAnsi(str) {
    if (!str) return '';
    return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

// Clean user prompt text
function cleanUserPrompt(content) {
    if (!content) return '';
    const match = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return content.replace(/<[^>]+>/g, '').trim();
}

// Middleware
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOAD_DIR));

// Serve Frontend Vite Dist with cache-busting headers for HTML/SW
app.use(express.static(path.join(__dirname, 'frontend/dist'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else if (filePath.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// REST API: File Upload Endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, path: req.file.path, originalName: req.file.originalname });
});

// REST API: Web Push Subscription
app.get('/api/vapidPublicKey', (req, res) => {
    res.send(vapidKeys.publicKey || '');
});

app.post('/api/subscribe', (req, res) => {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Invalid subscription payload' });
    }
    const exists = pushSubscriptions.some(sub => sub.endpoint === subscription.endpoint);
    if (!exists) {
        pushSubscriptions.push(subscription);
        saveSubscriptions();
    }
    res.status(201).json({ success: true });
});

// Model list cache
let cachedModels = null;
let lastModelFetchTime = 0;
const MODEL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getAvailableModels() {
    const now = Date.now();
    if (cachedModels && (now - lastModelFetchTime < MODEL_CACHE_TTL)) {
        return cachedModels;
    }

    const fallbackModels = [
        {
            id: 'gemini-3.8-flash',
            name: 'Gemini 3.8 Flash',
            shortName: '3.8 Flash',
            category: 'gemini',
            tag: 'Latest',
            description: 'Next-gen multimodal speed & reasoning',
            supportedEfforts: ['low', 'medium', 'high'],
            defaultEffort: 'high'
        },
        {
            id: 'gemini-3.7-flash',
            name: 'Gemini 3.7 Flash',
            shortName: '3.7 Flash',
            category: 'gemini',
            tag: 'Default',
            description: 'Fast multimodal speed & reasoning',
            supportedEfforts: ['low', 'medium', 'high'],
            defaultEffort: 'high',
            default: true
        },
        {
            id: 'gemini-3.6-flash',
            name: 'Gemini 3.6 Flash',
            shortName: '3.6 Flash',
            category: 'gemini',
            tag: 'Fast',
            description: 'High efficiency daily intelligence',
            supportedEfforts: ['low', 'medium', 'high'],
            defaultEffort: 'high'
        },
        {
            id: 'gemini-3.5-flash',
            name: 'Gemini 3.5 Flash',
            shortName: '3.5 Flash',
            category: 'gemini',
            tag: 'Lite',
            description: 'Lightweight & instant responsiveness',
            supportedEfforts: ['low', 'medium', 'high'],
            defaultEffort: 'high'
        },
        {
            id: 'gemini-3.1-pro',
            name: 'Gemini 3.1 Pro',
            shortName: '3.1 Pro',
            category: 'gemini',
            tag: 'Pro',
            description: 'Deep reasoning & complex coding',
            supportedEfforts: ['low', 'high'],
            defaultEffort: 'high'
        },
        {
            id: 'claude-sonnet-4-6',
            name: 'Claude Sonnet 4.6',
            shortName: 'Claude Sonnet',
            category: 'claude',
            tag: 'Thinking',
            description: 'Advanced synthesis & reasoning',
            supportedEfforts: ['thinking'],
            defaultEffort: 'thinking'
        },
        {
            id: 'claude-opus-4-6-thinking',
            name: 'Claude Opus 4.6',
            shortName: 'Claude Opus',
            category: 'claude',
            tag: 'Frontier',
            description: 'Maximum capability frontier reasoning',
            supportedEfforts: ['thinking'],
            defaultEffort: 'thinking'
        },
        {
            id: 'gpt-oss-120b-medium',
            name: 'GPT-OSS 120B',
            shortName: 'GPT-OSS',
            category: 'open',
            tag: 'Open-Weights',
            description: 'Open-weights reasoning model',
            supportedEfforts: ['medium'],
            defaultEffort: 'medium'
        }
    ];

    try {
        const stdout = execSync(`which opencode 2>/dev/null || which agy 2>/dev/null`, { encoding: 'utf8' }).trim();
        const binPath = stdout || OPENCODE_PATH;
        const modelsOutput = execSync(`${binPath} models 2>/dev/null || echo ""`, {
            encoding: 'utf8',
            timeout: 6000,
            env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}` }
        });
        
        const rawLines = modelsOutput.split('\n').map(l => l.trim()).filter(Boolean);
        const list = [];

        for (const line of rawLines) {
            let provider = 'Google';
            let displayName = line;

            if (line.includes('/')) {
                const parts = line.split('/');
                const p = parts[0];
                const modelName = parts.slice(1).join('/');

                if (p === 'opencode') {
                    provider = 'OpenCode Zen';
                    displayName = modelName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                } else if (p === 'google') {
                    provider = 'Google';
                    displayName = modelName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    if (modelName.includes('antigravity')) {
                        displayName = `${displayName} (Antigravity)`;
                    }
                } else {
                    provider = p.charAt(0).toUpperCase() + p.slice(1);
                    displayName = modelName;
                }
            } else {
                displayName = line.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            }

            list.push({
                id: line,
                name: displayName,
                provider: provider,
                isFree: line.includes('free') || line.includes('pickle')
            });
        }
        
        if (list.length > 0) {
            cachedModels = list;
        } else {
            cachedModels = fallbackModels;
        }
        lastModelFetchTime = now;
        return cachedModels;
    } catch (e) {
        cachedModels = fallbackModels;
        lastModelFetchTime = now;
        return cachedModels;
    }
}

// REST API: Omarchy Theme Colors
app.get('/api/theme', (req, res) => {
    try {
        const themePath = path.join(process.env.HOME, '.local/state/omarchy/current/theme/colors.toml');
        if (fs.existsSync(themePath)) {
            const content = fs.readFileSync(themePath, 'utf8');
            const colors = {};
            for (const line of content.split('\n')) {
                const match = line.match(/^([a-z_]+)\s*=\s*"([^"]+)"/i);
                if (match) {
                    colors[match[1]] = match[2];
                }
            }
            return res.json({ name: 'Omarchy Current', colors });
        }
    } catch (e) {}
    res.json({ name: 'Default', colors: {} });
});

// REST API: Available Models
app.get('/api/models', (req, res) => {
    res.json(getAvailableModels());
});

// REST API: Telemetry
app.get('/api/telemetry', (req, res) => {
    exec("free -m | awk 'NR==2{printf \"%.1f%%\", $3*100/$2}' && echo '||' && uptime -p", (err, stdout) => {
        if (err) return res.json({ memory: 'N/A', uptime: 'N/A' });
        const parts = stdout.trim().split('||');
        res.json({
            memory: parts[0] ? parts[0].trim() : 'N/A',
            uptime: parts[1] ? parts[1].trim() : 'N/A'
        });
    });
});

// REST API: Get Sessions List
app.get('/api/sessions', (req, res) => {
    try {
        const sessions = [];

        // 1. Fetch sessions from opencode.db if available
        if (fs.existsSync(OPENCODE_DB_PATH)) {
            try {
                const dbCmd = `sqlite3 "${OPENCODE_DB_PATH}" "SELECT s.id, s.title, s.time_updated, (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) as msg_count FROM session s ORDER BY s.time_updated DESC LIMIT 100;"`;
                const stdout = execSync(dbCmd, { encoding: 'utf8' }).trim();
                if (stdout) {
                    const lines = stdout.split('\n');
                    for (const line of lines) {
                        const firstPipe = line.indexOf('|');
                        const secondPipe = line.indexOf('|', firstPipe + 1);
                        const thirdPipe = line.indexOf('|', secondPipe + 1);

                        if (firstPipe !== -1 && secondPipe !== -1) {
                            const id = line.substring(0, firstPipe);
                            const rawTitle = line.substring(firstPipe + 1, secondPipe);
                            let timeUpdated = line.substring(secondPipe + 1);
                            let msgCountStr = '0';
                            if (thirdPipe !== -1) {
                                timeUpdated = line.substring(secondPipe + 1, thirdPipe);
                                msgCountStr = line.substring(thirdPipe + 1);
                            }

                            let title = rawTitle || 'New Session';
                            
                            // Query first prompt text from part table
                            try {
                                const firstMsgCmd = `sqlite3 "${OPENCODE_DB_PATH}" "SELECT json_extract(data, '$.text') FROM part WHERE session_id = '${id}' AND json_extract(data, '$.type') = 'text' AND json_extract(data, '$.text') IS NOT NULL LIMIT 1;"`;
                                const firstMsgOut = execSync(firstMsgCmd, { encoding: 'utf8' }).trim();
                                if (firstMsgOut) {
                                    const cleanText = cleanUserPrompt(firstMsgOut);
                                    if (cleanText) {
                                        title = cleanText.split('\n')[0];
                                    }
                                }
                            } catch (e) {
                                console.error('Error fetching first prompt:', e);
                            }
                            
                            sessions.push({
                                id,
                                title: title.length > 60 ? title.substring(0, 57) + '...' : title,
                                messageCount: parseInt(msgCountStr, 10) || 0,
                                updatedAt: new Date(parseInt(timeUpdated, 10))
                            });
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to read sessions from opencode.db:', err);
            }
        }

        // 2. Fallback or merge with legacy BRAIN_DIR if needed
        if (fs.existsSync(BRAIN_DIR)) {
            const existingIds = new Set(sessions.map(s => s.id));
            const dirs = fs.readdirSync(BRAIN_DIR, { withFileTypes: true })
                .filter(d => d.isDirectory() && isValidUUID(d.name) && !existingIds.has(d.name))
                .map(d => d.name);

            for (const dirName of dirs) {
                const transcriptPath = path.join(BRAIN_DIR, dirName, '.system_generated', 'logs', 'transcript.jsonl');
                if (fs.existsSync(transcriptPath)) {
                    try {
                        const stats = fs.statSync(transcriptPath);
                        const fileContent = fs.readFileSync(transcriptPath, 'utf8');
                        const lines = fileContent.trim().split('\n').filter(Boolean);
                        
                        let firstPrompt = 'New Conversation';
                        let messageCount = 0;
                        let lastTimestamp = stats.mtime;

                        for (const line of lines) {
                            try {
                                const entry = JSON.parse(line);
                                if (entry.type === 'USER_INPUT' && entry.content) {
                                    messageCount++;
                                    if (firstPrompt === 'New Conversation') {
                                        firstPrompt = cleanUserPrompt(entry.content);
                                    }
                                }
                                if (entry.created_at) lastTimestamp = new Date(entry.created_at);
                            } catch (e) {}
                        }

                        sessions.push({
                            id: dirName,
                            title: firstPrompt.length > 60 ? firstPrompt.substring(0, 57) + '...' : firstPrompt,
                            messageCount,
                            updatedAt: lastTimestamp
                        });
                    } catch (err) {}
                }
            }
        }

        sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        res.json(sessions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// REST API: Get Session Detail
app.get('/api/sessions/:id', (req, res) => {
    const sessionId = req.params.id;
    if (!isValidUUID(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID format' });
    }

    // 1. Try reading from opencode.db first if session ID starts with ses_ or exists in db
    if (fs.existsSync(OPENCODE_DB_PATH)) {
        try {
            const checkCmd = `sqlite3 "${OPENCODE_DB_PATH}" "SELECT id FROM session WHERE id = '${sessionId}' LIMIT 1;"`;
            const exists = execSync(checkCmd, { encoding: 'utf8' }).trim();

            if (exists) {
                const partsCmd = `sqlite3 "${OPENCODE_DB_PATH}" "SELECT m.id as msg_id, m.data as msg_data, p.data as part_data FROM message m JOIN part p ON m.id = p.message_id WHERE m.session_id = '${sessionId}' ORDER BY m.time_created ASC, p.time_created ASC;"`;
                const stdout = execSync(partsCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();

                const messagesMap = new Map();

                if (stdout) {
                    const rows = stdout.split('\n');
                    for (const row of rows) {
                        const firstPipe = row.indexOf('|');
                        const secondPipe = row.indexOf('|', firstPipe + 1);
                        if (firstPipe === -1 || secondPipe === -1) continue;

                        const msgId = row.substring(0, firstPipe);
                        const msgDataRaw = row.substring(firstPipe + 1, secondPipe);
                        const partDataRaw = row.substring(secondPipe + 1);

                        try {
                            const msgData = JSON.parse(msgDataRaw);
                            const partData = JSON.parse(partDataRaw);

                            if (!messagesMap.has(msgId)) {
                                messagesMap.set(msgId, {
                                    id: msgId,
                                    role: msgData.role,
                                    content: '',
                                    toolCalls: [],
                                    timestamp: msgData.time ? msgData.time.created : Date.now()
                                });
                            }

                            const currentMsg = messagesMap.get(msgId);

                            if (partData.type === 'text' && partData.text) {
                                currentMsg.content = (currentMsg.content ? currentMsg.content + '\n' : '') + partData.text;
                            } else if (partData.type === 'tool') {
                                const toolCallObj = {
                                    toolName: partData.tool || 'tool',
                                    title: partData.title || partData.tool,
                                    input: partData.state ? partData.state.input : {},
                                    output: partData.state ? partData.state.output : '',
                                    status: partData.state ? partData.state.status : 'completed',
                                    content: `$ ${partData.tool || 'tool'} ${partData.state && partData.state.input && partData.state.input.command ? partData.state.input.command : ''}`.trim()
                                };
                                currentMsg.toolCalls.push(toolCallObj);
                            }
                        } catch (e) {}
                    }
                }

                const messagesList = Array.from(messagesMap.values());
                return res.json({ id: sessionId, messages: messagesList });
            }
        } catch (err) {
            console.error('Failed to load session details from opencode.db:', err);
        }
    }

    // 2. Fallback to legacy BRAIN_DIR
    const sessionDir = path.resolve(BRAIN_DIR, sessionId);
    if (!sessionDir.startsWith(BRAIN_DIR)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const transcriptPath = path.join(sessionDir, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const fileContent = fs.readFileSync(transcriptPath, 'utf8');
        const lines = fileContent.trim().split('\n').filter(Boolean);
        const messages = [];
        let currentStartTime = null;

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'USER_INPUT' && entry.content) {
                    const text = cleanUserPrompt(entry.content);
                    if (text) {
                        messages.push({
                            role: 'user',
                            content: text,
                            timestamp: entry.created_at
                        });
                        currentStartTime = new Date(entry.created_at);
                    }
                } else if (entry.type === 'PLANNER_RESPONSE' || entry.type === 'MODEL') {
                    if (entry.content) {
                        let toolStr = null;
                        if (currentStartTime) {
                            const secs = ((new Date(entry.created_at) - currentStartTime) / 1000).toFixed(1);
                            toolStr = `Worked for ${secs}s`;
                        }
                        messages.push({
                            role: 'assistant',
                            content: entry.content,
                            timestamp: entry.created_at,
                            tool: toolStr
                        });
                        currentStartTime = null; // reset
                    }
                }
            } catch (e) {}
        }

        res.json({ id: sessionId, messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// REST API: Delete Session
app.delete('/api/sessions/:id', (req, res) => {
    const sessionId = req.params.id;
    if (!isValidUUID(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID format' });
    }

    // Try deleting from opencode.db if exists
    if (fs.existsSync(OPENCODE_DB_PATH)) {
        try {
            const delCmd = `sqlite3 "${OPENCODE_DB_PATH}" "DELETE FROM session WHERE id = '${sessionId}';"`;
            execSync(delCmd, { encoding: 'utf8' });
        } catch (e) {}
    }

    const targetDir = path.resolve(BRAIN_DIR, sessionId);
    if (!targetDir.startsWith(BRAIN_DIR)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    if (fs.existsSync(targetDir)) {
        // Also kill running process if any for this session
        if (activeSessions.has(sessionId)) {
            const active = activeSessions.get(sessionId);
            if (active.process) {
                try { active.process.kill('SIGKILL'); } catch (e) {}
            }
            activeSessions.delete(sessionId);
        }
        fs.rmSync(targetDir, { recursive: true, force: true });
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// Catch-all SPA route
app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    const indexPath = path.join(__dirname, 'frontend/dist/index.html');
    if (fs.existsSync(indexPath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Frontend not built. Please run "npm run build" in the frontend directory.');
    }
});

// Active background agent sessions: Map<conversationId, { process, clients, events, currentTool, state, startedAt } >
const activeSessions = new Map();

function broadcastToSession(conversationId, data) {
    const session = activeSessions.get(conversationId);
    if (!session) return;
    const jsonStr = JSON.stringify(data);
    for (const ws of session.clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(jsonStr);
        }
    }
}

// WebSocket Server
wss.on('connection', (ws) => {
    let boundConversationId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'attach') {
                const conversationId = data.conversationId;
                if (conversationId && isValidUUID(conversationId)) {
                    boundConversationId = conversationId;
                    ws.conversationId = conversationId;
                    if (activeSessions.has(conversationId)) {
                        const session = activeSessions.get(conversationId);
                        session.clients.add(ws);
                        // Replay active state
                        ws.send(JSON.stringify({ 
                            type: 'state_change', 
                            state: session.state || 'thinking', 
                            message: session.currentTool || 'Agent working in background...' 
                        }));
                        for (const event of session.events) {
                            ws.send(JSON.stringify(event));
                        }
                    }
                }
            } else if (data.type === 'prompt') {
                let userPrompt = data.prompt || 'Inspect attached file';
                let conversationId = data.conversationId;
                
                if (!conversationId || !isValidUUID(conversationId)) {
                    conversationId = crypto.randomUUID();
                }

                boundConversationId = conversationId;
                ws.conversationId = conversationId;

                // Send session_id confirmation
                ws.send(JSON.stringify({ type: 'session_id', id: conversationId }));

                const mode = data.mode || 'default';
                const effort = data.effort || 'high';
                const model = data.model || 'flash';
                const attachedFilePath = data.attachedFilePath;
                const customCwd = (data.cwd && fs.existsSync(data.cwd)) ? data.cwd : process.env.HOME;

                if (attachedFilePath) {
                    userPrompt = `Please inspect the attached file at absolute path '${attachedFilePath}'. User prompt: ${userPrompt}`;
                }

                console.log(`\n[ws] [${conversationId}] Received prompt: "${userPrompt.substring(0, 60)}..."`);

                // If previous process for this conversation exists, kill it before starting new prompt
                if (activeSessions.has(conversationId)) {
                    const prev = activeSessions.get(conversationId);
                    if (prev.process) {
                        try { prev.process.kill('SIGTERM'); } catch (e) {}
                    }
                    activeSessions.delete(conversationId);
                }

                const convDir = conversationId ? path.join(BRAIN_DIR, conversationId) : null;
                const isExistingConv = convDir && fs.existsSync(convDir);

                let args = [
                    '--dangerously-skip-permissions',
                    '--output-format', 'stream-json'
                ];

                if (conversationId && isExistingConv) {
                    args.push('--conversation', conversationId);
                }
                if (mode && mode !== 'default') {
                    args.push('--mode', mode);
                }

                // Resolve model and effort flags
                let exactModel = '';
                const selectedEffort = (effort || 'high').toLowerCase();

                if (model === 'gemini-3.8-flash') {
                    const eff = ['low', 'medium', 'high'].includes(selectedEffort) ? selectedEffort : 'high';
                    exactModel = `gemini-3.8-flash-${eff}`;
                } else if (model === 'flash' || model === 'gemini-3.7-flash') {
                    const eff = ['low', 'medium', 'high'].includes(selectedEffort) ? selectedEffort : 'high';
                    exactModel = `gemini-3.7-flash-${eff}`;
                } else if (model === 'gemini-3.6-flash') {
                    const eff = ['low', 'medium', 'high'].includes(selectedEffort) ? selectedEffort : 'high';
                    exactModel = `gemini-3.6-flash-${eff}`;
                } else if (model === 'gemini-3.5-flash') {
                    const eff = ['low', 'medium', 'high'].includes(selectedEffort) ? selectedEffort : 'high';
                    exactModel = `gemini-3.5-flash-${eff}`;
                } else if (model === 'pro' || model === 'gemini-3.1-pro') {
                    exactModel = selectedEffort === 'low' ? 'gemini-3.1-pro-low' : 'gemini-3.1-pro-high';
                } else if (model === 'claude' || model === 'claude-sonnet-4-6') {
                    exactModel = 'claude-sonnet-4-6';
                } else if (model === 'claude-opus-4-6-thinking') {
                    exactModel = 'claude-opus-4-6-thinking';
                } else if (model === 'gpt-oss-120b-medium') {
                    exactModel = 'gpt-oss-120b-medium';
                } else if (model.includes('-high') || model.includes('-medium') || model.includes('-low') || model.includes('-thinking')) {
                    // Full model ID already provided
                    exactModel = model;
                } else if (model.startsWith('gemini') || model.startsWith('claude') || model.startsWith('gpt')) {
                    exactModel = model;
                } else {
                    exactModel = `gemini-3.7-flash-${['low', 'medium', 'high'].includes(selectedEffort) ? selectedEffort : 'high'}`;
                }

                args.push('--model', exactModel);
                if (['low', 'medium', 'high'].includes(selectedEffort) && !exactModel.includes('-high') && !exactModel.includes('-medium') && !exactModel.includes('-low')) {
                    args.push('--effort', selectedEffort);
                }

                args.push('--print', userPrompt);

                console.log(`[ws] Spawning: ${AGY_PATH} in ${customCwd} with args: ${args.join(' ')}`);

                const systemPath = `${process.env.HOME}/.local/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`;

                const childProcess = spawn(AGY_PATH, args, {
                    env: { ...process.env, PATH: systemPath, TERM: 'dumb', PAGER: 'cat', HOME: process.env.HOME },
                    cwd: customCwd
                });

                const session = {
                    process: childProcess,
                    clients: new Set([ws]),
                    events: [],
                    currentTool: null,
                    state: 'thinking',
                    startedAt: Date.now()
                };
                activeSessions.set(conversationId, session);

                broadcastToSession(conversationId, { type: 'state_change', state: 'thinking', message: 'Agent processing...' });

                let hasEmittedChunk = false;
                let stdoutBuffer = '';

                childProcess.on('error', (err) => {
                    console.error(`[ws] Failed to start agy process:`, err);
                    broadcastToSession(conversationId, { type: 'error', error: `Failed to spawn agent: ${err.message}` });
                    activeSessions.delete(conversationId);
                });

                childProcess.stdout.on('data', (chunk) => {
                    try {
                        stdoutBuffer += chunk.toString();
                        let lines = stdoutBuffer.split('\n');
                        stdoutBuffer = lines.pop() || ''; // Keep incomplete line

                        for (const line of lines) {
                            const cleanLine = line.trim();
                            if (!cleanLine) continue;
                            try {
                                const obj = JSON.parse(cleanLine);

                                if (obj.event === 'init' && obj.conversation_id) {
                                    if (obj.conversation_id !== conversationId) {
                                        activeSessions.delete(conversationId);
                                        conversationId = obj.conversation_id;
                                        boundConversationId = conversationId;
                                        ws.conversationId = conversationId;
                                        activeSessions.set(conversationId, session);
                                        broadcastToSession(conversationId, { type: 'session_id', id: conversationId });
                                    }
                                } else if (obj.event === 'step_update' && obj.step_update) {
                                    const step = obj.step_update;
                                    
                                    if (step.step_type === 'tool') {
                                        let title = step.title || step.tool_name || 'action';
                                        let inputSummary = '';
                                        if (step.input) {
                                            if (typeof step.input === 'string') inputSummary = step.input;
                                            else if (step.input.command) inputSummary = step.input.command;
                                            else if (step.input.filePath || step.input.path) inputSummary = step.input.filePath || step.input.path;
                                            else if (step.input.pattern) inputSummary = step.input.pattern;
                                        }

                                        let msg = `$ ${step.tool_name || 'tool'} ${inputSummary}`.trim();
                                        if (step.state === 'DONE') msg = `✓ Completed: ${title}`;
                                        else if (step.state === 'ERROR') msg = `✗ Failed: ${title}`;
                                        
                                        session.currentTool = msg;
                                        const updateEvt = { type: 'tool_call', toolName: step.tool_name, title: title, input: step.input, state: step.state || 'running', content: msg };
                                        session.events.push(updateEvt);
                                        broadcastToSession(conversationId, updateEvt);
                                    } else if (step.step_type === 'subagent') {
                                        session.currentTool = 'Subagent active...';
                                        const updateEvt = { type: 'tool_update', content: 'Subagent active...' };
                                        session.events.push(updateEvt);
                                        broadcastToSession(conversationId, updateEvt);
                                    } else if (step.step_type === 'agent_response') {
                                        if (step.text_delta) {
                                            hasEmittedChunk = true;
                                            const chunkEvt = { type: 'chunk', content: step.text_delta };
                                            session.events.push(chunkEvt);
                                            broadcastToSession(conversationId, chunkEvt);
                                        }
                                    }
                                } else if (obj.type === 'tool_use' && obj.part) {
                                    const part = obj.part;
                                    const toolName = part.tool || 'tool';
                                    const state = part.state || {};
                                    const title = state.title || toolName;
                                    const input = state.input || {};
                                    const output = state.output || '';
                                    
                                    let msg = `$ ${toolName}`;
                                    if (input.command) msg = `$ ${input.command}`;
                                    else if (input.filePath || input.path) msg = `Read ${input.filePath || input.path}`;

                                    const toolEvt = {
                                        type: 'tool_call',
                                        toolName,
                                        title,
                                        input,
                                        output,
                                        status: state.status || 'completed',
                                        content: msg
                                    };
                                    session.events.push(toolEvt);
                                    broadcastToSession(conversationId, toolEvt);
                                } else if (obj.event === 'result') {
                                    if (obj.result && obj.result.status === 'ERROR') {
                                        const errEvt = { type: 'chunk', content: `\n\n**System Error:** ${obj.result.error || 'Execution failed'}` };
                                        session.events.push(errEvt);
                                        broadcastToSession(conversationId, errEvt);
                                    } else if (!hasEmittedChunk && obj.result && obj.result.response) {
                                        const chunkEvt = { type: 'chunk', content: obj.result.response };
                                        session.events.push(chunkEvt);
                                        broadcastToSession(conversationId, chunkEvt);
                                    }
                                    broadcastToSession(conversationId, { type: 'done', code: 0 });
                                }
                            } catch (e) {
                                console.error("[ws] Raw stdout:", cleanLine);
                                if (cleanLine.length < 80) {
                                    broadcastToSession(conversationId, { type: 'tool_update', content: cleanLine });
                                }
                            }
                        }
                    } catch (streamErr) {
                        console.error("[ws] Error processing stdout stream:", streamErr);
                    }
                });

                childProcess.stderr.on('data', (chunk) => {
                    const cleanStr = stripAnsi(chunk.toString()).trim();
                    if (cleanStr) {
                        console.error(`[ws] STDERR: ${cleanStr}`);
                        if (!cleanStr.includes('ExperimentalWarning') && !cleanStr.includes('not found') && cleanStr.length < 100) {
                            broadcastToSession(conversationId, { type: 'tool_update', content: cleanStr });
                        }
                    }
                });

                childProcess.on('close', (code) => {
                    console.log(`[ws] Process for conversation ${conversationId} exited with code ${code}`);
                    if (!hasEmittedChunk && code !== 0) {
                        broadcastToSession(conversationId, { type: 'error', error: `Agent exited unexpectedly with code ${code}` });
                    } else {
                        broadcastToSession(conversationId, { type: 'done', code });
                    }
                    activeSessions.delete(conversationId);
                    
                    // Send push notification to mobile devices
                    sendPushNotification({
                        title: 'Antigravity Agent',
                        body: 'The agent has completed responding to your prompt.',
                        icon: '/favicon.svg',
                        data: { url: `/?id=${conversationId}` }
                    });
                });

                childProcess.on('error', (err) => {
                    console.error(`[ws] Process error for ${conversationId}:`, err);
                    broadcastToSession(conversationId, { type: 'error', error: err.message });
                    activeSessions.delete(conversationId);
                });

            } else if (data.type === 'input') {
                const targetId = data.conversationId || boundConversationId;
                if (targetId && activeSessions.has(targetId)) {
                    const session = activeSessions.get(targetId);
                    if (session.process && session.process.stdin) {
                        session.process.stdin.write(data.input + '\n');
                    }
                }
            } else if (data.type === 'kill') {
                const targetId = data.conversationId || boundConversationId;
                if (targetId && activeSessions.has(targetId)) {
                    const session = activeSessions.get(targetId);
                    if (session.process) {
                        session.process.kill('SIGKILL');
                    }
                    activeSessions.delete(targetId);
                    broadcastToSession(targetId, { type: 'killed' });
                } else {
                    ws.send(JSON.stringify({ type: 'killed' }));
                }
            }
        } catch (err) {
            console.error('[ws] Message handling error:', err);
            ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
    });

    ws.on('close', () => {
        // On socket disconnect, detach client from active session but DO NOT KILL the background process
        if (boundConversationId && activeSessions.has(boundConversationId)) {
            const session = activeSessions.get(boundConversationId);
            session.clients.delete(ws);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ AGY Mobile server running at http://0.0.0.0:${PORT}\n`);
});
