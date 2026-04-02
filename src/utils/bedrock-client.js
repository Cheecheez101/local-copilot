'use strict';

const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const clientsByRegion = new Map();

function getClient(region) {
  const cacheKey = String(region || '').trim() || 'default';
  if (!clientsByRegion.has(cacheKey)) {
    const options = region ? { region } : {};
    clientsByRegion.set(cacheKey, new BedrockRuntimeClient(options));
  }
  return clientsByRegion.get(cacheKey);
}

function normalizeMessages(messages) {
  const system = [];
  const conversation = [];

  for (const message of messages || []) {
    if (!message || typeof message.content !== 'string' || !message.content.trim()) {
      continue;
    }

    if (message.role === 'system') {
      system.push({ text: message.content });
      continue;
    }

    const role = message.role === 'assistant' ? 'assistant' : 'user';
    conversation.push({
      role,
      content: [{ text: message.content }],
    });
  }

  return { system, conversation };
}

function extractText(output) {
  const chunks = output?.message?.content || [];
  const parts = chunks.map((chunk) => chunk?.text).filter(Boolean);
  return parts.join('\n').trim();
}

/**
 * Send a chat-style request to Amazon Bedrock via Converse API.
 *
 * @param {object} params
 * @param {string} params.modelId
 * @param {Array<{ role: string, content: string }>} params.messages
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {string} [params.region]
 * @returns {Promise<string>}
 */
async function converseBedrock(params) {
  const { modelId, messages, temperature, maxTokens, region } = params || {};

  if (!modelId) {
    throw new Error('Bedrock modelId is required');
  }

  const client = getClient(region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION);
  const { system, conversation } = normalizeMessages(messages);

  const command = new ConverseCommand({
    modelId,
    messages: conversation,
    ...(system.length > 0 ? { system } : {}),
    inferenceConfig: {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
  });

  const response = await client.send(command);
  const text = extractText(response.output);

  if (!text) {
    throw new Error('Unexpected response format from Bedrock');
  }

  return text;
}

module.exports = { converseBedrock };
