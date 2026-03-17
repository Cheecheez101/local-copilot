'use strict';

const fs = require('fs');
const path = require('path');
const { CLIInterface } = require('../../src/interfaces/cli-interface');

describe('CLIInterface file access commands', () => {
  let cli;
  let tempWriteFile;

  beforeEach(() => {
    cli = new CLIInterface();
    cli.print = jest.fn();
    cli.thinking = jest.fn();
    cli.error = jest.fn();
    cli.success = jest.fn();
    cli.showSuggestions = jest.fn();
    tempWriteFile = null;
  });

  afterEach(() => {
    if (tempWriteFile && fs.existsSync(tempWriteFile)) {
      fs.unlinkSync(tempWriteFile);
    }
  });

  it('uses local file listing for /dir command', async () => {
    const listSpy = jest.spyOn(cli.fileAgent, 'listFiles').mockResolvedValue({
      path: 'C:\\repo',
      files: [{ name: 'a.js', type: 'file', size: 10 }],
    });
    const processSpy = jest.spyOn(cli.orchestrator, 'process');

    await cli.handleCommand('dir', ['C:\\repo']);

    expect(listSpy).toHaveBeenCalled();
    expect(processSpy).not.toHaveBeenCalled();
    expect(cli.showSuggestions).toHaveBeenCalledWith(expect.objectContaining({ type: 'FILE_LIST' }));
  });

  it('parses inline /dir command in free-form input', async () => {
    const cmdSpy = jest.spyOn(cli, 'handleCommand').mockResolvedValue(undefined);
    await cli.handleMessage('open this folder and read it /dir C:\\Users\\Administrator\\projects\\local-copilot');
    expect(cmdSpy).toHaveBeenCalledWith('dir', ['C:\\Users\\Administrator\\projects\\local-copilot']);
  });

  it('writes file via /write', async () => {
    tempWriteFile = path.join(process.cwd(), 'tmp-cli-write-test.txt');
    await cli.handleCommand('write', [`--file=${tempWriteFile}`, '--content=hello']);
    expect(cli.success).toHaveBeenCalled();
  });
});
