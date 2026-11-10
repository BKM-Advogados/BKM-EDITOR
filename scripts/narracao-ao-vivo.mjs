// Teste ao vivo da narração por IA (docs/narracao.md), com a chave de verdade, pelo MCP por stdio (dist-mcp/nucleo.cjs).
// Cria um projeto de teste numa pasta temporária (nunca em ~/Estudio), com duas cenas e o dicionário de pronúncia, e faz a
// sequência: vozes → configurar → pronúncias → prévia (sem custo) → narrar → narrar de novo (cache: nada vai ao Google) →
// ajustar as cenas à fala. No fim, diz onde estão os WAVs para ouvir.
//
// Uso (na raiz do repositório, depois de `npm run mcp:build`):
//   GEMINI_API_KEY=… node scripts/narracao-ao-vivo.mjs                         # Gemini 3.8 Flash TTS, voz Charon
//   GEMINI_API_KEY=… node scripts/narracao-ao-vivo.mjs --modelo gemini-3.8-flash-lite-tts --voz Kore
//   GOOGLE_TTS_API_KEY=… node scripts/narracao-ao-vivo.mjs --provedor google-tts --voz Kore --velocidade 1.1
//   node scripts/narracao-ao-vivo.mjs --so-previa                               # sem chave e sem custo: só a prévia
// Custo: duas frases curtas, menos de US$ 0,01 no Gemini (e dentro do 1 milhão grátis do Cloud TTS).
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, padrao) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : padrao;
};
const provedor = arg('--provedor', 'gemini');
const soPrevia = process.argv.includes('--so-previa');

const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-narracao-ao-vivo-'));
mkdirSync(path.join(pasta, 'video'), {recursive: true});
mkdirSync(path.join(pasta, 'midia'), {recursive: true});
writeFileSync(path.join(pasta, 'estudio.json'), JSON.stringify({formato: 1, nome: 'Narração ao vivo', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Exemplo'}]}, null, 2));
writeFileSync(path.join(pasta, 'video', 'video.json'), JSON.stringify({
  tipo: 'cenas', formato: {largura: 1080, altura: 1920, fps: 30},
  tema: {fundo: '#111418', texto: '#F2F2F2', destaque: '#70B8FF', suave: '#A3ABB5', fonte: 'Inter'},
  cenas: [
    {id: 'c1', duracao_ms: 2000, blocos: [{id: 't1', tipo: 'titulo', x: 0.1, y: 0.4, largura: 0.8, texto: 'Narração ao vivo'}],
      narracao: {texto: 'Bem-vindo ao Estúdio. Este é um teste de narração ao vivo, gerada na hora para cada cena.'}},
    {id: 'c2', duracao_ms: 2000, blocos: [{id: 't2', tipo: 'texto', x: 0.1, y: 0.4, largura: 0.8, texto: 'Dúvidas? Veja o guia'}],
      narracao: {texto: 'Se tiver qualquer dúvida, consulte o guia do projeto [pausa] antes de exportar.'}},
  ],
  efeitos: [],
}, null, 2));

const mcp = path.join(raiz, 'dist-mcp', 'nucleo.cjs');
const ambiente = {...process.env};
if (soPrevia) for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_TTS_API_KEY']) delete ambiente[k];
const cliente = new Client({name: 'narracao-ao-vivo', version: '1'});
await cliente.connect(new StdioClientTransport({command: process.execPath, args: [mcp, '--projeto', pasta], env: {...ambiente, ELECTRON_RUN_AS_NODE: '1'}, stderr: 'inherit'}));

let falhas = 0;
const chamar = async (nome, args = {}) => {
  const r = await cliente.callTool({name: nome, arguments: args});
  const texto = r.content?.[0]?.text ?? '';
  if (r.isError) {
    falhas++;
    console.log(`\n✘ ${nome}: ${texto}`);
    return null;
  }
  console.log(`\n✔ ${nome}`);
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
};
const mostrar = (x) => console.log(JSON.stringify(x, null, 2).split('\n').slice(0, 40).join('\n'));

const config = {provedor, ...(arg('--voz') ? {voz: arg('--voz')} : {}), ...(arg('--modelo') ? {modelo: arg('--modelo')} : {}),
  ...(arg('--velocidade') ? {velocidade: Number(arg('--velocidade'))} : {}), ...(provedor === 'gemini' ? {estilo: arg('--estilo', 'calmo e didático, como um instrutor paciente')} : {})};
mostrar(await chamar('configurar_narracao', config));
mostrar(await chamar('pronuncias_narracao', {definir: [{de: 'PIN', para: 'pin'}, {de: 'RH', para: 'erre agá'}], testar: 'O PIN e o RH'}));
const previa = await chamar('narrar', {previa: true});
mostrar(previa);
if (soPrevia) {
  console.log(`\nSó a prévia (sem chave, sem custo). Projeto: ${pasta}`);
  await cliente.close();
  process.exit(falhas ? 1 : 0);
}
const vozes = await chamar('vozes_narracao', {provedor});
if (vozes) console.log(`${vozes.vozes.length} vozes${vozes.aviso ? ` (${vozes.aviso})` : ''}: ${vozes.vozes.slice(0, 8).map((v) => v.id).join(', ')}…`);
const r = await chamar('narrar');
mostrar(r);
const r2 = await chamar('narrar');
if (r2) console.log(r2.geradas?.length ? `✘ o cache não pegou: ${r2.geradas.length} gerada(s) de novo` : `cache: ${r2.avisos?.[0] ?? 'nada a gerar'}`);
mostrar(await chamar('ajustar_cenas_a_fala'));
const doc = JSON.parse(readFileSync(path.join(pasta, 'video', 'video.json'), 'utf-8'));
console.log('\nCenas depois do ajuste:', doc.cenas.map((c) => `${c.id} ${c.duracao_ms} ms`).join(' · '));
for (const g of r?.geradas ?? []) {
  const b = readFileSync(path.join(pasta, g.arquivo));
  const v = new DataView(b.buffer, b.byteOffset);
  console.log(`  ${g.arquivo}: ${String.fromCharCode(...b.subarray(0, 4))}, ${v.getUint32(24, true)} Hz, ${v.getUint16(34, true)} bits, ${(g.duracao_ms / 1000).toFixed(1)} s`);
}
console.log(`\nOuça os WAVs em ${path.join(pasta, 'midia', 'narracao')} (ou abra a pasta no Estúdio: ESTUDIO_PROJETO=${pasta} npm run dev).`);
await cliente.close();
process.exit(falhas ? 1 : 0);
