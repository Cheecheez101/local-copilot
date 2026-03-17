'use strict';

describe('WebInterface module', () => {
  it('loads without syntax errors', () => {
    expect(() => require('../../src/interfaces/web-interface')).not.toThrow();
  });
});
