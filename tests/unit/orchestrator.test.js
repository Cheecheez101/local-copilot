'use strict';

const { Orchestrator } = require('../../src/core/orchestrator');
const { ContextManager } = require('../../src/core/context-manager');
const fileHandler = require('../../src/utils/file-handler');

/**
 * Create a lightweight mock agent that returns a canned result.
 */
function createMockAgent(role) {
    return {
    process: jest.fn().mockResolvedValue('mock process'),
    isFileOperation: jest.fn().mockReturnValue(false),
    plan: jest.fn().mockResolvedValue('mock plan'),
    reason: jest.fn().mockResolvedValue('mock reason'),
    diagnose: jest.fn().mockResolvedValue('mock diagnosis'),
    compareOptions: jest.fn().mockResolvedValue('mock comparison'),
    generate: jest.fn().mockResolvedValue({ code: 'const x = 1;', explanation: 'Generated code', validation: { valid: true, errors: [], warnings: [] } }),
    review: jest.fn().mockResolvedValue('mock review'),
    refactor: jest.fn().mockResolvedValue({ code: 'const x = 1;', explanation: 'Refactored' }),
    debug: jest.fn().mockResolvedValue({ fix: 'const x = 1;', explanation: 'Fixed' }),
    complete: jest.fn().mockResolvedValue('const x = 1;'),
    summarize: jest.fn().mockResolvedValue('mock summary'),
    query: jest.fn().mockResolvedValue('mock query result'),
    analyzeDirectory: jest.fn().mockResolvedValue('mock dir analysis'),
    compare: jest.fn().mockResolvedValue('mock comparison'),
    analyzeContent: jest.fn().mockResolvedValue('mock content analysis'),
  };
}

/**
 * Create a mock ModelManager.
 */
function createMockModelManager() {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    listAvailableModels: jest.fn().mockResolvedValue(['model-a', 'model-b']),
    chat: jest.fn().mockResolvedValue('mock response'),
    getModelConfig: jest.fn().mockReturnValue({ id: 'test-model', maxTokens: 1024, temperature: 0.3 }),
  };
}

describe('Orchestrator', () => {
  let orchestrator;
  let mockModelManager;
  let mockAgents;
  let ctxMgr;
  let sessionId;

  beforeEach(() => {
    mockModelManager = createMockModelManager();
    ctxMgr = new ContextManager();
    mockAgents = {
      reasoning: createMockAgent('reasoning'),
      coding: createMockAgent('coding'),
      fileAnalysis: createMockAgent('fileAnalysis'),
    };
    orchestrator = new Orchestrator(mockAgents, mockModelManager, ctxMgr);
    sessionId = orchestrator.createSession({ test: true });
  });

  describe('createSession()', () => {
    it('returns a valid session ID', () => {
      const id = orchestrator.createSession();
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(36);
    });
  });

  describe('classifyIntent()', () => {
    const cases = [
      ['create a plan for refactoring the API', 'reasoning'],
      ['generate a JavaScript function to parse JSON', 'coding'],
      ['summarize this file', 'fileAnalysis'],
      ['debug this code and fix the bug', 'coding'],
      ['just a generic question', 'general'],
    ];

    test.each(cases)('classifies "%s" as %s', (input, expected) => {
      const result = orchestrator.classifyIntent(input);
      expect(result).toBe(expected);
    });
  });

  describe('process()', () => {
    it('routes to reasoning agent for planning tasks', async () => {
      const result = await orchestrator.process(
        'create a plan for building a REST API',
        sessionId,
        { agent: 'reasoning' }
      );
      expect(result.agent).toBe('reasoning');
      expect(mockAgents.reasoning.plan).toHaveBeenCalled();
    });

    it('routes to coding agent for code generation', async () => {
      const result = await orchestrator.process(
        'write a hello world function',
        sessionId,
        { agent: 'coding', language: 'javascript' }
      );
      expect(result.agent).toBe('coding');
      expect(mockAgents.coding.generate).toHaveBeenCalled();
    });

    it('routes natural file operations to reasoning process handler', async () => {
      mockAgents.reasoning.isFileOperation.mockReturnValue(true);
      const result = await orchestrator.process('delete file test.txt', sessionId);
      expect(result.agent).toBe('reasoning');
      expect(mockAgents.reasoning.process).toHaveBeenCalledWith('delete file test.txt', sessionId);
    });

    it('passes explicit file context to coding generation', async () => {
      const readSpy = jest.spyOn(fileHandler, 'readFile').mockReturnValue('const fromFile = true;');
      await orchestrator.process(
        'generate based on local file',
        sessionId,
        { agent: 'coding', language: 'javascript', filePaths: ['sample.js'] }
      );
      expect(mockAgents.coding.generate).toHaveBeenCalledWith(
        'generate based on local file',
        'javascript',
        sessionId,
        expect.objectContaining({
          files: [expect.objectContaining({ path: 'sample.js', content: 'const fromFile = true;' })],
        })
      );
      readSpy.mockRestore();
    });

    it('routes to fileAnalysis agent when filePath is provided', async () => {
      const os = require('os');
      const path = require('path');
      const fs = require('fs');
      const tmp = path.join(os.tmpdir(), 'orch-test.js');
      fs.writeFileSync(tmp, 'const x = 1;');

      const result = await orchestrator.process('analyze file', sessionId, {
        agent: 'fileAnalysis',
        filePath: tmp,
      });
      expect(result.agent).toBe('fileAnalysis');
      expect(mockAgents.fileAnalysis.summarize).toHaveBeenCalled();
      fs.unlinkSync(tmp);
    });

    it('routes to fileAnalysis agent when dirPath is provided', async () => {
      const os = require('os');
      const path = require('path');
      const tmp = os.tmpdir();

      const result = await orchestrator.process('analyze directory', sessionId, {
        agent: 'fileAnalysis',
        dirPath: tmp,
      });
      expect(result.agent).toBe('fileAnalysis');
      expect(mockAgents.fileAnalysis.analyzeDirectory).toHaveBeenCalled();
    });

    it('routes coding agent to review when code is supplied', async () => {
      const result = await orchestrator.process('review this code', sessionId, {
        agent: 'coding',
        code: 'const x = 1;',
        language: 'javascript',
      });
      expect(result.agent).toBe('coding');
      expect(mockAgents.coding.review).toHaveBeenCalled();
    });
  });

  describe('isModelServiceAvailable()', () => {
    it('delegates to model manager', async () => {
      const result = await orchestrator.isModelServiceAvailable();
      expect(result).toBe(true);
      expect(mockModelManager.isAvailable).toHaveBeenCalled();
    });
  });

  describe('listModels()', () => {
    it('returns available models', async () => {
      const models = await orchestrator.listModels();
      expect(models).toEqual(['model-a', 'model-b']);
    });
  });

  describe('getHistory() / clearHistory()', () => {
    it('returns empty history for a fresh session', () => {
      const history = orchestrator.getHistory(sessionId);
      expect(history).toEqual([]);
    });

    it('clearHistory empties the session messages', () => {
      ctxMgr.addMessage(sessionId, 'user', 'hello');
      orchestrator.clearHistory(sessionId);
      expect(orchestrator.getHistory(sessionId)).toEqual([]);
    });
  });

  describe('listSessions()', () => {
    it('includes created sessions', () => {
      const sessions = orchestrator.listSessions();
      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(sessionId);
    });
  });
});
