'use strict';

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const Playground = require('./playground');
const { AgentBuilder } = require('../agents/agent-builder');
const { AgentEvaluator } = require('../evaluation/agent-evaluator');

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}

let fetchFn;
try {
  fetchFn = fetch;
} catch {
  fetchFn = require('node-fetch');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

class AIToolkitIntegration {
  constructor(context, orchestrator) {
    this.context = context;
    this.orchestrator = orchestrator;
    this.modelCatalog = new ModelCatalog(orchestrator, context, this);
    this.playground = new Playground(orchestrator, context);
    this.agentBuilder = new AgentBuilder(orchestrator, context);
    this.evaluator = new AgentEvaluator(orchestrator);
    this.registerCommands();
    this.registerViews();
  }

  registerCommands() {
    if (!vscode) return;
    this.context.subscriptions.push(
      vscode.commands.registerCommand('ai-copilot.openModelCatalog', () => this.modelCatalog.show()),
      vscode.commands.registerCommand('ai-copilot.openPlayground', () => this.playground.show()),
      vscode.commands.registerCommand('ai-copilot.createAgent', () => this.agentBuilder.createAgent()),
      vscode.commands.registerCommand('ai-copilot.evaluateAgent', async (agent) => this.evaluator.evaluateAgent(agent)),
      vscode.commands.registerCommand('ai-copilot.exportAgent', async (agent) => this.agentBuilder.exportAgent(agent))
    );
  }

  registerViews() {
    if (!vscode) return;
    const provider = new AIToolkitViewProvider(this.context.extensionUri);
    this.context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('ai-copilot.toolkitView', provider)
    );
  }
}

class ModelCatalog {
  constructor(orchestrator, context, integration) {
    this.orchestrator = orchestrator;
    this.context = context;
    this.integration = integration;
  }

  async show() {
    if (!vscode) return;
    const panel = vscode.window.createWebviewPanel('modelCatalog', 'AI Model Catalog', vscode.ViewColumn.One, { enableScripts: true });
    await this.renderCatalog(panel);
    const disposable = panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'addModel':
          await this.addModel(message.model);
          break;
        case 'compareModels':
          await this.compareModels(message.models);
          break;
        case 'tryInPlayground':
          await this.openInPlayground(message.model);
          break;
        case 'refreshCatalog':
          await this.renderCatalog(panel);
          break;
        default:
          break;
      }
    });
    panel.onDidDispose(() => disposable.dispose());
  }

  async renderCatalog(panel) {
    try {
      const models = await this.discoverModels();
      panel.webview.html = this.getCatalogHtml(models);
    } catch (error) {
      panel.webview.html = `<html><body><h2>Failed to load model catalog</h2><pre>${escapeHtml(error.message)}</pre></body></html>`;
    }
  }

  async discoverModels() {
    const discovered = await Promise.allSettled([
      this.fetchGitHubModels(),
      this.fetchFoundryModels(),
      this.fetchOllamaModels(),
    ]);
    return discovered.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  }

  async getModelsByProvider(provider) {
    const normalized = provider === 'foundry' ? 'foundry-local' : provider;
    const models = await this.discoverModels();
    return models.filter((model) => model.provider === normalized);
  }

  async fetchGitHubModels() {
    const response = await fetchFn('https://models.inference.ai.azure.com/models');
    if (!response.ok) {
      throw new Error(`GitHub model list failed: ${response.status}`);
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }
    return data.map((model) => ({
      id: model.name,
      name: model.friendlyName || model.name,
      provider: 'github',
      type: 'remote',
      capabilities: Array.isArray(model.capabilities) ? model.capabilities : [],
      description: model.description || '',
    }));
  }

  async fetchFoundryModels() {
    if (this.orchestrator && typeof this.orchestrator.listModels === 'function') {
      try {
        const ids = await this.orchestrator.listModels();
        return (ids || []).map((id) => ({
          id,
          name: id,
          provider: 'foundry-local',
          type: 'local',
          capabilities: ['text', 'code'],
        }));
      } catch {
        // Fall through to CLI parsing.
      }
    }

    try {
      const { stdout } = await execPromise('foundry model ls');
      return this.parseFoundryModelList(stdout);
    } catch {
      return [];
    }
  }

  parseFoundryModelList(output) {
    const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts.length < 2) {
          return null;
        }
        const [id, ...rest] = parts;
        return {
          id,
          name: id,
          provider: 'foundry-local',
          type: 'local',
          description: rest.join(' '),
        };
      })
      .filter(Boolean);
  }

  async fetchOllamaModels() {
    try {
      const response = await fetchFn('http://localhost:11434/api/tags');
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return (data.models || []).map((model) => ({
        id: model.name,
        name: model.name,
        provider: 'ollama',
        type: 'local',
        capabilities: ['text', 'code'],
      }));
    } catch {
      return [];
    }
  }

  async addModel(modelId) {
    const manager = this.orchestrator?.modelManager;
    if (!manager || typeof manager.setModel !== 'function') {
      vscode?.window.showWarningMessage('Model switching is unavailable in this runtime.');
      return;
    }

    if (manager.config?.models?.chat) manager.setModel('chat', modelId);
    if (manager.config?.models?.reasoning) manager.setModel('reasoning', modelId);
    if (manager.config?.models?.coding) manager.setModel('coding', modelId);
    if (manager.config?.models?.fileAnalysis) manager.setModel('fileAnalysis', modelId);
    vscode?.window.showInformationMessage(`Model ${modelId} applied to active roles.`);
  }

  async compareModels(modelIds) {
    const selected = Array.isArray(modelIds) ? modelIds.filter(Boolean) : [];
    if (selected.length < 2) {
      vscode?.window.showWarningMessage('Select at least two models to compare.');
      return;
    }
    vscode?.window.showInformationMessage(`Selected for comparison: ${selected.join(' vs ')}`);
  }

  async openInPlayground(modelId) {
    await this.context.workspaceState.update('aiCopilot.playground.modelHint', modelId || '');
    await vscode.commands.executeCommand('ai-copilot.openPlayground');
  }

  getCatalogHtml(models) {
    const cards = models.map((model) => this.renderModelCard(model)).join('');
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 20px; }
    .model-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
    .model-card { border: 1px solid #ccc; border-radius: 8px; padding: 16px; }
    .model-name { font-size: 18px; font-weight: bold; margin-bottom: 8px; }
    .model-provider { color: #666; font-size: 14px; margin-bottom: 8px; }
    .model-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
    .badge-local { background: #e3f2fd; color: #1976d2; }
    .badge-remote { background: #f3e5f5; color: #7b1fa2; }
    .filter-bar { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  </style>
</head>
<body>
  <h1>AI Model Catalog</h1>
  <div class="filter-bar">
    <select id="providerFilter"><option value="">All Providers</option><option value="github">GitHub</option><option value="foundry-local">Foundry Local</option><option value="ollama">Ollama</option></select>
    <select id="typeFilter"><option value="">All Types</option><option value="local">Local</option><option value="remote">Remote</option></select>
    <button onclick="refreshModels()">Refresh</button>
    <button onclick="compareModels()">Compare Selected</button>
  </div>
  <div class="model-grid" id="modelGrid">${cards}</div>
  <script>
    const vscode = acquireVsCodeApi();
    function addModel(modelId) { vscode.postMessage({ command: 'addModel', model: modelId }); }
    function compareModels() {
      const selected = Array.from(document.querySelectorAll('.model-select:checked')).map((cb) => cb.value);
      vscode.postMessage({ command: 'compareModels', models: selected });
    }
    function tryInPlayground(modelId) { vscode.postMessage({ command: 'tryInPlayground', model: modelId }); }
    function refreshModels() { vscode.postMessage({ command: 'refreshCatalog' }); }
    function filterModels() {
      const provider = document.getElementById('providerFilter').value;
      const type = document.getElementById('typeFilter').value;
      document.querySelectorAll('.model-card').forEach((card) => {
        const matchProvider = !provider || card.dataset.provider === provider;
        const matchType = !type || card.dataset.type === type;
        card.style.display = matchProvider && matchType ? 'block' : 'none';
      });
    }
    document.getElementById('providerFilter').addEventListener('change', filterModels);
    document.getElementById('typeFilter').addEventListener('change', filterModels);
  </script>
</body>
</html>`;
  }

  renderModelCard(model) {
    const modelId = escapeJsString(model.id);
    const capabilities = (model.capabilities || [])
      .map((cap) => `<span style="background:#f5f5f5;padding:2px 6px;border-radius:4px;margin-right:4px;">${escapeHtml(cap)}</span>`)
      .join('');

    return `
      <div class="model-card" data-provider="${escapeHtml(model.provider)}" data-type="${escapeHtml(model.type)}">
        <div class="model-name">${escapeHtml(model.name)}</div>
        <div class="model-provider">${escapeHtml(model.provider)}</div>
        <span class="model-badge badge-${escapeHtml(model.type)}">${escapeHtml(model.type)}</span>
        <div style="margin-top:8px;">${capabilities}</div>
        <div style="margin-top:12px;">
          <button onclick="addModel('${modelId}')">Add Model</button>
          <button onclick="tryInPlayground('${modelId}')">Try in Playground</button>
          <input type="checkbox" class="model-select" value="${escapeHtml(model.id)}" style="margin-left:8px;">
        </div>
      </div>
    `;
  }
}

class AIToolkitViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
  }

  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = `<!DOCTYPE html><html><body>
      <h3>AI Toolkit</h3>
      <button onclick="openCatalog()">Model Catalog</button>
      <button onclick="openPlayground()">Playground</button>
      <script>
        const vscode = acquireVsCodeApi();
        function openCatalog() { vscode.postMessage({ command: 'openCatalog' }); }
        function openPlayground() { vscode.postMessage({ command: 'openPlayground' }); }
      </script>
    </body></html>`;

    const disposable = webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'openCatalog') {
        await vscode.commands.executeCommand('ai-copilot.openModelCatalog');
      } else if (message.command === 'openPlayground') {
        await vscode.commands.executeCommand('ai-copilot.openPlayground');
      }
    });

    webviewView.onDidDispose(() => disposable.dispose());
  }
}

module.exports = AIToolkitIntegration;
module.exports.AIToolkitIntegration = AIToolkitIntegration;
module.exports.ModelCatalog = ModelCatalog;
module.exports.escapeHtml = escapeHtml;
module.exports.escapeJsString = escapeJsString;
