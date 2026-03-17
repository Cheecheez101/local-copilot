'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class FileSystemController {
  constructor() {
    this.workspaceRoot = path.resolve(process.cwd());
    this.allowedExtensions = ['.js', '.ts', '.json', '.md', '.txt', '.html', '.css', '.py'];
    this.blockedPaths = [
      'C:\\Windows',
      'C:\\Program Files',
      '/etc',
      '/usr',
      'node_modules',
    ];
    this.operationLog = [];
    this.backups = new Map();
  }

  async readFile(filePath) {
    try {
      const fullPath = this.resolvePath(filePath);
      this.checkAccess(fullPath, 'read');

      const content = await fs.readFile(fullPath, 'utf8');
      const stats = await fs.stat(fullPath);

      this.log('read', fullPath);

      return {
        success: true,
        content,
        path: fullPath,
        size: stats.size,
        modified: stats.mtime,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }

  async listDirectory(dirPath = '.') {
    try {
      const fullPath = this.resolvePath(dirPath);
      this.checkAccess(fullPath, 'read');

      const items = await fs.readdir(fullPath, { withFileTypes: true });

      const contents = await Promise.all(items.map(async (item) => {
        const itemPath = path.join(fullPath, item.name);
        const stats = await fs.stat(itemPath);

        return {
          name: item.name,
          type: item.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          modified: stats.mtime,
          extension: path.extname(item.name),
          path: itemPath,
        };
      }));

      return {
        success: true,
        path: fullPath,
        contents,
        count: contents.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async searchFiles(pattern, location = '.') {
    try {
      const results = [];
      const fullPath = this.resolvePath(location);
      this.checkAccess(fullPath, 'read');

      const regex = (() => {
        try {
          return new RegExp(pattern);
        } catch {
          return new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
      })();

      const walk = async (dir) => {
        const files = await fs.readdir(dir, { withFileTypes: true });

        for (const file of files) {
          const filePath = path.join(dir, file.name);
          if (this.isBlockedPath(filePath)) continue;

          if (file.isDirectory()) {
            await walk(filePath);
          } else if (file.name.includes(pattern) || regex.test(file.name)) {
            const stats = await fs.stat(filePath);
            results.push({
              name: file.name,
              path: filePath,
              size: stats.size,
              modified: stats.mtime,
            });
          }
        }
      };

      await walk(fullPath);

      return {
        success: true,
        pattern,
        results,
        count: results.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async writeFile(filePath, content, options = {}) {
    try {
      const fullPath = this.resolvePath(filePath);
      this.checkAccess(fullPath, 'write');

      if (await this.fileExists(fullPath) && options.backup !== false) {
        await this.createBackup(fullPath);
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, String(content ?? ''), 'utf8');

      this.log('write', fullPath, { size: String(content ?? '').length });

      return {
        success: true,
        path: fullPath,
        action: 'written',
        backup: this.backups.has(fullPath),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async appendToFile(filePath, content) {
    try {
      const fullPath = this.resolvePath(filePath);
      this.checkAccess(fullPath, 'write');

      await fs.appendFile(fullPath, String(content ?? ''), 'utf8');
      this.log('append', fullPath);

      return {
        success: true,
        path: fullPath,
        action: 'appended',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async replaceInFile(filePath, search, replace, options = {}) {
    try {
      const fullPath = this.resolvePath(filePath);
      this.checkAccess(fullPath, 'write');

      const content = await fs.readFile(fullPath, 'utf8');
      await this.createBackup(fullPath);

      const regex = options.regex
        ? new RegExp(search, 'g')
        : new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const changes = (content.match(regex) || []).length;
      const newContent = content.replace(regex, replace);

      await fs.writeFile(fullPath, newContent, 'utf8');

      this.log('replace', fullPath, { changes });

      return {
        success: true,
        path: fullPath,
        changes,
        preview: `${newContent.substring(0, 200)}...`,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async deleteFile(filePath, options = {}) {
    try {
      const fullPath = this.resolvePath(filePath);
      this.checkAccess(fullPath, 'delete');

      if (!options.confirmed) {
        return {
          success: false,
          requiresConfirmation: true,
          message: `Are you sure you want to delete: ${fullPath}?`,
          size: (await fs.stat(fullPath)).size,
          type: 'file',
        };
      }

      if (options.backup !== false) {
        await this.createBackup(fullPath, { isDelete: true });
      }

      await fs.unlink(fullPath);
      this.log('delete', fullPath);

      return {
        success: true,
        path: fullPath,
        action: 'deleted',
        backup: this.backups.has(fullPath),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async createDirectory(dirPath) {
    try {
      const fullPath = this.resolvePath(dirPath);
      this.checkAccess(fullPath, 'write');

      await fs.mkdir(fullPath, { recursive: true });
      this.log('mkdir', fullPath);

      return {
        success: true,
        path: fullPath,
        action: 'created',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async copyFile(source, destination) {
    try {
      const sourcePath = this.resolvePath(source);
      const destPath = this.resolvePath(destination);

      this.checkAccess(sourcePath, 'read');
      this.checkAccess(destPath, 'write');

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(sourcePath, destPath);

      this.log('copy', sourcePath, { destination: destPath });

      return {
        success: true,
        from: sourcePath,
        to: destPath,
        action: 'copied',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async moveFile(source, destination) {
    try {
      const sourcePath = this.resolvePath(source);
      const destPath = this.resolvePath(destination);

      this.checkAccess(sourcePath, 'delete');
      this.checkAccess(destPath, 'write');

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.rename(sourcePath, destPath);

      this.log('move', sourcePath, { destination: destPath });

      return {
        success: true,
        from: sourcePath,
        to: destPath,
        action: 'moved',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async undo(filePath) {
    const fullPath = this.resolvePath(filePath);
    const backupPath = `${fullPath}.backup`;

    if (!(await this.fileExists(backupPath))) {
      return {
        success: false,
        error: 'No backup found for this file',
      };
    }

    await fs.copyFile(backupPath, fullPath);
    await fs.unlink(backupPath);
    this.backups.delete(fullPath);

    return {
      success: true,
      path: fullPath,
      action: 'restored',
    };
  }

  resolvePath(inputPath) {
    const raw = String(inputPath || '.');
    const resolved = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(this.workspaceRoot, raw);
    return path.normalize(resolved);
  }

  isBlockedPath(filePath) {
    const normalized = String(filePath).replace(/\//g, '\\').toLowerCase();
    return this.blockedPaths.some((blocked) => {
      const b = blocked.replace(/\//g, '\\').toLowerCase();
      if (b.includes('node_modules')) return normalized.includes('\\node_modules\\');
      return normalized.startsWith(path.normalize(b).toLowerCase());
    });
  }

  checkAccess(filePath, operation) {
    const fullPath = this.resolvePath(filePath);

    if (this.isBlockedPath(fullPath)) {
      throw new Error(`Access denied: Cannot ${operation} blocked path: ${fullPath}`);
    }

    const normalizedWorkspace = path.normalize(this.workspaceRoot).toLowerCase();
    const normalizedTarget = path.normalize(fullPath).toLowerCase();
    if (!normalizedTarget.startsWith(normalizedWorkspace)) {
      throw new Error(`Access denied: Can only access files within: ${this.workspaceRoot}`);
    }

    if (operation === 'write' || operation === 'delete') {
      const ext = path.extname(fullPath).toLowerCase();
      if (ext && !this.allowedExtensions.includes(ext)) {
        throw new Error(`Access denied: Cannot ${operation} ${ext} files for safety`);
      }
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async createBackup(filePath, options = {}) {
    const backupPath = `${filePath}.backup`;
    await fs.copyFile(filePath, backupPath);
    this.backups.set(filePath, {
      path: backupPath,
      timestamp: Date.now(),
      isDelete: options.isDelete || false,
      id: crypto.createHash('sha1').update(`${filePath}:${Date.now()}`).digest('hex'),
    });
  }

  log(operation, targetPath, details = {}) {
    this.operationLog.push({
      operation,
      path: targetPath,
      timestamp: Date.now(),
      ...details,
    });
  }

  getOperationLog(limit = 50) {
    return this.operationLog.slice(-limit);
  }
}

module.exports = FileSystemController;
