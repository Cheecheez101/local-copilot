'use strict';

const fs = require('fs');
const path = require('path');

let fetchFn;
try {
  fetchFn = fetch; // Node 18+ native fetch
} catch {
  fetchFn = require('node-fetch');
}

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config/default.json');

/**
 * ModelManager – manages connectivity to Foundry Local inference endpoints.
 *
 * Foundry Local exposes an OpenAI-compatible REST API, so we talk to it via
 * standard HTTP requests without needing an SDK.
 */
class ModelManager {
  constructor(config) {
    this.config = config || this._loadDefaultConfig();
    this._availableModels = null;
  }

  /**
   * Load configuration from default.json.
   * @returns {object}
   */
  _loadDefaultConfig() {
    try {
      const raw = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {
        foundryLocal: {
          baseUrl: 'http://localhost:5272',
          apiPath: '/v1/chat/completions',
          modelsPath: '/v1/models',
          timeout: 60000,
        },
        models: {
          reasoning: { id: 'phi-3.5-mini-instruct-generic-gpu', maxTokens: 2048, temperature: 0.3 },
          coding: { id: 'phi-3.5-mini-instruct-generic-gpu', maxTokens: 4096, temperature: 0.1 },
          fileAnalysis: { id: 'phi-3.5-mini-instruct-generic-gpu', maxTokens: 4096, temperature: 0.2 },
        },
      };
    }
  }

  /**
   * Get the Foundry Local base URL.
   * @returns {string}
   */
  get baseUrl() {
    return this.config.foundryLocal.baseUrl;
  }

  /**
   * Probe Foundry Local to confirm it is running and accessible.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const url = `${this.baseUrl}${this.config.foundryLocal.modelsPath}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetchFn(url, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * List models available in the Foundry Local instance.
   * @returns {Promise<string[]>} Array of model IDs.
   */
  async listAvailableModels() {
    const url = `${this.baseUrl}${this.config.foundryLocal.modelsPath}`;
    const res = await fetchFn(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    this._availableModels = (data.data || []).map((m) => m.id);
    return this._availableModels;
  }

  /**
   * Get the model configuration for a named agent role.
   * @param {string} role - 'reasoning' | 'coding' | 'fileAnalysis'
   * @returns {{ id: string, maxTokens: number, temperature: number }}
   */
  getModelConfig(role) {
    const modelCfg = this.config.models[role];
    if (!modelCfg) {
      throw new Error(`Unknown model role: ${role}`);
    }
    return modelCfg;
  }

  /**
   * Send a chat completion request to Foundry Local.
   *
   * @param {string} role    - Agent role ('reasoning' | 'coding' | 'fileAnalysis').
   * @param {Array<{ role: string, content: string }>} messages - Chat history.
   * @param {object} [overrides] - Optional parameter overrides (maxTokens, temperature).
   * @returns {Promise<string>} The model's reply text.
   */
  async chat(role, messages, overrides = {}) {
    const modelCfg = this.getModelConfig(role);
    const url = `${this.baseUrl}${this.config.foundryLocal.apiPath}`;

    const payload = {
      model: modelCfg.id,
      messages,
      max_tokens: overrides.maxTokens || modelCfg.maxTokens,
      temperature: overrides.temperature !== undefined ? overrides.temperature : modelCfg.temperature,
      stream: false,
    };

    const controller = new AbortController();
    const timeout = this.config.foundryLocal.timeout || 60000;
    const timer = setTimeout(() => controller.abort(), timeout);

    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Foundry Local API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (content === undefined || content === null) {
      throw new Error('Unexpected response format from Foundry Local');
    }
    return content;
  }

  /**
   * Update the model ID used for a particular role at runtime.
   * @param {string} role    - Agent role.
   * @param {string} modelId - New model ID.
   */
  setModel(role, modelId) {
    if (!this.config.models[role]) {
      throw new Error(`Unknown model role: ${role}`);
    }
    this.config.models[role].id = modelId;
  }
}

module.exports = new ModelManager();
module.exports.ModelManager = ModelManager;
