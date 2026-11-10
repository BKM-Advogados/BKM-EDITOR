// Faz de "outro app" (o Claude no terminal): fala com o MCP por stdio no projeto aberto no Estúdio. Uso: node scripts/mcp-externo.mjs <raiz> <ferramenta> '<json>'
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const [raiz, ferramenta, json] = process.argv.slice(2);
const c = new Client({name: 'externo', version: '0'});
await c.connect(new StdioClientTransport({command: process.execPath, args: ['dist-mcp/nucleo.cjs', '--projeto', raiz, '--autor', 'agente'], env: {...process.env, ELECTRON_RUN_AS_NODE: ''}}));
const r = await c.callTool({name: ferramenta, arguments: json ? JSON.parse(json) : {}});
console.log(r.content.map((x) => x.text).join('\n').slice(0, 1800));
await c.close();
process.exit(0);
