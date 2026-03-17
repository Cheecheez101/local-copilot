'use strict';

const { CodeValidator } = require('../../src/utils/code-validator');

describe('CodeValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new CodeValidator();
  });

  describe('validate()', () => {
    it('returns valid for correct JavaScript', () => {
      const result = validator.validate('const x = 1 + 2;', 'javascript');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid for broken JavaScript', () => {
      const result = validator.validate('const x = {;', 'javascript');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('warns about eval() usage in JavaScript', () => {
      const result = validator.validate('eval("1+1");', 'javascript');
      expect(result.warnings.some((w) => /eval/.test(w))).toBe(true);
    });

    it('warns about var usage in JavaScript', () => {
      const result = validator.validate('var x = 1;', 'javascript');
      expect(result.warnings.some((w) => /var/.test(w))).toBe(true);
    });

    it('returns valid for correct JSON', () => {
      const result = validator.validate('{"a":1}', 'json');
      expect(result.valid).toBe(true);
    });

    it('returns invalid for malformed JSON', () => {
      const result = validator.validate('{a:1}', 'json');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns valid for balanced brackets (generic)', () => {
      const result = validator.validate('{ [ () ] }', 'unknown');
      expect(result.valid).toBe(true);
    });

    it('returns invalid for unbalanced brackets (generic)', () => {
      const result = validator.validate('{ [ () }', 'unknown');
      expect(result.valid).toBe(false);
    });

    it('returns error for no code provided', () => {
      const result = validator.validate('', 'javascript');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/No code/);
    });
  });

  describe('extractCodeBlocks()', () => {
    it('extracts a single code block', () => {
      const md = '```javascript\nconst x = 1;\n```';
      const blocks = validator.extractCodeBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].language).toBe('javascript');
      expect(blocks[0].code).toBe('const x = 1;');
    });

    it('extracts multiple code blocks', () => {
      const md = '```js\nlet a = 1;\n```\n\n```python\nprint("hi")\n```';
      const blocks = validator.extractCodeBlocks(md);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].language).toBe('js');
      expect(blocks[1].language).toBe('python');
    });

    it('returns empty array for no code blocks', () => {
      expect(validator.extractCodeBlocks('no code here')).toEqual([]);
    });
  });

  describe('countMetrics()', () => {
    it('counts lines correctly', () => {
      const code = 'line1\nline2\nline3';
      const { lines } = validator.countMetrics(code, 'text');
      expect(lines).toBe(3);
    });

    it('counts JavaScript functions', () => {
      const code = 'function foo() {}\nfunction bar() {}';
      const { functions } = validator.countMetrics(code, 'javascript');
      expect(functions).toBeGreaterThanOrEqual(2);
    });

    it('returns zeros for empty code', () => {
      const result = validator.countMetrics('', 'javascript');
      expect(result).toEqual({ lines: 0, functions: 0, classes: 0 });
    });
  });
});
