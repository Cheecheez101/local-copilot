'use strict';

let originalFetch;

function createConfig(timeout = 1000) {
  return {
    foundryLocal: {
      baseUrl: 'http://localhost:5272',
      fallbackBaseUrls: [],
      apiPath: '/v1/chat/completions',
      modelsPath: '/v1/models',
      timeout,
    },
    models: {
      reasoning: { id: 'model-a', maxTokens: 10, temperature: 0.3 },
      coding: { id: 'model-a', maxTokens: 10, temperature: 0.1 },
      fileAnalysis: { id: 'model-a', maxTokens: 10, temperature: 0.2 },
    },
  };
}

function createAbortableHangingFetch() {
  return jest.fn((url, options = {}) => new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }
  }));
}

function loadModelManagerWithFetch(fetchImpl) {
  jest.resetModules();
  global.fetch = fetchImpl;
  // eslint-disable-next-line global-require
  const { ModelManager } = require('../../src/core/model-manager');
  return ModelManager;
}

describe('ModelManager timeout protection', () => {
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('listAvailableModels should timeout instead of hanging indefinitely', async () => {
    const ModelManager = loadModelManagerWithFetch(createAbortableHangingFetch());
    const manager = new ModelManager(createConfig(500));
    
    // Mock _resolveBaseUrl to return a valid URL
    jest.spyOn(manager, '_resolveBaseUrl').mockResolvedValue('http://localhost:5272');

    // Should reject with timeout, not hang forever
    const startTime = Date.now();
    await expect(manager.listAvailableModels()).rejects.toThrow(/timed out|abort/i);
    const elapsed = Date.now() - startTime;
    
    // Should timeout within reasonable bounds (500ms + buffer)
    expect(elapsed).toBeLessThan(2000);
  });

  it('chat method should respect timeout on main request', async () => {
    const ModelManager = loadModelManagerWithFetch(createAbortableHangingFetch());
    const manager = new ModelManager(createConfig(500));
    
    jest.spyOn(manager, '_resolveBaseUrl').mockResolvedValue('http://localhost:5272');

    const startTime = Date.now();
    await expect(manager.chat('reasoning', [{ role: 'user', content: 'test' }]))
      .rejects.toThrow(/timed out/i);
    const elapsed = Date.now() - startTime;
    
    expect(elapsed).toBeLessThan(2000);
  });

  it('chat method should respect timeout on minimal payload retry', async () => {
    const hangingFetch = createAbortableHangingFetch();
    const fetchMock = jest.fn(async (...args) => {
      if (fetchMock.mock.calls.length === 1) {
        return {
          ok: false,
          status: 400,
          text: async () => 'bad request',
        };
      }
      return hangingFetch(...args);
    });
    const ModelManager = loadModelManagerWithFetch(fetchMock);
    const manager = new ModelManager(createConfig(500));
    
    jest.spyOn(manager, '_resolveBaseUrl').mockResolvedValue('http://localhost:5272');

    const startTime = Date.now();
    await expect(manager.chat('reasoning', [{ role: 'user', content: 'test' }]))
      .rejects.toThrow();
    const elapsed = Date.now() - startTime;
    
    // Should timeout within reasonable bounds
    expect(elapsed).toBeLessThan(4000);
  });
});
