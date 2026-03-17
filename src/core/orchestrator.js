'use strict';

const { v4: uuidv4 } = require('uuid');
const reasoningAgent = require('../agents/reasoning-agent');
const codingAgent = require('../agents/coding-agent');
const fileAnalysisAgent = require('../agents/file-analysis-agent');
const modelManager = require('./model-manager');
const contextManager = require('./context-manager');

/**
 * Intent classification keywords used to route tasks to the right agent.
 */
const INTENT_PATTERNS = {
  reasoning: [
    /\bplan\b/i, /\barchitect\b/i, /\bdesign\b/i, /\bstrategy\b/i,
    /\bdecision\b/i, /\bcompare\b/i, /\btrade.?off/i, /\bdiagnose\b/i,
    /\banalyze\b/i, /\banalyse\b/i, /\bwhy\b/i, /\bshould i\b/i,
    /\bbest approach\b/i, /\bpros and cons\b/i,
  ],
  coding: [
    /\bgenerate\b/i, /\bwrite\b/i, /\bcode\b/i, /\bfunction\b/i,
    /\bclass\b/i, /\bimplement\b/i, /\brefactor\b/i, /\bdebug\b/i,
    /\bfix\b/i, /\bbug\b/i, /\btest\b/i, /\bunit test\b/i,
    /\bcomplete\b/i, /\bsnippet\b/i, /\bscript\b/i,
  ],
  fileAnalysis: [
    /\bfile\b/i, /\bread\b/i, /\bsummariz/i, /\bsummarise/i,
    /\bdocument\b/i, /\bdir(ectory)?\b/i, /\bcodebase\b/i,
    /\banalyze.*(file|doc|content)/i, /\bwhat does.*file\b/i,
    /\bcontent\b/i, /\bpars(e|ing)\b/i,
  ],
};

/**
 * Orchestrator – the central coordinator for the multi-agent system.
 *
 * It classifies incoming tasks, routes them to the appropriate agent,
 * manages sessions, and provides a unified interface for all agent operations.
 */
class Orchestrator {
  constructor(agents, models, context) {
    this.reasoningAgent = agents?.reasoning || reasoningAgent;
    this.codingAgent = agents?.coding || codingAgent;
    this.fileAnalysisAgent = agents?.fileAnalysis || fileAnalysisAgent;
    this.modelManager = models || modelManager;
    this.contextManager = context || contextManager;
  }

  /**
   * Create a new user session.
   * @param {object} [metadata={}]
   * @returns {string} Session ID.
   */
  createSession(metadata = {}) {
    return this.contextManager.createSession(metadata);
  }

  /**
   * Classify the intent of a task string.
   * @param {string} task
   * @returns {'reasoning'|'coding'|'fileAnalysis'|'general'}
   */
  classifyIntent(task) {
    const scores = { reasoning: 0, coding: 0, fileAnalysis: 0 };

    for (const [agent, patterns] of Object.entries(INTENT_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(task)) {
          scores[agent]++;
        }
      }
    }

    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) return 'general';

    return Object.keys(scores).find((k) => scores[k] === maxScore) || 'general';
  }

  /**
   * Process a task by automatically routing it to the most appropriate agent.
   *
   * @param {string} task      - Natural-language task description.
   * @param {string} sessionId - Session ID.
   * @param {object} [options] - Additional options (filePath, language, etc.).
   * @returns {Promise<{ agent: string, response: any }>}
   */
  async process(task, sessionId, options = {}) {
    const intent = options.agent || this.classifyIntent(task);

    switch (intent) {
      case 'coding':
        return this._handleCodingTask(task, sessionId, options);
      case 'fileAnalysis':
        return this._handleFileTask(task, sessionId, options);
      case 'reasoning':
      default:
        return this._handleReasoningTask(task, sessionId, options);
    }
  }

  /**
   * Route a task to the reasoning agent.
   * @private
   */
  async _handleReasoningTask(task, sessionId, options) {
    let response;

    if (options.compareOptions && Array.isArray(options.compareOptions)) {
      response = await this.reasoningAgent.compareOptions(
        options.compareOptions,
        options.criteria || task,
        sessionId
      );
    } else if (/diagnose|error|issue|problem/i.test(task)) {
      response = await this.reasoningAgent.diagnose(task, sessionId);
    } else if (/plan|steps|how to/i.test(task)) {
      response = await this.reasoningAgent.plan(task, sessionId);
    } else {
      response = await this.reasoningAgent.reason(task, sessionId);
    }

    return { agent: 'reasoning', response };
  }

  /**
   * Route a task to the coding agent.
   * @private
   */
  async _handleCodingTask(task, sessionId, options) {
    const language = options.language || 'javascript';
    let response;

    if (options.code) {
      if (/refactor/i.test(task)) {
        response = await this.codingAgent.refactor(options.code, language, task, sessionId);
      } else if (/debug|fix|error/i.test(task)) {
        response = await this.codingAgent.debug(options.code, language, options.error || '', sessionId);
      } else if (/review/i.test(task)) {
        response = await this.codingAgent.review(options.code, language, sessionId);
      } else if (/complete/i.test(task)) {
        response = await this.codingAgent.complete(options.code, language, sessionId);
      } else {
        response = await this.codingAgent.review(options.code, language, sessionId);
      }
    } else {
      response = await this.codingAgent.generate(task, language, sessionId);
    }

    return { agent: 'coding', response };
  }

  /**
   * Route a task to the file analysis agent.
   * @private
   */
  async _handleFileTask(task, sessionId, options) {
    let response;

    if (options.filePath) {
      if (options.filePathB) {
        response = await this.fileAnalysisAgent.compare(options.filePath, options.filePathB, sessionId);
      } else if (options.question) {
        response = await this.fileAnalysisAgent.query(options.filePath, options.question || task, sessionId);
      } else {
        response = await this.fileAnalysisAgent.summarize(options.filePath, sessionId);
      }
    } else if (options.dirPath) {
      response = await this.fileAnalysisAgent.analyzeDirectory(options.dirPath, sessionId);
    } else if (options.content) {
      response = await this.fileAnalysisAgent.analyzeContent(options.content, task, sessionId);
    } else {
      response = await this.reasoningAgent.reason(task, sessionId);
    }

    return { agent: 'fileAnalysis', response };
  }

  /**
   * Check if the underlying model service is available.
   * @returns {Promise<boolean>}
   */
  async isModelServiceAvailable() {
    return this.modelManager.isAvailable();
  }

  /**
   * List available models from Foundry Local.
   * @returns {Promise<string[]>}
   */
  async listModels() {
    return this.modelManager.listAvailableModels();
  }

  /**
   * Get session history.
   * @param {string} sessionId
   * @returns {Array<{ role: string, content: string }>}
   */
  getHistory(sessionId) {
    return this.contextManager.getHistory(sessionId);
  }

  /**
   * Clear session history.
   * @param {string} sessionId
   */
  clearHistory(sessionId) {
    this.contextManager.clearHistory(sessionId);
  }

  /**
   * List all active sessions.
   * @returns {Array}
   */
  listSessions() {
    return this.contextManager.listSessions();
  }
}

module.exports = new Orchestrator();
module.exports.Orchestrator = Orchestrator;
