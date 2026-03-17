'use strict';

/**
 * CodeValidator – utility for validating code syntax and quality.
 * Performs lightweight, dependency-free checks using regex and structural
 * analysis. For a richer experience, deeper AST-based analysis is delegated
 * to the coding-agent.
 */
class CodeValidator {
  /**
   * Validate a snippet of code for the given language.
   * @param {string} code     - Source code to validate.
   * @param {string} language - Language identifier (e.g. 'javascript', 'python').
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  validate(code, language) {
    if (!code || typeof code !== 'string') {
      return { valid: false, errors: ['No code provided'], warnings: [] };
    }

    const lang = (language || '').toLowerCase();

    switch (lang) {
      case 'javascript':
      case 'js':
      case 'typescript':
      case 'ts':
        return this._validateJavaScript(code);
      case 'python':
      case 'py':
        return this._validatePython(code);
      case 'json':
        return this._validateJson(code);
      default:
        return this._validateGeneric(code);
    }
  }

  /**
   * Lightweight JavaScript/TypeScript validation.
   * Uses Node's built-in `vm` module to attempt compilation.
   * @param {string} code
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  _validateJavaScript(code) {
    const errors = [];
    const warnings = [];

    try {
      // Use the vm module for a cheap syntax check
      const vm = require('vm');
      new vm.Script(code);
    } catch (err) {
      errors.push(`Syntax error: ${err.message}`);
    }

    // Style warnings
    if (/\beval\s*\(/.test(code)) {
      warnings.push('Use of eval() is discouraged for security reasons.');
    }
    if (/\bdebugger\b/.test(code)) {
      warnings.push('debugger statement found – remove before production.');
    }
    if (/console\.(log|warn|error)\(/.test(code)) {
      warnings.push('console statements detected – consider using a proper logger.');
    }
    if (/var\s+/.test(code)) {
      warnings.push('Prefer `const`/`let` over `var`.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Lightweight Python validation via structural checks.
   * @param {string} code
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  _validatePython(code) {
    const errors = [];
    const warnings = [];
    const lines = code.split('\n');

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      // Detect mixed indentation
      if (/^ +\t|^\t+ /.test(line)) {
        errors.push(`Line ${lineNo}: Mixed tabs and spaces in indentation.`);
      }
    });

    // Warning checks
    if (/\bexec\s*\(/.test(code)) {
      warnings.push('Use of exec() is discouraged for security reasons.');
    }
    if (/\beval\s*\(/.test(code)) {
      warnings.push('Use of eval() is discouraged for security reasons.');
    }
    if (/print\s*\(/.test(code)) {
      warnings.push('print() statements detected – consider using the `logging` module.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * JSON syntax validation.
   * @param {string} code
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  _validateJson(code) {
    const errors = [];
    const warnings = [];

    try {
      JSON.parse(code);
    } catch (err) {
      errors.push(`JSON parse error: ${err.message}`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Generic validation for unsupported languages (bracket balancing, etc.).
   * @param {string} code
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  _validateGeneric(code) {
    const errors = [];
    const warnings = [];

    // Bracket balance check
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const closers = new Set(Object.values(pairs));
    const stack = [];

    for (const ch of code) {
      if (pairs[ch]) {
        stack.push(pairs[ch]);
      } else if (closers.has(ch)) {
        if (stack.length === 0 || stack[stack.length - 1] !== ch) {
          errors.push(`Unmatched bracket: '${ch}'`);
          break;
        }
        stack.pop();
      }
    }

    if (stack.length > 0) {
      errors.push(`Unclosed brackets detected: ${stack.join('')}`);
    }

    if (code.length === 0) {
      warnings.push('Empty code snippet.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Extract the code blocks from a markdown-formatted string.
   * Useful for pulling code out of model responses.
   * @param {string} markdown
   * @returns {Array<{ language: string, code: string }>}
   */
  extractCodeBlocks(markdown) {
    const blocks = [];
    const regex = /```(\w*)\n?([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(markdown)) !== null) {
      blocks.push({
        language: match[1] || 'unknown',
        code: match[2].trim(),
      });
    }

    return blocks;
  }

  /**
   * Count approximate lines, functions, and classes in a code snippet.
   * @param {string} code
   * @param {string} language
   * @returns {{ lines: number, functions: number, classes: number }}
   */
  countMetrics(code, language) {
    if (!code) return { lines: 0, functions: 0, classes: 0 };

    const lines = code.split('\n').length;
    const lang = (language || '').toLowerCase();

    let functionPattern;
    let classPattern;

    if (['javascript', 'js', 'typescript', 'ts'].includes(lang)) {
      functionPattern = /\b(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?(function|\(.*?\)\s*=>)|\w+\s*\(.*?\)\s*\{)/g;
      classPattern = /\bclass\s+\w+/g;
    } else if (['python', 'py'].includes(lang)) {
      functionPattern = /^\s*def\s+\w+/gm;
      classPattern = /^\s*class\s+\w+/gm;
    } else {
      functionPattern = /\b\w+\s*\([^)]*\)\s*\{/g;
      classPattern = /\bclass\s+\w+/g;
    }

    const functions = (code.match(functionPattern) || []).length;
    const classes = (code.match(classPattern) || []).length;

    return { lines, functions, classes };
  }
}

module.exports = new CodeValidator();
module.exports.CodeValidator = CodeValidator;
