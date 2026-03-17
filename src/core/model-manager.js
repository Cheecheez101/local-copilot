'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { log } = require('../utils/logger');

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
    this._applyModelProfile();
    this._availableModels = null;
    this._resolvedBaseUrl = null;
  }

  /**
   * Apply a named model profile if configured.
   * Profile source order: env MODEL_PROFILE -> config.activeModelProfile.
   */
  _applyModelProfile() {
    const profileName = process.env.MODEL_PROFILE || this.config?.activeModelProfile;
    const profiles = this.config?.modelProfiles;
    if (!profileName || !profiles || !profiles[profileName]) {
      return;
    }
    const profile = profiles[profileName];
    for (const [role, value] of Object.entries(profile)) {
      if (this.config.models?.[role]?.id && typeof value === 'string') {
        this.config.models[role].id = value;
      }
    }
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
          timeout: 300000,
        },
        models: {
          chat: { id: 'Phi-4-generic-cpu:1', maxTokens: 2048, temperature: 0.2 },
          reasoning: { id: 'Phi-4-mini-reasoning-generic-cpu:3', maxTokens: 2048, temperature: 0.3 },
          coding: { id: 'qwen2.5-coder-1.5b-instruct-generic-cpu:4', maxTokens: 4096, temperature: 0.1 },
          fileAnalysis: { id: 'qwen2.5-coder-1.5b-instruct-generic-cpu:4', maxTokens: 4096, temperature: 0.2 },
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
    let discoveredFoundryBaseUrl = '';
    try {
      const statusOut = execSync('foundry service status', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = statusOut.match(/https?:\/\/[^\s/]+(?::\d+)?\/?/i);
      discoveredFoundryBaseUrl = m ? m[0].replace(/\/+$/, '') : '';
    } catch {
      // Ignore if Foundry CLI is not available or service is not running.
    }

    const candidates = [
      process.env.OPENAI_BASE_URL,
      process.env.FOUNDRY_BASE_URL,
      process.env.FOUNDRY_LOCAL_BASE_URL,
      discoveredFoundryBaseUrl,
      discoveredFoundryBaseUrl ? `${discoveredFoundryBaseUrl}/openai` : '',
      cfg.baseUrl,
      ...(Array.isArray(cfg.fallbackBaseUrls) ? cfg.fallbackBaseUrls : []),
      'http://127.0.0.1:5272',
      'http://localhost:5272',
      'http://127.0.0.1:59501',
      'http://localhost:59501',
      'http://127.0.0.1:61731',
      'http://localhost:61731',
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
   * Build request headers for OpenAI-compatible APIs.
   * Supports local Foundry defaults and optional remote-provider auth.
   * @returns {{[k:string]: string}}
   */
  _buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const bearer =
      process.env.OPENAI_API_KEY ||
      process.env.GITHUB_TOKEN ||
      process.env.AZURE_INFERENCE_API_KEY ||
      process.env.FOUNDRY_API_KEY;

    if (bearer) {
      headers.Authorization = `Bearer ${bearer}`;
    }
    return headers;
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
      const res = await fetchFn(url, { signal: controller.signal, headers: this._buildHeaders() });
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
    
    const controller = new AbortController();
    const timeout = this.config.foundryLocal.timeout || 60000;
    const timer = setTimeout(() => controller.abort(), timeout);
    
    try {
      const res = await fetchFn(url, { signal: controller.signal, headers: this._buildHeaders() });
      if (!res.ok) {
        throw new Error(`Failed to fetch models from ${url}: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      this._availableModels = (data.data || []).map((m) => m.id);
      return this._availableModels;
    } finally {
      clearTimeout(timer);
    }
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
   * Pick a sensible fallback model for a role from advertised model IDs.
   * @param {string} role
   * @param {string[]} available
   * @returns {string}
   */
  _pickFallbackModel(role, available) {
    const normalized = available.map((m) => String(m).toLowerCase());
    const findBy = (patterns) => {
      const idx = normalized.findIndex((m) => patterns.some((p) => m.includes(p)));
      return idx >= 0 ? available[idx] : null;
    };

    if (role === 'chat') {
      return findBy(['phi-4']) || findBy(['chat']) || available[0];
    }
    if (role === 'reasoning') {
      return findBy(['reasoning', 'phi-4-mini-reasoning']) || findBy(['phi-4']) || available[0];
    }
    if (role === 'coding' || role === 'fileAnalysis') {
      return findBy(['qwen', 'coder']) || available[0];
    }
    return available[0];
  }

  /**
   * Attempt one model fallback for the given role and re-run chat once.
   * @param {string} role
   * @param {string} currentModelId
   * @param {Array<{ role: string, content: string }>} messages
   * @param {object} overrides
   * @returns {Promise<string>}
   */
  async _retryWithFallbackModel(role, currentModelId, messages, overrides = {}) {
    const available = await this.listAvailableModels();
    if (!available.length) {
      throw new Error('No models available for fallback.');
    }

    const lowerCurrent = String(currentModelId || '').toLowerCase();
    const preferred = this._pickFallbackModel(role, available);
    const fallback = String(preferred || '').toLowerCase() === lowerCurrent
      ? available.find((m) => String(m || '').toLowerCase() !== lowerCurrent)
      : preferred;

    if (!fallback) {
      throw new Error(`No alternate fallback model found for role ${role}.`);
    }

    this.setModel(role, fallback);
    log('info', 'model_fallback_applied', { role, from: currentModelId, to: fallback });
    return this.chat(role, messages, { ...overrides, __fallbackAttempted: true });
  }

  /**
   * Normalize OpenAI-compatible message content into plain text.
   * Supports string content and structured content arrays/objects.
   *
   * @param {*} content
   * @returns {string}
   */
  _extractTextContent(content) {
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') {
            if (typeof part.text === 'string') return part.text;
            if (typeof part.content === 'string') return part.content;
          }
          return '';
        })
        .join('')
        .trim();
    }

    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') return content.text.trim();
      if (typeof content.content === 'string') return content.content.trim();
    }

    return '';
  }

  /**
   * Extract assistant text from an OpenAI-compatible choice object.
   * Supports both chat (`message.content`) and legacy completion (`text`) formats.
   *
   * @param {*} choice
   * @returns {string}
   */
  _extractChoiceText(choice) {
    if (!choice || typeof choice !== 'object') {
      return '';
    }

    const messageText = this._extractTextContent(choice?.message?.content);
    if (messageText) {
      return messageText;
    }

    if (typeof choice.text === 'string') {
      return choice.text.trim();
    }

    return '';
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
    const headers = this._buildHeaders();

    const performRequest = async (requestUrl, body, modelIdForError) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        return await fetchFn(requestUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const isAbort = err?.name === 'AbortError' || /aborted|abort/i.test(String(err?.message || ''));
        if (isAbort) {
          throw new Error(
            `Request timed out after ${timeout}ms at ${requestUrl} (model: ${modelIdForError}). Increase foundryLocal.timeout in config/default.json for CPU models.`
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };

    let res;
    try {
      res = await performRequest(url, payload, modelCfg.id);
    } catch (err) {
      // Check if this is a timeout error
      if (/timed out after/i.test(String(err?.message || ''))) {
        if (!overrides.__fallbackAttempted) {
          try {
            return await this._retryWithFallbackModel(role, modelCfg.id, messages, overrides);
          } catch {
            // Keep original timeout error when fallback fails.
          }
        }
        throw err;
      }
      
      // Retry once after re-discovering the active endpoint (service port may have changed).
      try {
        baseUrl = await this._resolveBaseUrl(true);
        url = this._buildUrl(baseUrl, this.config.foundryLocal.apiPath);
        res = await performRequest(url, payload, modelCfg.id);
      } catch (retryErr) {
        throw retryErr;
      }
    }

    if (!res.ok) {
      const errText = await res.text();

      if (res.status === 400) {
        // Recover from stale model IDs even when server error text is blank/opaque.
        try {
          const available = await this.listAvailableModels();
          const currentModel = String(modelCfg.id || '').toLowerCase();
          const currentExists = available.some((m) => String(m).toLowerCase() === currentModel);

          if (!currentExists && available.length > 0) {
            const fallback = this._pickFallbackModel(role, available);
            this.setModel(role, fallback);
            return this.chat(role, messages, { ...overrides, __fallbackAttempted: true });
          }
        } catch {
          // Keep original error path if models list cannot be fetched.
        }

        // Some local OpenAI-compatible servers reject optional generation fields.
        // Retry once with a minimal payload before failing.
        const minimalPayload = {
          model: this.getModelConfig(role).id,
          messages,
          stream: false,
        };
        
        const minimalController = new AbortController();
        const minimalTimer = setTimeout(() => minimalController.abort(), timeout);
        try {
          const retryRes = await fetchFn(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(minimalPayload),
            signal: minimalController.signal,
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json();
            const retryContent = this._extractChoiceText(retryData?.choices?.[0]);
            if (retryContent) {
              return retryContent;
            }
            throw new Error('Foundry Local returned an empty response body.');
          }

          const retryErrText = await retryRes.text();
          throw new Error(
            `Foundry Local API error 400: ${errText || '<empty error body>'}; retry(minimal payload) => ${retryRes.status} ${retryErrText || '<empty error body>'}`
          );
        } finally {
          clearTimeout(minimalTimer);
        }
      }

      if (!overrides.__fallbackAttempted && [429, 500, 502, 503, 504].includes(res.status)) {
        try {
          return await this._retryWithFallbackModel(role, modelCfg.id, messages, overrides);
        } catch {
          // Preserve the original API error if fallback is unavailable.
        }
      }

      throw new Error(`OpenAI-compatible API error ${res.status} at ${url} (model: ${modelCfg.id}): ${errText}`);
    }

    const data = await res.json();
    const content = this._extractChoiceText(data?.choices?.[0]);
    if (!content) {
      throw new Error('Foundry Local returned an empty response body.');
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
