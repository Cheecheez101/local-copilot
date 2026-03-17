'use strict';

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}

const PLAYGROUND_CONFIG_KEY = 'aiCopilot.playground.defaultConfig';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class Playground {
  constructor(orchestrator, context = null) {
    this.orchestrator = orchestrator;
    this.context = context;
    this.sessions = new Map();
  }

  async show() {
    if (!vscode) {
      throw new Error('Playground is only available inside VS Code.');
    }

    const panel = vscode.window.createWebviewPanel(
      'aiPlayground',
      'AI Playground',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const models = await this.getAvailableModels();
    const defaults = this.getSavedConfiguration();
    panel.webview.html = this.getPlaygroundHtml(models, defaults);

    const disposable = panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'sendMessage':
          await this.handleMessage(panel, message);
          break;
        case 'compare':
          await this.startComparison(panel, message);
          break;
        case 'saveConfig':
          await this.saveConfiguration(message.config);
          break;
        default:
          break;
      }
    });

    panel.onDidDispose(() => disposable.dispose());
  }

  async getAvailableModels() {
    const fallback = [{ id: 'default', name: 'Default (auto)', provider: 'local-copilot' }];
    if (!this.orchestrator || typeof this.orchestrator.listModels !== 'function') {
      return fallback;
    }

    const ids = await this.orchestrator.listModels();
    if (!Array.isArray(ids) || ids.length === 0) {
      return fallback;
    }

    return ids.map((id) => ({ id, name: id, provider: 'foundry-local' }));
  }

  getSavedConfiguration() {
    return this.context?.globalState?.get(PLAYGROUND_CONFIG_KEY, {
      temperature: 0.7,
      maxTokens: 2048,
      topP: 0.95,
      systemPrompt: '',
    }) || {
      temperature: 0.7,
      maxTokens: 2048,
      topP: 0.95,
      systemPrompt: '',
    };
  }

  getPlaygroundHtml(models, defaults) {
    const modelOptions = models
      .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(`${m.name} (${m.provider})`)}</option>`)
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; font-family: -apple-system, sans-serif; }
    .playground-container { display: flex; gap: 20px; height: calc(100vh - 40px); }
    .config-panel { width: 300px; border-right: 1px solid #ccc; padding-right: 20px; }
    .chat-panel { flex: 1; display: flex; flex-direction: column; }
    .messages { flex: 1; overflow-y: auto; padding: 16px; background: #f9f9f9; border-radius: 8px; margin-bottom: 16px; }
    .message { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; white-space: pre-wrap; }
    .user-message { background: #007acc; color: white; align-self: flex-end; }
    .assistant-message { background: #e5e5e5; color: #333; }
    .input-area { display: flex; gap: 8px; }
    textarea { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; resize: vertical; }
    .param-slider { width: 100%; margin: 8px 0; }
    .model-selector { margin-bottom: 16px; padding: 8px; width: 100%; }
    .system-prompt { width: 100%; min-height: 100px; margin-bottom: 16px; padding: 8px; }
  </style>
</head>
<body>
  <div class="playground-container">
    <div class="config-panel">
      <h3>Configuration</h3>
      <label>Model:</label>
      <select class="model-selector" id="modelSelect">${modelOptions}</select>
      <label>System Prompt:</label>
      <textarea class="system-prompt" id="systemPrompt" placeholder="Enter system prompt...">${escapeHtml(defaults.systemPrompt || '')}</textarea>
      <label>Temperature: <span id="tempValue">${escapeHtml(defaults.temperature ?? 0.7)}</span></label>
      <input type="range" class="param-slider" id="temperature" min="0" max="2" step="0.1" value="${escapeHtml(defaults.temperature ?? 0.7)}">
      <label>Max Tokens:</label>
      <input type="number" id="maxTokens" value="${escapeHtml(defaults.maxTokens ?? 2048)}" min="1" max="8192">
      <label>Top P:</label>
      <input type="range" class="param-slider" id="topP" min="0" max="1" step="0.05" value="${escapeHtml(defaults.topP ?? 0.95)}">
      <button onclick="saveConfig()">Save as Default</button>
    </div>
    <div class="chat-panel">
      <div class="messages" id="messages"></div>
      <div class="input-area">
        <textarea id="userInput" placeholder="Type your message..." rows="3"></textarea>
        <button onclick="sendMessage()">Send</button>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const history = [];
    document.getElementById('temperature').addEventListener('input', (e) => {
      document.getElementById('tempValue').textContent = e.target.value;
    });
    function config() {
      return {
        model: document.getElementById('modelSelect').value,
        systemPrompt: document.getElementById('systemPrompt').value,
        temperature: parseFloat(document.getElementById('temperature').value),
        maxTokens: parseInt(document.getElementById('maxTokens').value, 10),
        topP: parseFloat(document.getElementById('topP').value)
      };
    }
    function addMessage(role, content) {
      const node = document.createElement('div');
      node.className = 'message ' + (role === 'user' ? 'user-message' : 'assistant-message');
      node.textContent = content;
      document.getElementById('messages').appendChild(node);
      history.push({ role, content });
      const c = document.getElementById('messages');
      c.scrollTop = c.scrollHeight;
    }
    function sendMessage() {
      const input = document.getElementById('userInput');
      const message = input.value.trim();
      if (!message) return;
      addMessage('user', message);
      input.value = '';
      vscode.postMessage({ command: 'sendMessage', message, config: config(), history });
    }
    function saveConfig() {
      vscode.postMessage({ command: 'saveConfig', config: config() });
    }
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'response') addMessage('assistant', message.response);
      if (message.command === 'error') addMessage('assistant', 'Error: ' + message.error);
    });
  </script>
</body>
</html>`;
  }

  async handleMessage(panel, message) {
    try {
      const selectedModel = message?.config?.model;
      const manager = this.orchestrator?.modelManager;
      if (manager && selectedModel && selectedModel !== 'default') {
        if (manager.config?.models?.chat) manager.setModel('chat', selectedModel);
        if (manager.config?.models?.reasoning) manager.setModel('reasoning', selectedModel);
      }

      const prompt = String(message?.message || '').trim();
      if (!prompt) {
        throw new Error('Message cannot be empty.');
      }

      const response = await this.orchestrator.process(prompt, this._getSession(panel), { agent: 'reasoning' });
      const text = typeof response?.response === 'string'
        ? response.response
        : JSON.stringify(response?.response ?? {}, null, 2);

      panel.webview.postMessage({ command: 'response', response: text, modelId: selectedModel || 'default' });
    } catch (error) {
      panel.webview.postMessage({ command: 'error', error: error.message });
    }
  }

  async startComparison(panel, message) {
    const prompt = String(message?.message || '').trim();
    if (!prompt) {
      panel.webview.postMessage({ command: 'error', error: 'Comparison prompt cannot be empty.' });
      return;
    }
    panel.webview.postMessage({
      command: 'error',
      error: 'Comparison mode is not yet enabled in this simplified playground build.',
    });
  }

  async saveConfiguration(config) {
    const normalized = {
      model: String(config?.model || 'default'),
      systemPrompt: String(config?.systemPrompt || ''),
      temperature: Number(config?.temperature ?? 0.7),
      maxTokens: Number(config?.maxTokens ?? 2048),
      topP: Number(config?.topP ?? 0.95),
    };

    if (this.context?.globalState?.update) {
      await this.context.globalState.update(PLAYGROUND_CONFIG_KEY, normalized);
    }

    if (vscode) {
      vscode.window.showInformationMessage('AI Playground defaults saved.');
    }
  }

  _getSession(panel) {
    const key = panel?.title || 'default';
    if (!this.sessions.has(key)) {
      this.sessions.set(key, this.orchestrator.createSession({ interface: 'vscode-playground' }));
    }
    return this.sessions.get(key);
  }
}

module.exports = Playground;
module.exports.Playground = Playground;
module.exports.escapeHtml = escapeHtml;
