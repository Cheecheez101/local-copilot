'use strict';

const { redactSecrets } = require('../../src/utils/logger');

describe('logger redaction', () => {
  it('redacts sensitive object keys', () => {
    const input = { apiKey: 'abc123', token: 'xyz', nested: { password: 'p' } };
    const output = redactSecrets(input);
    expect(output.apiKey).toBe('[REDACTED]');
    expect(output.token).toBe('[REDACTED]');
    expect(output.nested.password).toBe('[REDACTED]');
  });
});
