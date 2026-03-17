'use strict';

class NLU {
  understand(userInput) {
    const intent = this.classifyIntent(userInput);
    const entities = this.extractEntities(userInput);

    return {
      intent,
      entities,
      confidence: this.calculateConfidence(intent, entities),
      response: this.generateResponse(intent, entities),
    };
  }

  classifyIntent(input) {
    const text = String(input || '');
    const patterns = {
      LIST_FILES: /(list|show|check|what.*in|files?\s+in|directory|folder)/i,
      RUN: /(run|execute|start|launch)/i,
      OPEN: /(open|launch|start)/i,
      FIND: /(find|search|look for|locate)/i,
      ERROR: /(error|bug|issue|problem|not working)/i,
      HELP: /(help|how|what can you|assist)/i,
    };

    for (const [intent, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) return intent;
    }

    return 'UNKNOWN';
  }

  extractEntities(input) {
    const text = String(input || '');
    const entities = {};

    const windowsPath = text.match(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/);
    const slashPath = text.match(/(?:\.{0,2}\/|\/)?(?:[^/\s]+\/)*[^/\s]*/);
    if (windowsPath?.[0]) {
      entities.path = windowsPath[0];
    } else if (slashPath?.[0] && slashPath[0].includes('/')) {
      entities.path = slashPath[0];
    }

    const fileMatch = text.match(/\b[\w.-]+\.[a-z0-9]{2,8}\b/i);
    if (fileMatch?.[0]) {
      entities.file = fileMatch[0];
    }

    return entities;
  }

  calculateConfidence(intent, entities) {
    if (intent === 'UNKNOWN') return 0.2;
    let confidence = 0.65;
    if (entities.path) confidence += 0.15;
    if (entities.file) confidence += 0.15;
    return Math.min(confidence, 0.95);
  }

  generateResponse(intent, entities) {
    switch (intent) {
      case 'LIST_FILES':
        return entities.path
          ? `I can list files in ${entities.path}.`
          : 'I can list files. Tell me which directory to inspect.';
      case 'RUN':
        return 'I can help run safe development commands.';
      case 'OPEN':
        return entities.file
          ? `I can help open ${entities.file}.`
          : 'Tell me what file or target you want to open.';
      case 'FIND':
        return entities.file
          ? `I can help find ${entities.file}.`
          : 'Tell me what you want to find.';
      case 'ERROR':
        return 'I can help diagnose the issue. Share the failing output.';
      case 'HELP':
        return 'I can help with files, commands, debugging, and project analysis.';
      default:
        return 'I did not fully understand. Try rephrasing with a clear action.';
    }
  }
}

module.exports = new NLU();
module.exports.NLU = NLU;
