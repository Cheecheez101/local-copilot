'use strict';

class SuggestionAgent {
  constructor(context = {}) {
    this.context = context;
  }

  suggestNextAction(lastAction = {}) {
    const suggestions = [];

    if (lastAction.type === 'FILE_LIST' && Array.isArray(lastAction?.result?.files)) {
      const count = lastAction.result.files.length;
      if (count > 0) {
        suggestions.push({
          text: `Found ${count} files`,
          actions: [
            'Run one of them',
            'Check file contents',
            'Search for specific file',
          ],
        });
      }
    }

    const hour = new Date().getHours();
    if (hour === 9 || hour === 13 || hour === 17) {
      suggestions.push({
        text: 'Quick tip: You can ask me to remember common commands',
        action: 'Say "remember this command"',
      });
    }

    return suggestions;
  }
}

module.exports = new SuggestionAgent();
module.exports.SuggestionAgent = SuggestionAgent;
