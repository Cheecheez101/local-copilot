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

function loadModelManagerWithFetch(fetchImpl) {
  jest.resetModules();
  global.fetch = fetchImpl;
  // eslint-disable-next-line global-require
  const { ModelManager } = require('../../src/core/model-manager');
  return ModelManager;
}

describe('ModelManager robustness fallback', () => {
  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('falls back to another model when the current model times out', async () => {
    const fetchMock = jest.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        throw new Error('aborted');
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'fallback-success' } }] }),
      };
    });
    const ModelManager = loadModelManagerWithFetch(fetchMock);
    const manager = new ModelManager(createConfig(300));

    jest.spyOn(manager, '_resolveBaseUrl').mockResolvedValue('http://localhost:5272');
    jest.spyOn(manager, 'listAvailableModels').mockResolvedValue(['model-a', 'model-b']);

    await expect(manager.chat('reasoning', [{ role: 'user', content: 'hello' }]))
      .resolves.toBe('fallback-success');
    expect(manager.getModelConfig('reasoning').id).toBe('model-b');
  });

  it('falls back to another model on transient API 503 error', async () => {
    const fetchMock = jest.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => 'service unavailable',
        };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'recovered' } }] }),
      };
    });
    const ModelManager = loadModelManagerWithFetch(fetchMock);
    const manager = new ModelManager(createConfig(300));

    jest.spyOn(manager, '_resolveBaseUrl').mockResolvedValue('http://localhost:5272');
    jest.spyOn(manager, 'listAvailableModels').mockResolvedValue(['model-a', 'model-cpu']);

    await expect(manager.chat('reasoning', [{ role: 'user', content: 'hello' }]))
      .resolves.toBe('recovered');
    expect(manager.getModelConfig('reasoning').id).toBe('model-cpu');
  });
});
