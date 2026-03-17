'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ExecutionAgent } = require('../../src/agents/execution-agent');

describe('ExecutionAgent', () => {
  let tmpDir;
  let agent;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-agent-'));
    fs.writeFileSync(path.join(tmpDir, 'note.txt'), 'hello');
    agent = new ExecutionAgent();
    agent.currentDir = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('blocks dangerous commands', async () => {
    const result = await agent.execute('del', ['note.txt']);
    expect(result.safe).toBe(false);
    expect(result.message).toContain("won't run");
  });

  it('lists files for dir command', async () => {
    const result = await agent.execute('dir', []);
    expect(result.success).toBe(true);
    expect(result.output).toContain('note.txt');
  });

  it('reads file with type command', async () => {
    const result = await agent.execute('type', ['note.txt']);
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello');
  });
});
