'use strict';

const modelManager = require('../core/model-manager');
const contextManager = require('../core/context-manager');
const fileHandler = require('../utils/file-handler');

const SYSTEM_PROMPT = `You are a file and document analysis agent. You help developers understand codebases, \
documentation, configuration files, and other technical documents. You extract key information, summarise content, \
identify patterns, detect issues, and answer specific questions about files. Be precise and reference specific \
sections or line numbers when relevant.`;

/**
 * FileAnalysisAgent – responsible for reading, understanding, and extracting
 * insights from files and documents.
 */
class FileAnalysisAgent {
  constructor(modelMgr, ctxMgr, fileHndlr) {
    this.modelManager = modelMgr || modelManager;
    this.contextManager = ctxMgr || contextManager;
    this.fileHandler = fileHndlr || fileHandler;
    this.role = 'fileAnalysis';
  }

  /**
   * Summarise the content of a file.
   * @param {string} filePath  - Path to the file.
   * @param {string} sessionId
   * @returns {Promise<string>} Summary.
   */
  async summarize(filePath, sessionId) {
    const fileInfo = this.fileHandler.analyzeFile(filePath);
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `Summarize the following ${fileInfo.language} file (${fileInfo.lines} lines, ${fileInfo.size} bytes):\n\nPath: ${fileInfo.path}\n\n\`\`\`${fileInfo.language}\n${fileInfo.content}\n\`\`\`\n\nProvide:\n1. A brief overview of what the file does\n2. Key components/sections\n3. Any notable patterns or potential issues`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Answer a specific question about a file's content.
   * @param {string} filePath  - Path to the file.
   * @param {string} question  - Question to answer.
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async query(filePath, question, sessionId) {
    const fileInfo = this.fileHandler.analyzeFile(filePath);
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `File: ${fileInfo.path} (${fileInfo.language})\n\n\`\`\`${fileInfo.language}\n${fileInfo.content}\n\`\`\`\n\nQuestion: ${question}`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Analyse a codebase directory and provide an overview.
   * @param {string} dirPath   - Path to the directory.
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async analyzeDirectory(dirPath, sessionId) {
    const files = this.fileHandler.listDirectory(dirPath, true);
    const fileList = files
      .filter((f) => {
        try {
          return this.fileHandler.getMetadata(f).isFile;
        } catch {
          return false;
        }
      })
      .map((f) => {
        const lang = this.fileHandler.detectLanguage(f);
        const meta = this.fileHandler.getMetadata(f);
        return `- ${f} (${lang}, ${meta.size} bytes)`;
      })
      .join('\n');

    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `Analyze the following directory structure and provide an overview of the codebase:\n\nDirectory: ${dirPath}\n\nFiles:\n${fileList}\n\nProvide:\n1. Project purpose and architecture\n2. Key components and their roles\n3. Technology stack\n4. Suggestions for improvement`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Compare two files and highlight differences/similarities.
   * @param {string} filePathA - First file path.
   * @param {string} filePathB - Second file path.
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async compare(filePathA, filePathB, sessionId) {
    const fileA = this.fileHandler.analyzeFile(filePathA);
    const fileB = this.fileHandler.analyzeFile(filePathB);

    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `Compare these two files:\n\n**File A:** ${fileA.path}\n\`\`\`${fileA.language}\n${fileA.content}\n\`\`\`\n\n**File B:** ${fileB.path}\n\`\`\`${fileB.language}\n${fileB.content}\n\`\`\`\n\nProvide:\n1. Key similarities\n2. Key differences\n3. Which is better and why (if applicable)`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }

  /**
   * Analyse text content (without reading from disk).
   * @param {string} content   - Raw text content to analyse.
   * @param {string} question  - Optional question to answer about the content.
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async analyzeContent(content, question, sessionId) {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const questionSection = question ? `\n\nQuestion: ${question}` : '\n\nPlease provide a comprehensive analysis of this content.';
    const prompt = `Analyze the following content:${questionSection}\n\nContent:\n${content}`;

    this.contextManager.addMessage(sessionId, 'user', prompt);
    const messages = this.contextManager.getHistory(sessionId);
    const response = await this.modelManager.chat(this.role, messages);

    this.contextManager.addMessage(sessionId, 'assistant', response);
    return response;
  }
}

module.exports = new FileAnalysisAgent();
module.exports.FileAnalysisAgent = FileAnalysisAgent;
