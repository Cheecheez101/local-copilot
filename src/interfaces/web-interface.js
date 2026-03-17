'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { Orchestrator } = require('../core/orchestrator');
const { ModelManager } = require('../core/model-manager');
const { ContextManager } = require('../core/context-manager');
const { validateStartupEnv } = require('../utils/startup-validation');
const { log } = require('../utils/logger');

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
    #diag-btn{background:#30363d;color:#c9d1d9;border:1px solid #484f58;border-radius:6px;padding:4px 10px;cursor:pointer}
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
    #send-btn,#upload-btn{background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 18px;cursor:pointer;font-size:.9rem}
    #send-btn:hover{background:#2ea043}
    #upload-btn{background:#1f6feb}
    #upload-btn:hover{background:#388bfd}
    #send-btn:disabled{opacity:.4;cursor:not-allowed}
    #upload-btn:disabled{opacity:.4;cursor:not-allowed}
    .thinking{color:#8b949e;font-style:italic}
    a{color:#58a6ff}
  </style>
</head>
<body>
<header>
  <h1>🤖 Local AI Dev Co-Pilot</h1>
  <span class="badge">Offline · Private</span>
  <span id="status">Checking service…</span>
  <button id="diag-btn">Diagnostics</button>
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
  <input id="file-input" type="file" style="display:none" />
  <button id="upload-btn">Upload File</button>
  <button id="send-btn">Send</button>
</footer>
<script>
  const chat = document.getElementById('chat');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');
  const agentSelect = document.getElementById('agent-select');
  const statusEl = document.getElementById('status');
  const diagBtn = document.getElementById('diag-btn');
  let sessionId = null;

  async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function ensureSession() {
    if (sessionId) return sessionId;
    try {
      const res = await fetchWithTimeout('/api/session', { method: 'POST' }, 15000);
      const data = await res.json();
      if (!res.ok || !data.sessionId) {
        throw new Error(data.error || 'Failed to create session');
      }
      sessionId = data.sessionId;
      return sessionId;
    } catch (err) {
      // Retry once for transient startup/network aborts before failing.
      const isAbort = err && (err.name === 'AbortError' || /aborted|abort/i.test(String(err.message || err)));
      if (!isAbort) {
        throw err;
      }
      const retryRes = await fetchWithTimeout('/api/session', { method: 'POST' }, 20000);
      const retryData = await retryRes.json();
      if (!retryRes.ok || !retryData.sessionId) {
        throw new Error(retryData.error || 'Failed to create session');
      }
      sessionId = retryData.sessionId;
      return sessionId;
    }
  }

  async function init() {
    try {
      // Do not hard-fail startup UI on transient session creation errors.
      try {
        await ensureSession();
      } catch (sessionErr) {
        statusEl.textContent = '⚠ Session retry needed';
        statusEl.style.color = '#f78166';
      }

      const health = await fetchWithTimeout('/api/health', {}, 15000);
      const h = await health.json();
      statusEl.textContent = h.modelService ? '● Service online' : '⚠ Service offline';
      statusEl.style.color = h.modelService ? '#3fb950' : '#f78166';
    } catch (err) {
      statusEl.textContent = '⚠ Service check failed';
      statusEl.style.color = '#f78166';
      addMessage('ai', 'Startup warning: ' + (err && err.message ? err.message : String(err)));
    }
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
    const thinking = addMessage('ai', 'Thinking\u2026');
    thinking.querySelector('div:last-child').className = 'thinking';

    // Guard so thinking is only removed once, preventing a double-removeChild crash
    // that would silently swallow errors and leave the chat blank.
    let thinkingRemoved = false;
    function removeThinking() {
      if (!thinkingRemoved) { thinkingRemoved = true; chat.removeChild(thinking); }
    }

    let display = '';
    let agentName = '';
    try {
      await ensureSession();
      const agent = agentSelect.value === 'auto' ? undefined : agentSelect.value;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300000); // 5-min browser timeout
      let res;
      try {
        res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId, agent }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || ('Request failed with status ' + res.status));
      }
      agentName = data.agent || '';
      const response = data.response;
      if (response == null) {
        display = 'No response content returned.';
      } else if (typeof response === 'object') {
        display = response.explanation || response.code || response.fix || JSON.stringify(response, null, 2);
      } else {
        display = String(response) || 'No response content returned.';
      }
    } catch (err) {
      display = 'Error: ' + (err && err.message ? err.message : String(err));
    }

    removeThinking();
    addMessage('ai', display, agentName);
    sendBtn.disabled = false;
    input.focus();
  }

  async function uploadAndAnalyzeFile(file) {
    if (!file) return;
    uploadBtn.disabled = true;

    addMessage('user', 'Uploaded file: ' + file.name);
    const thinking = addMessage('ai', 'Analyzing file…', 'fileAnalysis');
    thinking.querySelector('div:last-child').className = 'thinking';

    let display = '';
    try {
      await ensureSession();
      const question = input.value.trim();
      const isImage = (file.type || '').startsWith('image/');
      let payload;
      if (isImage) {
        const optimized = await optimizeImageForUpload(file);
        payload = {
          sessionId,
          fileName: file.name,
          mimeType: optimized.mimeType,
          imageDataUrl: optimized.imageDataUrl,
          question,
        };
      } else {
        const content = await file.text();
        payload = { sessionId, fileName: file.name, content, question };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 300000);
      try {
        const res = await fetch('/api/analyze-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || ('Request failed with status ' + res.status));
        }
         const response = data.response;
         if (response == null) {
           display = 'No response content returned.';
         } else if (typeof response === 'object') {
           display = response.explanation || response.code || response.fix || JSON.stringify(response, null, 2);
         } else {
           display = String(response);
         }
       } finally {
         clearTimeout(timeout);
       }
     } catch (err) {
       display = 'Error: ' + (err && err.message ? err.message : String(err));
     }

    chat.removeChild(thinking);
    addMessage('ai', display, 'fileAnalysis');
    uploadBtn.disabled = false;
  }

  async function showDiagnostics() {
    try {
      const res = await fetch('/api/diagnostics');
      const data = await res.json();
      addMessage('ai', JSON.stringify(data, null, 2), 'diagnostics');
    } catch (err) {
      addMessage('ai', 'Diagnostics failed: ' + (err && err.message ? err.message : String(err)));
    }
  }

  async function optimizeImageForUpload(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load image'));
        image.src = objectUrl;
      });

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      const maxDimension = 768;
      const longestEdge = Math.max(width, height);
      if (longestEdge > maxDimension) {
        const scale = maxDimension / longestEdge;
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable for image optimization');

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.82;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      const maxDataUrlChars = 500_000;

      while (dataUrl.length > maxDataUrlChars && quality > 0.45) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      while (dataUrl.length > maxDataUrlChars && canvas.width > 384 && canvas.height > 384) {
        const nextWidth = Math.max(384, Math.round(canvas.width * 0.85));
        const nextHeight = Math.max(384, Math.round(canvas.height * 0.85));
        const resized = document.createElement('canvas');
        resized.width = nextWidth;
        resized.height = nextHeight;
        const resizedCtx = resized.getContext('2d');
        if (!resizedCtx) break;
        resizedCtx.drawImage(canvas, 0, 0, nextWidth, nextHeight);
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        const redrawCtx = canvas.getContext('2d');
        if (!redrawCtx) break;
        redrawCtx.drawImage(resized, 0, 0, nextWidth, nextHeight);
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }

      if (dataUrl.length > maxDataUrlChars) {
        throw new Error('Image is still too large after compression. Please crop the screenshot and try again.');
      }

      return { imageDataUrl: dataUrl, mimeType: 'image/jpeg' };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  sendBtn.addEventListener('click', send);
  diagBtn.addEventListener('click', showDiagnostics);
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    await uploadAndAnalyzeFile(file);
    fileInput.value = '';
  });
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
    this.startupValidation = validateStartupEnv();

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
    r.add('POST', '/api/analyze-file', this._handleAnalyzeFile.bind(this));

    // List models
    r.add('GET', '/api/models', this._handleModels.bind(this));
    r.add('GET', '/api/diagnostics', this._handleDiagnostics.bind(this));

    // Web UI
    r.add('GET', '/', this._handleUI.bind(this));
  }

  async _handleHealth(req, res) {
    const available = await this.orchestrator.isModelServiceAvailable();
    sendJson(res, 200, {
      status: 'ok',
      modelService: available,
      timestamp: new Date().toISOString(),
      env: this.startupValidation,
    });
  }

  async _handleDiagnostics(req, res) {
    try {
      const [available, models] = await Promise.all([
        this.orchestrator.isModelServiceAvailable(),
        this.orchestrator.listModels().catch(() => []),
      ]);
      sendJson(res, 200, {
        status: 'ok',
        available,
        models,
        env: this.startupValidation,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
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
      log('error', 'web_api_chat_failed', { message: err?.message, stack: err?.stack });
      sendJson(res, 500, { error: err.message });
    }
  }

  async _handleAnalyzeFile(req, res) {
    try {
      const body = await parseBody(req);
      const { sessionId, fileName, content, question, imageDataUrl, mimeType } = body;

      if (!sessionId) {
        return sendJson(res, 400, { error: '`sessionId` is required' });
      }

      let result;
      if (imageDataUrl) {
        if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
          return sendJson(res, 400, { error: 'Invalid image payload.' });
        }
        if (imageDataUrl.length > 8_000_000) {
          return sendJson(res, 400, { error: 'Image is too large. Please upload a smaller image.' });
        }
        const response = await this.orchestrator.fileAnalysisAgent.analyzeImage(
          imageDataUrl,
          mimeType || 'image/*',
          question || '',
          sessionId,
          fileName || 'uploaded-image'
        );
        result = { agent: 'fileAnalysis', response };
      } else {
        if (!content || typeof content !== 'string') {
          return sendJson(res, 400, { error: '`content` is required for text files' });
        }
        if (content.length > 400000) {
          return sendJson(res, 400, { error: 'File is too large. Please upload a smaller text file.' });
        }
        const task = `Analyze uploaded file: ${fileName || 'unnamed-file'}`;
        result = await this.orchestrator.process(task, sessionId, {
          agent: 'fileAnalysis',
          content,
          question: question || '',
        });
      }
      sendJson(res, 200, result);
    } catch (err) {
      log('error', 'web_api_analyze_failed', { message: err?.message, stack: err?.stack });
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
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
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
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const match = this.router.match(req.method, url.pathname);

        if (match) {
          await match.handler(req, res);
        } else {
          sendJson(res, 404, { error: 'Not found' });
        }
      });

      const onError = (err) => {
        if (err && err.code === 'EADDRINUSE') {
          reject(new Error(`Cannot start web interface: ${this.host}:${this.port} is already in use. Set PORT to a different value and retry.`));
          return;
        }
        reject(err);
      };
      this.server.once('error', onError);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', onError);
        log('info', 'web_started', {
          host: this.host,
          port: this.port,
          envWarnings: this.startupValidation.warnings,
          envErrors: this.startupValidation.errors,
        });
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
  const rawPort = Number.parseInt(process.env.PORT, 10);
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : undefined;
  const host = process.env.HOST || undefined;
  const web = new WebInterface({ port, host });
  web.start().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { WebInterface };
