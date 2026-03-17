'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * ContextManager – maintains per-session conversation history and metadata.
 *
 * Each session holds a sliding window of messages so that the model always
 * receives relevant context without exceeding its context window.
 */
class ContextManager {
  constructor(options = {}) {
    this.maxHistory = options.maxHistory || 20;
    this.sessions = new Map();
    this.runtimeContext = {
      os: process.platform,
      cwd: process.cwd(),
      previousCommands: [],
      userPreferences: {},
      sessionStart: Date.now(),
      lastPath: undefined,
      projectPath: undefined,
      currentIntent: undefined,
    };
  }

  remember(conversation) {
    const text = String(conversation || '');
    if (!text) return;

    const extractedPath = this.extractPath(text);
    if (extractedPath) {
      this.runtimeContext.lastPath = extractedPath;
    }

    const projectMatch = text.match(/[A-Za-z]:\\[^"'`\r\n]*projects(?:\\[^"'`\r\n]*)?/i)
      || text.match(/[A-Za-z]:\/[^"'`\r\n]*projects(?:\/[^"'`\r\n]*)?/i);
    if (projectMatch?.[0]) {
      this.runtimeContext.projectPath = projectMatch[0];
    }

    this.runtimeContext.currentIntent = this.detectIntent(text);
  }

  extractPath(text) {
    const windowsPath = String(text || '').match(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/);
    if (windowsPath?.[0]) return windowsPath[0];
    const slashPath = String(text || '').match(/[A-Za-z]:\/(?:[^/:\r\n]+\/)*[^/:\r\n]*/);
    return slashPath?.[0] || null;
  }

  detectIntent(text) {
    const input = String(text || '').toLowerCase();
    if (/list|show|check|scan/.test(input) && /file|folder|dir|directory/.test(input)) return 'check files';
    if (/\brun\b|\bexecute\b|\bstart\b/.test(input)) return 'run';
    if (/\bopen\b|\blaunch\b/.test(input)) return 'open';
    if (/\btest\b/.test(input)) return 'test';
    return 'general';
  }

  getRelevantContext() {
    return {
      os: this.runtimeContext.os,
      lastPath: this.runtimeContext.lastPath,
      projectPath: this.runtimeContext.projectPath,
      recentCommands: this.runtimeContext.previousCommands.slice(-3),
      currentIntent: this.runtimeContext.currentIntent,
    };
  }

  /**
   * Create a new session and return its ID.
   * @param {object} [metadata={}] - Optional metadata to attach to the session.
   * @returns {string} Session ID.
   */
  createSession(metadata = {}) {
    const id = uuidv4();
    this.sessions.set(id, {
      id,
      metadata,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  /**
   * Retrieve a session by ID.
   * @param {string} sessionId
   * @returns {object|null}
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Delete a session.
   * @param {string} sessionId
   */
  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Add a message to a session's history.
   * Automatically trims the history to stay within `maxHistory`.
   *
   * @param {string} sessionId
   * @param {'user'|'assistant'|'system'} role
   * @param {string} content
   */
  addMessage(sessionId, role, content) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      // Auto-create session if it doesn't exist
      const id = sessionId;
      session = { id, metadata: {}, messages: [], createdAt: new Date(), updatedAt: new Date() };
      this.sessions.set(id, session);
    }

    session.messages.push({ role, content, timestamp: new Date() });
    session.updatedAt = new Date();
    if (role === 'user') {
      this.runtimeContext.previousCommands.push(String(content || ''));
      if (this.runtimeContext.previousCommands.length > 50) {
        this.runtimeContext.previousCommands = this.runtimeContext.previousCommands.slice(-50);
      }
      this.remember(content);
    }

    // Keep only the last N non-system messages, but always preserve system messages
    const systemMessages = session.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = session.messages.filter((m) => m.role !== 'system');

    if (nonSystemMessages.length > this.maxHistory) {
      const trimmed = nonSystemMessages.slice(nonSystemMessages.length - this.maxHistory);
      session.messages = [...systemMessages, ...trimmed];
    }
  }

  /**
   * Get the message history for a session formatted for the model API.
   * @param {string} sessionId
   * @returns {Array<{ role: string, content: string }>}
   */
  getHistory(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.messages.map(({ role, content }) => ({ role, content }));
  }

  /**
   * Clear all messages from a session (but keep the session itself).
   * @param {string} sessionId
   */
  clearHistory(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = [];
      session.updatedAt = new Date();
    }
  }

  /**
   * Inject a system prompt into the session.
   * Replaces any existing system messages.
   * @param {string} sessionId
   * @param {string} systemPrompt
   */
  setSystemPrompt(sessionId, systemPrompt) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      const id = sessionId;
      session = { id, metadata: {}, messages: [], createdAt: new Date(), updatedAt: new Date() };
      this.sessions.set(id, session);
    }

    // Remove existing system messages
    session.messages = session.messages.filter((m) => m.role !== 'system');
    // Prepend new system message
    session.messages.unshift({ role: 'system', content: systemPrompt, timestamp: new Date() });
    session.updatedAt = new Date();
  }

  /**
   * Get a summary of all active sessions.
   * @returns {Array<{ id: string, messageCount: number, createdAt: Date, updatedAt: Date }>}
   */
  listSessions() {
    return Array.from(this.sessions.values()).map(({ id, messages, createdAt, updatedAt, metadata }) => ({
      id,
      messageCount: messages.length,
      createdAt,
      updatedAt,
      metadata,
    }));
  }
}

module.exports = new ContextManager();
module.exports.ContextManager = ContextManager;
