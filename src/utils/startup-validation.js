'use strict';

function isValidUrl(url) {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function validateStartupEnv() {
  const warnings = [];
  const errors = [];

  if (process.env.OPENAI_BASE_URL && !isValidUrl(process.env.OPENAI_BASE_URL)) {
    errors.push('OPENAI_BASE_URL is set but not a valid URL.');
  }
  if (process.env.FOUNDRY_BASE_URL && !isValidUrl(process.env.FOUNDRY_BASE_URL)) {
    errors.push('FOUNDRY_BASE_URL is set but not a valid URL.');
  }
  if (process.env.OPENAI_BASE_URL && !process.env.OPENAI_API_KEY && !process.env.GITHUB_TOKEN && !process.env.AZURE_INFERENCE_API_KEY) {
    warnings.push('OPENAI_BASE_URL is set without API key/token environment variables.');
  }

  return { warnings, errors };
}

module.exports = { validateStartupEnv };
