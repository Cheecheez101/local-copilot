'use strict';

const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;

function getWebSocketCtor() {
  try {
    return require('ws');
  } catch {
    throw new Error('The "ws" package is required for remote MCP servers. Install it with: npm install ws');
  }
}

class MCPServerManager extends EventEmitter {
  constructor(orchestrator) {
    super();
    this.orchestrator = orchestrator;
    this.servers = new Map();
    this.tools = new Map();
  }

  async getAvailableServers() {
    const servers = [];

    servers.push({
      id: 'playwright',
      name: 'Playwright MCP Server',
      description: 'Web automation and scraping tools',
      tools: [
        { name: 'navigate', description: 'Navigate to a URL' },
        { name: 'click', description: 'Click an element' },
        { name: 'type', description: 'Type text into an input' },
        { name: 'screenshot', description: 'Take a screenshot' },
        { name: 'extract', description: 'Extract content from page' },
      ],
      connected: false,
      type: 'featured',
    });

    servers.push({
      id: 'filesystem',
      name: 'Filesystem MCP Server',
      description: 'File system operations',
      tools: [
        { name: 'readFile', description: 'Read file contents' },
        { name: 'writeFile', description: 'Write to file' },
        { name: 'listDirectory', description: 'List directory contents' },
        { name: 'searchFiles', description: 'Search for files' },
      ],
      connected: false,
      type: 'featured',
    });

    servers.push({
      id: 'github',
      name: 'GitHub MCP Server',
      description: 'GitHub API integration',
      tools: [
        { name: 'getRepo', description: 'Get repository info' },
        { name: 'listIssues', description: 'List repository issues' },
        { name: 'createPR', description: 'Create pull request' },
        { name: 'searchCode', description: 'Search code on GitHub' },
      ],
      connected: false,
      type: 'featured',
    });

    for (const [id, server] of this.servers) {
      servers.push({ id, ...server, connected: true });
    }

    return servers;
  }

  async addServer(config) {
    const serverConfig = this.parseServerConfig(config);
    const server = await this.startMCPServer(serverConfig);
    this.servers.set(server.id, server);

    const tools = await this.discoverTools(server);
    this.tools.set(server.id, tools);
    this.emit('serverAdded', { id: server.id, tools });
    return server;
  }

  parseServerConfig(config) {
    const raw = typeof config === 'string' ? config : String(config?.config || '').trim();
    if (!raw) {
      throw new Error('Invalid MCP server configuration.');
    }

    if (raw.startsWith('http')) {
      return { type: 'remote', url: raw, transport: 'sse' };
    }

    const parts = raw.split(/\s+/);
    return {
      type: 'local',
      command: parts[0],
      args: parts.slice(1),
      transport: 'stdio',
    };
  }

  async startMCPServer(config) {
    const serverId = `mcp_${Date.now()}`;

    if (config.type === 'local') {
      const child = spawn(config.command, config.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const server = { id: serverId, process: child, config, status: 'running', startTime: Date.now() };

      child.stdout.on('data', (data) => this.handleServerMessage(serverId, data.toString()));
      child.stderr.on('data', (data) => this.emit('serverError', { serverId, error: data.toString() }));
      child.on('close', (code) => this.handleServerClose(serverId, code));
      return server;
    }

    const WebSocket = getWebSocketCtor();
    const ws = new WebSocket(config.url);
    const server = { id: serverId, ws, config, status: 'connecting', startTime: Date.now() };

    ws.on('open', () => {
      server.status = 'connected';
      this.emit('serverConnected', serverId);
    });
    ws.on('message', (data) => this.handleServerMessage(serverId, data.toString()));
    ws.on('close', () => {
      server.status = 'disconnected';
      this.emit('serverDisconnected', serverId);
    });

    return server;
  }

  async discoverTools(server) {
    const initRequest = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '0.1.0', capabilities: {} },
      id: 1,
    };
    await this.sendRequest(server, initRequest);

    const toolsRequest = { jsonrpc: '2.0', method: 'tools/list', id: 2 };
    const toolsResponse = await this.sendRequest(server, toolsRequest);
    return toolsResponse.result?.tools || [];
  }

  sendRequest(server, request) {
    return new Promise((resolve, reject) => {
      const messageId = request.id;
      let timeoutHandle = null;

      const handler = (data) => {
        try {
          const response = JSON.parse(String(data));
          if (response.id === messageId) {
            cleanup();
            resolve(response);
          }
        } catch {
          // Ignore non-JSON lines from process output.
        }
      };

      const errorHandler = (error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (server.process) {
          server.process.stdout.removeListener('data', handler);
          server.process.removeListener('error', errorHandler);
        } else if (server.ws) {
          server.ws.removeListener('message', handler);
          server.ws.removeListener('error', errorHandler);
        }
      };

      if (server.process) {
        server.process.stdout.on('data', handler);
        server.process.on('error', errorHandler);
        server.process.stdin.write(`${JSON.stringify(request)}\n`);
      } else if (server.ws) {
        server.ws.on('message', handler);
        server.ws.on('error', errorHandler);
        server.ws.send(JSON.stringify(request));
      } else {
        reject(new Error('Server transport is unavailable.'));
        return;
      }

      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error('Request timeout'));
      }, 5000);
    });
  }

  async callTool(serverId, toolName, params) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    const request = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: params },
      id: Date.now(),
    };

    const response = await this.sendRequest(server, request);
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  handleServerMessage(serverId, message) {
    try {
      const data = JSON.parse(message);
      if (data.method === 'notification') {
        this.emit('serverNotification', { serverId, notification: data.params });
      } else if (data.id) {
        this.emit(`response:${data.id}`, message);
      }
    } catch {
      // Non-JSON log lines are expected from some servers.
    }
  }

  handleServerClose(serverId, code) {
    const server = this.servers.get(serverId);
    if (server) {
      server.status = 'stopped';
      this.emit('serverStopped', { serverId, code });
    }
  }

  async createNewMCPServer(projectPath, name) {
    const template = await this.getMCPServerTemplate(name);
    await fs.mkdir(projectPath, { recursive: true });

    await fs.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        dependencies: { '@modelcontextprotocol/sdk': '^0.5.0' },
        scripts: { start: 'node index.js' },
      }, null, 2),
      'utf8'
    );

    await fs.writeFile(path.join(projectPath, 'index.js'), template, 'utf8');
    return projectPath;
  }

  async getMCPServerTemplate(name) {
    return `import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: '${name}', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'example_tool',
    description: 'An example tool',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'A message to process' } },
      required: ['message'],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'example_tool') {
    return { content: [{ type: 'text', text: \`Processed: \${args.message}\` }] };
  }
  throw new Error(\`Unknown tool: \${name}\`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('${name} MCP server running on stdio');`;
  }
}

module.exports = { MCPServerManager };
