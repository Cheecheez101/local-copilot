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
    this._resolvedBaseUrl = null;
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
          fallbackBaseUrls: ['http://127.0.0.1:5272', 'http://127.0.0.1:59501'],
          apiPath: '/v1/chat/completions',
          modelsPath: '/v1/models',
          timeout: 60000,
        },
        models: {
          reasoning: { id: 'Phi-3.5-mini-instruct-generic-gpu:1', maxTokens: 2048, temperature: 0.3 },
          coding: { id: 'Phi-3.5-mini-instruct-generic-gpu:1', maxTokens: 4096, temperature: 0.1 },
          fileAnalysis: { id: 'Phi-3.5-mini-instruct-generic-gpu:1', maxTokens: 4096, temperature: 0.2 },
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
   * Normalize URL joining to avoid duplicate slashes.
   * @param {string} base
   * @param {string} endpointPath
   * @returns {string}
   */
  _buildUrl(base, endpointPath) {
    const normalizedBase = String(base || '').replace(/\/+$/, '');
    const normalizedPath = String(endpointPath || '').startsWith('/')
      ? endpointPath
      : `/${endpointPath || ''}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  /**
   * Candidate Foundry Local base URLs in probe priority order.
   * @returns {string[]}
   */
  _candidateBaseUrls() {
    const cfg = this.config?.foundryLocal || {};
    const candidates = [
      process.env.FOUNDRY_BASE_URL,
      process.env.FOUNDRY_LOCAL_BASE_URL,
      cfg.baseUrl,
      ...(Array.isArray(cfg.fallbackBaseUrls) ? cfg.fallbackBaseUrls : []),
      'http://127.0.0.1:5272',
      'http://localhost:5272',
      'http://127.0.0.1:59501',
      'http://localhost:59501',
    ];

    const seen = new Set();
    return candidates
      .map((url) => (typeof url === 'string' ? url.trim() : ''))
      .filter(Boolean)
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });
  }

  /**
   * Probe a base URL by calling the models endpoint.
   * @param {string} baseUrl
   * @returns {Promise<boolean>}
   */
  async _probeBaseUrl(baseUrl) {
    const url = this._buildUrl(baseUrl, this.config.foundryLocal.modelsPath);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchFn(url, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve the active Foundry Local base URL and cache it.
   * @param {boolean} [forceRefresh=false]
   * @returns {Promise<string>}
   */
  async _resolveBaseUrl(forceRefresh = false) {
    if (!forceRefresh && this._resolvedBaseUrl) {
      return this._resolvedBaseUrl;
    }

    const candidates = this._candidateBaseUrls();
    for (const candidate of candidates) {
      try {
        if (await this._probeBaseUrl(candidate)) {
          this._resolvedBaseUrl = candidate;
          return candidate;
        }
      } catch {
        // Continue probing other local endpoints.
      }
    }

    throw new Error(
      `Unable to reach Foundry Local. Set FOUNDRY_BASE_URL or FOUNDRY_LOCAL_BASE_URL if your service uses a custom endpoint.`
    );
  }

  /**
   * Probe Foundry Local to confirm it is running and accessible.
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      await this._resolveBaseUrl(true);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List models available in the Foundry Local instance.
   * @returns {Promise<string[]>} Array of model IDs.
   */
  async listAvailableModels() {
    const baseUrl = await this._resolveBaseUrl();
    const url = this._buildUrl(baseUrl, this.config.foundryLocal.modelsPath);
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
    let baseUrl = await this._resolveBaseUrl();
    let url = this._buildUrl(baseUrl, this.config.foundryLocal.apiPath);

    const payload = {
      model: modelCfg.id,
      messages,
      max_tokens: overrides.maxTokens || modelCfg.maxTokens,
      temperature: overrides.temperature !== undefined ? overrides.temperature : modelCfg.temperature,
      stream: false,
    };

    const timeout = this.config.foundryLocal.timeout || 60000;

    const performRequest = async (requestUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        return await fetchFn(requestUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let res;
    try {
      res = await performRequest(url);
    } catch {
      // Retry once after re-discovering the active endpoint (service port may have changed).
      baseUrl = await this._resolveBaseUrl(true);
      url = this._buildUrl(baseUrl, this.config.foundryLocal.apiPath);
      res = await performRequest(url);
    }

    if (!res.ok) {
      const errText = await res.text();

      // Recover from stale model IDs by switching to the first advertised model.
      if (res.status === 400 && /model.*not found|was not found/i.test(errText)) {
        const available = await this.listAvailableModels();
        if (available.length > 0 && available[0] !== modelCfg.id) {
          this.setModel(role, available[0]);
          return this.chat(role, messages, overrides);
        }
      }

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
