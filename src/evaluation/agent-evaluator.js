'use strict';

class AgentEvaluator {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.evaluators = new Map();
    this.results = new Map();
    this.registerBuiltInEvaluators();
  }

  registerBuiltInEvaluators() {
    this.evaluators.set('intent', { name: 'Intent Resolution', description: 'How well did the agent understand the request?', score: this.evaluateIntent.bind(this) });
    this.evaluators.set('task', { name: 'Task Adherence', description: 'Did the agent complete the intended task?', score: this.evaluateTaskAdherence.bind(this) });
    this.evaluators.set('tool', { name: 'Tool Call Accuracy', description: 'Were the correct tools selected?', score: this.evaluateToolAccuracy.bind(this) });
    this.evaluators.set('coherence', { name: 'Coherence', description: 'Is the response logically consistent?', score: this.evaluateCoherence.bind(this) });
    this.evaluators.set('fluency', { name: 'Fluency', description: 'Is the language natural and readable?', score: this.evaluateFluency.bind(this) });
    this.evaluators.set('f1', { name: 'F1 Score', description: 'Token overlap with ground truth', score: this.evaluateF1.bind(this) });
  }

  async evaluateAgent(agent, testCases = [], options = {}) {
    if (!agent) {
      throw new Error('Agent is required for evaluation.');
    }
    if (!Array.isArray(testCases) || testCases.length === 0) {
      throw new Error('At least one test case is required for evaluation.');
    }

    const results = {
      agentId: agent.id || 'unknown-agent',
      timestamp: Date.now(),
      testCases: testCases.length,
      scores: {},
      details: [],
    };

    for (const testCase of testCases) {
      const result = await this.evaluateTestCase(agent, testCase, options);
      results.details.push(result);

      for (const [metric, score] of Object.entries(result.scores)) {
        if (!results.scores[metric]) {
          results.scores[metric] = { total: 0, count: 0 };
        }
        results.scores[metric].total += score;
        results.scores[metric].count += 1;
      }
    }

    for (const [metric, data] of Object.entries(results.scores)) {
      results.scores[metric] = data.total / data.count;
    }

    this.results.set(`${results.agentId}_${Date.now()}`, results);
    return results;
  }

  async evaluateTestCase(agent, testCase, options) {
    const result = {
      input: testCase.input,
      expected: testCase.expected,
      actual: null,
      scores: {},
      metrics: {},
    };

    result.actual = await this._runAgent(agent, testCase.input, testCase.context || {});
    const evaluators = options.evaluators || Array.from(this.evaluators.keys());

    for (const evaluatorId of evaluators) {
      const evaluator = this.evaluators.get(evaluatorId);
      if (!evaluator) continue;
      result.scores[evaluatorId] = await evaluator.score(
        result.input,
        result.actual,
        result.expected,
        testCase.context || {}
      );
    }

    return result;
  }

  async evaluateIntent(input, actual) {
    return this._judgeScore(`Evaluate intent understanding from 0-10.\nInput: "${input}"\nResponse: "${this._toText(actual)}"\nReturn only the number.`);
  }

  async evaluateTaskAdherence(input, actual, expected) {
    return this._judgeScore(`Evaluate task completion from 0-10.\nTask: "${input}"\nResponse: "${this._toText(actual)}"\nExpected: "${expected || ''}"\nReturn only the number.`);
  }

  async evaluateToolAccuracy(input, actual, expected, context) {
    if (!actual?.toolCalls || actual.toolCalls.length === 0) return 0;
    const expectedTools = context.expectedTools || [];
    const correctTools = actual.toolCalls.filter((tool) => expectedTools.includes(tool.name)).length;
    return expectedTools.length > 0 ? correctTools / expectedTools.length : 0;
  }

  async evaluateCoherence(input, actual) {
    return this._judgeScore(`Evaluate response coherence from 0-10.\nResponse: "${this._toText(actual)}"\nReturn only the number.`);
  }

  async evaluateFluency(input, actual) {
    return this._judgeScore(`Evaluate language fluency from 0-10.\nResponse: "${this._toText(actual)}"\nReturn only the number.`);
  }

  evaluateF1(input, actual, expected) {
    if (!expected) return 0;
    const actualTokens = this.tokenize(this._toText(actual));
    const expectedTokens = this.tokenize(expected);
    const intersection = actualTokens.filter((token) => expectedTokens.includes(token));
    const precision = intersection.length / actualTokens.length || 0;
    const recall = intersection.length / expectedTokens.length || 0;
    if (precision + recall === 0) return 0;
    return 2 * (precision * recall) / (precision + recall);
  }

  tokenize(text) {
    return String(text || '').toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter((token) => token.length > 0);
  }

  async generateTestData(agent, count = 10, examples = []) {
    const prompt = `Generate ${count} diverse test cases for an AI agent.\nAgent instructions: ${agent.instructions || ''}\nExamples: ${JSON.stringify(examples)}\nReturn strict JSON: {"testCases":[{"input":"","expected":"","context":{}}]}`;
    const text = await this._reason(prompt);
    try {
      const data = JSON.parse(text);
      return data.testCases || [];
    } catch {
      return [];
    }
  }

  getResultsSummary(resultId) {
    const result = this.results.get(resultId);
    if (!result) return null;
    const vals = Object.values(result.scores);
    const overall = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { overall, metrics: result.scores, testCount: result.testCases, timestamp: result.timestamp };
  }

  compareVersions(version1Id, version2Id) {
    const v1 = this.results.get(version1Id);
    const v2 = this.results.get(version2Id);
    if (!v1 || !v2) return null;

    const comparison = { version1: v1.agentId, version2: v2.agentId, improvements: {}, regressions: {}, unchanged: {} };
    for (const metric of Object.keys(v1.scores)) {
      const diff = (v2.scores[metric] || 0) - (v1.scores[metric] || 0);
      if (diff > 0.1) comparison.improvements[metric] = diff;
      else if (diff < -0.1) comparison.regressions[metric] = -diff;
      else comparison.unchanged[metric] = v1.scores[metric];
    }
    return comparison;
  }

  async _runAgent(agent, input, context) {
    if (typeof agent.process === 'function') {
      return agent.process(input, context);
    }
    if (this.orchestrator?.process) {
      const sessionId = this.orchestrator.createSession({ interface: 'agent-evaluator' });
      const result = await this.orchestrator.process(input, sessionId, { agent: 'reasoning' });
      return result?.response ?? result;
    }
    throw new Error('No runnable agent provided.');
  }

  _toText(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value.raw === 'string') return value.raw;
    return JSON.stringify(value ?? {});
  }

  async _reason(prompt) {
    if (!this.orchestrator?.process) {
      throw new Error('Orchestrator is unavailable for evaluation prompts.');
    }
    const sessionId = this.orchestrator.createSession({ interface: 'agent-evaluator' });
    const result = await this.orchestrator.process(prompt, sessionId, { agent: 'reasoning' });
    return this._toText(result?.response ?? result);
  }

  async _judgeScore(prompt) {
    try {
      const text = await this._reason(prompt);
      const score = parseFloat(text) / 10;
      return Number.isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch {
      return 0.5;
    }
  }
}

module.exports = { AgentEvaluator };
