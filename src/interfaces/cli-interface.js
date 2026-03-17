#!/usr/bin/env node
'use strict';

const readline = require('readline');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const { Orchestrator } = require('../core/orchestrator');
const { ModelManager } = require('../core/model-manager');
const { ContextManager } = require('../core/context-manager');
const { SuggestionAgent } = require('../agents/suggestion-agent');
const { FileAgent } = require('../agents/file-agent');
const fileHandler = require('../utils/file-handler');
const { validateStartupEnv } = require('../utils/startup-validation');
const { redactSecrets } = require('../utils/logger');
const { CLI_COMMANDS } = require('../config/command-spec');

const execAsync = util.promisify(exec);

// Avoid chalk ESM issues – use ANSI codes directly
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';

const BANNER = `
${CYAN}${BOLD}╔══════════════════════════════════════════════╗
║        Local AI Dev Co-Pilot  v1.0.0         ║
║  Offline · Private · Fast · Multi-Agent AI   ║
╚══════════════════════════════════════════════╝${RESET}
`;

const HELP = `
${BOLD}Commands:${RESET}
  ${CYAN}/plan <task>${RESET}           Create a step-by-step plan
  ${CYAN}/code <description>${RESET}    Generate code (use --lang=<lang> --file=<path> or --files=a,b)
  ${CYAN}/review${RESET}               Review code from clipboard or file (--file=<path>)
  ${CYAN}/refactor${RESET}             Refactor code (--file=<path> --goal=<goal>)
  ${CYAN}/debug${RESET}                Debug code (--file=<path> --error=<msg>)
  ${CYAN}/analyze <file>${RESET}        Analyze a file
  ${CYAN}/dir <path>${RESET}            Analyze a directory
  ${CYAN}/read <file>${RESET}           Read and print a file
  ${CYAN}/write --file=<path> --content=<text>${RESET}  Write text to a file
  ${CYAN}/compare <a> <b>${RESET}       Compare two files
  ${CYAN}/models${RESET}               List available models
  ${CYAN}/diagnostics${RESET}          Show service + model diagnostics
  ${CYAN}/git-status${RESET}           Show git status
  ${CYAN}/git-diff${RESET}             Show git diff (working + staged)
  ${CYAN}/history${RESET}              Show conversation history
  ${CYAN}/clear${RESET}                Clear conversation history
  ${CYAN}/help${RESET}                 Show this help message
  ${CYAN}/exit${RESET}                 Exit the application

${DIM}Or just type a message for general AI assistance.${RESET}
`;

/**
 * Parse simple flag arguments from a CLI argument array.
 * e.g. ["--lang=python", "--file=/tmp/x.py"] → { lang: 'python', file: '/tmp/x.py' }
 */
function parseFlags(args) {
  const flags = {};
  const positional = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length > 0 ? rest.join('=') : true;
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

/**
 * CLIInterface – interactive command-line interface for the Local AI Dev Co-Pilot.
 */
class CLIInterface {
  constructor() {
    const modelMgr = new ModelManager();
    const ctxMgr = new ContextManager();
    this.orchestrator = new Orchestrator({}, modelMgr, ctxMgr);
    this.suggestionAgent = new SuggestionAgent(ctxMgr);
    this.fileAgent = new FileAgent();
    this.sessionId = this.orchestrator.createSession({ interface: 'cli' });
    this.rl = null;
  }

  /** Print formatted text to stdout. */
  print(text) {
    process.stdout.write(text + '\n');
  }

  /** Print an error message. */
  error(text) {
    this.print(`${RED}Error: ${text}${RESET}`);
  }

  /** Print a success message. */
  success(text) {
    this.print(`${GREEN}${text}${RESET}`);
  }

  /** Print a thinking indicator. */
  thinking() {
    process.stdout.write(`${DIM}Thinking…${RESET}\n`);
  }

  async runShell(command) {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 20,
    });
    return `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim();
  }

  /**
   * Display the result from an agent.
   * @param {string} agent    - Agent name.
   * @param {*}      response - Agent response.
   */
  displayResult(agent, response) {
    const agentLabel = {
      reasoning: `${BLUE}[Reasoning Agent]${RESET}`,
      coding: `${MAGENTA}[Coding Agent]${RESET}`,
      fileAnalysis: `${YELLOW}[File Analysis Agent]${RESET}`,
    }[agent] || `${CYAN}[AI]${RESET}`;

    this.print(`\n${agentLabel}`);

    if (typeof response === 'object' && response !== null) {
      if (response.code) {
        this.print(response.explanation || response.code);
      } else if (response.fix) {
        this.print(response.explanation || response.fix);
      } else {
        this.print(JSON.stringify(response, null, 2));
      }
    } else {
      const text = typeof response === 'string' ? response.trim() : String(response || '');
      this.print(text || `${YELLOW}[No response text returned by the model]${RESET}`);
    }
    this.showSuggestions(this.buildLastAction(agent, response));
    this.print('');
  }

  buildLastAction(agent, response) {
    if (agent === 'fileAnalysis' && response && Array.isArray(response.files)) {
      return { type: 'FILE_LIST', result: response };
    }
    return { type: 'AGENT_RESULT', agent, result: response };
  }

  showSuggestions(lastAction) {
    const suggestions = this.suggestionAgent.suggestNextAction(lastAction);
    if (!Array.isArray(suggestions) || suggestions.length === 0) return;
    this.print(`${DIM}Suggestions:${RESET}`);
    for (const suggestion of suggestions) {
      this.print(`  • ${suggestion.text}`);
      if (Array.isArray(suggestion.actions)) {
        for (const action of suggestion.actions) {
          this.print(`    - ${action}`);
        }
      } else if (suggestion.action) {
        this.print(`    - ${suggestion.action}`);
      }
    }
  }

  /**
   * Handle a parsed command.
   * @param {string}   command  - Command name (without the leading slash).
   * @param {string[]} args     - Command arguments.
   */
  async handleCommand(command, args) {
    const { flags, positional } = parseFlags(args);
    const rest = positional.join(' ');

    try {
      switch (command) {
        case 'help':
          this.print(HELP);
          break;

        case 'exit':
        case 'quit':
          this.print(`\n${GREEN}Goodbye!${RESET}\n`);
          this.rl.close();
          process.exit(0);
          break;

        case 'clear':
          this.orchestrator.clearHistory(this.sessionId);
          this.success('Conversation history cleared.');
          break;

        case 'history': {
          const history = this.orchestrator.getHistory(this.sessionId);
          if (history.length === 0) {
            this.print(`${DIM}No history yet.${RESET}`);
          } else {
            history.forEach((m) => {
              const label = m.role === 'user' ? `${CYAN}You${RESET}` : `${GREEN}AI${RESET}`;
              this.print(`${label}: ${m.content.slice(0, 200)}${m.content.length > 200 ? '…' : ''}`);
            });
          }
          break;
        }

        case 'models': {
          this.thinking();
          const models = await this.orchestrator.listModels();
          this.print(`\n${BOLD}Available Models:${RESET}`);
          models.forEach((m) => this.print(`  • ${m}`));
          this.print('');
          break;
        }

        case 'diagnostics': {
          this.thinking();
          const available = await this.orchestrator.isModelServiceAvailable();
          const models = await this.orchestrator.listModels().catch(() => []);
          const env = validateStartupEnv();
          this.print(JSON.stringify(redactSecrets({
            available,
            models,
            env,
            timestamp: new Date().toISOString(),
          }), null, 2));
          break;
        }

        case 'git-status': {
          this.thinking();
          const out = await this.runShell('git --no-pager status --short --branch && git --no-pager log -1 --oneline');
          this.print(out || 'Repository is clean.');
          break;
        }

        case 'git-diff': {
          this.thinking();
          const out = await this.runShell('git --no-pager diff -- . && git --no-pager diff --cached -- .');
          this.print(out || 'No changes to diff.');
          break;
        }

        case 'plan': {
          if (!rest) { this.error('Usage: /plan <task description>'); break; }
          this.thinking();
          const result = await this.orchestrator.process(rest, this.sessionId, { agent: 'reasoning' });
          this.displayResult(result.agent, result.response);
          break;
        }

        case 'code': {
          if (!rest) { this.error('Usage: /code <description> [--lang=javascript]'); break; }
          this.thinking();
          const language = flags.lang || flags.language || 'javascript';
          const filePaths = [];
          if (flags.file) filePaths.push(flags.file);
          if (flags.files) filePaths.push(...String(flags.files).split(',').map((p) => p.trim()).filter(Boolean));
          const options = { agent: 'coding', language };
          if (filePaths.length > 0) options.filePaths = filePaths;
          const result = await this.orchestrator.process(rest, this.sessionId, options);
          this.displayResult(result.agent, result.response);
          break;
        }

        case 'review': {
          const filePath = flags.file;
          if (!filePath) { this.error('Usage: /review --file=<path>'); break; }
          this.thinking();
          const language = flags.lang || flags.language || '';
          const result = await this.orchestrator.process('review this code', this.sessionId, {
            agent: 'coding',
            code: require('../utils/file-handler').readFile(filePath),
            language,
          });
          this.displayResult(result.agent, result.response);
          break;
        }

        case 'refactor': {
          const filePath = flags.file;
          if (!filePath) { this.error('Usage: /refactor --file=<path> [--goal=<goal>]'); break; }
          this.thinking();
          const language = flags.lang || flags.language || '';
          const goal = flags.goal || rest;
          const result = await this.orchestrator.process(`refactor ${goal}`, this.sessionId, {
            agent: 'coding',
            code: require('../utils/file-handler').readFile(filePath),
            language,
          });
          this.displayResult(result.agent, result.response);
          break;
        }

        case 'debug': {
          const filePath = flags.file;
          if (!filePath) { this.error('Usage: /debug --file=<path> [--error=<message>]'); break; }
          this.thinking();
          const language = flags.lang || flags.language || '';
          const result = await this.orchestrator.process('debug this code', this.sessionId, {
            agent: 'coding',
            code: require('../utils/file-handler').readFile(filePath),
            language,
            error: flags.error || '',
          });
          this.displayResult(result.agent, result.response);
          break;
        }

        case 'analyze': {
          const filePath = flags.file || rest;
          if (!filePath) { this.error('Usage: /analyze <file> or /analyze --file=<path>'); break; }
          this.thinking();
          const result = await this.orchestrator.process('analyze file', this.sessionId, {
            agent: 'fileAnalysis',
            filePath: path.resolve(filePath),
          });
          this.displayResult(result.agent, result.response);
          break;
        }

        case 'dir':
        case 'analyze-dir': {
          const dirPath = flags.path || rest;
          if (!dirPath) { this.error('Usage: /dir <directory> or /dir --path=<path>'); break; }
          this.thinking();
          const listing = await this.fileAgent.listFiles(path.resolve(dirPath));
          if (listing.error) {
            this.error(listing.message);
            break;
          }
          this.print(`\n${YELLOW}[Directory]${RESET} ${listing.path}`);
          listing.files.forEach((f) => {
            const size = f.size == null ? '' : ` (${f.size} bytes)`;
            this.print(`  - [${f.type}] ${f.name}${size}`);
          });
          this.showSuggestions({ type: 'FILE_LIST', result: listing });
          if (flags.analyze) {
            const result = await this.orchestrator.process('analyze directory', this.sessionId, {
              agent: 'fileAnalysis',
              dirPath: path.resolve(dirPath),
            });
            this.displayResult(result.agent, result.response);
          } else {
            this.print('');
          }
          break;
        }

        case 'read': {
          const filePath = flags.file || rest;
          if (!filePath) { this.error('Usage: /read <file> or /read --file=<path>'); break; }
          this.thinking();
          const content = fileHandler.readFile(path.resolve(filePath));
          this.print(content);
          break;
        }

        case 'write': {
          const filePath = flags.file;
          const content = typeof flags.content === 'string' ? flags.content : rest;
          if (!filePath) { this.error('Usage: /write --file=<path> --content=<text>'); break; }
          fileHandler.writeFile(path.resolve(filePath), content || '');
          this.success(`Wrote file: ${path.resolve(filePath)}`);
          break;
        }

        case 'compare': {
          const [fileA, fileB] = positional;
          if (!fileA || !fileB) { this.error('Usage: /compare <file-a> <file-b>'); break; }
          this.thinking();
          const result = await this.orchestrator.process('compare files', this.sessionId, {
            agent: 'fileAnalysis',
            filePath: path.resolve(fileA),
            filePathB: path.resolve(fileB),
          });
          this.displayResult(result.agent, result.response);
          break;
        }

        default:
          {
            const suggestion = CLI_COMMANDS.find((c) => c.startsWith(command)) || CLI_COMMANDS.find((c) => c.includes(command));
            this.error(`Unknown command: /${command}. Type /help for a list of commands.${suggestion ? ` Did you mean /${suggestion}?` : ''}`);
          }
      }
    } catch (err) {
      const errMsg = err?.message || String(err || 'Unknown error');
      if (/unable to reach|connect|unreachable/i.test(errMsg)) {
        this.error(`${errMsg}\n💡 Make sure Foundry Local is running: foundry service start`);
      } else if (/timed out/i.test(errMsg)) {
        this.error(`${errMsg}\n💡 Model is slow. Increase timeout in config/default.json`);
      } else {
        this.error(errMsg);
      }
    }
  }

  /**
   * Handle a free-form message (auto-routes to best agent).
   * @param {string} message
   */
  async handleMessage(message) {
    const inline = String(message || '').match(/\/(dir|analyze-dir)\s+(.+)$/i);
    if (inline) {
      await this.handleCommand(inline[1].toLowerCase(), [inline[2].trim()]);
      return;
    }
    this.thinking();
    try {
      const result = await this.orchestrator.process(message, this.sessionId);
      if (!result || !result.response) {
        this.error('No response received from agent. Is Foundry Local running?');
        return;
      }
      this.displayResult(result.agent, result.response);
    } catch (err) {
      const errMsg = err?.message || String(err || 'Unknown error');
      if (/unable to reach|connect|unreachable/i.test(errMsg)) {
        this.error(`${errMsg}\n\n💡 Make sure Foundry Local is running: foundry service start`);
      } else if (/timed out/i.test(errMsg)) {
        this.error(`${errMsg}\n\n💡 Model is slow. Increase timeout in config/default.json`);
      } else {
        this.error(errMsg);
      }
    }
  }

  /**
   * Start the interactive CLI session.
   */
  async start() {
    this.print(BANNER);
    const env = validateStartupEnv();
    if (env.errors.length || env.warnings.length) {
      this.print(`${YELLOW}Startup validation:${RESET}`);
      for (const err of env.errors) this.print(`${RED}  - ${err}${RESET}`);
      for (const warn of env.warnings) this.print(`${YELLOW}  - ${warn}${RESET}`);
      this.print('');
    }

    // Check model service availability
    const available = await this.orchestrator.isModelServiceAvailable();
    if (available) {
      this.success('✓ Foundry Local service is running.');
    } else {
      this.print(`${YELLOW}⚠  Foundry Local is not running. Start it to enable AI features.${RESET}`);
      this.print(`${DIM}   See: https://github.com/microsoft/Foundry${RESET}`);
    }

    this.print(`${DIM}Type /help for available commands.${RESET}\n`);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const prompt = () => process.stdout.write(`${CYAN}you>${RESET} `);

    prompt();

    this.rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) { prompt(); return; }

      if (input.startsWith('/')) {
        const [command, ...args] = input.slice(1).split(/\s+/);
        await this.handleCommand(command.toLowerCase(), args);
      } else {
        await this.handleMessage(input);
      }

      prompt();
    });

    this.rl.on('close', () => {
      this.print(`\n${GREEN}Session ended.${RESET}`);
      process.exit(0);
    });
  }
}

// Run when executed directly
if (require.main === module) {
  const cli = new CLIInterface();
  cli.start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { CLIInterface };
