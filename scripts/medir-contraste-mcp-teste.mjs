// A cadeia inteira das ferramentas da marca d'água fora do Electron (rodada 3, frente C): o MCP chama marca_dagua (grava a marca de
// um destino) e medir_contraste_marca, que pede a medida ao processo principal (src/main/contraste-marca.ts, o mesmo registro que o
// app faz ao subir), que renderiza os quadros com o Remotion e lê os pixels. Um vídeo claro com o logo claro do kit no canto: sem
// placa fica abaixo de 3:1; com a placa que a medida sugere passa.
// Uso: npx tsx scripts/medir-contraste-mcp-teste.mjs   (leva uns 60 s neste PC)
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registrarContrasteMarca} from '../src/main/contraste-marca';
import {prepararRender} from '../src/main/exportar';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {MARCA_CLIENTE, temaDaMarca} from '../src/nucleo/marca';
import {Projeto} from '../src/nucleo/projeto';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${m}`);
const svg = (s) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
const LOGO = svg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" rx="24" fill="#EDE7DD"/>'
  + '<text x="40" y="138" font-family="sans-serif" font-size="110" font-weight="800" fill="#F8F5EF">Cliente</text></svg>');

const doc = {
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  tema: {...temaDaMarca(MARCA_CLIENTE, {logo: LOGO, fontes_arquivos: []}), fundo: '#F4F0EA'},
  cenas: [{id: 'a', duracao_ms: 4000, fundo: '#F4F0EA', blocos: [{id: 'a-t', tipo: 'titulo', x: 0.1, y: 0.45, largura: 0.8, em: 0, texto: 'Fundo claro', cor: '#171A19'}]}],
};
const pasta = mkdtempSync(path.join(os.tmpdir(), 'estudio-contraste-mcp-'));
mkdirSync(path.join(pasta, 'video'), {recursive: true});
writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Contraste', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo'}]}));
writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify(doc));
const projeto = new Projeto(pasta);
let falhou = false;
try {
  const preparado = await prepararRender({raizApp: raiz, empacotado: false, aviso: () => undefined});
  // o que o main.ts faz ao subir: registra o canal e o medidor
  registrarContrasteMarca(() => undefined, () => projeto, () => ({props: resolverCenas(doc).props}), async () => preparado);
  const servidor = new McpServer({name: 'estudio', version: 'teste'});
  registrarFerramentas(servidor, projeto, 'agente', 'script');
  const [a, b] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({name: 'script', version: '1'});
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
  const chamar = async (name, args) => {
    const r = await cliente.callTool({name, arguments: args});
    return {erro: Boolean(r.isError), texto: r.content[0].text};
  };
  log(`marca_dagua: ${(await chamar('marca_dagua', {destino: 'reels', ligada: true, conteudo: 'logo', canto: 'inf-dir'})).texto.replace(/\s+/g, ' ')}`);
  const sem = await chamar('medir_contraste_marca', {documento: 'video', destino: 'reels'});
  log(`sem placa (erro ${sem.erro}):\n${sem.texto}`);
  const com = await chamar('medir_contraste_marca', {documento: 'video', destino: 'reels', placa: 'escura'});
  log(`com a placa escura, só de teste (erro ${com.erro}):\n${com.texto}`);
  falhou = sem.erro || com.erro || !/NÃO passa/.test(sem.texto) || !/ passa\./.test(com.texto);
  log(falhou ? 'ATENÇÃO: o esperado era abaixo de 3:1 sem placa e acima com a placa' : 'pronto: sem placa abaixo de 3:1, com placa acima, pela ferramenta do MCP');
} finally {
  rmSync(pasta, {recursive: true, force: true});
}
process.exit(falhou ? 1 : 0);
