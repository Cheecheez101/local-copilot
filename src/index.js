'use strict';

const { Orchestrator } = require('./core/orchestrator');
const { ModelManager } = require('./core/model-manager');
const { ContextManager } = require('./core/context-manager');

class LocalAICopilot {
  constructor() {
    this.orchestrator = null;
    this.started = false;
  }

  async start(mode = 'headless') {
    if (this.started) return;
    const modelMgr = new ModelManager();
    const ctxMgr = new ContextManager();
    this.orchestrator = new Orchestrator({}, modelMgr, ctxMgr);
    this.mode = mode;
    this.started = true;
  }

  stop() {
    this.started = false;
    this.orchestrator = null;
  }
}

module.exports = LocalAICopilot;
module.exports.LocalAICopilot = LocalAICopilot;
