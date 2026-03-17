# Local AI Dev Co-Pilot

An **offline, multi-agent AI workspace** designed to give developers fast, private, and reliable AI assistance without relying on cloud services.

## Overview

Local AI Dev Co-Pilot integrates three specialised agents:

| Agent | Responsibility |
|-------|---------------|
| **Reasoning Agent** | Task planning, architectural decisions, trade-off analysis, root-cause diagnosis |
| **Coding Agent** | Code generation, review, refactoring, debugging, and completion |
| **File Analysis Agent** | File summarisation, codebase overviews, document Q&A, file comparison |

All agents are powered by on-device models running through **[Foundry Local](https://github.com/microsoft/Foundry)**, giving you:

* 🔒 **Privacy** – your code never leaves your machine
* ⚡ **Speed** – no round-trips to the cloud
* 🌐 **Offline support** – works without internet access
* 💸 **No API costs** – run as much as you like

---

## Project Structure

```
local-ai-dev-copilot/
├── src/
│   ├── agents/
│   │   ├── reasoning-agent.js    # Task planning & logical analysis
│   │   ├── coding-agent.js       # Code generation, review, debug
│   │   └── file-analysis-agent.js# Document & codebase analysis
│   ├── core/
│   │   ├── orchestrator.js       # Routes tasks to the right agent
│   │   ├── model-manager.js      # Foundry Local API connector
│   │   └── context-manager.js    # Conversation session management
│   ├── interfaces/
│   │   ├── cli-interface.js      # Interactive terminal REPL
│   │   ├── web-interface.js      # Local web UI + REST API
│   │   └── vscode-extension.js   # VS Code extension entry point
│   └── utils/
│       ├── file-handler.js       # Read / write / inspect files
│       └── code-validator.js     # Syntax checking & metrics
├── models/                       # (Managed by Foundry Local)
├── config/
│   └── default.json              # Default configuration
├── package.json
└── README.md
```

---

## Prerequisites

1. **Node.js 18+**
2. **Foundry Local** installed and running (default is often `http://localhost:5272`, but local port may vary)
   * Download: <https://github.com/microsoft/Foundry>
   * Start: `foundry service start`
   * Pull a model (example): `foundry model run qwen2.5-coder-1.5b-instruct-generic-cpu:4`

---

## Installation

```bash
npm install
```

---

## Usage

### Interactive CLI

```bash
npm start
# or
node src/interfaces/cli-interface.js
```

Available commands inside the REPL:

| Command | Description |
|---------|-------------|
| `/plan <task>` | Create a step-by-step plan |
| `/code <desc> [--lang=js] [--file=<path> or --files=a,b]` | Generate code with optional local file context |
| `/review --file=<path>` | Review a file |
| `/refactor --file=<path> [--goal=…]` | Refactor a file |
| `/debug --file=<path> [--error=…]` | Debug a file |
| `/analyze <file>` | Summarise a file |
| `/dir <path> [--analyze]` | List directory contents directly from local filesystem (`--analyze` adds AI summary) |
| `/read <file>` | Read and print a file directly |
| `/write --file=<path> --content=<text>` | Write text directly to a file |
| `/compare <a> <b>` | Compare two files |
| `/models` | List available Foundry Local models |
| `/diagnostics` | Show service + model diagnostics |
| `/git-status` | Show git status + latest commit |
| `/git-diff` | Show working/staged diff |
| `/history` | Show conversation history |
| `/clear` | Clear conversation history |
| `/help` | Show help |
| `/exit` | Quit |

Or just type naturally – the orchestrator will route to the best agent automatically.

### Web Interface

```bash
npm run web
# Open http://127.0.0.1:3000
```

If port `3000` is already in use, override it:

```powershell
$env:PORT=3001; npm run web
```

The web UI exposes:
* `GET  /api/health`    – service health check
* `POST /api/session`   – create a new session
* `POST /api/chat`      – send a message
* `GET  /api/models`    – list available models
* `GET  /api/diagnostics` – diagnostics payload

Web UI includes a sidebar with shortcuts for Diagnostics, Models, and Analyze Directory, plus a markdown render toggle and copy button on AI responses.

### VS Code Extension

The `src/interfaces/vscode-extension.js` file implements the standard VS Code
extension lifecycle (`activate` / `deactivate`). Commands registered:

| Command ID | Description |
|-----------|-------------|
| `localCopilot.explain` | Explain selected code |
| `localCopilot.review` | Review current file |
| `localCopilot.refactor` | Refactor selected code |
| `localCopilot.generate` | Generate code from description |
| `localCopilot.analyzeDirectory` | Analyze a directory (VS prompt input) |
| `localCopilot.runTests` | Run project test suite (`npm test`) |
| `localCopilot.gitStatus` | Show git branch, status, and latest commit |
| `localCopilot.gitDiff` | Show working tree + staged diff |
| `localCopilot.draftCommitMessage` | Draft commit message from staged diff |
| `localCopilot.toggleTestOnSave` | Toggle auto-running tests on file save |
| `localCopilot.diagnostics` | Open diagnostics panel |
| `localCopilot.quickActions` | Open one-click quick actions picker |
| `localCopilot.ask` | Ask a free-form question |
| `localCopilot.clearHistory` | Clear conversation history |

Manual smoke test (Extension Development Host):

1. Reload the VS Code window with `Developer: Reload Window`.
2. Run `Local AI Copilot: Analyze Directory` from the Command Palette.
3. Open `View -> Output` and choose `Local AI Co-Pilot` from the dropdown.
4. Confirm you see the activation line plus command output for the action you ran.

Package + install smoke test (`.vsix`):

1. Build package: `npm run package:vsix`
2. Install in VS Code: `code --install-extension local-ai-dev-copilot-1.0.0.vsix`
3. Reload window and run `Local AI Copilot: Quick Actions`.
4. Validate keybindings:
   * `Ctrl+Alt+L` -> Quick Actions
   * `Ctrl+Alt+K` -> Ask Copilot
5. Run `Local AI Copilot: Open Diagnostics` and verify diagnostics render.

---

## Configuration

Edit `config/default.json` to customise model IDs, preferred Foundry Local URL, token limits, and the web server port.

The runtime now includes automatic robustness features:
* retries endpoint discovery when a request fails
* falls back to an alternate available model on timeout/transient `5xx` errors
* auto-recovers from stale model IDs when providers return `400`
* supports CPU model profiles (`activeModelProfile` / `MODEL_PROFILE`)

The app now probes multiple local Foundry endpoints automatically. If your Foundry endpoint is custom, set one of:

* `FOUNDRY_BASE_URL`
* `FOUNDRY_LOCAL_BASE_URL`

```json
{
  "foundryLocal": {
    "baseUrl": "http://localhost:5272",
    "fallbackBaseUrls": ["http://127.0.0.1:5272", "http://127.0.0.1:59501"],
    "timeout": 300000
  },
  "models": {
    "reasoning": { "id": "Phi-3.5-mini-instruct-generic-gpu:1", "temperature": 0.3 },
    "coding":    { "id": "Phi-3.5-mini-instruct-generic-gpu:1", "temperature": 0.1 },
    "fileAnalysis": { "id": "Phi-3.5-mini-instruct-generic-gpu:1", "temperature": 0.2 }
  },
  "web": { "port": 3000, "host": "127.0.0.1" }
}
```

For slower CPU models, increase `foundryLocal.timeout` (for example `300000` = 5 minutes).

Model profiles:
* `cpu-balanced` (default): stronger reasoning model + CPU chat/coding
* `cpu-fast`: single fast CPU model for all roles

You can switch profile with:

```powershell
$env:MODEL_PROFILE="cpu-fast"
npm run cli
```

If the CLI returns to `you>` with no visible answer, the app now treats that as a model error (`empty response body`) so you can diagnose it instead of getting a silent blank output.

PowerShell note: use semicolons instead of `&&` on older Windows PowerShell:

```powershell
npm run lint; npm test; npm start; npm run web
```

---

## Tests

```bash
npm test
```

If a test hangs, run:

```bash
npm run test:handles
```

## Quickstart (2 minutes)

1. `foundry service start`
2. `npm install`
3. `node diagnose.js`
4. `npm run cli` or `npm run web`
5. In VS Code (extension host), run `localCopilot.diagnostics` once.

## Troubleshooting Decision Tree

1. No response at all:
   * Run `node diagnose.js`.
   * If service unavailable: `foundry service start`.

2. Response times out:
   * Use `cpu-fast` profile.
   * Increase `foundryLocal.timeout` in `config/default.json`.

3. OpenAI-compatible endpoint fails:
   * Verify `OPENAI_BASE_URL`.
   * Set `OPENAI_API_KEY`/`GITHUB_TOKEN`/`AZURE_INFERENCE_API_KEY`.
   * Open diagnostics (`/api/diagnostics` or `localCopilot.diagnostics`).

---

## License

MIT
