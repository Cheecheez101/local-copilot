'use strict';

const { LearningSystem } = require('../../src/core/learning');

describe('LearningSystem', () => {
  let learning;

  beforeEach(() => {
    learning = new LearningSystem();
  });

  it('stores feedback records', () => {
    learning.learnFromInteraction('hello', 'hi', { rating: 1 });
    expect(learning.feedback).toHaveLength(1);
    expect(learning.feedback[0].input).toBe('hello');
  });

  it('stores improvement when correction exists', () => {
    learning.learnFromInteraction('ls foler', 'unknown', { correction: 'ls folder', context: 'typo fix' });
    expect(learning.improvements.has('ls foler')).toBe(true);
  });

  it('returns improved response for similar input', () => {
    learning.learnFromInteraction('locol copilot', 'x', { correction: 'local copilot', context: 'spelling' });
    const improved = learning.getImprovedResponse('local copilot');
    expect(improved).toBe('local copilot');
  });

  it('returns null when no suitable match exists', () => {
    learning.learnFromInteraction('abc', 'x', { correction: 'abc', context: 'same' });
    const improved = learning.getImprovedResponse('totally different');
    expect(improved).toBeNull();
  });
});
