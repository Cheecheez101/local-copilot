'use strict';

const { ModelManager } = require('../../src/core/model-manager');

function createConfig() {
  return {
    foundryLocal: {
      baseUrl: 'http://localhost:5272',
      fallbackBaseUrls: ['http://127.0.0.1:5272', 'http://127.0.0.1:59501'],
      apiPath: '/v1/chat/completions',
      modelsPath: '/v1/models',
      timeout: 1000,
    },
    models: {
      reasoning: { id: 'model-a', maxTokens: 10, temperature: 0.3 },
      coding: { id: 'model-a', maxTokens: 10, temperature: 0.1 },
      fileAnalysis: { id: 'model-a', maxTokens: 10, temperature: 0.2 },
    },
  };
}

describe('ModelManager endpoint resolution', () => {
  it('resolves the first reachable endpoint', async () => {
    const manager = new ModelManager(createConfig());
    jest.spyOn(manager, '_probeBaseUrl').mockImplementation(async (url) => url === 'http://127.0.0.1:59501');

    await expect(manager._resolveBaseUrl()).resolves.toBe('http://127.0.0.1:59501');
  });

  it('prefers env override candidate ordering', () => {
    const prior = process.env.FOUNDRY_BASE_URL;
    process.env.FOUNDRY_BASE_URL = 'http://127.0.0.1:7000';
    try {
      const manager = new ModelManager(createConfig());
      const candidates = manager._candidateBaseUrls();
      expect(candidates[0]).toBe('http://127.0.0.1:7000');
    } finally {
      if (prior === undefined) delete process.env.FOUNDRY_BASE_URL;
      else process.env.FOUNDRY_BASE_URL = prior;
    }
  });

  it('returns false in availability check when resolution fails', async () => {
    const manager = new ModelManager(createConfig());
    jest.spyOn(manager, '_resolveBaseUrl').mockRejectedValue(new Error('unreachable'));

    await expect(manager.isAvailable()).resolves.toBe(false);
  });
});
