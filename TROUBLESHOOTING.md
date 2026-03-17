# Troubleshooting: "Failed to Reply" / No Responses

If you're seeing the CLI/web interface get stuck on "Thinking..." or saying "failed to reply", follow this guide.

## Quick Diagnostic

Run the diagnostic tool to identify the issue:

```bash
node diagnose.js
```

This will:
1. ✓ Check if Foundry Local is reachable
2. ✓ Discover the Foundry Local endpoint
3. ✓ List available models
4. ✓ Test a sample chat request

## Common Issues & Fixes

### Issue 1: "Unable to reach Foundry Local"

**Problem:** The CLI can't connect to Foundry Local service

**Solution:**
```bash
# 1. Start the Foundry Local service
foundry service start

# 2. Verify it's running
foundry service status

# 3. Should show output like:
# Foundry Local service is running on http://localhost:5272
```

**If Foundry Local isn't installed:**
```bash
# Install Foundry Local
npm install -g @microsoft/foundry-local

# Or see: https://github.com/microsoft/Foundry
```

---

### Issue 2: "Request timed out after 60000ms"

**Problem:** The model is taking too long to respond

**Causes:**
- Using CPU-only model (very slow)
- Network latency
- Server is overloaded
- Model is loading for first time

**Solution:**

**For CPU models**, increase timeout in `config/default.json`:
```json
{
  "foundryLocal": {
    "timeout": 120000  // 2 minutes instead of 1 minute
  }
}
```

**For slow networks/servers:**
```json
{
  "foundryLocal": {
    "timeout": 300000  // 5 minutes
  }
}
```

**Switch to GPU model** in `config/default.json`:
```json
{
  "models": {
    "reasoning": { 
      "id": "Phi-4-generic-gpu:1",  // GPU variant
      "maxTokens": 2048, 
      "temperature": 0.3 
    }
  }
}
```

---

### Issue 3: "No response text returned by the model"

**Problem:** Model responded but with empty content

**Solution:**
1. Check Foundry Local logs for model errors
2. Verify model ID is correct in `config/default.json`
3. Run diagnostic: `node diagnose.js` to list available models
4. Update config with an available model

---

### Issue 4: Service shows "offline" but Foundry is running

**Problem:** The status indicator says "⚠ Service offline" even though Foundry Local is running

**Solution:**
1. Check Foundry Local is on the right port:
```bash
foundry service status
# Should show: http://localhost:5272 or similar
```

2. Update `config/default.json` if using custom port:
```json
{
  "foundryLocal": {
    "baseUrl": "http://127.0.0.1:59501"  // Your custom port
  }
}
```

3. Or set environment variable:
```bash
export FOUNDRY_BASE_URL=http://127.0.0.1:59501
npm run cli
```

---

### Issue 5: CLI runs but shows "able commands" (help message cut off)

**Problem:** Help text appears but is incomplete

**Solution:**
This usually means the CLI started but something interrupted it. Try:
1. Clear terminal: `clear` or `cls`
2. Restart CLI: `npm run cli`
3. Type `/help` to see full help text
4. Run diagnostic: `node diagnose.js`

---

## Step-by-Step Troubleshooting

### Step 1: Verify Foundry Local

```bash
# Check if running
foundry service status

# If not running, start it
foundry service start

# Wait 10 seconds for it to fully start
sleep 10

# Check again
foundry service status
```

### Step 2: Run Diagnostic

```bash
node diagnose.js
```

Expected output:
```
✓ Foundry Local is reachable
✓ Discovered endpoint: http://localhost:5272
✓ Found 4 model(s):
  - Phi-3.5-mini-instruct-generic-gpu:1
  - Phi-4-mini-reasoning-generic-cpu:3
  - qwen2.5-coder-1.5b-instruct-generic-cpu:4
  - Phi-3.5-mini-instruct-generic-gpu:1
✓ Chat response received: "Hello, I am working!"
```

### Step 3: Start CLI

```bash
npm run cli
```

### Step 4: Type a message

```
you> hello
```

You should see:
1. `Thinking…` message
2. `[AI]` or `[Reasoning Agent]` label
3. Response text
4. Back to `you> ` prompt

---

## Advanced Debugging

### Add Console Logging

Edit `src/interfaces/cli-interface.js` in `handleMessage()` method:

```javascript
async handleMessage(message) {
  console.log('[DEBUG] Input message:', message);
  this.thinking();
  try {
    console.log('[DEBUG] Calling orchestrator.process()');
    const result = await this.orchestrator.process(message, this.sessionId);
    console.log('[DEBUG] Result received:', result);
    this.displayResult(result.agent, result.response);
  } catch (err) {
    console.error('[DEBUG] Error caught:', err);
    this.error(err.message);
  }
}
```

Then run: `npm run cli` and check console output.

### Check Foundry Local Logs

```bash
# View Foundry Local logs
foundry service logs

# Or on Windows:
Get-Content "path/to/foundry/logs"
```

Look for error messages about model loading or API calls.

### Network Test

Test connectivity to Foundry Local directly:

**Linux/Mac:**
```bash
curl http://localhost:5272/v1/models -s | json_pp
```

**Windows (PowerShell):**
```powershell
Invoke-WebRequest http://localhost:5272/v1/models | Select-Object Content
```

Should return a list of available models.

---

## Getting Help

If you still can't get responses:

1. Run diagnostic and share output: `node diagnose.js`
2. Check Foundry Local status: `foundry service status`
3. Check logs: `foundry service logs`
4. Verify config: `cat config/default.json`
5. Open an issue with all the above information

---

## Configuration Reference

Full default config in `config/default.json`:

```json
{
  "foundryLocal": {
    "baseUrl": "http://localhost:5272",
    "fallbackBaseUrls": [
      "http://127.0.0.1:5272",
      "http://127.0.0.1:59501"
    ],
    "apiPath": "/v1/chat/completions",
    "modelsPath": "/v1/models",
    "timeout": 60000
  },
  "models": {
    "chat": {
      "id": "Phi-3.5-mini-instruct-generic-gpu:1",
      "maxTokens": 2048,
      "temperature": 0.2
    },
    "reasoning": {
      "id": "Phi-4-mini-reasoning-generic-cpu:3",
      "maxTokens": 2048,
      "temperature": 0.3
    },
    "coding": {
      "id": "qwen2.5-coder-1.5b-instruct-generic-cpu:4",
      "maxTokens": 4096,
      "temperature": 0.1
    },
    "fileAnalysis": {
      "id": "Phi-3.5-mini-instruct-generic-gpu:1",
      "maxTokens": 4096,
      "temperature": 0.2
    }
  }
}
```

---

## Still Not Working?

**Most likely:** Foundry Local is not running or not accessible

**Least likely (after fixes):** Bug in local-copilot code (very unlikely - diagnostics would catch it)

**Next steps:**
1. Try: `foundry service start && sleep 10 && node diagnose.js`
2. Check Foundry Local documentation: https://github.com/microsoft/Foundry
3. Verify Node.js version: `node --version` (should be 18+)
4. Try with GPU model if available
