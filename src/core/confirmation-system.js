'use strict';

const { randomUUID } = require('crypto');

class ConfirmationSystem {
  constructor(fileSystem) {
    this.fileSystem = fileSystem;
    this.pendingConfirmations = new Map();
  }

  generateId() {
    return randomUUID();
  }

  async requireConfirmation(userId, operation, details = {}) {
    const confirmationId = this.generateId();

    this.pendingConfirmations.set(confirmationId, {
      userId,
      operation,
      details,
      expires: Date.now() + 60000,
    });

    return {
      requiresConfirmation: true,
      id: confirmationId,
      message: this.formatConfirmationMessage(operation, details),
      options: ['yes', 'no', 'show details'],
    };
  }

  async handleResponse(userId, confirmationId, response) {
    const confirmation = this.pendingConfirmations.get(confirmationId);

    if (!confirmation) {
      return { error: 'Confirmation expired or invalid' };
    }

    if (confirmation.userId !== userId) {
      return { error: 'Not authorized' };
    }

    if (Date.now() > confirmation.expires) {
      this.pendingConfirmations.delete(confirmationId);
      return { error: 'Confirmation expired' };
    }

    const normalized = String(response || '').toLowerCase().trim();
    if (normalized === 'show details') {
      return {
        requiresConfirmation: true,
        id: confirmationId,
        message: this.formatConfirmationMessage(confirmation.operation, confirmation.details),
        details: confirmation.details,
      };
    }

    if (normalized === 'yes') {
      const result = await this.executeOperation(confirmation.operation, confirmation.details);
      this.pendingConfirmations.delete(confirmationId);
      return result;
    }

    this.pendingConfirmations.delete(confirmationId);
    return { cancelled: true, message: 'Operation cancelled' };
  }

  async executeOperation(operation, details = {}) {
    if (!this.fileSystem) {
      return { error: 'No file system controller configured' };
    }

    switch (operation) {
      case 'delete':
        return this.fileSystem.deleteFile(details.path, { confirmed: true });
      case 'write':
        return this.fileSystem.writeFile(details.path, details.content || '', { backup: details.backup !== false });
      case 'replace':
        return this.fileSystem.replaceInFile(details.path, details.search || '', details.replace || '', { regex: !!details.regex });
      default:
        return { error: `Unsupported operation: ${operation}` };
    }
  }

  formatConfirmationMessage(operation, details = {}) {
    const messages = {
      delete: `DANGER: You are about to delete:\n   ${details.path}\n   Size: ${details.size ?? 'unknown'} bytes\n\nType "yes" to confirm deletion`,
      write: `You are about to write to:\n   ${details.path}\n   Size: ~${details.contentLength ?? String(details.content || '').length} bytes\n\nType "yes" to continue`,
      replace: `You are about to replace text in:\n   ${details.path}\n   Changes: ${details.changes ?? 'unknown'} occurrences\n\nType "yes" to continue`,
    };

    return messages[operation] || `Confirm operation: ${operation}`;
  }
}

module.exports = ConfirmationSystem;
module.exports.ConfirmationSystem = ConfirmationSystem;
