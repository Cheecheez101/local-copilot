'use strict';

class ConversationFlow {
  constructor() {
    this.flows = {
      FILE_EXPLORATION: {
        steps: [
          'ask_path',
          'list_files',
          'offer_actions',
          'execute_choice',
        ],
        next: (currentStep, response) => {
          const text = String(response || '');
          if (currentStep === 'ask_path' && /[A-Za-z]:[\\/]/.test(text)) {
            return 'list_files';
          }
          return currentStep;
        },
      },
      DEFAULT: {
        steps: ['understand', 'respond'],
        next: (currentStep) => {
          if (currentStep === 'understand') return 'respond';
          return currentStep;
        },
      },
    };
  }

  manageFlow(intent, context = {}) {
    const flow = this.flows[intent] || this.flows.DEFAULT;
    const currentStep = context.currentStep || flow.steps[0];
    const currentIndex = flow.steps.indexOf(currentStep);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const step = flow.steps[safeIndex];

    return {
      step,
      nextSteps: flow.steps.slice(safeIndex + 1),
      prompt: this.getPromptForStep(step, context),
    };
  }

  getPromptForStep(step, context = {}) {
    switch (step) {
      case 'ask_path':
        return 'Please share the directory path you want to explore.';
      case 'list_files':
        return `Listing files for ${context.path || 'the selected directory'}.`;
      case 'offer_actions':
        return 'What would you like to do next: open, run, or search?';
      case 'execute_choice':
        return `Executing your choice: ${context.choice || 'selected action'}.`;
      case 'understand':
        return 'Let me understand what you need first.';
      case 'respond':
      default:
        return 'Here is the best next response based on your request.';
    }
  }
}

module.exports = new ConversationFlow();
module.exports.ConversationFlow = ConversationFlow;
