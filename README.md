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
   * Pull a model (example): `foundry model run Phi-3.5-mini-instruct-generic-gpu:1`

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
| `/code <desc> [--lang=js]` | Generate code |
| `/review --file=<path>` | Review a file |
| `/refactor --file=<path> [--goal=…]` | Refactor a file |
| `/debug --file=<path> [--error=…]` | Debug a file |
| `/analyze <file>` | Summarise a file |
| `/dir <path>` | Analyse a directory |
| `/compare <a> <b>` | Compare two files |
| `/models` | List available Foundry Local models |
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

The web UI exposes:
* `GET  /api/health`    – service health check
* `POST /api/session`   – create a new session
* `POST /api/chat`      – send a message
* `GET  /api/models`    – list available models

### VS Code Extension

The `src/interfaces/vscode-extension.js` file implements the standard VS Code
extension lifecycle (`activate` / `deactivate`). Commands registered:

| Command ID | Description |
|-----------|-------------|
| `localCopilot.explain` | Explain selected code |
| `localCopilot.review` | Review current file |
| `localCopilot.refactor` | Refactor selected code |
| `localCopilot.generate` | Generate code from description |
| `localCopilot.ask` | Ask a free-form question |
| `localCopilot.clearHistory` | Clear conversation history |

---

## Configuration

Edit `config/default.json` to customise model IDs, preferred Foundry Local URL, token limits, and the web server port.

The app now probes multiple local Foundry endpoints automatically. If your Foundry endpoint is custom, set one of:

* `FOUNDRY_BASE_URL`
* `FOUNDRY_LOCAL_BASE_URL`

```json
{
  "foundryLocal": {
    "baseUrl": "http://localhost:5272",
    "fallbackBaseUrls": ["http://127.0.0.1:5272", "http://127.0.0.1:59501"]
  },
  "models": {
    "reasoning": { "id": "Phi-3.5-mini-instruct-generic-gpu:1", "temperature": 0.3 },
    "coding":    { "id": "Phi-3.5-mini-instruct-generic-gpu:1", "temperature": 0.1 },
    "fileAnalysis": { "id": "Phi-3.5-mini-instruct-generic-gpu:1", "temperature": 0.2 }
  },
  "web": { "port": 3000, "host": "127.0.0.1" }
}
```

PowerShell note: use semicolons instead of `&&` on older Windows PowerShell:

```powershell
npm run lint; npm test; npm start; npm run web
```

---

## Tests

```bash
npm test
```

---

## License

MIT
