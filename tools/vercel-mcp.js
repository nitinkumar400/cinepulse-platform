#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// Redirect stdout logging to stderr so it doesn't corrupt JSON-RPC 2.0 messages
console.log = function (...args) {
  process.stderr.write(args.join(' ') + '\n');
};
console.error = function (...args) {
  process.stderr.write(args.join(' ') + '\n');
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// A small log to stderr on startup to show it's running
process.stderr.write("Vercel MCP Server starting...\n");

const tools = [
  {
    name: "deploy_site",
    description: "Deploy the Cine Stream Platform to Vercel. Use this to trigger a preview or production deployment.",
    inputSchema: {
      type: "object",
      properties: {
        production: {
          type: "boolean",
          description: "Whether to deploy to production (true) or preview (false)"
        },
        link: {
          type: "boolean",
          description: "Whether to link the project first before deploying"
        }
      }
    }
  },
  {
    name: "add_env_var",
    description: "Add an environment variable to Vercel for the project. For example: MONGODB_URI.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The name of the environment variable"
        },
        value: {
          type: "string",
          description: "The value of the environment variable"
        },
        environment: {
          type: "string",
          description: "Environment to add it to (production, preview, development)"
        }
      },
      required: ["key", "value"]
    }
  },
  {
    name: "get_status",
    description: "Run 'vercel status' or similar commands to check the project and deployment status on Vercel.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "list_deployment_urls",
    description: "Lists configured or existing Vercel deployment URLs and project details.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

function handleRequest(req) {
  const { id, method, params } = req;
  
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "Vercel MCP Server",
          version: "1.0.0"
        }
      }
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools
      }
    };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    let responseText = "";

    try {
      if (name === "deploy_site") {
        const prodFlag = args && args.production ? "--prod" : "";
        const linkFlag = args && args.link ? "--yes" : "";
        const command = `npx vercel ${prodFlag} ${linkFlag}`.trim();
        
        process.stderr.write(`Executing command: ${command}\n`);
        const workspaceDir = path.resolve(__dirname, '..');
        const output = execSync(command, { cwd: workspaceDir, encoding: 'utf-8', stdio: 'pipe' });
        responseText = `Deployment triggered successfully.\n\nOutput:\n${output}`;
      } else if (name === "add_env_var") {
        const key = args.key;
        const val = args.value;
        const env = args.environment || "production";
        
        const command = `npx vercel env add ${key} ${env} "${val}"`;
        process.stderr.write(`Executing command: ${command}\n`);
        const workspaceDir = path.resolve(__dirname, '..');
        const output = execSync(command, { cwd: workspaceDir, encoding: 'utf-8', stdio: 'pipe' });
        responseText = `Environment variable ${key} added successfully.\n\nOutput:\n${output}`;
      } else if (name === "get_status") {
        const command = "npx vercel list";
        const workspaceDir = path.resolve(__dirname, '..');
        const output = execSync(command, { cwd: workspaceDir, encoding: 'utf-8', stdio: 'pipe' });
        responseText = `Vercel Status:\n${output}`;
      } else if (name === "list_deployment_urls") {
        const vercelJsonPath = path.resolve(__dirname, '../vercel.json');
        let configInfo = "No vercel.json found.";
        if (fs.existsSync(vercelJsonPath)) {
          configInfo = fs.readFileSync(vercelJsonPath, 'utf-8');
        }
        responseText = `Vercel configuration info:\n${configInfo}`;
      } else {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool not found: ${name}`
          }
        };
      }
    } catch (err) {
      responseText = `Error running tool: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}`;
    }

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: responseText
          }
        ]
      }
    };
  }

  // Handle fallback or notifications (like initialized)
  if (method && method.startsWith("notifications/")) {
    return null;
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`
    }
  };
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const res = handleRequest(req);
    if (res) {
      process.stdout.write(JSON.stringify(res) + '\n');
    }
  } catch (err) {
    process.stderr.write(`Invalid message line ignored: ${err.message}\n`);
  }
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`Uncaught Exception in MCP server: ${err.stack || err}\n`);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Unhandled Rejection in MCP server: ${reason}\n`);
});
