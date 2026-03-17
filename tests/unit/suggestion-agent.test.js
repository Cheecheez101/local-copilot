'use strict';

const { SuggestionAgent } = require('../../src/agents/suggestion-agent');

describe('SuggestionAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new SuggestionAgent();
  });

  it('suggests follow-up actions after file listing', () => {
    const suggestions = agent.suggestNextAction({
      type: 'FILE_LIST',
      result: { files: [{ name: 'a.js' }, { name: 'b.js' }] },
    });

    expect(suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        text: 'Found 2 files',
        actions: expect.arrayContaining(['Run one of them']),
      }),
    ]));
  });

  it('returns array safely for empty input', () => {
    const suggestions = agent.suggestNextAction();
    expect(Array.isArray(suggestions)).toBe(true);
  });
});
