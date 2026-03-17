'use strict';

class Personality {
  constructor() {
    this.traits = {
      helpful: 0.9,
      concise: 0.7,
      friendly: 0.8,
      technical: 0.6,
    };
  }

  formatResponse(text, context = {}) {
    const body = String(text || '');

    if (context.error) {
      const suggestion = context.suggestion ? `\n\nTry this instead: ${context.suggestion}` : '';
      return `Hmm, I ran into an issue: ${body}${suggestion}`;
    }

    if (context.success) {
      return `Done! ${body}`;
    }

    if (context.suggestion) {
      return `Tip: ${body}`;
    }

    return body;
  }
}

module.exports = new Personality();
module.exports.Personality = Personality;
