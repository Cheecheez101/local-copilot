'use strict';

const modelManager = require('../core/model-manager');
const contextManager = require('../core/context-manager');

const SYSTEM_PROMPT = `You are a reasoning and planning agent that helps developers break down complex problems, \
create step-by-step plans, analyse trade-offs, and make architectural decisions. \
You think carefully before responding, consider edge cases, and produce clear, \
structured explanations. When asked for a plan, always produce numbered steps. \
When evaluating options, list pros and cons. Keep responses concise but complete.`;

/**
 * ReasoningAgent – responsible for task planning, logical analysis, and
 * architectural decision-making.
 */
class ReasoningAgent {
  constructor(modelMgr, ctxMgr) {
    this.modelManager = modelMgr || modelManager;
    this.contextManager = ctxMgr || contextManager;
    this.role = 'reasoning';
  }

  /**
   * Analyse a problem and produce a structured plan.
   * @param {string} problem   - Description of the problem.
   * @param {string} sessionId - Session ID for context tracking.
   * @returns {Promise<string>} Structured plan from the model.
   */
  async plan(problem, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);
    this.contextManager.addMessage(
      sessionId,
      'user',
      `Please create a detailed plan to address the following problem:\n\n${problem}`
    );

    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Analyse trade-offs between multiple options.
   * @param {string[]} options   - List of options to compare.
   * @param {string}   criteria  - Criteria for evaluation.
   * @param {string}   sessionId
   * @returns {Promise<string>}
   */
  async compareOptions(options, criteria, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const optionList = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const prompt = `Compare the following options based on: ${criteria}\n\nOptions:\n${optionList}\n\nProvide a structured comparison with pros and cons for each option, then give a recommendation.`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Ask a free-form reasoning question.
   * @param {string} question  - The question to reason about.
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async reason(question, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);
    this.contextManager.addMessage(sessionId, 'user', question);

    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Diagnose a technical issue and suggest solutions.
   * @param {string} issue     - Description of the issue.
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async diagnose(issue, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `Diagnose the following technical issue and suggest potential solutions:\n\n${issue}\n\nStructure your response as:\n1. Root cause analysis\n2. Possible solutions (ranked by likelihood)\n3. Recommended next steps`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }
}

module.exports = new ReasoningAgent();
module.exports.ReasoningAgent = ReasoningAgent;
