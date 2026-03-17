'use strict';

const path = require('path');
const fs = require('fs').promises;
const { MCPServerManager } = require('./mcp-server-manager');

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
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

class AgentBuilder {
  constructor(orchestrator, context = null) {
    this.orchestrator = orchestrator;
    this.context = context;
    this.mcpManager = new MCPServerManager(orchestrator, context);
    this.agents = new Map();
  }

  async createAgent() {
    if (!vscode) return;
    const panel = vscode.window.createWebviewPanel(
      'agentBuilder',
      'Build AI Agent',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const models = await this.getAvailableModels();
    const mcpServers = await this.mcpManager.getAvailableServers();
    panel.webview.html = this.getAgentBuilderHtml(models, mcpServers);

    const disposable = panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'saveAgent':
          await this.saveAgent(message.agent);
          break;
        case 'testAgent':
          await this.testAgent(panel, message);
          break;
        case 'addMCPServer': {
          await this.mcpManager.addServer(message.server);
          panel.webview.postMessage({ command: 'mcpServerAdded' });
          break;
        }
        case 'toggleMCPServer': {
          await this.mcpManager.toggleServer(message.serverId);
          panel.webview.postMessage({ command: 'mcpServerAdded' });
          break;
        }
        case 'exportAgent':
          await this.exportAgent(message.agentId);
          break;
        default:
          break;
      }
    });

    panel.onDidDispose(() => disposable.dispose());
  }

  async getAvailableModels() {
    const fallback = [{ id: 'default', name: 'Default (auto)' }];
    try {
      const ids = await this.orchestrator.listModels();
      if (!Array.isArray(ids) || ids.length === 0) {
        return fallback;
      }
      return ids.map((id) => ({ id, name: id }));
    } catch {
      return fallback;
    }
  }

  renderMCPServerCard(server) {
    const tools = (server.tools || [])
      .map((t) => `<li>${escapeHtml(t.name)} - ${escapeHtml(t.description)}</li>`)
      .join('');
    const id = escapeJsString(server.id);
    const checked = server.connected ? 'checked' : '';
    return `
      <div class="mcp-server-card">
        <div class="header">
          <span class="name">${escapeHtml(server.name)}</span>
          <span class="status ${server.connected ? 'connected' : 'disconnected'}">${server.connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div>${escapeHtml(server.description || '')}</div>
        <label><input type="checkbox" class="mcp-server-check" value="${escapeHtml(server.id)}" ${checked}> Enabled</label>
        <div class="tool-list"><strong>Tools:</strong><ul>${tools || '<li>No tools available</li>'}</ul></div>
        <button class="btn btn-secondary" onclick="toggleMCPServer('${id}')">${server.connected ? 'Disconnect' : 'Connect'}</button>
      </div>`;
  }

  getAgentBuilderHtml(models, mcpServers) {
    const modelOptions = models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
    const mcpCards = mcpServers.map((server) => this.renderMCPServerCard(server)).join('');
    return `<!DOCTYPE html><html><head><style>
      body { padding: 20px; font-family: -apple-system, sans-serif; }
      .builder-container { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
      .section { background: #f5f5f5; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
      .section-title { font-size: 18px; font-weight: bold; margin-bottom: 16px; color: #007acc; }
      .form-group { margin-bottom: 16px; }
      label { display: block; margin-bottom: 6px; font-weight: 500; }
      input[type="text"], select, textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
      .variable-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
      .variable-row input { flex: 1; }
      .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
      .btn-primary { background: #007acc; color: white; } .btn-secondary { background: #6c757d; color: white; } .btn-success { background: #28a745; color: white; }
      .mcp-server-card { background: white; border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 10px; }
      .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .status.connected { background: #d4edda; color: #155724; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
      .status.disconnected { background: #f8d7da; color: #721c24; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
      .test-panel { grid-column: span 2; background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; }
      .test-messages { height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px; padding: 16px; margin-bottom: 16px; }
      .test-input { display: flex; gap: 10px; }
      .test-input input { flex: 1; padding: 8px; }
    </style></head><body>
    <h1>Build AI Agent</h1>
    <div class="builder-container">
      <div class="section">
        <div class="section-title">Basic Configuration</div>
        <div class="form-group"><label>Agent Name</label><input type="text" id="agentName" placeholder="e.g., CustomerSupportAgent"></div>
        <div class="form-group"><label>Base Model</label><select id="modelSelect">${modelOptions}</select></div>
        <div class="form-group"><label>System Instructions</label><textarea id="systemInstructions" rows="8" placeholder="Define your agent's behavior..."></textarea></div>
      </div>
      <div class="section">
        <div class="section-title">Variables</div>
        <div id="variablesContainer"><div class="variable-row"><input type="text" placeholder="Variable name (e.g., user_name)"><input type="text" placeholder="Default value"><button class="btn btn-secondary" onclick="removeVariable(this)">×</button></div></div>
        <button class="btn btn-secondary" onclick="addVariable()">+ Add Variable</button>
        <div class="section-title" style="margin-top: 30px;">MCP Servers</div>
        <div id="mcpServers">${mcpCards}</div>
        <button class="btn btn-secondary" onclick="showAddMCPServer()">+ Add MCP Server</button>
      </div>
      <div class="test-panel">
        <div class="section-title">Test Your Agent</div>
        <div class="test-messages" id="testMessages"><div class="message">Ready to test your agent...</div></div>
        <div class="test-input"><input type="text" id="testInput" placeholder="Type a test message..." onkeypress="if(event.key==='Enter') testAgent()"><button class="btn btn-primary" onclick="testAgent()">Send</button></div>
      </div>
    </div>
    <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
      <button class="btn btn-secondary" onclick="saveAgent()">Save Agent</button>
      <button class="btn btn-success" onclick="exportAgent()">Export Code</button>
    </div>
    <script>
      const vscode = acquireVsCodeApi(); let testMessages = [];
      function addVariable(){ const c=document.getElementById('variablesContainer'); const r=document.createElement('div'); r.className='variable-row'; r.innerHTML='<input type="text" placeholder="Variable name (e.g., user_name)"><input type="text" placeholder="Default value"><button class="btn btn-secondary" onclick="removeVariable(this)">×</button>'; c.appendChild(r); }
      function removeVariable(btn){ btn.parentElement.remove(); }
      function showAddMCPServer(){ const serverConfig = prompt('Enter MCP server command or URL:'); if(serverConfig){ vscode.postMessage({ command:'addMCPServer', server:{ config: serverConfig } }); } }
      function toggleMCPServer(serverId){ vscode.postMessage({ command:'toggleMCPServer', serverId }); }
      function addTestMessage(role, content){ const d=document.getElementById('testMessages'); const m=document.createElement('div'); m.className='message '+role+'-message'; m.textContent=role+': '+content; d.appendChild(m); d.scrollTop=d.scrollHeight; testMessages.push({ role, content }); }
      function getVariables(){ const vars=[]; document.querySelectorAll('.variable-row').forEach((row)=>{ const inputs=row.querySelectorAll('input'); if(inputs[0].value){ vars.push({ name: inputs[0].value, value: inputs[1].value }); } }); return vars; }
      function getSelectedMCPServers(){ return Array.from(document.querySelectorAll('.mcp-server-check:checked')).map((el)=>el.value); }
      function testAgent(){ const input=document.getElementById('testInput'); const message=input.value.trim(); if(!message) return; addTestMessage('user', message); input.value=''; const agent={ name:document.getElementById('agentName').value, model:document.getElementById('modelSelect').value, instructions:document.getElementById('systemInstructions').value, variables:getVariables() }; vscode.postMessage({ command:'testAgent', message, agent, history:testMessages }); }
      function saveAgent(){ const agent={ name:document.getElementById('agentName').value, model:document.getElementById('modelSelect').value, instructions:document.getElementById('systemInstructions').value, variables:getVariables(), mcpServers:getSelectedMCPServers() }; vscode.postMessage({ command:'saveAgent', agent }); }
      function exportAgent(){ vscode.postMessage({ command:'exportAgent', agentId:document.getElementById('agentName').value }); }
      window.addEventListener('message', (event)=>{ const msg=event.data; if(msg.command==='testResponse') addTestMessage('assistant', msg.response); if(msg.command==='mcpServerAdded') location.reload(); });
    </script></body></html>`;
  }

  async saveAgent(agentConfig) {
    const rawName = String(agentConfig?.name || '').trim();
    if (!rawName) {
      throw new Error('Agent name is required.');
    }
    const agentId = rawName.toLowerCase().replace(/\s+/g, '-');
    const agent = { id: agentId, ...agentConfig, created: Date.now(), versions: [] };
    this.agents.set(agentId, agent);
    const agentsDir = path.join(__dirname, '../../agents');
    await fs.mkdir(agentsDir, { recursive: true });
    const agentPath = path.join(agentsDir, `${agentId}.json`);
    await fs.writeFile(agentPath, JSON.stringify(agent, null, 2), 'utf8');
    vscode?.window.showInformationMessage(`Agent ${rawName} saved successfully.`);
  }

  async testAgent(panel, message) {
    try {
      const prompt = String(message?.message || '').trim();
      if (!prompt) throw new Error('Test message is required.');
      const result = await this.orchestrator.process(prompt, this.orchestrator.createSession({ interface: 'agent-builder-test' }), { agent: 'reasoning' });
      const response = typeof result.response === 'string' ? result.response : JSON.stringify(result.response, null, 2);
      panel.webview.postMessage({ command: 'testResponse', response });
    } catch (error) {
      panel.webview.postMessage({ command: 'testResponse', response: `Error: ${error.message}` });
    }
  }

  async exportAgent(agentId) {
    const id = String(agentId || '').toLowerCase().trim();
    const agent = this.agents.get(id);
    if (!agent) {
      vscode?.window.showErrorMessage('Agent not found.');
      return;
    }

    const sdk = await vscode.window.showQuickPick(
      ['Azure AI Inference SDK', 'OpenAI SDK', 'Custom HTTP'],
      { placeHolder: 'Select SDK for export' }
    );
    if (!sdk) return;

    const language = await vscode.window.showQuickPick(
      ['JavaScript', 'Python'],
      { placeHolder: 'Select programming language' }
    );
    if (!language) return;

    const fileContent = this.generateCodeFile(agent, sdk, language);
    const ext = language === 'Python' ? 'py' : 'js';
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${id}-agent.${ext}`),
      filters: { 'Code files': [ext] },
    });
    if (!uri) return;
    await fs.writeFile(uri.fsPath, fileContent, 'utf8');
    await vscode.window.showTextDocument(uri);
  }

  generateCodeFile(agent, sdk, language) {
    return language === 'Python'
      ? this.generatePythonCode(agent, sdk)
      : this.generateJavaScriptCode(agent, sdk);
  }

  generateJavaScriptCode(agent, sdk) {
    const base = `// ${agent.name} AI Agent\n// Generated for ${sdk}\n`;
    return `${base}
import dotenv from 'dotenv';
dotenv.config();

async function callAgent(message, history = []) {
  const body = {
    messages: [
      { role: 'system', content: \`${escapeJsString(agent.instructions || '')}\` },
      ...history,
      { role: 'user', content: message }
    ],
    model: '${escapeJsString(agent.model || 'default')}'
  };

  const response = await fetch(process.env.API_URL || 'http://localhost:5272/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export { callAgent };
`;
  }

  generatePythonCode(agent, sdk) {
    return `# ${agent.name} AI Agent\n# Generated for ${sdk}\nimport os\nimport requests\n\ndef call_agent(message, history=None):\n    history = history or []\n    payload = {\n        "messages": [\n            {"role": "system", "content": """${String(agent.instructions || '').replace(/"""/g, '\\"\\"\\"')}"""},\n            *history,\n            {"role": "user", "content": message}\n        ],\n        "model": "${escapeJsString(agent.model || 'default')}"\n    }\n    url = os.getenv("API_URL", "http://localhost:5272/v1/chat/completions")\n    res = requests.post(url, json=payload, timeout=60)\n    res.raise_for_status()\n    data = res.json()\n    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "")\n`;
  }
}

module.exports = AgentBuilder;
module.exports.AgentBuilder = AgentBuilder;
