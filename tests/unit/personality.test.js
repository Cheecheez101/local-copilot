'use strict';

const { Personality } = require('../../src/core/personality');

describe('Personality', () => {
  let personality;

  beforeEach(() => {
    personality = new Personality();
  });

  it('formats error responses with suggestion when provided', () => {
    const out = personality.formatResponse('File not found', {
      error: true,
      suggestion: 'Check the path and try again',
    });
    expect(out).toContain('ran into an issue');
    expect(out).toContain('Try this instead');
  });

  it('formats success responses', () => {
    const out = personality.formatResponse('Generated the file', { success: true });
    expect(out).toBe('Done! Generated the file');
  });

  it('formats suggestion responses', () => {
    const out = personality.formatResponse('Use /help for command list', { suggestion: true });
    expect(out).toBe('Tip: Use /help for command list');
  });

  it('returns plain text by default', () => {
    const out = personality.formatResponse('hello');
    expect(out).toBe('hello');
  });
});
