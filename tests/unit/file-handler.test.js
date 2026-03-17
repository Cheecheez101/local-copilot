'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { FileHandler } = require('../../src/utils/file-handler');

describe('FileHandler', () => {
  let handler;
  let tmpDir;

  beforeEach(() => {
    handler = new FileHandler();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('writeFile() / readFile()', () => {
    it('writes and reads a file', () => {
      const file = path.join(tmpDir, 'hello.txt');
      handler.writeFile(file, 'hello world');
      expect(handler.readFile(file)).toBe('hello world');
    });

    it('creates parent directories automatically', () => {
      const file = path.join(tmpDir, 'sub', 'dir', 'file.txt');
      handler.writeFile(file, 'nested');
      expect(handler.readFile(file)).toBe('nested');
    });

    it('throws for a non-existent file', () => {
      expect(() => handler.readFile('/nonexistent/path.txt')).toThrow();
    });
  });

  describe('appendFile()', () => {
    it('appends content to an existing file', () => {
      const file = path.join(tmpDir, 'append.txt');
      handler.writeFile(file, 'line1\n');
      handler.appendFile(file, 'line2\n');
      expect(handler.readFile(file)).toBe('line1\nline2\n');
    });
  });

  describe('deleteFile()', () => {
    it('deletes an existing file', () => {
      const file = path.join(tmpDir, 'delete.txt');
      handler.writeFile(file, 'bye');
      handler.deleteFile(file);
      expect(handler.exists(file)).toBe(false);
    });

    it('does not throw when deleting a non-existent file', () => {
      expect(() => handler.deleteFile('/nonexistent/file.txt')).not.toThrow();
    });
  });

  describe('exists()', () => {
    it('returns true for an existing path', () => {
      const file = path.join(tmpDir, 'exists.txt');
      handler.writeFile(file, 'yes');
      expect(handler.exists(file)).toBe(true);
    });

    it('returns false for a missing path', () => {
      expect(handler.exists(path.join(tmpDir, 'nope.txt'))).toBe(false);
    });
  });

  describe('getMetadata()', () => {
    it('returns correct metadata for a file', () => {
      const file = path.join(tmpDir, 'meta.txt');
      handler.writeFile(file, 'content');
      const meta = handler.getMetadata(file);
      expect(meta.isFile).toBe(true);
      expect(meta.isDirectory).toBe(false);
      expect(meta.size).toBeGreaterThan(0);
      expect(typeof meta.mtime.getTime).toBe('function');
    });
  });

  describe('listDirectory()', () => {
    it('lists files in a directory', () => {
      handler.writeFile(path.join(tmpDir, 'a.txt'), 'a');
      handler.writeFile(path.join(tmpDir, 'b.txt'), 'b');
      const entries = handler.listDirectory(tmpDir);
      expect(entries.length).toBe(2);
    });

    it('lists recursively', () => {
      handler.writeFile(path.join(tmpDir, 'sub', 'c.txt'), 'c');
      const entries = handler.listDirectory(tmpDir, true);
      expect(entries.some((e) => e.endsWith('c.txt'))).toBe(true);
    });

    it('throws for a non-existent directory', () => {
      expect(() => handler.listDirectory('/nonexistent')).toThrow();
    });
  });

  describe('detectLanguage()', () => {
    const cases = [
      ['file.js', 'javascript'],
      ['file.ts', 'typescript'],
      ['file.py', 'python'],
      ['file.json', 'json'],
      ['file.md', 'markdown'],
      ['file.xyz', 'unknown'],
    ];

    test.each(cases)('detects %s as %s', (filename, expected) => {
      expect(handler.detectLanguage(filename)).toBe(expected);
    });
  });

  describe('analyzeFile()', () => {
    it('returns structured info for a file', () => {
      const file = path.join(tmpDir, 'code.js');
      handler.writeFile(file, 'const x = 1;\nconst y = 2;');
      const info = handler.analyzeFile(file);
      expect(info.language).toBe('javascript');
      expect(info.lines).toBe(2);
      expect(info.content).toContain('const x');
    });
  });
});
