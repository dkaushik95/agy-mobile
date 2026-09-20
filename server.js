const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const multer = require('multer');
const webpush = require('web-push');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3900;
const BRAIN_DIR = path.join(process.env.HOME || '', '.gemini/antigravity-cli/brain');
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');
const OPENCODE_DB_PATH = path.join(process.env.HOME || '', '.local/share/opencode/opencode.db');

// Environment configurations
const AUTH_TOKEN = process.env.OPENCODE_MOBILE_TOKEN || '';
const DEV_NO_AUTH = process.env.DEV_NO_AUTH === '1';
const ALLOW_UNSAFE_AGENT = process.env.ALLOW_UNSAFE_AGENT === '1';
const VAPID_MAILTO = process.env.VAPID_MAILTO || 'mailto:admin@localhost';

// Allowed CWDS
const rawAllowedCwds = process.env.ALLOWED_CWDS || process.env.HOME || process.cwd();
const ALLOWED_CWDS = rawAllowedCwds
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => path.resolve(p));

function isCwdAllowed(targetPath) {
    if (!targetPath) return false;
    const resolved = path.resolve(targetPath);
    return ALLOWED_CWDS.some(allowedRoot => resolved === allowedRoot || resolved.startsWith(allowedRoot + path.sep));
}

// IP & CIDR allowlist checking (Tailscale, Local, and Private LAN subnets)
const rawAllowedNets = process.env.ALLOWED_NETS || '127.0.0.0/8, ::1, 100.64.0.0/10, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12';
const ALLOWED_NETS = rawAllowedNets.split(',').map(s => s.trim()).filter(Boolean);

function parseIp(ipStr) {
    if (!ipStr) return null;
    let ip = ipStr.trim();
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }
    if (ip.includes('.')) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
        const num = ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
        return { kind: 'ipv4', num: num >>> 0, str: ip };
    }
    if (ip === '::1') {
        return { kind: 'ipv6', str: '::1' };
    }
    return { kind: 'ipv6', str: ip };
}

function matchCidr(clientIpStr, cidrStr) {
    const parsedClient = parseIp(clientIpStr);
    if (!parsedClient) return false;

    const [netStr, maskStr] = cidrStr.split('/');
    if (netStr === '::1' && parsedClient.kind === 'ipv6' && parsedClient.str === '::1') {
        return true;
    }

    const parsedNet = parseIp(netStr);
    if (!parsedNet || parsedNet.kind !== parsedClient.kind) return false;

    if (parsedClient.kind === 'ipv4') {
        const maskBits = maskStr !== undefined ? parseInt(maskStr, 10) : 32;
        if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;
        const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
        return ((parsedClient.num & mask) >>> 0) === ((parsedNet.num & mask) >>> 0);
    }

    return parsedClient.str === parsedNet.str;
}

function isIpAllowed(clientIp) {
    if (!clientIp) return false;
    for (const cidr of ALLOWED_NETS) {
        if (matchCidr(clientIp, cidr)) {
            return true;
        }
    }
    return false;
}

function isLocalIp(clientIp) {
    const parsed = parseIp(clientIp);
    if (!parsed) return false;
    if (parsed.kind === 'ipv6' && parsed.str === '::1') return true;
    if (parsed.kind === 'ipv4') {
        return (parsed.num >>> 24) === 127;
    }
    return false;
}

// Sunshine-style Device Pairing State & Persistence
// Stored in the user XDG state dir (outside the repo) with owner-only perms.
// Device tokens are persisted only as salted hashes (never raw tokens), so a
// leaked file yields no usable credentials.
const STATE_DIR = path.join(require('os').homedir(), '.local/state/opencode-mobile');
const PAIRED_DEVICES_FILE = path.join(STATE_DIR, 'paired_devices.json');

function ensureStateDir() {
    try {
        fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
        fs.chmodSync(STATE_DIR, 0o700);
    } catch (e) {}
}

function hashDeviceToken(token, saltHex) {
    return crypto.pbkdf2Sync(token, Buffer.from(saltHex, 'hex'), 10000, 32, 'sha256').toString('hex');
}

function makeSalt() {
    return crypto.randomBytes(16).toString('hex');
}

let pairedSalt = '';
let pairedDevices = [];

function savePairedDevices() {
    try {
        fs.writeFileSync(PAIRED_DEVICES_FILE, JSON.stringify({ salt: pairedSalt, devices: pairedDevices }, null, 2), { mode: 0o600 });
        fs.chmodSync(PAIRED_DEVICES_FILE, 0o600);
    } catch (e) {
        console.error('Failed to save paired devices:', e);
    }
}

function loadPairedDevices() {
    ensureStateDir();
    const legacyFile = path.join(__dirname, 'paired_devices.json');

    // First run under the new scheme: relocate the legacy repo-root store into the state dir
    if (!fs.existsSync(PAIRED_DEVICES_FILE) && fs.existsSync(legacyFile)) {
        try {
            fs.renameSync(legacyFile, PAIRED_DEVICES_FILE);
        } catch (e) {
            console.error('Failed to migrate paired devices file:', e);
        }
    }

    if (!fs.existsSync(PAIRED_DEVICES_FILE)) {
        pairedSalt = makeSalt();
        return;
    }

    try {
        const raw = JSON.parse(fs.readFileSync(PAIRED_DEVICES_FILE, 'utf8'));
        if (Array.isArray(raw)) {
            pairedDevices = raw;
        } else {
            pairedSalt = raw.salt || '';
            pairedDevices = raw.devices || [];
        }

        let changed = false;
        if (!pairedSalt) {
            pairedSalt = makeSalt();
            changed = true;
        }

        // One-time migration: replace any stored raw tokens with salted hashes
        for (const dev of pairedDevices) {
            if (dev.token && !dev.tokenHash) {
                dev.tokenHash = hashDeviceToken(dev.token, pairedSalt);
                delete dev.token;
                changed = true;
            }
        }
        if (changed) savePairedDevices();
    } catch (e) {
        console.error('Failed to load paired devices:', e);
        pairedSalt = makeSalt();
    }
}

loadPairedDevices();

// In-memory active PIN challenges: Map<pin, { clientId, clientName, clientIp, expiresAt, token }>
const pendingPinChallenges = new Map();

function cleanExpiredPinChallenges() {
    const now = Date.now();
    for (const [pin, challenge] of pendingPinChallenges.entries()) {
        if (challenge.expiresAt < now) {
            pendingPinChallenges.delete(pin);
        }
    }
}
setInterval(cleanExpiredPinChallenges, 10000);

function isPairedToken(token) {
    if (!token || !pairedSalt) return false;

    let presented;
    try {
        presented = Buffer.from(hashDeviceToken(token, pairedSalt), 'hex');
    } catch (e) {
        return false;
    }

    for (const dev of pairedDevices) {
        if (!dev.tokenHash) continue;
        const stored = Buffer.from(dev.tokenHash, 'hex');
        if (stored.length === presented.length && crypto.timingSafeEqual(stored, presented)) {
            return true;
        }
    }
    return false;
}

function checkTokenAuth(req) {
    // Explicit environment flag to bypass auth in development
    if (DEV_NO_AUTH) {
        return true;
    }

    let token = '';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (AUTH_TOKEN && token === AUTH_TOKEN) {
        return true;
    }

    if (isPairedToken(token)) {
        return true;
    }

    return false;
}

// Locate CLI executable dynamically
let AGY_PATH = 'opencode';
try {
    const whichOut = execSync('which opencode 2>/dev/null || which agy 2>/dev/null || echo ""', {
        env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    }).toString().trim();
    if (whichOut && fs.existsSync(whichOut)) {
        AGY_PATH = whichOut;
    } else if (fs.existsSync(`${process.env.HOME}/.local/bin/opencode`)) {
        AGY_PATH = `${process.env.HOME}/.local/bin/opencode`;
    } else if (fs.existsSync(`${process.env.HOME}/.local/bin/agy`)) {
        AGY_PATH = `${process.env.HOME}/.local/bin/agy`;
    }
} catch (e) {
    if (fs.existsSync(`${process.env.HOME}/.local/bin/opencode`)) {
        AGY_PATH = `${process.env.HOME}/.local/bin/opencode`;
    }
}
console.log(`📌 Using agent executable binary path: ${AGY_PATH}`);

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer Storage & Validation Configuration (Limit: 10MB, 1 file, extension/MIME allowlist)
const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/json'
]);
const ALLOWED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.txt', '.md', '.markdown', '.csv', '.pdf', '.json'
]);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase() || '.bin';
        cb(null, 'upload-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIME_TYPES.has(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Disallowed file type'));
        }
    }
});

// Web Push Configuration
let vapidKeys = { publicKey: '', privateKey: '' };
const VAPID_FILE = path.join(__dirname, 'vapid_keys.json');
try {
    if (fs.existsSync(VAPID_FILE)) {
        vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
        if (vapidKeys.publicKey && vapidKeys.privateKey) {
            webpush.setVapidDetails(VAPID_MAILTO, vapidKeys.publicKey, vapidKeys.privateKey);
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
                pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
                saveSubscriptions();
            }
        })
    );
    Promise.all(promises).catch(() => {});
}

// Database Connection Helper (better-sqlite3 read-only, WAL mode)
let dbInstance = null;
function getDb() {
    if (dbInstance) return dbInstance;
    if (fs.existsSync(OPENCODE_DB_PATH)) {
        try {
            dbInstance = new Database(OPENCODE_DB_PATH, { readonly: false, fileMustExist: true });
            dbInstance.pragma('journal_mode = WAL');
            dbInstance.pragma('foreign_keys = ON');
            return dbInstance;
        } catch (e) {
            console.error('Failed to open opencode.db with better-sqlite3:', e);
            return null;
        }
    }
    return null;
}

function isValidUUID(id) {
    return typeof id === 'string' && (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) || /^ses_[a-zA-Z0-9]+$/.test(id));
}

function stripAnsi(str) {
    if (!str) return '';
    return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function cleanUserPrompt(content) {
    if (!content) return '';
    const match = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return content.replace(/<[^>]+>/g, '').trim();
}

// 1. IP Allowlist Middleware for all incoming HTTP requests
app.use((req, res, next) => {
    const clientIp = req.socket.remoteAddress;
    if (!isIpAllowed(clientIp)) {
        return res.status(403).json({ error: 'Access forbidden from this network source' });
    }
    next();
});

app.use(express.json());

// Sunshine-style Pairing API Endpoints (Public within IP allowlist or host-only)

// Client checks if auth/pairing is required
app.get('/api/pair/status', (req, res) => {
    const clientIp = req.socket.remoteAddress;
    const hasAuth = checkTokenAuth(req);
    const requireAuth = !DEV_NO_AUTH;
    res.json({
        requireAuth,
        authenticated: hasAuth,
        isLocal: isLocalIp(clientIp),
        pairedDeviceCount: pairedDevices.length,
        activePinCount: Array.from(pendingPinChallenges.values()).filter(c => !c.paired).length
    });
});

// Client requests a 4-digit PIN for pairing (like Moonlight client)
app.post('/api/pair/request-pin', (req, res) => {
    const clientIp = req.socket.remoteAddress;
    const { clientName, clientId } = req.body || {};
    
    cleanExpiredPinChallenges();

    // Generate random 4-digit PIN
    let pin = '';
    for (let i = 0; i < 4; i++) {
        pin += Math.floor(Math.random() * 10).toString();
    }

    const token = crypto.randomBytes(24).toString('hex');
    const challenge = {
        pin,
        clientId: clientId || crypto.randomUUID(),
        clientName: clientName || 'Mobile Client',
        clientIp,
        token,
        paired: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 min TTL
    };

    pendingPinChallenges.set(pin, challenge);

    res.json({
        pin,
        clientId: challenge.clientId,
        expiresIn: 300
    });
});

// Client polls to check if its requested PIN has been confirmed on the host / Omarchy panel
app.post('/api/pair/poll-pin', (req, res) => {
    const { pin, clientId } = req.body || {};
    cleanExpiredPinChallenges();

    const challenge = pendingPinChallenges.get(pin);
    if (!challenge || challenge.clientId !== clientId) {
        return res.status(404).json({ error: 'Pairing challenge expired or not found' });
    }

    if (challenge.paired) {
        pendingPinChallenges.delete(pin);
        return res.json({
            paired: true,
            token: challenge.token,
            clientName: challenge.clientName
        });
    }

    res.json({ paired: false, remainingSeconds: Math.max(0, Math.round((challenge.expiresAt - Date.now()) / 1000)) });
});

// Host / Omarchy Panel lists active pairing PIN requests
app.get('/api/pair/active-pins', (req, res) => {
    const clientIp = req.socket.remoteAddress;
    if (!isLocalIp(clientIp) && !checkTokenAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    cleanExpiredPinChallenges();
    const list = Array.from(pendingPinChallenges.values())
        .filter(c => !c.paired)
        .map(c => ({
            pin: c.pin,
            clientName: c.clientName,
            clientIp: c.clientIp,
            expiresAt: c.expiresAt
        }));
    res.json(list);
});

// Host / Omarchy Panel accepts / verifies a PIN (like Sunshine web UI)
app.post('/api/pair/confirm-pin', (req, res) => {
    const clientIp = req.socket.remoteAddress;
    if (!isLocalIp(clientIp) && !checkTokenAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { pin, name } = req.body || {};
    if (!pin) {
        return res.status(400).json({ error: 'PIN is required' });
    }

    cleanExpiredPinChallenges();
    const challenge = pendingPinChallenges.get(String(pin).trim());
    if (!challenge) {
        return res.status(404).json({ error: 'Invalid or expired PIN' });
    }

    challenge.paired = true;
    if (name) challenge.clientName = name;

    // Add to persistent paired devices (token stored only as a salted hash)
    const deviceEntry = {
        id: challenge.clientId,
        name: challenge.clientName,
        tokenHash: hashDeviceToken(challenge.token, pairedSalt),
        ip: challenge.clientIp,
        pairedAt: new Date().toISOString()
    };
    pairedDevices.push(deviceEntry);
    savePairedDevices();

    res.json({ success: true, device: deviceEntry });
});

// List paired devices (for Omarchy panel)
app.get('/api/pair/devices', (req, res) => {
    const clientIp = req.socket.remoteAddress;
    if (!isLocalIp(clientIp) && !checkTokenAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json(pairedDevices.map(d => ({ id: d.id, name: d.name, ip: d.ip, pairedAt: d.pairedAt })));
});

// Unpair device
app.delete('/api/pair/devices/:id', (req, res) => {
    const clientIp = req.socket.remoteAddress;
    if (!isLocalIp(clientIp) && !checkTokenAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { id } = req.params;
    pairedDevices = pairedDevices.filter(d => d.id !== id);
    savePairedDevices();
    res.json({ success: true });
});

// 2. Token-gate API routes
app.use('/api', (req, res, next) => {
    const clientIp = req.socket.remoteAddress;
    if (!checkTokenAuth(req)) {
        return res.status(401).json({ error: 'Unauthorized: Valid token required' });
    }
    next();
});

// Serve uploaded files statically with security headers
const DANGEROUS_EXTS = new Set(['.html', '.htm', '.svg', '.js', '.xml']);
app.use('/uploads', express.static(UPLOAD_DIR, {
    setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const ext = path.extname(filePath).toLowerCase();
        if (DANGEROUS_EXTS.has(ext)) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment');
        }
    }
}));

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
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message || 'File upload failed' });
        }
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const fileUrl = `/uploads/${req.file.filename}`;
        res.json({ url: fileUrl, filename: req.file.filename, originalName: req.file.originalname });
    });
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

// REST API: Theme Colors
app.get('/api/theme', (req, res) => {
    try {
        const themePath = path.join(process.env.HOME || '', '.local/state/omarchy/current/theme/colors.toml');
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

// Model list cache
let cachedModels = null;
let lastModelFetchTime = 0;
const MODEL_CACHE_TTL = 30 * 60 * 1000;

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
        const binPath = stdout || AGY_PATH;
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

app.get('/api/models', (req, res) => {
    res.json(getAvailableModels());
});

// REST API: Telemetry
app.get('/api/telemetry', (req, res) => {
    const currentCwd = process.cwd();
    let memPct = 'N/A';
    let uptimeStr = 'N/A';
    try {
        const stdout = execSync("free -m | awk 'NR==2{printf \"%.1f%%\", $3*100/$2}' && echo '||' && uptime -p", { encoding: 'utf8', timeout: 3000 });
        const parts = stdout.trim().split('||');
        if (parts[0]) memPct = parts[0].trim();
        if (parts[1]) uptimeStr = parts[1].trim();
    } catch (e) {}

    res.json({
        cwd: currentCwd,
        memory: memPct,
        uptime: uptimeStr
    });
});

// REST API: Get Sessions List (Optimized single SQL query via better-sqlite3)
app.get('/api/sessions', (req, res) => {
    try {
        const sessions = [];
        const db = getDb();

        if (db) {
            try {
                const stmt = db.prepare(`
                    SELECT 
                        s.id, 
                        s.title, 
                        s.time_updated,
                        COUNT(m.id) as msg_count,
                        (
                            SELECT json_extract(p.data, '$.text') 
                            FROM part p 
                            WHERE p.session_id = s.id 
                              AND json_extract(p.data, '$.type') = 'text' 
                              AND json_extract(p.data, '$.text') IS NOT NULL 
                            LIMIT 1
                        ) as first_prompt
                    FROM session s
                    LEFT JOIN message m ON m.session_id = s.id
                    GROUP BY s.id
                    ORDER BY s.time_updated DESC
                    LIMIT 100
                `);
                const rows = stmt.all();

                for (const row of rows) {
                    let title = row.title || 'New Session';
                    if (row.first_prompt) {
                        const cleanText = cleanUserPrompt(row.first_prompt);
                        if (cleanText) {
                            title = cleanText.split('\n')[0];
                        }
                    }

                    sessions.push({
                        id: row.id,
                        title: title.length > 60 ? title.substring(0, 57) + '...' : title,
                        messageCount: row.msg_count || 0,
                        updatedAt: new Date(row.time_updated)
                    });
                }
            } catch (err) {
                console.error('Failed to read sessions from better-sqlite3:', err);
            }
        }

        // Merge with legacy BRAIN_DIR if available
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

    const db = getDb();
    if (db) {
        try {
            const sessionCheck = db.prepare('SELECT id FROM session WHERE id = ? LIMIT 1').get(sessionId);
            if (sessionCheck) {
                const rows = db.prepare(`
                    SELECT 
                        m.id as msg_id, 
                        m.data as msg_data, 
                        p.data as part_data 
                    FROM message m 
                    JOIN part p ON m.id = p.message_id 
                    WHERE m.session_id = ? 
                    ORDER BY m.time_created ASC, p.time_created ASC
                    LIMIT 500
                `).all(sessionId);

                const messagesMap = new Map();
                for (const row of rows) {
                    try {
                        const msgData = JSON.parse(row.msg_data);
                        const partData = JSON.parse(row.part_data);

                        if (!messagesMap.has(row.msg_id)) {
                            messagesMap.set(row.msg_id, {
                                id: row.msg_id,
                                role: msgData.role,
                                content: '',
                                toolCalls: [],
                                timestamp: msgData.time ? msgData.time.created : Date.now()
                            });
                        }

                        const currentMsg = messagesMap.get(row.msg_id);

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

                const messagesList = Array.from(messagesMap.values());
                return res.json({ id: sessionId, messages: messagesList, truncated: rows.length >= 500 });
            }
        } catch (err) {
            console.error('Failed to load session details with better-sqlite3:', err);
        }
    }

    // Fallback to BRAIN_DIR
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
                        currentStartTime = null;
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

    let deletedFromDb = false;
    const db = getDb();
    if (db) {
        try {
            const deleteParts = db.prepare('DELETE FROM part WHERE session_id = ?');
            const deleteMessages = db.prepare('DELETE FROM message WHERE session_id = ?');
            const deleteSession = db.prepare('DELETE FROM session WHERE id = ?');

            const delTx = db.transaction((id) => {
                deleteParts.run(id);
                deleteMessages.run(id);
                const info = deleteSession.run(id);
                return info.changes > 0;
            });
            deletedFromDb = delTx(sessionId);
        } catch (e) {
            console.error('Error deleting session from db:', e);
        }
    }

    const targetDir = path.resolve(BRAIN_DIR, sessionId);
    let deletedFromDisk = false;
    if (targetDir.startsWith(BRAIN_DIR) && fs.existsSync(targetDir)) {
        if (activeSessions.has(sessionId)) {
            const active = activeSessions.get(sessionId);
            if (active.process) {
                try { active.process.kill('SIGKILL'); } catch (e) {}
            }
            activeSessions.delete(sessionId);
        }
        fs.rmSync(targetDir, { recursive: true, force: true });
        deletedFromDisk = true;
    }

    if (deletedFromDb || deletedFromDisk) {
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

// Gracefully stop a running agent. SIGTERM first so opencode can tear down its
// internal server cleanly; hard SIGKILL after a short grace period.
function stopSession(targetId) {
    const session = activeSessions.get(targetId);
    if (!session || !session.process) return;
    const p = session.process;
    if (p.exitCode !== null || p.signalCode) return;
    const hard = setTimeout(() => {
        try { p.kill('SIGKILL'); } catch (e) {}
    }, 4000);
    p.once('exit', () => clearTimeout(hard));
    try { p.kill('SIGTERM'); } catch (e) {}
}

// WebSocket Connection Management
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

                const effort = data.effort || 'high';
                const model = data.model || 'flash';
                const attachedFilePath = data.attachedFilePath;

                // Verify and constrain cwd against ALLOWED_CWDS
                let customCwd = process.env.HOME || process.cwd();
                if (data.cwd) {
                    if (isCwdAllowed(data.cwd) && fs.existsSync(data.cwd)) {
                        customCwd = path.resolve(data.cwd);
                    } else {
                        ws.send(JSON.stringify({ type: 'error', error: `Working directory '${data.cwd}' is not within ALLOWED_CWDS` }));
                        return;
                    }
                }

                // Verify attachedFilePath if provided
                if (attachedFilePath) {
                    const resolvedAttach = path.resolve(attachedFilePath);
                    const isInUploads = resolvedAttach.startsWith(UPLOAD_DIR);
                    const isInAllowedCwd = isCwdAllowed(resolvedAttach);
                    if (!isInUploads && !isInAllowedCwd) {
                        ws.send(JSON.stringify({ type: 'error', error: 'Attached file path is not allowed' }));
                        return;
                    }
                    userPrompt = `Please inspect the attached file at absolute path '${resolvedAttach}'. User prompt: ${userPrompt}`;
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

                // Conversation resume is handled via --session (see args below); remaining
                // handlers keep the id in BRAIN_DIR for transcript archiving.

                let args = ['run', '--format', 'json'];

                // Auto-approve permissions behind ALLOW_UNSAFE_AGENT=1 (this replaced the old
                // --dangerously-skip-permissions flag). The WS handshake already enforces a
                // token (unless DEV_NO_AUTH), so only AUTH_TOKEN / paired-device tokens are
                // meaningful here.
                if (ALLOW_UNSAFE_AGENT) {
                    if (AUTH_TOKEN || isPairedToken(ws._token) || DEV_NO_AUTH) {
                        args.push('--auto');
                    } else {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            error: 'ALLOW_UNSAFE_AGENT is set but client is not authenticated with valid token/pairing. Spawning aborted.' 
                        }));
                        return;
                    }
                }

                // Resume a real opencode session. Legacy UUID conversation ids (pre-1.18
                // transcripts) are kept for viewing but can't be resumed by the new CLI, so a
                // fresh session is started instead and the real id is broadcast back.
                if (conversationId && /^ses_/.test(conversationId)) {
                    args.push('--session', conversationId);
                }

                // Model ids already arrive provider-qualified (e.g. opencode/big-pickle).
                // Omit --model when unset so opencode uses its configured default model.
                if (model && model !== 'default') {
                    args.push('--model', model);
                    const selectedEffort = (effort || 'high').toLowerCase();
                    if (model.startsWith('google/gemini-') && ['low', 'medium', 'high'].includes(selectedEffort)) {
                        args.push('--variant', selectedEffort);
                    }
                }

                // Prompt travels as a positional argument to `opencode run`.
                let maskedPrompt = userPrompt;
                if (maskedPrompt.startsWith('-')) maskedPrompt = ' ' + maskedPrompt;
                args.push(maskedPrompt);

                console.log(`[ws] Spawning: ${AGY_PATH} in ${customCwd} with args: ${args.join(' ')}`);

                const systemPath = `${process.env.HOME}/.local/bin:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}`;

                const childProcess = spawn(AGY_PATH, args, {
                    env: { ...process.env, PATH: systemPath, TERM: 'dumb', PAGER: 'cat', HOME: process.env.HOME },
                    cwd: customCwd,
                    // Keep stdin closed: opencode 1.18 blocks while a stdin pipe is held open,
                    // which deadlocks the run and cascades into the whole app.
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                const session = {
                    process: childProcess,
                    clients: new Set([ws]),
                    events: [],
                    currentTool: null,
                    state: 'thinking',
                    isFinished: false,
                    errored: false,
                    startedAt: Date.now()
                };
                activeSessions.set(conversationId, session);

                broadcastToSession(conversationId, { type: 'state_change', state: 'thinking', message: 'Agent processing...' });

                let hasEmittedChunk = false;
                let stdoutBuffer = '';

                const appendEvent = (evt) => {
                    if (session.isFinished) return;
                    session.events.push(evt);
                    if (session.events.length > 200) {
                        session.events.splice(0, session.events.length - 200);
                    }
                };

                childProcess.on('error', (err) => {
                    console.error(`[ws] Failed to start agent process:`, err);
                    broadcastToSession(conversationId, { type: 'error', error: `Failed to spawn agent: ${err.message}` });
                    if (activeSessions.get(conversationId) === session) {
                        activeSessions.delete(conversationId);
                    }
                });

                childProcess.stdout.on('data', (chunk) => {
                    try {
                        stdoutBuffer += chunk.toString();
                        let lines = stdoutBuffer.split('\n');
                        stdoutBuffer = lines.pop() || '';

                        for (const line of lines) {
                            const cleanLine = line.trim();
                            if (!cleanLine) continue;
                            try {
                                const obj = JSON.parse(cleanLine);

                                // opencode 1.18 generates its own ses_ session id for new
                                // chats; rebind once so the frontend stores the real id for
                                // later resume.
                                if (obj.sessionID && obj.sessionID !== conversationId) {
                                    if (activeSessions.get(conversationId) === session) {
                                        activeSessions.delete(conversationId);
                                    }
                                    conversationId = obj.sessionID;
                                    boundConversationId = conversationId;
                                    ws.conversationId = conversationId;
                                    activeSessions.set(conversationId, session);
                                    broadcastToSession(conversationId, { type: 'session_id', id: conversationId });
                                }

                                if (obj.type === 'text' && obj.part && obj.part.text) {
                                    hasEmittedChunk = true;
                                    const chunkEvt = { type: 'chunk', content: obj.part.text };
                                    appendEvent(chunkEvt);
                                    broadcastToSession(conversationId, chunkEvt);
                                } else if (obj.type === 'reasoning' && obj.part && obj.part.text) {
                                    const thinkEvt = { type: 'tool_update', content: obj.part.text };
                                    appendEvent(thinkEvt);
                                    broadcastToSession(conversationId, thinkEvt);
                                } else if (obj.type === 'tool_use' && obj.part && obj.part.tool_use) {
                                    const tu = obj.part.tool_use;
                                    const name = tu.name || 'tool';
                                    let inputSummary = '';
                                    if (typeof tu.input === 'string') inputSummary = tu.input;
                                    else if (tu.input && tu.input.command) inputSummary = tu.input.command;
                                    else if (tu.input && (tu.input.filePath || tu.input.path)) inputSummary = tu.input.filePath || tu.input.path;
                                    else if (tu.input && tu.input.pattern) inputSummary = tu.input.pattern;
                                    let msg = `$ ${name} ${inputSummary}`.trim();
                                    if (tu.state === 'DONE') msg = `✓ Completed: ${name}`;
                                    else if (tu.state === 'ERROR') msg = `✗ Failed: ${name}`;
                                    session.currentTool = msg;
                                    const toolEvt = { type: 'tool_call', toolName: name, title: msg, input: tu.input, state: tu.state || 'running', content: msg };
                                    appendEvent(toolEvt);
                                    broadcastToSession(conversationId, toolEvt);
                                } else if (obj.type === 'error') {
                                    session.errored = true;
                                    let detail = 'Execution failed';
                                    if (obj.error) {
                                        if (obj.error.data && obj.error.data.message) detail = obj.error.data.message;
                                        else if (obj.error.data && obj.error.data.error) detail = obj.error.data.error;
                                        else if (obj.error.data && typeof obj.error.data === 'string') detail = obj.error.data;
                                        else if (obj.error.message) detail = obj.error.message;
                                    }
                                    if (detail.length > 600) detail = detail.substring(0, 600) + '…';
                                    const errEvt = { type: 'chunk', content: `\n\n**System Error:** ${detail}` };
                                    appendEvent(errEvt);
                                    broadcastToSession(conversationId, errEvt);
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
                    if (activeSessions.get(conversationId) !== session) {
                        return;
                    }
                    session.isFinished = true;

                    if (!hasEmittedChunk && code !== 0 && !session.errored) {
                        broadcastToSession(conversationId, { type: 'error', error: `Agent exited unexpectedly with code ${code}` });
                    } else if (!session.errored) {
                        broadcastToSession(conversationId, { type: 'done', code });
                    }
                    activeSessions.delete(conversationId);
                    
                    sendPushNotification({
                        title: 'OpenCode Mobile',
                        body: 'The agent has completed responding to your prompt.',
                        icon: '/favicon.svg',
                        data: { url: `/?id=${conversationId}` }
                    });
                });

                childProcess.on('error', (err) => {
                    console.error(`[ws] Process error for ${conversationId}:`, err);
                    if (activeSessions.get(conversationId) !== session) return;
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
            } else if (data.type === 'stop' || data.type === 'kill') {
                const targetId = data.conversationId || boundConversationId;
                if (targetId && activeSessions.has(targetId)) {
                    stopSession(targetId);
                    broadcastToSession(targetId, { type: 'stopped' });
                    activeSessions.delete(targetId);
                } else {
                    ws.send(JSON.stringify({ type: 'stopped' }));
                }
            }
        } catch (err) {
            console.error('[ws] Message handling error:', err);
            ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
    });

    ws.on('close', () => {
        if (boundConversationId && activeSessions.has(boundConversationId)) {
            const session = activeSessions.get(boundConversationId);
            session.clients.delete(ws);
        }
    });
});

// HTTP Upgrade Handling with IP allowlist, Origin validation, Token validation, and /ws path assertion
server.on('upgrade', (req, socket, head) => {
    const clientIp = socket.remoteAddress;

    // 1. IP Check
    if (!isIpAllowed(clientIp)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
    }

    // 2. Path Check
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (parsedUrl.pathname !== '/ws') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
    }

    // 3. Origin check (kill CSWSH/DNS-rebinding)
    const origin = req.headers['origin'];
    if (origin) {
        try {
            const originUrl = new URL(origin);
            const hostHeader = req.headers['host'];
            if (originUrl.host !== hostHeader) {
                socket.write('HTTP/1.1 403 Forbidden: Invalid Origin\r\n\r\n');
                socket.destroy();
                return;
            }
        } catch (e) {
            socket.write('HTTP/1.1 403 Forbidden: Invalid Origin Format\r\n\r\n');
            socket.destroy();
            return;
        }
    }

    // 4. Token Check for WS
    req.query = Object.fromEntries(parsedUrl.searchParams);
    if (!checkTokenAuth(req)) {
        socket.write('HTTP/1.1 401 Unauthorized: Invalid Token\r\n\r\n');
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        ws._token = req.query.token || '';
        wss.emit('connection', ws, req);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ OpenCode Mobile server running at http://0.0.0.0:${PORT}\n`);
});
