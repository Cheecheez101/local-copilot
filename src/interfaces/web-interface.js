'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { Orchestrator } = require('../core/orchestrator');
const { ModelManager } = require('../core/model-manager');
const { ContextManager } = require('../core/context-manager');

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Simple router helper – matches method + path and calls the handler.
 */
class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    this.routes.push({ method: method.toUpperCase(), pattern, handler });
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;

      if (route.pattern instanceof RegExp) {
        const m = pathname.match(route.pattern);
        if (m) return { handler: route.handler, params: m.groups || {} };
      } else if (route.pattern === pathname) {
        return { handler: route.handler, params: {} };
      }
    }
    return null;
  }
}

/**
 * Parse the request body as JSON.
 * @param {http.IncomingMessage} req
 * @returns {Promise<object>}
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {object} body
 */
function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

/** Minimal HTML for the single-page web UI */
function buildUI() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Local AI Dev Co-Pilot</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#c9d1d9;height:100vh;display:flex;flex-direction:column}
    header{background:#161b22;padding:12px 20px;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:12px}
    header h1{font-size:1.1rem;color:#58a6ff}
    header .badge{background:#21262d;border:1px solid #30363d;border-radius:999px;padding:2px 10px;font-size:.75rem;color:#8b949e}
    #status{font-size:.75rem;color:#3fb950}
    main{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px}
    .msg{max-width:80%;padding:12px 16px;border-radius:12px;font-size:.9rem;line-height:1.6;white-space:pre-wrap;word-break:break-word}
    .msg.user{align-self:flex-end;background:#1f6feb;color:#fff;border-bottom-right-radius:4px}
    .msg.ai{align-self:flex-start;background:#161b22;border:1px solid #30363d;border-bottom-left-radius:4px}
    .msg .agent-label{font-size:.7rem;color:#8b949e;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}
    pre,code{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px 12px;overflow-x:auto;font-size:.82rem}
    footer{background:#161b22;border-top:1px solid #30363d;padding:12px 16px;display:flex;gap:8px;align-items:center}
    #agent-select{background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:6px 10px;border-radius:6px;font-size:.85rem}
    #input{flex:1;background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:8px 12px;border-radius:6px;font-size:.9rem;resize:none;height:42px}
    #input:focus{outline:none;border-color:#58a6ff}
    #send-btn{background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 18px;cursor:pointer;font-size:.9rem}
    #send-btn:hover{background:#2ea043}
    #send-btn:disabled{opacity:.4;cursor:not-allowed}
    .thinking{color:#8b949e;font-style:italic}
    a{color:#58a6ff}
  </style>
</head>
<body>
<header>
  <h1>🤖 Local AI Dev Co-Pilot</h1>
  <span class="badge">Offline · Private</span>
  <span id="status">Checking service…</span>
</header>
<main id="chat"></main>
<footer>
  <select id="agent-select">
    <option value="auto">Auto-route</option>
    <option value="reasoning">Reasoning</option>
    <option value="coding">Coding</option>
    <option value="fileAnalysis">File Analysis</option>
  </select>
  <textarea id="input" placeholder="Ask anything… (Shift+Enter for newline)" rows="1"></textarea>
  <button id="send-btn">Send</button>
</footer>
<script>
  const chat = document.getElementById('chat');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const agentSelect = document.getElementById('agent-select');
  const statusEl = document.getElementById('status');
  let sessionId = null;

  async function init() {
    const res = await fetch('/api/session', { method: 'POST' });
    const data = await res.json();
    sessionId = data.sessionId;

    const health = await fetch('/api/health');
    const h = await health.json();
    statusEl.textContent = h.modelService ? '● Service online' : '⚠ Service offline';
    statusEl.style.color = h.modelService ? '#3fb950' : '#f78166';
  }

  function addMessage(role, text, agentName) {
    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
    if (agentName) {
      const lbl = document.createElement('div');
      lbl.className = 'agent-label';
      lbl.textContent = agentName + ' agent';
      div.appendChild(lbl);
    }
    // Build markdown fence chars without raw backticks (this whole script lives in a template literal).
    const codeFence = String.fromCharCode(96).repeat(3);
    const codeBlockRe = new RegExp(codeFence + '(\\w*)\\n?([\\s\\S]*?)' + codeFence, 'g');
    const formatted = text.replace(codeBlockRe, (_, lang, code) => {
      return '<pre><code>' + code.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>';
    });
    const content = document.createElement('div');
    content.innerHTML = formatted;
    div.appendChild(content);
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBtn.disabled = true;

    addMessage('user', text);
    const thinking = addMessage('ai', 'Thinking…');
    thinking.querySelector('div:last-child').className = 'thinking';

    try {
      const agent = agentSelect.value === 'auto' ? undefined : agentSelect.value;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, agent }),
      });
      const data = await res.json();
      chat.removeChild(thinking);

      const response = data.response;
      const display = typeof response === 'object'
        ? (response.explanation || response.code || response.fix || JSON.stringify(response, null, 2))
        : response;

      addMessage('ai', display, data.agent);
    } catch (err) {
      chat.removeChild(thinking);
      addMessage('ai', 'Error: ' + err.message);
    }

    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  init();
</script>
</body>
</html>`;
}

/**
 * WebInterface – Express-like HTTP server providing a REST API and minimal
 * single-page web UI for the Local AI Dev Co-Pilot.
 */
class WebInterface {
  constructor(options = {}) {
    const modelMgr = new ModelManager();
    const ctxMgr = new ContextManager();
    this.orchestrator = new Orchestrator({}, modelMgr, ctxMgr);
    this.port = options.port || DEFAULT_PORT;
    this.host = options.host || DEFAULT_HOST;
    this.router = new Router();
    this.server = null;

    this._registerRoutes();
  }

  _registerRoutes() {
    const r = this.router;

    // Health check
    r.add('GET', '/api/health', this._handleHealth.bind(this));

    // Session management
    r.add('POST', '/api/session', this._handleCreateSession.bind(this));

    // Chat endpoint
    r.add('POST', '/api/chat', this._handleChat.bind(this));

    // List models
    r.add('GET', '/api/models', this._handleModels.bind(this));

    // Web UI
    r.add('GET', '/', this._handleUI.bind(this));
  }

  async _handleHealth(req, res) {
    const available = await this.orchestrator.isModelServiceAvailable();
    sendJson(res, 200, {
      status: 'ok',
      modelService: available,
      timestamp: new Date().toISOString(),
    });
  }

  async _handleCreateSession(req, res) {
    try {
      const body = await parseBody(req);
      const sessionId = this.orchestrator.createSession(body.metadata || {});
      sendJson(res, 201, { sessionId });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  }

  async _handleChat(req, res) {
    try {
      const body = await parseBody(req);
      const { message, sessionId, agent, options = {} } = body;

      if (!message) {
        return sendJson(res, 400, { error: '`message` is required' });
      }
      if (!sessionId) {
        return sendJson(res, 400, { error: '`sessionId` is required' });
      }

      const processOptions = { ...options };
      if (agent) processOptions.agent = agent;

      const result = await this.orchestrator.process(message, sessionId, processOptions);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  }

  async _handleModels(req, res) {
    try {
      const models = await this.orchestrator.listModels();
      sendJson(res, 200, { models });
    } catch (err) {
      sendJson(res, 503, { error: `Could not fetch models: ${err.message}` });
    }
  }

  _handleUI(req, res) {
    const html = buildUI();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    res.end(html);
  }

  /**
   * Start the HTTP server.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const match = this.router.match(req.method, url.pathname);

        if (match) {
          await match.handler(req, res);
        } else {
          sendJson(res, 404, { error: 'Not found' });
        }
      });

      this.server.listen(this.port, this.host, () => {
        console.log(`Local AI Dev Co-Pilot web interface running at http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server.
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// Run when executed directly
if (require.main === module) {
  const web = new WebInterface();
  web.start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { WebInterface };
