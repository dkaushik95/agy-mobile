const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const crypto = require('crypto');
const multer = require('multer');

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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend/dist')));

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

// REST API: File Upload Endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, path: req.file.path, originalName: req.file.originalname });
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
        if (!fs.existsSync(BRAIN_DIR)) return res.json([]);
        const dirs = fs.readdirSync(BRAIN_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        const sessions = [];

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
                        title: firstPrompt.length > 50 ? firstPrompt.substring(0, 47) + '...' : firstPrompt,
                        messageCount,
                        updatedAt: lastTimestamp
                    });
                } catch (err) {}
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
    const transcriptPath = path.join(BRAIN_DIR, sessionId, '.system_generated', 'logs', 'transcript.jsonl');

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
                    } else if (entry.tool_calls && entry.tool_calls.length > 0) {
                        // Just track time implicitly via currentStartTime
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
    const targetDir = path.join(BRAIN_DIR, sessionId);
    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// WebSocket Handler
wss.on('connection', (ws) => {
    let currentProcess = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'prompt') {
                let userPrompt = data.prompt || 'Inspect attached file';
                let conversationId = data.conversationId;
                
                // CRITICAL FIX: If no conversation ID, generate one so we retain context!
                if (!conversationId) {
                    conversationId = crypto.randomUUID();
                    ws.send(JSON.stringify({ type: 'session_id', id: conversationId }));
                }

                const mode = data.mode || 'default';
                const effort = data.effort || 'medium';
                const model = data.model || 'flash';
                const attachedFilePath = data.attachedFilePath;

                if (attachedFilePath) {
                    userPrompt = `Please inspect the attached file at absolute path '${attachedFilePath}'. User prompt: ${userPrompt}`;
                }

                console.log(`\n[ws] Received prompt: "${userPrompt.substring(0,50)}..."`);
                let args = ['--print', userPrompt, '--dangerously-skip-permissions', '--output-format', 'stream-json'];

                if (conversationId) {
                    args.push('--conversation', conversationId);
                }
                if (mode && mode !== 'default') {
                    args.push('--mode', mode);
                }
                
                let exactModel = '';
                if (model === 'pro') {
                    exactModel = effort === 'low' ? 'gemini-3.1-pro-low' : 'gemini-3.1-pro-high';
                } else {
                    exactModel = `gemini-3.6-flash-${effort || 'medium'}`;
                }
                args.push('--model', exactModel);

                console.log(`[ws] Spawning agy with args: ${args.join(' ')}`);

                ws.send(JSON.stringify({ type: 'state_change', state: 'thinking', message: 'Agent processing...' }));

                const systemPath = `${process.env.HOME}/.local/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`;

                currentProcess = spawn(AGY_PATH, args, {
                    env: { ...process.env, PATH: systemPath, TERM: 'dumb', PAGER: 'cat', HOME: process.env.HOME },
                    cwd: process.env.HOME
                });

                let stdoutBuffer = '';

                currentProcess.stdout.on('data', (chunk) => {
                    stdoutBuffer += chunk.toString();
                    let lines = stdoutBuffer.split('\n');
                    stdoutBuffer = lines.pop(); // Keep the last incomplete line

                    for (const line of lines) {
                        const cleanLine = line.trim();
                        if (!cleanLine) continue;
                        try {
                            const obj = JSON.parse(cleanLine);
                            
                            if (obj.event === 'step_update' && obj.step_update) {
                                const step = obj.step_update;
                                
                                if (step.step_type === 'tool') {
                                    if (step.state === 'ACTIVE') {
                                        ws.send(JSON.stringify({ type: 'tool_update', content: `Running tool: ${step.tool_name}` }));
                                    } else if (step.state === 'DONE') {
                                        ws.send(JSON.stringify({ type: 'tool_update', content: `Finished: ${step.tool_name}` }));
                                    } else if (step.state === 'ERROR') {
                                        ws.send(JSON.stringify({ type: 'tool_update', content: `Failed: ${step.tool_name}` }));
                                    }
                                } else if (step.step_type === 'subagent') {
                                    ws.send(JSON.stringify({ type: 'tool_update', content: `Subagent active...` }));
                                } else if (step.step_type === 'agent_response') {
                                    if (step.text_delta) {
                                        ws.send(JSON.stringify({ type: 'chunk', content: step.text_delta }));
                                    } else if (step.thinking_delta) {
                                        ws.send(JSON.stringify({ type: 'tool_update', content: `Thinking...` }));
                                    }
                                }
                            } else if (obj.event === 'result') {
                                if (obj.result.status === 'ERROR') {
                                    ws.send(JSON.stringify({ type: 'chunk', content: `\n\n**System Error:** ${obj.result.error}` }));
                                }
                                ws.send(JSON.stringify({ type: 'done', code: 0 }));
                            }
                        } catch (e) {
                            // If it fails to parse, it might be raw text output (e.g. panic)
                            console.error("[ws] Raw stdout:", cleanLine);
                            ws.send(JSON.stringify({ type: 'tool_update', content: `Raw: ${cleanLine.substring(0, 50)}` }));
                        }
                    }
                });

                currentProcess.stderr.on('data', (chunk) => {
                    const cleanStr = stripAnsi(chunk.toString()).trim();
                    if (cleanStr) {
                        console.error(`[ws] STDERR: ${cleanStr}`);
                        ws.send(JSON.stringify({ type: 'tool_update', content: `Error: ${cleanStr.substring(0, 50)}` }));
                    }
                });

                currentProcess.on('close', (code) => {
                    currentProcess = null;
                    ws.send(JSON.stringify({ type: 'done', code }));
                });

                currentProcess.on('error', (err) => {
                    currentProcess = null;
                    ws.send(JSON.stringify({ type: 'error', error: err.message }));
                });
            } else if (data.type === 'input' && currentProcess) {
                currentProcess.stdin.write(data.input + '\n');
            } else if (data.type === 'kill') {
                if (currentProcess) {
                    currentProcess.kill('SIGKILL');
                    currentProcess = null;
                }
                ws.send(JSON.stringify({ type: 'killed' }));
            }
        } catch (err) {
            ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
    });

    ws.on('close', () => {
        if (currentProcess) currentProcess.kill('SIGINT');
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ Native App AGY Mobile running at http://0.0.0.0:${PORT}\n`);
});
