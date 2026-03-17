'use strict';

const { ConfirmationSystem } = require('../../src/core/confirmation-system');

describe('ConfirmationSystem', () => {
  let fileSystem;
  let confirmations;

  beforeEach(() => {
    fileSystem = {
      deleteFile: jest.fn().mockResolvedValue({ success: true, action: 'deleted' }),
      writeFile: jest.fn().mockResolvedValue({ success: true, action: 'written' }),
      replaceInFile: jest.fn().mockResolvedValue({ success: true, action: 'replaced' }),
    };
    confirmations = new ConfirmationSystem(fileSystem);
  });

  it('creates pending confirmation entries', async () => {
    const res = await confirmations.requireConfirmation('u1', 'delete', { path: 'a.txt', size: 10 });
    expect(res.requiresConfirmation).toBe(true);
    expect(res.id).toBeTruthy();
    expect(confirmations.pendingConfirmations.has(res.id)).toBe(true);
  });

  it('executes operation on yes', async () => {
    const req = await confirmations.requireConfirmation('u1', 'delete', { path: 'a.txt', size: 10 });
    const out = await confirmations.handleResponse('u1', req.id, 'yes');
    expect(fileSystem.deleteFile).toHaveBeenCalledWith('a.txt', { confirmed: true });
    expect(out.success).toBe(true);
  });

  it('rejects unauthorized confirmation response', async () => {
    const req = await confirmations.requireConfirmation('u1', 'write', { path: 'a.txt', content: 'x' });
    const out = await confirmations.handleResponse('u2', req.id, 'yes');
    expect(out.error).toBe('Not authorized');
  });

  it('cancels on non-yes response', async () => {
    const req = await confirmations.requireConfirmation('u1', 'replace', { path: 'a.txt' });
    const out = await confirmations.handleResponse('u1', req.id, 'no');
    expect(out.cancelled).toBe(true);
  });
});
