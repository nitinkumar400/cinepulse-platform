const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
  }
];

// Handles the GET request for checking if the server works
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: "Vercel MCP Server API route is ready.",
    endpoints: {
      mcp: "POST /api/mcp"
    }
  });
});

// JSON-RPC endpoint for Streamable HTTP or other HTTP transport
router.post('/', (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  if (method === "initialize") {
    return res.json({
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
    });
  }

  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools
      }
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    let responseText = "";

    try {
      if (name === "deploy_site") {
        const prodFlag = args && args.production ? "--prod" : "";
        const linkFlag = args && args.link ? "--yes" : "";
        const command = `npx vercel ${prodFlag} ${linkFlag}`.trim();
        
        const workspaceDir = path.resolve(__dirname, '../..');
        const output = execSync(command, { cwd: workspaceDir, encoding: 'utf-8', stdio: 'pipe' });
        responseText = `Deployment triggered successfully.\n\nOutput:\n${output}`;
      } else if (name === "add_env_var") {
        const key = args.key;
        const val = args.value;
        const env = args.environment || "production";
        
        const command = `npx vercel env add ${key} ${env} "${val}"`;
        const workspaceDir = path.resolve(__dirname, '../..');
        const output = execSync(command, { cwd: workspaceDir, encoding: 'utf-8', stdio: 'pipe' });
        responseText = `Environment variable ${key} added successfully.\n\nOutput:\n${output}`;
      } else {
        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool not found: ${name}`
          }
        });
      }
    } catch (err) {
      responseText = `Error running tool: ${err.message}\n${err.stdout || ''}\n${err.stderr || ''}`;
    }

    return res.json({
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
    });
  }

  return res.json({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`
    }
  });
});

module.exports = router;
