'use strict';

const { ModelCatalog, escapeHtml, escapeJsString } = require('../../src/vscode/ai-toolkit-integration');
const { Playground } = require('../../src/vscode/playground');

describe('VS Code toolkit helpers', () => {
  it('escapes HTML special chars', () => {
    expect(escapeHtml(`a<b>"'&`)).toBe('a&lt;b&gt;&quot;&#39;&amp;');
  });

  it('escapes JavaScript single-quoted strings', () => {
    expect(escapeJsString("x'\\\n")).toBe("x\\'\\\\\\n");
  });
});

describe('ModelCatalog', () => {
  it('parses foundry model output lines defensively', () => {
    const catalog = new ModelCatalog({}, {}, {});
    const models = catalog.parseFoundryModelList('phi4 ready\nqwen2.5-coder downloaded');
    expect(models).toEqual([
      expect.objectContaining({ id: 'phi4', provider: 'foundry-local', type: 'local' }),
      expect.objectContaining({ id: 'qwen2.5-coder', provider: 'foundry-local', type: 'local' }),
    ]);
  });
});

describe('Playground', () => {
  it('routes sendMessage through orchestrator and posts response', async () => {
    const orchestrator = {
      createSession: jest.fn().mockReturnValue('session-1'),
      process: jest.fn().mockResolvedValue({ response: 'ok-response' }),
      modelManager: {
        config: { models: { chat: { id: 'a' }, reasoning: { id: 'b' } } },
        setModel: jest.fn(),
      },
    };

    const playground = new Playground(orchestrator);
    const panel = {
      title: 'p1',
      webview: {
        postMessage: jest.fn(),
      },
    };

    await playground.handleMessage(panel, {
      message: 'hello',
      config: { model: 'new-model' },
    });

    expect(orchestrator.modelManager.setModel).toHaveBeenCalledWith('chat', 'new-model');
    expect(orchestrator.modelManager.setModel).toHaveBeenCalledWith('reasoning', 'new-model');
    expect(orchestrator.process).toHaveBeenCalledWith('hello', 'session-1', { agent: 'reasoning' });
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'response', response: 'ok-response' })
    );
  });
});
