'use strict';

const { NLU } = require('../../src/core/nlu');

describe('NLU', () => {
  let nlu;

  beforeEach(() => {
    nlu = new NLU();
  });

  it('classifies list-files intent', () => {
    expect(nlu.classifyIntent('show files in C:\\Users\\Administrator')).toBe('LIST_FILES');
  });

  it('extracts path and filename entities', () => {
    const entities = nlu.extractEntities('open C:\\Users\\Administrator\\projects\\app\\index.js');
    expect(entities.path).toContain('C:\\Users\\Administrator\\projects\\app\\index.js');
    expect(entities.file).toBe('index.js');
  });

  it('returns unknown for unrelated text', () => {
    const result = nlu.understand('banana cloud abstract');
    expect(result.intent).toBe('UNKNOWN');
    expect(result.confidence).toBeLessThan(0.3);
  });
});
