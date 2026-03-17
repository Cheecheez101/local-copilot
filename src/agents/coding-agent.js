'use strict';

const modelManager = require('../core/model-manager');
const contextManager = require('../core/context-manager');
const codeValidator = require('../utils/code-validator');

const SYSTEM_PROMPT = `You are an expert coding agent that helps developers write, review, refactor, and debug code. \
You produce clean, well-documented, production-ready code. When generating code always wrap it in a markdown \
code fence with the correct language tag (e.g. \`\`\`javascript). Explain your changes concisely after the code block. \
Follow modern best practices and include error handling. Do not include placeholder comments like "// TODO" unless \
explicitly asked.`;

/**
 * CodingAgent – responsible for code generation, completion, refactoring,
 * review, and debugging.
 */
class CodingAgent {
  constructor(modelMgr, ctxMgr, validator) {
    this.modelManager = modelMgr || modelManager;
    this.contextManager = ctxMgr || contextManager;
    this.codeValidator = validator || codeValidator;
    this.role = 'coding';
  }

  /**
   * Generate code based on a natural-language description.
   * @param {string} description - What the code should do.
   * @param {string} language    - Target programming language.
   * @param {string} sessionId
   * @param {{files?: Array<{path:string, content:string}>}} [context={}]
   * @returns {Promise<{ code: string, explanation: string, validation: object }>}
   */
  async generate(description, language, sessionId, context = {}) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const fileContext = this._buildFileContext(context.files);
    const prompt = `Generate ${language} code that: ${description}\n\nRequirements:\n- Clean, readable code\n- Proper error handling\n- Brief inline comments where helpful${fileContext}`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);

    const blocks = this.codeValidator.extractCodeBlocks(response);
    const primaryBlock = blocks[0] || { language: language, code: response };

    const validation = this.codeValidator.validate(primaryBlock.code, language);

    return {
      code: primaryBlock.code,
      explanation: response,
      validation,
    };
  }

  _buildFileContext(files) {
    if (!Array.isArray(files) || files.length === 0) {
      return '';
    }
    const rendered = files
      .slice(0, 5)
      .map((f, idx) => {
        const body = String(f.content || '').slice(0, 12000);
        return `\nFile ${idx + 1}: ${f.path}\n\`\`\`\n${body}\n\`\`\``;
      })
      .join('\n');
    return `\n\nUse the following local file context if relevant:${rendered}`;
  }

  /**
   * Review existing code and provide feedback.
   * @param {string} code      - Code to review.
   * @param {string} language  - Language of the code.
   * @param {string} sessionId
   * @returns {Promise<string>} Review feedback.
   */
  async review(code, language, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `Please review the following ${language} code and provide:\n1. Overall assessment\n2. Issues found (bugs, security, performance)\n3. Suggestions for improvement\n4. Positive aspects\n\n\`\`\`${language}\n${code}\n\`\`\``;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Refactor code to improve readability, performance, or structure.
   * @param {string} code        - Original code.
   * @param {string} language    - Language of the code.
   * @param {string} [goal='']   - Specific refactoring goal.
   * @param {string} sessionId
   * @returns {Promise<{ code: string, explanation: string }>}
   */
  async refactor(code, language, goal, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const goalText = goal ? ` with a focus on: ${goal}` : '';
    const prompt = `Refactor the following ${language} code${goalText}:\n\n\`\`\`${language}\n${code}\n\`\`\``;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);

    const blocks = this.codeValidator.extractCodeBlocks(response);
    const primaryBlock = blocks[0] || { language, code: response };

    return { code: primaryBlock.code, explanation: response };
  }

  /**
   * Debug code and suggest fixes.
   * @param {string} code        - Buggy code.
   * @param {string} language    - Language of the code.
   * @param {string} [error='']  - Error message or description.
   * @param {string} sessionId
   * @returns {Promise<{ fix: string, explanation: string }>}
   */
  async debug(code, language, error, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const errorSection = error ? `\n\nError message:\n${error}` : '';
    const prompt = `Debug the following ${language} code and provide a fixed version:${errorSection}\n\n\`\`\`${language}\n${code}\n\`\`\``;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);

    const blocks = this.codeValidator.extractCodeBlocks(response);
    const primaryBlock = blocks[0] || { language, code: response };

    return { fix: primaryBlock.code, explanation: response };
  }

  /**
   * Complete a partial code snippet.
   * @param {string} partialCode - Code with a portion to be completed.
   * @param {string} language    - Language of the code.
   * @param {string} sessionId
   * @returns {Promise<string>} Completed code.
   */
  async complete(partialCode, language, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `Complete the following ${language} code snippet. Only provide the completion, not a rewrite of what's already there:\n\n\`\`\`${language}\n${partialCode}\n\`\`\``;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);

    const blocks = this.codeValidator.extractCodeBlocks(response);
    return blocks[0]?.code || response;
  }
}

module.exports = new CodingAgent();
module.exports.CodingAgent = CodingAgent;
