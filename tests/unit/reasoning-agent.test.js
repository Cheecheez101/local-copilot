'use strict';

const { ReasoningAgent } = require('../../src/agents/reasoning-agent');

describe('ReasoningAgent fuzzy intent helpers', () => {
  let agent;

  beforeEach(() => {
    agent = new ReasoningAgent(
      { chat: jest.fn() },
      { setSystemPrompt: jest.fn(), addMessage: jest.fn(), getHistory: jest.fn().mockReturnValue([]) }
    );
  });

  it('fixes common typos', () => {
    expect(agent.fixTypos('locol directorr interuct')).toBe('local directory interact');
  });

  it('matches check files intent from typo input', () => {
    expect(agent.understandIntent('locol-copilot check files please')).toBe('check files');
  });

  it('matches run intent from close spelling', () => {
    expect(agent.matchIntent('ruun', { run: ['run'], open: ['open'] })).toBe('run');
  });
});

describe('ReasoningAgent file operations', () => {
  let agent;
  let fsCtrl;

  beforeEach(() => {
    fsCtrl = {
      readFile: jest.fn().mockResolvedValue({ success: true, path: 'a.txt', size: 5, content: 'hello' }),
      listDirectory: jest.fn().mockResolvedValue({
        success: true,
        path: 'C:\\repo',
        contents: [{ type: 'file', name: 'a.txt', size: 5 }],
      }),
      writeFile: jest.fn().mockResolvedValue({ success: true, path: 'a.txt' }),
      searchFiles: jest.fn().mockResolvedValue({ success: true, count: 1, pattern: 'a', results: [{ path: 'a.txt' }] }),
      replaceInFile: jest.fn().mockResolvedValue({ success: true, changes: 1, path: 'a.txt', preview: 'x' }),
      deleteFile: jest.fn().mockResolvedValue({ success: true, path: 'a.txt', action: 'deleted' }),
      copyFile: jest.fn().mockResolvedValue({ success: true, from: 'a.txt', to: 'b.txt' }),
      moveFile: jest.fn().mockResolvedValue({ success: true, from: 'a.txt', to: 'b.txt' }),
      undo: jest.fn().mockResolvedValue({ success: true, path: 'a.txt', action: 'restored' }),
    };
    agent = new ReasoningAgent(
      { chat: jest.fn() },
      { setSystemPrompt: jest.fn(), addMessage: jest.fn(), getHistory: jest.fn().mockReturnValue([]) },
      fsCtrl
    );
  });

  it('routes read file operations to file system controller', async () => {
    const out = await agent.reason('read file a.txt', 's1');
    expect(fsCtrl.readFile).toHaveBeenCalled();
    expect(out).toContain('File: a.txt');
  });

  it('routes list files operations to file system controller', async () => {
    const out = await agent.reason('list files in C:\\repo', 's1');
    expect(fsCtrl.listDirectory).toHaveBeenCalled();
    expect(out).toContain('Directories (0)');
  });

  it('routes write operations to file system controller', async () => {
    const out = await agent.reason('write file a.txt with "hello"', 's1');
    expect(fsCtrl.writeFile).toHaveBeenCalled();
    expect(out).toContain('File written');
  });

  it('requires confirmation for delete and executes on yes', async () => {
    const confirm = await agent.reason('delete file a.txt', 's1');
    expect(confirm.toLowerCase()).toContain('type "yes"');
    const out = await agent.process('yes', 's1');
    expect(fsCtrl.deleteFile).toHaveBeenCalledWith('a.txt', { confirmed: true });
    expect(out).toContain('Deleted');
  });

  it('supports undo operation', async () => {
    const out = await agent.reason('undo a.txt', 's1');
    expect(fsCtrl.undo).toHaveBeenCalled();
    expect(out).toContain('Restored');
  });
});
