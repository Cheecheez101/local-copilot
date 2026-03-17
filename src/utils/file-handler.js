'use strict';

const fs = require('fs');
const path = require('path');

/**
 * FileHandler – utility for reading, writing, and inspecting files on disk.
 * All methods are synchronous-friendly with async variants where helpful.
 */
class FileHandler {
  /**
   * Read a file and return its content as a string.
   * @param {string} filePath - Absolute or relative path to the file.
   * @param {string} [encoding='utf8'] - File encoding.
   * @returns {string} File contents.
   */
  readFile(filePath, encoding = 'utf8') {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }
    return fs.readFileSync(resolved, encoding);
  }

  /**
   * Write content to a file, creating parent directories if needed.
   * @param {string} filePath - Destination file path.
   * @param {string} content  - Content to write.
   * @param {string} [encoding='utf8'] - File encoding.
   */
  writeFile(filePath, content, encoding = 'utf8') {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, encoding);
  }

  /**
   * Append content to a file, creating it if it doesn't exist.
   * @param {string} filePath - Destination file path.
   * @param {string} content  - Content to append.
   */
  appendFile(filePath, content) {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, content, 'utf8');
  }

  /**
   * Delete a file.
   * @param {string} filePath - Path to the file to delete.
   */
  deleteFile(filePath) {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  }

  /**
   * Check whether a path exists on disk.
   * @param {string} filePath
   * @returns {boolean}
   */
  exists(filePath) {
    return fs.existsSync(path.resolve(filePath));
  }

  /**
   * Return metadata for a file or directory.
   * @param {string} filePath
   * @returns {{ size: number, isFile: boolean, isDirectory: boolean, mtime: Date }}
   */
  getMetadata(filePath) {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    return {
      size: stat.size,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      mtime: stat.mtime,
    };
  }

  /**
   * List the contents of a directory.
   * @param {string} dirPath - Path to the directory.
   * @param {boolean} [recursive=false] - Whether to list recursively.
   * @returns {string[]} Array of file/directory paths.
   */
  listDirectory(dirPath, recursive = false) {
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory not found: ${resolved}`);
    }

    if (!recursive) {
      return fs.readdirSync(resolved).map((name) => path.join(resolved, name));
    }

    const results = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        results.push(fullPath);
        if (fs.statSync(fullPath).isDirectory()) {
          walk(fullPath);
        }
      }
    };
    walk(resolved);
    return results;
  }

  /**
   * Detect the programming language of a file based on its extension.
   * @param {string} filePath
   * @returns {string} Language name or 'unknown'.
   */
  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap = {
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.rb': 'ruby',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.sh': 'bash',
      '.bash': 'bash',
      '.zsh': 'zsh',
      '.ps1': 'powershell',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.toml': 'toml',
      '.xml': 'xml',
      '.html': 'html',
      '.htm': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.md': 'markdown',
      '.txt': 'text',
      '.sql': 'sql',
    };
    return languageMap[ext] || 'unknown';
  }

  /**
   * Read a file and return structured information about it.
   * @param {string} filePath
   * @returns {{ path: string, language: string, content: string, lines: number, size: number }}
   */
  analyzeFile(filePath) {
    const resolved = path.resolve(filePath);
    const content = this.readFile(resolved);
    const meta = this.getMetadata(resolved);
    const language = this.detectLanguage(resolved);
    const lines = content.split('\n').length;

    return {
      path: resolved,
      language,
      content,
      lines,
      size: meta.size,
    };
  }
}

module.exports = new FileHandler();
module.exports.FileHandler = FileHandler;
