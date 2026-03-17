'use strict';

const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');

class ExecutionAgent {
  constructor() {
    this.allowedCommands = [
      'dir', 'ls', 'cd', 'pwd',
      'node', 'npm', 'git',
      'echo', 'type', 'cat',
    ];
    this.currentDir = process.cwd();
  }

  isDangerous(command, args = []) {
    const cmd = String(command || '').toLowerCase().trim();
    if (!this.allowedCommands.includes(cmd)) return true;
    if (!Array.isArray(args)) return true;
    return args.some((arg) => /[;&|><`]/.test(String(arg)));
  }

  async execute(command, args = []) {
    const cmd = String(command || '').toLowerCase().trim();
    const normalizedArgs = Array.isArray(args) ? args.map((a) => String(a)) : [];

    if (this.isDangerous(cmd, normalizedArgs)) {
      return {
        safe: false,
        message: `⚠️ For safety, I won't run: ${cmd || command}`,
        alternative: `Here's what I can do instead: ${this.suggestAlternative(cmd)}`,
      };
    }

    if (cmd === 'pwd') {
      return { success: true, output: this.currentDir, command: 'pwd' };
    }

    if (cmd === 'cd') {
      const target = normalizedArgs[0] || this.currentDir;
      const resolved = path.resolve(this.currentDir, target);
      try {
        const stats = await fs.stat(resolved);
        if (!stats.isDirectory()) {
          return { success: false, output: `Not a directory: ${resolved}`, command: `cd ${target}` };
        }
        this.currentDir = resolved;
        return { success: true, output: this.currentDir, command: `cd ${target}` };
      } catch (error) {
        return { success: false, output: `Cannot access ${resolved}: ${error.message}`, command: `cd ${target}` };
      }
    }

    if (cmd === 'dir' || cmd === 'ls') {
      try {
        const target = normalizedArgs[0] ? path.resolve(this.currentDir, normalizedArgs[0]) : this.currentDir;
        const entries = await fs.readdir(target, { withFileTypes: true });
        const output = entries.map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
        return { success: true, output, command: `${cmd} ${normalizedArgs.join(' ')}`.trim() };
      } catch (error) {
        return { success: false, output: error.message, command: `${cmd} ${normalizedArgs.join(' ')}`.trim() };
      }
    }

    if (cmd === 'type' || cmd === 'cat') {
      try {
        const file = normalizedArgs[0];
        if (!file) return { success: false, output: 'Missing file path', command: cmd };
        const content = await fs.readFile(path.resolve(this.currentDir, file), 'utf8');
        return { success: true, output: content, command: `${cmd} ${file}` };
      } catch (error) {
        return { success: false, output: error.message, command: `${cmd} ${normalizedArgs.join(' ')}`.trim() };
      }
    }

    if (cmd === 'echo') {
      return { success: true, output: normalizedArgs.join(' '), command: `echo ${normalizedArgs.join(' ')}`.trim() };
    }

    const realCmd = process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd;
    return new Promise((resolve) => {
      execFile(realCmd, normalizedArgs, { cwd: this.currentDir, windowsHide: true }, (error, stdout, stderr) => {
        resolve({
          success: !error,
          output: (stdout || stderr || '').trim(),
          command: `${cmd} ${normalizedArgs.join(' ')}`.trim(),
        });
      });
    });
  }

  suggestAlternative(command) {
    const alternatives = {
      del: 'list files first with "dir"',
      format: 'cannot format drives',
      shutdown: 'cannot shutdown system',
    };
    return alternatives[command] || 'ask me to explain the command instead';
  }
}

module.exports = new ExecutionAgent();
module.exports.ExecutionAgent = ExecutionAgent;
