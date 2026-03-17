'use strict';

const fs = require('fs').promises;
const path = require('path');

class FileAgent {
  async listFiles(directory) {
    try {
      const normalizedPath = path.normalize(directory);
      await fs.access(normalizedPath);
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true });

      const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(normalizedPath, entry.name);
        let size = null;
        if (entry.isFile()) {
          const stats = await fs.stat(fullPath);
          size = stats.size;
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
          size,
          extension: path.extname(entry.name),
        };
      }));

      return {
        path: normalizedPath,
        files,
      };
    } catch (error) {
      return {
        error: true,
        message: `Cannot access ${directory}: ${error.message}`,
        suggestions: [
          'Check if path exists',
          'Use forward slashes: C:/Users/...',
          'Try: "list files in current folder"',
        ],
      };
    }
  }

  async findExecutables(directory) {
    const files = await this.listFiles(directory);
    if (files.error) return files;

    const exes = files.files.filter((f) => f.extension.toLowerCase() === '.exe');
    if (exes.length === 0) {
      return {
        found: false,
        message: 'No .exe files found',
        suggestion: 'Looking for something else? Try: "find .js files"',
      };
    }

    return {
      found: true,
      count: exes.length,
      files: exes,
      command: exes[0] ? `To run: ${path.join(files.path, exes[0].name)}` : null,
    };
  }
}

module.exports = new FileAgent();
module.exports.FileAgent = FileAgent;
