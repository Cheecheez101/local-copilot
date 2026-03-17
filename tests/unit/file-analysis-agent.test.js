'use strict';

const { FileAnalysisAgent } = require('../../src/agents/file-analysis-agent');

describe('FileAnalysisAgent directory analysis limits', () => {
  it('truncates large directory listings to avoid oversized prompts', async () => {
    let userPrompt = '';
    const modelMgr = {
      chat: jest.fn().mockResolvedValue('ok'),
    };
    const ctxMgr = {
      setSystemPrompt: jest.fn(),
      addMessage: jest.fn((sessionId, role, content) => {
        if (role === 'user') userPrompt = content;
      }),
      getHistory: jest.fn(() => [{ role: 'user', content: userPrompt }]),
    };

    const generatedFiles = [];
    for (let i = 0; i < 1200; i += 1) {
      generatedFiles.push(`C:\\repo\\src\\file-${i}.js`);
    }
    generatedFiles.push('C:\\repo\\node_modules\\lib\\index.js');

    const fileHndlr = {
      listDirectory: jest.fn().mockReturnValue(generatedFiles),
      getMetadata: jest.fn().mockImplementation((f) => ({ isFile: true, size: 100 + String(f).length })),
      detectLanguage: jest.fn().mockReturnValue('javascript'),
    };

    const agent = new FileAnalysisAgent(modelMgr, ctxMgr, fileHndlr);
    await agent.analyzeDirectory('C:\\repo', 's1');

    expect(modelMgr.chat).toHaveBeenCalled();
    expect(userPrompt.length).toBeLessThan(18000);
    expect(userPrompt).toContain('Omitted from listing due to limits');
    expect(userPrompt).not.toContain('node_modules');
  });
});
