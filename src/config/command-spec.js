'use strict';

const VS_QUICK_ACTIONS = [
  { label: 'Generate Code', command: 'localCopilot.generate' },
  { label: 'Review Current File', command: 'localCopilot.review' },
  { label: 'Analyze Directory', command: 'localCopilot.analyzeDirectory' },
  { label: 'Run Tests', command: 'localCopilot.runTests' },
  { label: 'Git Status', command: 'localCopilot.gitStatus' },
  { label: 'Diagnostics', command: 'localCopilot.diagnostics' },
  { label: 'Open Model Catalog', command: 'ai-copilot.openModelCatalog' },
  { label: 'Open Playground', command: 'ai-copilot.openPlayground' },
];

const CLI_COMMANDS = [
  'plan',
  'code',
  'review',
  'refactor',
  'debug',
  'analyze',
  'dir',
  'analyze-dir',
  'read',
  'write',
  'compare',
  'models',
  'diagnostics',
  'git-status',
  'git-diff',
  'history',
  'clear',
  'help',
  'exit',
];

module.exports = { VS_QUICK_ACTIONS, CLI_COMMANDS };
