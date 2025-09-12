import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'Example MCP',
  version: '1.0.0',
});

server.registerTool(
  'add',
  {
    title: 'Addition Tool',
    description: 'Add two numbers',
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => {
    // operation durchführen
    const sum = a + b;
    return { content: [{ type: 'text', text: String(sum) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
