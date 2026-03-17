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
    const isExcludedPath = (p) => {
      const normalized = String(p).replace(/\\/g, '/').toLowerCase();
      return normalized.includes('/node_modules/')
        || normalized.includes('/.git/')
        || normalized.includes('/dist/')
        || normalized.includes('/build/')
        || normalized.includes('/coverage/');
    };

    const fileEntries = files
      .filter((f) => {
        try {
          return this.fileHandler.getMetadata(f).isFile && !isExcludedPath(f);
        } catch {
          return false;
        }
      })
      .map((f) => {
        const lang = this.fileHandler.detectLanguage(f);
        const meta = this.fileHandler.getMetadata(f);
        return { path: f, lang, size: meta.size };
      });

    const MAX_FILES = 250;
    const MAX_FILELIST_CHARS = 14000;
    const limitedFiles = fileEntries.slice(0, MAX_FILES);
    let fileList = '';
    for (const entry of limitedFiles) {
      const line = `- ${entry.path} (${entry.lang}, ${entry.size} bytes)\n`;
      if (fileList.length + line.length > MAX_FILELIST_CHARS) {
        break;
      }
      fileList += line;
    }

    const languageCounts = new Map();
    let totalSize = 0;
    for (const entry of fileEntries) {
      totalSize += entry.size;
      languageCounts.set(entry.lang, (languageCounts.get(entry.lang) || 0) + 1);
    }
    const topLanguages = Array.from(languageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([lang, count]) => `${lang}: ${count}`)
      .join(', ');
    const omitted = fileEntries.length - limitedFiles.length;

    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const prompt = `Analyze this directory and provide a high-level codebase overview.

Directory: ${dirPath}
Total files considered: ${fileEntries.length}
Total size: ${totalSize} bytes
Top languages: ${topLanguages || 'unknown'}
${omitted > 0 ? `Omitted from listing due to limits: ${omitted}` : ''}

Sample file listing (truncated):
${fileList || '- (no files listed)'}

Provide:
1. Project purpose and architecture
2. Key components and their roles
3. Technology stack
4. Suggestions for improvement`;

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

  /**
   * Analyse an uploaded image via OpenAI-compatible multimodal message format.
   * @param {string} imageDataUrl - Data URL, e.g. data:image/png;base64,...
   * @param {string} mimeType
   * @param {string} question
   * @param {string} sessionId
   * @param {string} fileName
   * @returns {Promise<string>}
   */
  async analyzeImage(imageDataUrl, mimeType, question, sessionId, fileName = 'uploaded-image') {
    this.contextManager.setSystemPrompt(sessionId, SYSTEM_PROMPT);

    const textPrompt = question
      ? `Analyze this uploaded image (${fileName}, ${mimeType}) and answer: ${question}`
      : `Analyze this uploaded image (${fileName}, ${mimeType}). Describe what it contains and any important technical details.`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ];

    try {
      const response = await this.modelManager.chat(this.role, messages, { maxTokens: 512, temperature: 0.1 });
      this.contextManager.addMessage(sessionId, 'user', `[image] ${fileName} (${mimeType}) ${question || ''}`.trim());
      this.contextManager.addMessage(sessionId, 'assistant', response);
      return response;
    } catch (err) {
      const msg = String(err?.message || err);
      if (/failed to allocate memory|bfcarena|out of memory|non-zero status code|bad allocation/i.test(msg)) {
        throw new Error(
          'Image analysis ran out of memory. Upload a smaller screenshot (the web app now auto-compresses), or switch fileAnalysis to a lighter vision model.'
        );
      }
      if (/image|vision|multimodal|unsupported/i.test(msg)) {
        throw new Error(
          'Current file-analysis model does not support image input. Use a vision-capable model in config/default.json for fileAnalysis.'
        );
      }
      throw err;
    }
  }
}

module.exports = new FileAnalysisAgent();
module.exports.FileAnalysisAgent = FileAnalysisAgent;
