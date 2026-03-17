'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const FileSystemController = require('../../src/agents/file-system-controller');

describe('FileSystemController', () => {
  let tempRoot;
  let controller;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fsc-'));
    controller = new FileSystemController();
    controller.workspaceRoot = tempRoot;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes and reads a file', async () => {
    const file = path.join(tempRoot, 'a.txt');
    const writeRes = await controller.writeFile(file, 'hello');
    expect(writeRes.success).toBe(true);

    const readRes = await controller.readFile(file);
    expect(readRes.success).toBe(true);
    expect(readRes.content).toBe('hello');
  });

  it('requires confirmation before delete', async () => {
    const file = path.join(tempRoot, 'b.txt');
    fs.writeFileSync(file, 'x');
    const res = await controller.deleteFile(file);
    expect(res.success).toBe(false);
    expect(res.requiresConfirmation).toBe(true);
  });

  it('blocks disallowed extensions for write', async () => {
    const file = path.join(tempRoot, 'danger.exe');
    const res = await controller.writeFile(file, 'x');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Access denied/i);
  });
});
