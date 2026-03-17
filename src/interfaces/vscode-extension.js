'use strict';

/**
 * vscode-extension.js
 *
 * VS Code extension entry point for the Local AI Dev Co-Pilot.
 *
 * This file exports the standard `activate` and `deactivate` lifecycle hooks
 * expected by VS Code. When the extension is loaded it registers a set of
 * commands that surface the multi-agent system directly inside the editor.
 *
 * NOTE: `vscode` is a virtual module provided at runtime by the VS Code
 * extension host. It is NOT available in Node.js outside VS Code, so all
 * references are guarded behind the `vscode` variable that is only assigned
 * when the module is required in the correct environment.
 */

const { Orchestrator } = require('../core/orchestrator');
const { ModelManager } = require('../core/model-manager');
const { ContextManager } = require('../core/context-manager');
const { SuggestionAgent } = require('../agents/suggestion-agent');
const { AIToolkitIntegration } = require('../vscode/ai-toolkit-integration');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const { validateStartupEnv } = require('../utils/startup-validation');
const { redactSecrets } = require('../utils/logger');
const { VS_QUICK_ACTIONS } = require('../config/command-spec');

const execAsync = util.promisify(exec);

let vscode;
try {
  vscode = require('vscode');
} catch {
  // Running outside of VS Code (e.g. in tests)
  vscode = null;
}

let orchestrator = null;
let sessionId = null;
let outputChannel = null;
let toolkitIntegration = null;
let suggestionAgent = null;
let testOnSaveEnabled = false;
let testOnSaveDisposable = null;

function ensureOutputChannel() {
  if (!vscode) return null;
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Local AI Co-Pilot');
  }
  return outputChannel;
}

/**
 * Initialise the shared orchestrator + session used across all commands.
 */
function initOrchestrator() {
  if (!orchestrator) {
    const modelMgr = new ModelManager();
    const ctxMgr = new ContextManager();
    orchestrator = new Orchestrator({}, modelMgr, ctxMgr);
    suggestionAgent = new SuggestionAgent(ctxMgr);
    sessionId = orchestrator.createSession({ interface: 'vscode' });
  }
}

function buildLastAction(agent, response) {
  if (agent === 'fileAnalysis' && response && Array.isArray(response.files)) {
    return { type: 'FILE_LIST', result: response };
  }
  return { type: 'AGENT_RESULT', agent, result: response };
}

function showSuggestions(agent, response) {
  if (!suggestionAgent) return;
  const suggestions = suggestionAgent.suggestNextAction(buildLastAction(agent, response));
  if (!Array.isArray(suggestions) || suggestions.length === 0) return;
  showOutput('--- Suggestions ---');
  for (const suggestion of suggestions) {
    showOutput(`• ${suggestion.text}`);
    if (Array.isArray(suggestion.actions)) {
      for (const action of suggestion.actions) {
        showOutput(`  - ${action}`);
      }
    } else if (suggestion.action) {
      showOutput(`  - ${suggestion.action}`);
    }
  }
}

/**
 * Show output in the dedicated VS Code output channel.
 * @param {string} text
 */
function showOutput(text) {
  const channel = ensureOutputChannel();
  if (channel) {
    channel.appendLine(text);
    channel.show(true);
  } else {
    console.log(text);
  }
}

function safeOutput(data) {
  showOutput(typeof data === 'string' ? data : JSON.stringify(redactSecrets(data), null, 2));
}

/**
 * Generic wrapper that shows a progress notification, calls the agent, and
 * displays the result in the output channel.
 *
 * @param {string}   title   - Progress notification title.
 * @param {Function} task    - Async function that returns the result string.
 */
async function withProgress(title, task) {
  if (!vscode) {
    return task();
  }

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Local AI Co-Pilot: ${title}`,
      cancellable: false,
    },
    async () => {
      const result = await task();
      return result;
    }
  );
}

/**
 * Get the text currently selected in the active editor.
 * @returns {string} Selected text or empty string.
 */
function getSelectedText() {
  if (!vscode) return '';
  const editor = vscode.window.activeTextEditor;
  if (!editor) return '';
  const selection = editor.selection;
  return editor.document.getText(selection);
}

/**
 * Get the full text of the active editor document.
 * @returns {string}
 */
function getActiveDocumentText() {
  if (!vscode) return '';
  const editor = vscode.window.activeTextEditor;
  if (!editor) return '';
  return editor.document.getText();
}

/**
 * Get the language ID of the active editor document.
 * @returns {string}
 */
function getActiveLanguage() {
  if (!vscode) return 'javascript';
  const editor = vscode.window.activeTextEditor;
  if (!editor) return 'javascript';
  return editor.document.languageId;
}

/**
 * Insert text at the current cursor position in the active editor.
 * @param {string} text
 */
async function insertAtCursor(text) {
  if (!vscode) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  await editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, text);
  });
}

function getWorkspaceRoot() {
  if (!vscode?.workspace?.workspaceFolders?.length) {
    return process.cwd();
  }
  return vscode.workspace.workspaceFolders[0].uri.fsPath;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function cmdExplain() {
  initOrchestrator();
  const code = getSelectedText() || getActiveDocumentText();
  const language = getActiveLanguage();

  if (!code) {
    vscode && vscode.window.showWarningMessage('Local AI Co-Pilot: No code selected or open file is empty.');
    return;
  }

  showOutput('--- Explain Code ---');
  await withProgress('Explaining code…', async () => {
    const result = await orchestrator.process(
      `Explain what this ${language} code does`,
      sessionId,
      { agent: 'reasoning' }
    );
    const text = typeof result.response === 'string' ? result.response : JSON.stringify(result.response, null, 2);
    showOutput(text);
    showSuggestions(result.agent, result.response);
    return text;
  });
}

async function cmdReview() {
  initOrchestrator();
  const code = getSelectedText() || getActiveDocumentText();
  const language = getActiveLanguage();

  if (!code) {
    vscode && vscode.window.showWarningMessage('Local AI Co-Pilot: No code to review.');
    return;
  }

  showOutput('--- Code Review ---');
  await withProgress('Reviewing code…', async () => {
    const result = await orchestrator.process('review code', sessionId, {
      agent: 'coding',
      code,
      language,
    });
    const text = typeof result.response === 'string' ? result.response
      : result.response.explanation || JSON.stringify(result.response, null, 2);
    showOutput(text);
    showSuggestions(result.agent, result.response);
    return text;
  });
}

async function cmdRefactor() {
  initOrchestrator();
  if (!vscode) return;

  const code = getSelectedText() || getActiveDocumentText();
  const language = getActiveLanguage();

  if (!code) {
    vscode.window.showWarningMessage('Local AI Co-Pilot: No code to refactor.');
    return;
  }

  const goal = await vscode.window.showInputBox({
    prompt: 'Refactoring goal (optional)',
    placeHolder: 'e.g. improve readability, reduce complexity',
  });

  showOutput('--- Refactor Code ---');
  await withProgress('Refactoring…', async () => {
    const result = await orchestrator.process(`refactor ${goal || ''}`, sessionId, {
      agent: 'coding',
      code,
      language,
    });
    const text = result.response.explanation || result.response.code || JSON.stringify(result.response, null, 2);
    showOutput(text);
    showSuggestions(result.agent, result.response);
    return text;
  });
}

async function cmdGenerateCode() {
  initOrchestrator();
  if (!vscode) return;

  const description = await vscode.window.showInputBox({
    prompt: 'Describe the code to generate',
    placeHolder: 'e.g. A function that validates an email address',
  });

  if (!description) return;

  const language = getActiveLanguage();

  showOutput('--- Generate Code ---');
  await withProgress('Generating code…', async () => {
    const result = await orchestrator.process(description, sessionId, {
      agent: 'coding',
      language,
    });
    const code = result.response.code || '';
    if (code) {
      await insertAtCursor('\n' + code + '\n');
    }
    showOutput(result.response.explanation || code);
    showSuggestions(result.agent, result.response);
    return code;
  });
}

async function cmdAnalyzeDirectory() {
  initOrchestrator();
  if (!vscode) return;

  const root = getWorkspaceRoot();
  const dirInput = await vscode.window.showInputBox({
    prompt: 'Directory path to analyze',
    placeHolder: 'e.g. . or src',
    value: root,
  });

  if (!dirInput) return;
  const dirPath = path.isAbsolute(dirInput) ? dirInput : path.resolve(root, dirInput);

  showOutput(`--- Analyze Directory: ${dirPath} ---`);
  await withProgress('Analyzing directory…', async () => {
    const result = await orchestrator.process('analyze directory', sessionId, {
      agent: 'fileAnalysis',
      dirPath,
    });
    const text = typeof result.response === 'string'
      ? result.response
      : JSON.stringify(result.response, null, 2);
    showOutput(text);
    showSuggestions(result.agent, result.response);
    return text;
  });
}

async function cmdAsk() {
  initOrchestrator();
  if (!vscode) return;

  const question = await vscode.window.showInputBox({
    prompt: 'Ask the AI anything',
    placeHolder: 'e.g. How do I implement a binary search tree?',
  });

  if (!question) return;

  showOutput(`--- Ask: ${question} ---`);
  await withProgress('Thinking…', async () => {
    const result = await orchestrator.process(question, sessionId);
    const text = typeof result.response === 'string' ? result.response : JSON.stringify(result.response, null, 2);
    showOutput(text);
    showSuggestions(result.agent, result.response);
    return text;
  });
}

async function cmdClearHistory() {
  initOrchestrator();
  orchestrator.clearHistory(sessionId);
  vscode && vscode.window.showInformationMessage('Local AI Co-Pilot: Conversation history cleared.');
  showOutput('--- History cleared ---');
}

async function cmdRunTests() {
  if (!vscode) return;
  const cwd = getWorkspaceRoot();
  showOutput('--- Run Tests ---');
  await withProgress('Running tests…', async () => {
    try {
      const command = process.platform === 'win32' ? 'npm.cmd test' : 'npm test';
      const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 1024 * 1024 * 20 });
      if (stdout) showOutput(stdout.trim());
      if (stderr) showOutput(stderr.trim());
      vscode.window.showInformationMessage('Local AI Co-Pilot: Tests completed.');
    } catch (error) {
      const details = error?.stderr || error?.stdout || error?.message || String(error);
      showOutput(details);
      vscode.window.showErrorMessage('Local AI Co-Pilot: Test run failed. See output channel.');
    }
  });
}

async function cmdGitStatus() {
  if (!vscode) return;
  const cwd = getWorkspaceRoot();
  showOutput('--- Git Status ---');
  await withProgress('Checking git status…', async () => {
    try {
      const { stdout } = await execAsync('git --no-pager status --short --branch && git --no-pager log -1 --oneline', {
        cwd,
        maxBuffer: 1024 * 1024 * 5,
      });
      showOutput(stdout.trim() || 'Repository is clean.');
    } catch (error) {
      const details = error?.stderr || error?.stdout || error?.message || String(error);
      showOutput(details);
      vscode.window.showErrorMessage('Local AI Co-Pilot: Git status failed. See output channel.');
    }
  });
}

async function cmdGitDiff() {
  if (!vscode) return;
  const cwd = getWorkspaceRoot();
  showOutput('--- Git Diff ---');
  await withProgress('Collecting git diff…', async () => {
    try {
      const { stdout } = await execAsync('git --no-pager diff -- . && git --no-pager diff --cached -- .', {
        cwd,
        maxBuffer: 1024 * 1024 * 20,
      });
      showOutput(stdout.trim() || 'No changes to diff.');
    } catch (error) {
      safeOutput({ error: error?.message, stderr: error?.stderr, stdout: error?.stdout });
      vscode.window.showErrorMessage('Local AI Co-Pilot: Git diff failed. See output channel.');
    }
  });
}

async function cmdDraftCommitMessage() {
  initOrchestrator();
  if (!vscode) return;
  const cwd = getWorkspaceRoot();
  showOutput('--- Draft Commit Message ---');
  await withProgress('Drafting commit message…', async () => {
    try {
      const { stdout } = await execAsync('git --no-pager diff --cached -- .', { cwd, maxBuffer: 1024 * 1024 * 20 });
      if (!stdout.trim()) {
        vscode.window.showWarningMessage('Stage changes first (git add ...) to draft a commit message.');
        return;
      }
      const result = await orchestrator.process(
        `Draft a concise conventional commit message from this staged diff:\n\n${stdout.slice(0, 20000)}`,
        sessionId,
        { agent: 'reasoning' }
      );
      const msg = typeof result.response === 'string' ? result.response : JSON.stringify(result.response, null, 2);
      showOutput(msg);
      await vscode.env.clipboard.writeText(msg);
      vscode.window.showInformationMessage('Commit message draft copied to clipboard.');
    } catch (error) {
      safeOutput({ error: error?.message, stderr: error?.stderr, stdout: error?.stdout });
      vscode.window.showErrorMessage('Local AI Co-Pilot: Commit draft failed. See output channel.');
    }
  });
}

function configureTestOnSave(context) {
  if (testOnSaveDisposable) {
    testOnSaveDisposable.dispose();
    testOnSaveDisposable = null;
  }
  if (!testOnSaveEnabled) return;
  testOnSaveDisposable = vscode.workspace.onDidSaveTextDocument(async () => {
    await cmdRunTests();
  });
  context.subscriptions.push(testOnSaveDisposable);
}

async function cmdToggleTestOnSave(context) {
  if (!vscode) return;
  testOnSaveEnabled = !testOnSaveEnabled;
  configureTestOnSave(context);
  vscode.window.showInformationMessage(`Local AI Co-Pilot: test-on-save ${testOnSaveEnabled ? 'enabled' : 'disabled'}.`);
}

async function cmdDiagnostics() {
  initOrchestrator();
  if (!vscode) return;
  const env = validateStartupEnv();
  const [available, models] = await Promise.all([
    orchestrator.isModelServiceAvailable().catch(() => false),
    orchestrator.listModels().catch(() => []),
  ]);
  const payload = { available, models, env, timestamp: new Date().toISOString() };
  const panel = vscode.window.createWebviewPanel('localCopilotDiagnostics', 'Local AI Diagnostics', vscode.ViewColumn.One, {});
  panel.webview.html = `<html><body><h2>Local AI Diagnostics</h2><pre>${JSON.stringify(redactSecrets(payload), null, 2)}</pre></body></html>`;
}

async function cmdQuickActions() {
  if (!vscode) return;
  const selected = await vscode.window.showQuickPick(VS_QUICK_ACTIONS, { placeHolder: 'Local AI quick actions' });
  if (selected?.command) {
    await vscode.commands.executeCommand(selected.command);
  }
}

// ---------------------------------------------------------------------------
// VS Code extension lifecycle
// ---------------------------------------------------------------------------

/**
 * Called by VS Code when the extension is activated.
 * @param {object} context - VS Code ExtensionContext.
 */
function activate(context) {
  if (!vscode) return;

  ensureOutputChannel();
  outputChannel.appendLine('Local AI Dev Co-Pilot activated.');
  const env = validateStartupEnv();
  if (env.errors.length || env.warnings.length) {
    safeOutput({ startupValidation: env });
  }

  const commands = [
    ['localCopilot.explain', cmdExplain],
    ['localCopilot.review', cmdReview],
    ['localCopilot.refactor', cmdRefactor],
    ['localCopilot.generate', cmdGenerateCode],
    ['localCopilot.analyzeDirectory', cmdAnalyzeDirectory],
    ['localCopilot.runTests', cmdRunTests],
    ['localCopilot.gitStatus', cmdGitStatus],
    ['localCopilot.gitDiff', cmdGitDiff],
    ['localCopilot.draftCommitMessage', cmdDraftCommitMessage],
    ['localCopilot.diagnostics', cmdDiagnostics],
    ['localCopilot.quickActions', cmdQuickActions],
    ['localCopilot.ask', cmdAsk],
    ['localCopilot.clearHistory', cmdClearHistory],
  ];

  for (const [id, handler] of commands) {
    const disposable = vscode.commands.registerCommand(id, handler);
    context.subscriptions.push(disposable);
  }
  context.subscriptions.push(vscode.commands.registerCommand('localCopilot.toggleTestOnSave', () => cmdToggleTestOnSave(context)));

  try {
    initOrchestrator();
    toolkitIntegration = new AIToolkitIntegration(context, orchestrator);
    orchestrator.isModelServiceAvailable().then((available) => {
      if (!available) {
        vscode.window.showWarningMessage('Local AI Co-Pilot: model service appears offline. Run diagnostics.');
      }
    }).catch(() => {
      vscode.window.showWarningMessage('Local AI Co-Pilot: startup self-check failed. Run diagnostics.');
    });
  } catch (error) {
    showOutput(`AI Toolkit integration failed to initialize: ${error.message}`);
    vscode.window.showWarningMessage('Local AI Co-Pilot: AI Toolkit integration was not initialized.');
  }

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(robot) Co-Pilot';
  statusBarItem.tooltip = 'Local AI Dev Co-Pilot';
  statusBarItem.command = 'localCopilot.ask';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

/**
 * Called by VS Code when the extension is deactivated.
 */
function deactivate() {
  orchestrator = null;
  sessionId = null;
  toolkitIntegration = null;
  suggestionAgent = null;
  testOnSaveEnabled = false;
  if (testOnSaveDisposable) {
    testOnSaveDisposable.dispose();
    testOnSaveDisposable = null;
  }
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = null;
  }
}

module.exports = { activate, deactivate };
