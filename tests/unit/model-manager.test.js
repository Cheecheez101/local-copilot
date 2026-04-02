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
    bedrock: {
      enabled: false,
      region: 'us-east-1',
      modelId: '',
      temperature: 0.2,
      maxTokens: 100,
    },
    cloudMode: 'local-first',
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

  it('uses bedrock when cloud mode is always', () => {
    const config = createConfig();
    config.bedrock.enabled = true;
    config.bedrock.modelId = 'bedrock-model';
    config.cloudMode = 'always';

    const manager = new ModelManager(config);
    expect(manager._shouldUseBedrock('reasoning')).toBe(true);
  });

  it('falls back to bedrock only when configured', async () => {
    const config = createConfig();
    config.bedrock.enabled = true;
    config.bedrock.modelId = 'bedrock-model';
    config.cloudMode = 'local-first';

    const manager = new ModelManager(config);
    jest.spyOn(manager, '_chatWithFoundry').mockRejectedValue(new Error('foundry offline'));
    jest.spyOn(manager, '_chatWithBedrock').mockResolvedValue('from bedrock');

    const result = await manager.chat('reasoning', [{ role: 'user', content: 'hello' }]);
    expect(result).toBe('from bedrock');
    expect(manager._chatWithBedrock).toHaveBeenCalled();
  });
});
