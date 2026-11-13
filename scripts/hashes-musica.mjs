// Contrato de determinismo da música (M-03, ADR A4; docs/musica.md, seção "Determinismo"): confere que o MCP por stdio
// (dist-mcp/nucleo.cjs, o mesmo render do processo principal) dá, para cada documento de testes/fixtures/musica-referencia/,
// o mesmo SHA-256 do PCM que o vitest (testes/musica-determinismo.test.ts, que confere o hashes.json). Monta um projeto
// temporário com os documentos e o áudio de referência, chama medir_musica {hash: true} em cada um e compara.
// Uso (depois do npm run mcp:build):
//   node scripts/hashes-musica.mjs                       # roda o vitest e depois o MCP pelo Node de quem chama
//   node scripts/hashes-musica.mjs --sem-vitest          # só o MCP, contra o hashes.json
//   node scripts/hashes-musica.mjs --executavel <app>    # o MCP pelo executável do Estúdio em modo Node (o V8 do Electron)
// Sai com 1 se algum hash diferir.
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = path.join(raiz, 'testes', 'fixtures', 'musica-referencia');
const nucleo = path.join(raiz, 'dist-mcp', 'nucleo.cjs');
const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const executavel = arg('--executavel');

if (!existsSync(nucleo)) {
  console.error('falta dist-mcp/nucleo.cjs: rode npm run mcp:build');
  process.exit(2);
}

// 1) o vitest: o motor de agora dá o hashes.json (se não der, comparar o MCP com o arquivo não prova nada)
if (!process.argv.includes('--sem-vitest')) {
  const vitest = path.join(raiz, 'node_modules', 'vitest', 'vitest.mjs');
  const r = spawnSync(process.execPath, [vitest, 'run', 'testes/musica-determinismo.test.ts'], {cwd: raiz, stdio: 'inherit'});
  if (r.status !== 0) {
    console.error('o vitest não bate com o hashes.json: confira antes o motor');
    process.exit(1);
  }
}

const esperados = JSON.parse(readFileSync(path.join(pasta, 'hashes.json'), 'utf8')).musicas;
const nomes = readdirSync(pasta).filter((f) => f.endsWith('.json') && f !== 'hashes.json').map((f) => f.replace(/\.json$/, '')).sort();

// 2) um projeto temporário com as músicas de referência (fora de ~/Estudio, apagado no fim)
const projeto = mkdtempSync(path.join(tmpdir(), 'estudio-hashes-'));
mkdirSync(path.join(projeto, 'musica'));
for (const n of nomes) cpSync(path.join(pasta, `${n}.json`), path.join(projeto, 'musica', `${n}.json`));
cpSync(path.join(pasta, 'midia'), path.join(projeto, 'midia'), {recursive: true});
writeFileSync(path.join(projeto, 'estudio.json'), `${JSON.stringify({formato: 1, nome: 'Hashes da música',
  documentos: nomes.map((n) => ({id: n, modulo: 'musica', caminho: `musica/${n}.json`, titulo: n}))}, null, 2)}\n`);
writeFileSync(path.join(projeto, '.gitignore'), 'saidas/\n');

// 3) o MCP por stdio: pelo Node de quem chama, ou pelo executável do app em modo Node
const env = {...process.env};
if (executavel) env.ELECTRON_RUN_AS_NODE = '1';
else delete env.ELECTRON_RUN_AS_NODE;
const cliente = new Client({name: 'hashes-musica', version: '0'});
let falhas = 0;
try {
  await cliente.connect(new StdioClientTransport({command: executavel ?? process.execPath, args: [nucleo, '--projeto', projeto, '--autor', 'agente'], env, stderr: 'inherit'}));
  console.log(`MCP por stdio: ${executavel ?? `node ${process.version}`}`);
  for (const n of nomes) {
    const r = await cliente.callTool({name: 'medir_musica', arguments: {documento: n, hash: true}});
    const texto = r.content.map((x) => x.text).join('\n');
    let dado = null;
    try {
      dado = JSON.parse(texto);
    } catch {
      /* erro em texto */
    }
    const e = esperados[n];
    const ok = !r.isError && dado && e && dado.pcm_sha256 === e.pcm_sha256 && dado.amostras === e.amostras;
    if (!ok) falhas++;
    console.log(`${ok ? 'igual    ' : 'DIFERENTE'} ${n.padEnd(22)} ${dado?.pcm_sha256 ?? texto.slice(0, 200)}${ok ? '' : `\n          esperado (vitest)      ${e?.pcm_sha256 ?? '(sem hash no hashes.json)'}`}${dado?.feito_por ? `  [${dado.feito_por}]` : ''}`);
  }
} finally {
  await cliente.close().catch(() => undefined);
  rmSync(projeto, {recursive: true, force: true});
}
console.log(falhas ? `${falhas} de ${nomes.length} diferem` : `os ${nomes.length} hashes batem com o vitest`);
process.exit(falhas ? 1 : 0);
