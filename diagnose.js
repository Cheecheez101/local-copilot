#!/usr/bin/env node
'use strict';

/**
 * Diagnostic tool to identify why local-copilot isn't getting responses
 */

const { ModelManager } = require('./src/core/model-manager');
const path = require('path');

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

async function log(prefix, msg, color = RESET) {
  console.log(`${color}${prefix}${RESET} ${msg}`);
}

async function diagnose() {
  console.log(`\n${CYAN}Local Copilot Diagnostic Tool${RESET}\n`);

  const modelMgr = new ModelManager();

  // Test 1: Check service availability
  console.log(`${YELLOW}1. Checking Foundry Local service availability...${RESET}`);
  try {
    const available = await modelMgr.isAvailable();
    if (available) {
      await log('✓', 'Foundry Local is reachable', GREEN);
    } else {
      await log('✗', 'Foundry Local is NOT reachable', RED);
      await log('  ', 'Try starting it: foundry service start');
      return;
    }
  } catch (err) {
    await log('✗', `Error checking availability: ${err.message}`, RED);
    return;
  }

  // Test 2: Get base URL
  console.log(`\n${YELLOW}2. Discovering Foundry Local endpoint...${RESET}`);
  try {
    const baseUrl = await modelMgr._resolveBaseUrl();
    await log('✓', `Discovered endpoint: ${baseUrl}`, GREEN);
  } catch (err) {
    await log('✗', `Failed to discover endpoint: ${err.message}`, RED);
    return;
  }

  // Test 3: List available models
  console.log(`\n${YELLOW}3. Fetching available models...${RESET}`);
  try {
    const models = await modelMgr.listAvailableModels();
    if (models && models.length > 0) {
      await log('✓', `Found ${models.length} model(s):`, GREEN);
      models.forEach((m) => console.log(`    - ${m}`));
    } else {
      await log('⚠', 'No models found', YELLOW);
    }
  } catch (err) {
    await log('✗', `Failed to list models: ${err.message}`, RED);
  }

  // Test 4: Test a simple chat request
  console.log(`\n${YELLOW}4. Testing chat request...${RESET}`);
  try {
    const testMessages = [
      { role: 'user', content: 'Say "Hello, I am working!" in exactly 4 words.' }
    ];
    console.log(`   Sending test message...`);
    const response = await modelMgr.chat('reasoning', testMessages);
    await log('✓', `Chat response received:`, GREEN);
    console.log(`    "${response}"`);
  } catch (err) {
    await log('✗', `Chat request failed: ${err.message}`, RED);
    if (/timed out/i.test(err.message)) {
      await log('  ', 'Model timed out. Try increasing timeout in config/default.json', YELLOW);
    }
  }

  console.log(`\n${CYAN}Diagnostics complete!${RESET}\n`);
  console.log(`${YELLOW}If tests pass:${RESET}`);
  console.log(`  Try: npm run cli`);
  console.log(`\n${YELLOW}If Foundry Local check fails:${RESET}`);
  console.log(`  1. Start Foundry Local: foundry service start`);
  console.log(`  2. Verify it's running: foundry service status`);
  console.log(`\n${YELLOW}If chat times out:${RESET}`);
  console.log(`  1. Edit config/default.json`);
  console.log(`  2. Increase foundryLocal.timeout (e.g., to 120000 for 2 minutes)\n`);
}

diagnose().catch(err => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  process.exit(1);
});
