'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileAgent } = require('../../src/agents/file-agent');

describe('FileAgent', () => {
  let tmpDir;
  let agent;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-agent-'));
    agent = new FileAgent();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists files with metadata', async () => {
    fs.writeFileSync(path.join(tmpDir, 'app.exe'), 'abc');
    fs.mkdirSync(path.join(tmpDir, 'nested'));

    const result = await agent.listFiles(tmpDir);
    expect(result.error).toBeUndefined();
    expect(result.path).toBe(path.normalize(tmpDir));
    expect(result.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'app.exe', type: 'file', extension: '.exe', size: 3 }),
      expect.objectContaining({ name: 'nested', type: 'folder', extension: '', size: null }),
    ]));
  });

  it('returns an error payload for invalid paths', async () => {
    const result = await agent.listFiles(path.join(tmpDir, 'missing-dir'));
    expect(result.error).toBe(true);
    expect(result.message).toContain('Cannot access');
    expect(Array.isArray(result.suggestions)).toBe(true);
  });

  it('finds executable files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'tool.exe'), 'abc');
    const result = await agent.findExecutables(tmpDir);
    expect(result.found).toBe(true);
    expect(result.count).toBe(1);
    expect(result.command).toContain('tool.exe');
  });
});
