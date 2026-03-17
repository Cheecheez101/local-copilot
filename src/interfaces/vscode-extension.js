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

/**
 * Initialise the shared orchestrator + session used across all commands.
 */
function initOrchestrator() {
  if (!orchestrator) {
    const modelMgr = new ModelManager();
    const ctxMgr = new ContextManager();
    orchestrator = new Orchestrator({}, modelMgr, ctxMgr);
    sessionId = orchestrator.createSession({ interface: 'vscode' });
  }
}

/**
 * Show output in the dedicated VS Code output channel.
 * @param {string} text
 */
function showOutput(text) {
  if (outputChannel) {
    outputChannel.appendLine(text);
    outputChannel.show(true);
  } else {
    console.log(text);
  }
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
    return code;
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
    return text;
  });
}

async function cmdClearHistory() {
  initOrchestrator();
  orchestrator.clearHistory(sessionId);
  vscode && vscode.window.showInformationMessage('Local AI Co-Pilot: Conversation history cleared.');
  showOutput('--- History cleared ---');
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

  outputChannel = vscode.window.createOutputChannel('Local AI Co-Pilot');
  outputChannel.appendLine('Local AI Dev Co-Pilot activated.');

  const commands = [
    ['localCopilot.explain', cmdExplain],
    ['localCopilot.review', cmdReview],
    ['localCopilot.refactor', cmdRefactor],
    ['localCopilot.generate', cmdGenerateCode],
    ['localCopilot.ask', cmdAsk],
    ['localCopilot.clearHistory', cmdClearHistory],
  ];

  for (const [id, handler] of commands) {
    const disposable = vscode.commands.registerCommand(id, handler);
    context.subscriptions.push(disposable);
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
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = null;
  }
}

module.exports = { activate, deactivate };
