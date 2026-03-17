'use strict';

class LearningSystem {
  constructor() {
    this.feedback = [];
    this.improvements = new Map();
  }

  learnFromInteraction(userInput, agentResponse, userFeedback = {}) {
    const record = {
      input: String(userInput || ''),
      response: agentResponse,
      feedback: userFeedback,
      timestamp: Date.now(),
    };
    this.feedback.push(record);

    if (userFeedback?.correction) {
      this.improvements.set(record.input, {
        better: userFeedback.correction,
        context: userFeedback.context,
      });
    }
  }

  getImprovedResponse(input) {
    const similar = this.findSimilarInput(input);
    if (similar && similar.score > 0.75) {
      return similar.improvedResponse;
    }
    return null;
  }

  findSimilarInput(input) {
    const needle = String(input || '').toLowerCase().trim();
    if (!needle || this.improvements.size === 0) return null;

    let best = null;
    for (const [seenInput, value] of this.improvements.entries()) {
      const score = this.similarity(needle, String(seenInput).toLowerCase());
      if (!best || score > best.score) {
        best = { input: seenInput, score, improvedResponse: value.better, context: value.context };
      }
    }
    return best;
  }

  similarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - (this.levenshtein(a, b) / maxLen);
  }

  levenshtein(a, b) {
    const s = String(a || '');
    const t = String(b || '');
    const rows = s.length + 1;
    const cols = t.length + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let i = 0; i < rows; i++) matrix[i][0] = i;
    for (let j = 0; j < cols; j++) matrix[0][j] = j;

    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[s.length][t.length];
  }
}

module.exports = new LearningSystem();
module.exports.LearningSystem = LearningSystem;
