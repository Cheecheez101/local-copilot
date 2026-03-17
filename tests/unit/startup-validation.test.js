'use strict';

const { validateStartupEnv } = require('../../src/utils/startup-validation');

describe('startup validation', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('reports warning for OPENAI_BASE_URL without api key', () => {
    process.env.OPENAI_BASE_URL = 'https://example.com/v1';
    delete process.env.OPENAI_API_KEY;
    const result = validateStartupEnv();
    expect(result.warnings.join(' ')).toMatch(/without API key/i);
  });

  it('reports error for invalid URL env values', () => {
    process.env.OPENAI_BASE_URL = 'not a url';
    const result = validateStartupEnv();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
