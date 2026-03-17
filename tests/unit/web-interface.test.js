'use strict';

const http = require('http');
const { WebInterface } = require('../../src/interfaces/web-interface');

describe('WebInterface module', () => {
  it('loads without syntax errors', () => {
    expect(() => require('../../src/interfaces/web-interface')).not.toThrow();
  });

  it('rejects start when the configured port is already in use', async () => {
    const blocker = http.createServer();
    await new Promise((resolve, reject) => {
      blocker.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    });

    const { port } = blocker.address();
    const web = new WebInterface({ port, host: '127.0.0.1' });

    await expect(web.start()).rejects.toThrow(/already in use/i);

    await new Promise((resolve, reject) => {
      blocker.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
