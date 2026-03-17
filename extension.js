'use strict';

const path = require('path');
const fs = require('fs').promises;

let vscode;
try {
  vscode = require('vscode');
} catch {
  vscode = null;
}

const { AIToolkitIntegration } = require('./src/vscode/ai-toolkit-integration');
const { AgentEvaluator } = require('./src/evaluation/agent-evaluator');
const LocalAICopilot = require('./src/index');
const { validateStartupEnv } = require('./src/utils/startup-validation');

let copilot;
let toolkitIntegration;

async function activate(context) {
  if (!vscode) return;
  const env = validateStartupEnv();
  if (env.errors.length || env.warnings.length) {
    vscode.window.showWarningMessage(`Local AI startup validation: ${[...env.errors, ...env.warnings].join(' | ')}`);
  }
  copilot = new LocalAICopilot();
  await copilot.start('headless');
  toolkitIntegration = new AIToolkitIntegration(context, copilot.orchestrator);
  registerCommands(context);
  vscode.window.showInformationMessage('Local AI Dev Co-Pilot is ready!');
}

function registerCommands(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('ai-copilot.openModelCatalog', () => toolkitIntegration.modelCatalog.show()),
    vscode.commands.registerCommand('ai-copilot.openPlayground', () => toolkitIntegration.playground.show()),
    vscode.commands.registerCommand('ai-copilot.createAgent', () => toolkitIntegration.agentBuilder.createAgent()),
    vscode.commands.registerCommand('ai-copilot.evaluateAgent', async () => {
      const agents = await getAgents();
      const selectedName = await vscode.window.showQuickPick(
        agents.map((a) => a.name),
        { placeHolder: 'Select agent to evaluate' }
      );
      if (!selectedName) return;
      const agent = agents.find((a) => a.name === selectedName);
      if (!agent) return;
      const evaluator = new AgentEvaluator(copilot.orchestrator);
      const testCases = await evaluator.generateTestData(agent, 10);
      const results = await evaluator.evaluateAgent(agent, testCases);
      const values = Object.values(results.scores);
      const overall = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      showEvaluationResults({ overall, metrics: results.scores, testCount: results.testCases, timestamp: results.timestamp });
    }),
    vscode.commands.registerCommand('ai-copilot.addMCPServer', async () => {
      const config = await vscode.window.showInputBox({
        prompt: 'Enter MCP server command or URL',
        placeHolder: 'npx playwright-mcp-server or http://localhost:3000/mcp',
      });
      if (config) {
        await toolkitIntegration.agentBuilder.mcpManager.addServer(config);
        vscode.window.showInformationMessage('MCP server added successfully!');
      }
    }),
    vscode.commands.registerCommand('ai-copilot.createMCPServer', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter MCP server name',
        placeHolder: 'weather-mcp-server',
      });
      if (!name) return;
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders?.length) return;
      const projectPath = path.join(workspaceFolders[0].uri.fsPath, name);
      await toolkitIntegration.agentBuilder.mcpManager.createNewMCPServer(projectPath, name);
      const open = await vscode.window.showInformationMessage('MCP server created! Open it now?', 'Open');
      if (open) {
        const uri = vscode.Uri.file(projectPath);
        await vscode.commands.executeCommand('vscode.openFolder', uri);
      }
    }),
    vscode.commands.registerCommand('ai-copilot.exportAgent', async () => {
      const agents = await getAgents();
      const selectedName = await vscode.window.showQuickPick(
        agents.map((a) => a.name),
        { placeHolder: 'Select agent to export' }
      );
      if (!selectedName) return;
      const agent = agents.find((a) => a.name === selectedName);
      if (agent) {
        await toolkitIntegration.agentBuilder.exportAgent(agent.id);
      }
    })
  );
}

async function getAgents() {
  const agentsPath = path.join(__dirname, 'agents');
  try {
    const files = await fs.readdir(agentsPath);
    const agents = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(agentsPath, file), 'utf8');
      agents.push(JSON.parse(content));
    }
    return agents;
  } catch {
    return [];
  }
}

function showEvaluationResults(results) {
  const panel = vscode.window.createWebviewPanel('evaluationResults', 'Agent Evaluation Results', vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = getEvaluationHtml(results);
}

function getEvaluationHtml(results) {
  return `<!DOCTYPE html><html><head><style>
    body { padding: 20px; font-family: -apple-system, sans-serif; }
    .score-card { background: #f5f5f5; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .metric { display: flex; justify-content: space-between; margin-bottom: 10px; padding: 8px; background: white; border-radius: 4px; }
    .metric-name { font-weight: 500; } .metric-value { font-weight: bold; color: #007acc; }
    .good { color: #28a745; } .medium { color: #ffc107; } .poor { color: #dc3545; }
  </style></head><body>
    <h1>Agent Evaluation Results</h1>
    <div class="score-card">
      <h3>Overall Score: ${((results.overall || 0) * 100).toFixed(1)}%</h3>
      ${Object.entries(results.metrics || {}).map(([name, score]) => `
        <div class="metric">
          <span class="metric-name">${name}:</span>
          <span class="metric-value ${score > 0.7 ? 'good' : score > 0.4 ? 'medium' : 'poor'}">${(score * 100).toFixed(1)}%</span>
        </div>`).join('')}
    </div>
    <h3>Test Cases: ${results.testCount || 0}</h3>
    <p>Evaluated at: ${new Date(results.timestamp || Date.now()).toLocaleString()}</p>
  </body></html>`;
}

function deactivate() {
  if (copilot) {
    copilot.stop();
  }
}

module.exports = { activate, deactivate };
