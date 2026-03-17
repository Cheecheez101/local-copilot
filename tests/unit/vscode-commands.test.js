'use strict';

function createVscodeMock(registeredIds) {
  return {
    commands: {
      registerCommand: jest.fn((id, handler) => {
        registeredIds.push(id);
        return { dispose: jest.fn(), id, handler };
      }),
    },
    window: {
      createOutputChannel: jest.fn(() => ({
        appendLine: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
      })),
      withProgress: jest.fn(async (_opts, cb) => cb()),
      showWarningMessage: jest.fn(),
      showInformationMessage: jest.fn(),
      registerWebviewViewProvider: jest.fn(() => ({ dispose: jest.fn() })),
      createStatusBarItem: jest.fn(() => ({
        text: '',
        tooltip: '',
        command: '',
        show: jest.fn(),
        dispose: jest.fn(),
      })),
    },
    ProgressLocation: { Notification: 1 },
    StatusBarAlignment: { Right: 1 },
  };
}

describe('VS Code command registration', () => {
  it('registers required LocalCopilot and AI Toolkit commands on activate', async () => {
    jest.resetModules();
    const registeredIds = [];
    const vscodeMock = createVscodeMock(registeredIds);

    jest.doMock('vscode', () => vscodeMock, { virtual: true });
    // eslint-disable-next-line global-require
    const extension = require('../../src/interfaces/vscode-extension');

    const context = {
      subscriptions: [],
      extensionUri: { fsPath: 'C:\\mock' },
      workspaceState: { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) },
      globalState: { get: jest.fn(), update: jest.fn().mockResolvedValue(undefined) },
    };

    await extension.activate(context);

    const expected = [
      'localCopilot.explain',
      'localCopilot.review',
      'localCopilot.refactor',
      'localCopilot.generate',
      'localCopilot.analyzeDirectory',
      'localCopilot.runTests',
      'localCopilot.gitStatus',
      'localCopilot.gitDiff',
      'localCopilot.draftCommitMessage',
      'localCopilot.toggleTestOnSave',
      'localCopilot.diagnostics',
      'localCopilot.quickActions',
      'localCopilot.ask',
      'localCopilot.clearHistory',
      'ai-copilot.openModelCatalog',
      'ai-copilot.openPlayground',
      'ai-copilot.createAgent',
      'ai-copilot.evaluateAgent',
      'ai-copilot.exportAgent',
    ];

    for (const id of expected) {
      expect(registeredIds).toContain(id);
    }
  });
});
