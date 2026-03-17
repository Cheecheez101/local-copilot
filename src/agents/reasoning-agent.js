'use strict';

const modelManager = require('../core/model-manager');
const contextManager = require('../core/context-manager');
const FileSystemController = require('./file-system-controller');
const { ConfirmationSystem } = require('../core/confirmation-system');

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
  constructor(modelMgr, ctxMgr, fileSystemCtrl) {
    this.modelManager = modelMgr || modelManager;
    this.contextManager = ctxMgr || contextManager;
    this.fileSystem = fileSystemCtrl || new FileSystemController();
    this.confirmationSystem = new ConfirmationSystem(this.fileSystem);
    this.pendingConfirmationBySession = new Map();
    this.requireConfirmation = true;
    this.role = 'reasoning';
  }

  async process(input, sessionId) {
    const normalized = String(input || '').trim().toLowerCase();
    if ((normalized === 'yes' || normalized === 'no' || normalized === 'show details')
      && this.pendingConfirmationBySession.has(sessionId)) {
      return this.handlePendingConfirmation(sessionId, normalized);
    }
    if (this.isFileOperation(input)) {
      return this.handleFileOperation(input, sessionId);
    }
    return this.standardReasoning(input, sessionId);
  }

  standardReasoning(input, sessionId) {
    return this.reason(input, sessionId);
  }

  isFileOperation(input) {
    const patterns = [
      /(read|open|show|display) file/i,
      /(write|save|create) file/i,
      /(edit|change|modify|update) file/i,
      /(delete|remove) file/i,
      /(list|show) files/i,
      /(search|find) (in )?files/i,
      /(copy|move) file/i,
      /(replace|find and replace)/i,
      /(undo|restore)/i,
    ];
    return patterns.some((p) => p.test(String(input || '')));
  }

  async handlePendingConfirmation(sessionId, response) {
    const confirmationId = this.pendingConfirmationBySession.get(sessionId);
    const result = await this.confirmationSystem.handleResponse(sessionId, confirmationId, response);
    if (!result?.requiresConfirmation) {
      this.pendingConfirmationBySession.delete(sessionId);
    }
    if (result.cancelled) {
      return 'Operation cancelled.';
    }
    if (result.error) {
      return `Error: ${result.error}`;
    }
    const op = result.action === 'deleted' ? 'delete' : (result.action || 'delete');
    return this.formatFileResponse(result, op);
  }

  async handleFileOperation(input, sessionId) {
    const operation = this.identifyFileOperation(input);
    const target = this.extractFileTarget(input);
    let result;

    switch (operation) {
      case 'read':
        result = await this.fileSystem.readFile(target);
        break;
      case 'list':
        result = await this.fileSystem.listDirectory(target || '.');
        break;
      case 'write':
        result = await this.fileSystem.writeFile(target, this.extractContent(input));
        break;
      case 'search':
        result = await this.fileSystem.searchFiles(this.extractSearchPattern(input), target || '.');
        break;
      case 'replace': {
        const [search, replace] = this.extractReplacePatterns(input);
        result = await this.fileSystem.replaceInFile(target, search, replace);
        break;
      }
      case 'delete':
        result = await this.fileSystem.readFile(target);
        if (!result.success) {
          break;
        }
        result = await this.confirmationSystem.requireConfirmation(sessionId, 'delete', {
          path: target,
          size: result.size,
        });
        this.pendingConfirmationBySession.set(sessionId, result.id);
        return result.message;
      case 'undo':
      case 'restore':
        result = await this.fileSystem.undo(target);
        break;
      case 'copy': {
        const [source, destination] = this.extractTwoPaths(input);
        result = await this.fileSystem.copyFile(source || target, destination || target);
        break;
      }
      case 'move': {
        const [source, destination] = this.extractTwoPaths(input);
        result = await this.fileSystem.moveFile(source || target, destination || target);
        break;
      }
      default:
        result = { success: false, error: `Unsupported file operation: ${operation}` };
    }

    return this.formatFileResponse(result, operation);
  }

  formatFileResponse(result, operation) {
    if (!result.success) {
      return `Error: ${result.error}\n\nSuggestions:\n${result.suggestions?.join('\n') || 'Check if the path exists'}`;
    }

    switch (operation) {
      case 'read':
        return `File: ${result.path} (${result.size} bytes)\n\n${result.content}`;
      case 'list': {
        const dirs = (result.contents || []).filter((c) => c.type === 'directory');
        const files = (result.contents || []).filter((c) => c.type === 'file');
        return `${result.path}\n\nDirectories (${dirs.length}):\n${dirs.map((d) => `  [DIR] ${d.name}`).join('\n')}\n\nFiles (${files.length}):\n${files.map((f) => `  [FILE] ${f.name} (${this.formatSize(f.size)})`).join('\n')}`;
      }
      case 'search':
        return `Found ${result.count} matches for "${result.pattern}"\n\n${(result.results || []).map((r) => `${r.path}`).join('\n')}`;
      case 'write':
        return `File written: ${result.path}`;
      case 'replace':
        return `Replaced ${result.changes} occurrence(s) in ${result.path}\n\nPreview:\n${result.preview}`;
      case 'delete':
        return `Deleted: ${result.path}`;
      case 'restored':
      case 'undo':
      case 'restore':
        return `Restored: ${result.path}`;
      case 'copy':
        return `Copied: ${result.from} -> ${result.to}`;
      case 'move':
        return `Moved: ${result.from} -> ${result.to}`;
      default:
        return JSON.stringify(result, null, 2);
    }
  }

  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  identifyFileOperation(input) {
    const text = String(input || '');
    if (/read|open|show|display/i.test(text)) return 'read';
    if (/list|show.*files|directory/i.test(text)) return 'list';
    if (/write|save|create/i.test(text)) return 'write';
    if (/search|find/i.test(text)) return 'search';
    if (/replace|find and replace|modify/i.test(text)) return 'replace';
    if (/delete|remove/i.test(text)) return 'delete';
    if (/undo|restore/i.test(text)) return 'undo';
    if (/copy/i.test(text)) return 'copy';
    if (/move/i.test(text)) return 'move';
    return 'unknown';
  }

  extractFileTarget(input) {
    const text = String(input || '');
    const pathMatch = text.match(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*|[A-Za-z]:\/(?:[^/\s]+\/)*[^/\s]*|\/[^/\s]+(?:\/[^/\s]+)*|[\w\-./\\]+\.[a-z0-9]+/i);
    return pathMatch ? pathMatch[0] : '.';
  }

  extractTwoPaths(input) {
    const text = String(input || '');
    const matches = text.match(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*|[A-Za-z]:\/(?:[^/\s]+\/)*[^/\s]*|\/[^/\s]+(?:\/[^/\s]+)*|[\w\-./\\]+\.[a-z0-9]+/ig) || [];
    return [matches[0], matches[1]];
  }

  extractContent(input) {
    const text = String(input || '');
    const quoteMatch = text.match(/"([^"]*)"|'([^']*)'/);
    if (quoteMatch) return quoteMatch[1] || quoteMatch[2];
    const withMatch = text.match(/with ["']?(.+?)["']?(?:\s|$)/i);
    return withMatch ? withMatch[1] : '';
  }

  extractSearchPattern(input) {
    const text = String(input || '');
    const patternMatch = text.match(/for ["']?(.+?)["']?(?:\s|$)/i);
    return patternMatch ? patternMatch[1] : '';
  }

  extractReplacePatterns(input) {
    const text = String(input || '');
    const replaceMatch = text.match(/"([^"]*)" with "([^"]*)"/);
    return replaceMatch ? [replaceMatch[1], replaceMatch[2]] : ['', ''];
  }

  /**
   * Understand coarse command intent with typo correction + fuzzy matching.
   * @param {string} userInput
   * @returns {string} Best-matched intent key or 'general'.
   */
  understandIntent(userInput) {
    const commands = {
      'check files': ['check files', 'list files', 'show files', 'whats in', 'locol', 'local'],
      run: ['run', 'execute', 'start'],
      open: ['open', 'launch', 'start'],
    };

    const cleanedInput = this.fixTypos(userInput);
    return this.matchIntent(cleanedInput, commands);
  }

  /**
   * Replace common misspellings while preserving unknown words.
   * @param {string} text
   * @returns {string}
   */
  fixTypos(text) {
    const typos = {
      locol: 'local',
      copilot: 'copilot',
      directorr: 'directory',
      interuct: 'interact',
    };

    return String(text || '').replace(/\b\w+\b/g, (word) => typos[word.toLowerCase()] || word);
  }

  /**
   * Fuzzy-match normalized input against command aliases.
   * @param {string} input
   * @param {Record<string, string[]>} commands
   * @returns {string}
   */
  matchIntent(input, commands) {
    const normalizedInput = String(input || '').toLowerCase().trim();
    if (!normalizedInput) return 'general';

    let bestIntent = 'general';
    let bestScore = 0;

    for (const [intent, aliases] of Object.entries(commands)) {
      for (const alias of aliases) {
        const normalizedAlias = alias.toLowerCase();
        if (normalizedInput.includes(normalizedAlias)) {
          return intent;
        }
        const distance = this.levenshtein(normalizedInput, normalizedAlias);
        const maxLen = Math.max(normalizedInput.length, normalizedAlias.length);
        const similarity = maxLen === 0 ? 0 : (1 - distance / maxLen);
        if (similarity > bestScore) {
          bestScore = similarity;
          bestIntent = intent;
        }
      }
    }

    return bestScore >= 0.7 ? bestIntent : 'general';
  }

  /**
   * Compute Levenshtein edit distance between two strings.
   * @param {string} a
   * @param {string} b
   * @returns {number}
   */
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
    if (this.isFileOperation(question)) {
      return this.handleFileOperation(question, sessionId);
    }
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);
    this.contextManager.addMessage(sessionId, 'user', question);

    const messages = this.contextManager.getHistory(sessionId);
    // General chat should prioritize UX when a dedicated chat model is configured.
    const chatRole = this.modelManager?.config?.models?.chat ? 'chat' : this.role;
    const response = await this.modelManager.chat(chatRole, messages);

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
