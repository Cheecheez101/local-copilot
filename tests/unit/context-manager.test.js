'use strict';

const { ContextManager } = require('../../src/core/context-manager');

describe('ContextManager', () => {
  let ctx;

  beforeEach(() => {
    ctx = new ContextManager({ maxHistory: 5 });
  });

  describe('createSession() / getSession()', () => {
    it('creates a session and returns an ID', () => {
      const id = ctx.createSession();
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(36); // UUID v4
    });

    it('stores metadata on the session', () => {
      const id = ctx.createSession({ interface: 'test' });
      const session = ctx.getSession(id);
      expect(session.metadata.interface).toBe('test');
    });

    it('returns null for an unknown session', () => {
      expect(ctx.getSession('nonexistent')).toBeNull();
    });
  });

  describe('addMessage() / getHistory()', () => {
    it('adds messages and returns them', () => {
      const id = ctx.createSession();
      ctx.addMessage(id, 'user', 'hello');
      ctx.addMessage(id, 'assistant', 'hi there');
      const history = ctx.getHistory(id);
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[1].content).toBe('hi there');
    });

    it('trims non-system messages beyond maxHistory', () => {
      const id = ctx.createSession();
      for (let i = 0; i < 10; i++) {
        ctx.addMessage(id, 'user', `msg ${i}`);
      }
      const history = ctx.getHistory(id);
      // Should be capped at maxHistory (5)
      expect(history.length).toBeLessThanOrEqual(5);
    });

    it('always preserves system messages', () => {
      const id = ctx.createSession();
      ctx.setSystemPrompt(id, 'You are helpful.');
      for (let i = 0; i < 10; i++) {
        ctx.addMessage(id, 'user', `msg ${i}`);
      }
      const history = ctx.getHistory(id);
      expect(history.filter((m) => m.role === 'system')).toHaveLength(1);
    });

    it('auto-creates session if not found when adding a message', () => {
      ctx.addMessage('new-session', 'user', 'hello');
      const history = ctx.getHistory('new-session');
      expect(history).toHaveLength(1);
    });

    it('returns empty array for unknown session', () => {
      expect(ctx.getHistory('unknown')).toEqual([]);
    });
  });

  describe('clearHistory()', () => {
    it('clears all messages', () => {
      const id = ctx.createSession();
      ctx.addMessage(id, 'user', 'hello');
      ctx.clearHistory(id);
      expect(ctx.getHistory(id)).toHaveLength(0);
    });
  });

  describe('setSystemPrompt()', () => {
    it('prepends a system message', () => {
      const id = ctx.createSession();
      ctx.setSystemPrompt(id, 'Be helpful.');
      const history = ctx.getHistory(id);
      expect(history[0].role).toBe('system');
      expect(history[0].content).toBe('Be helpful.');
    });

    it('replaces existing system messages', () => {
      const id = ctx.createSession();
      ctx.setSystemPrompt(id, 'Old prompt.');
      ctx.setSystemPrompt(id, 'New prompt.');
      const systemMessages = ctx.getHistory(id).filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0].content).toBe('New prompt.');
    });
  });

  describe('deleteSession()', () => {
    it('removes the session', () => {
      const id = ctx.createSession();
      ctx.deleteSession(id);
      expect(ctx.getSession(id)).toBeNull();
    });
  });

  describe('listSessions()', () => {
    it('lists all sessions', () => {
      const id1 = ctx.createSession();
      const id2 = ctx.createSession();
      const sessions = ctx.listSessions();
      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });
  });

  describe('runtime context memory', () => {
    it('remembers path and intent from conversation', () => {
      ctx.remember('please check files in C:\\Users\\Administrator\\projects\\local-copilot');
      const context = ctx.getRelevantContext();
      expect(context.lastPath).toContain('C:\\Users\\Administrator\\projects\\local-copilot');
      expect(context.projectPath).toContain('projects');
      expect(context.currentIntent).toBe('check files');
    });

    it('tracks recent user commands from added messages', () => {
      const id = ctx.createSession();
      ctx.addMessage(id, 'user', 'open project');
      ctx.addMessage(id, 'user', 'run tests');
      ctx.addMessage(id, 'user', 'check files');
      ctx.addMessage(id, 'user', 'another command');
      const context = ctx.getRelevantContext();
      expect(context.recentCommands).toEqual(['run tests', 'check files', 'another command']);
    });
  });
});
