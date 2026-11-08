// Teste fora do Electron das fontes da exportação (rodada 3, frente Marca; video-D9 e video-D10): o Remotion empacota as
// composições e renderiza um quadro do vídeo de cenas com cada fonte que vem no app (Inter, Archivo, IBM Plex Sans e
// Mono) e com uma fonte de arquivo que NÃO existe. As quatro do app saem sem pedir nada à internet (o pacote não cita
// fonts.gstatic.com) e a que não existe não cancela o render: o texto sai numa fonte do sistema, com um aviso no console.
// Uso: npx tsx scripts/exportar-teste-fontes.mjs
// Saída em testes/saida/exportar-fontes/ (ignorada pelo git): fonte-<nome>.png e o pacote.
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'exportar-fontes');
const publica = path.join(saida, 'publico');
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);

rmSync(saida, {recursive: true, force: true});
mkdirSync(publica, {recursive: true});

const doc = (fonte, extra = {}) => ({
  ...novoDocCenas({largura: 720, altura: 1280, fps: 30}),
  tema: {fundo: '#171A19', texto: '#F4F0EA', destaque: '#C88155', suave: '#A09F9B', fonte, ...extra},
  cenas: [{id: 'c1', duracao_ms: 2000, blocos: [
    {id: 't', tipo: 'titulo', x: 0.08, y: 0.25, largura: 0.84, texto: `${fonte}: **Rescisão** de contrato 1234`},
    {id: 'x', tipo: 'texto', x: 0.08, y: 0.5, largura: 0.84, texto: 'Aviso prévio, férias proporcionais e décimo terceiro.'},
  ]}],
});

const casos = [
  {nome: 'Inter', doc: doc('Inter')},
  {nome: 'Archivo', doc: doc('Archivo')},
  {nome: 'IBM Plex Sans', doc: doc('IBM Plex Sans')},
  {nome: 'IBM Plex Mono', doc: doc('IBM Plex Mono')},
  // o kit cita uma fonte de arquivo que foi apagada de fontes/: o render tem de seguir (video-D10)
  {nome: 'Fantasma', doc: doc('Fantasma', {fontes_arquivos: [{familia: 'Fantasma', arquivo: 'fontes/Fantasma-Bold.ttf', peso: 700}]})},
];

let etapa = 'carregar @remotion/bundler e @remotion/renderer';
try {
  const {bundle} = await import('@remotion/bundler');
  const {ensureBrowser, renderStill, selectComposition} = await import('@remotion/renderer');
  etapa = 'achar o Chrome Headless do Remotion';
  await ensureBrowser();
  etapa = 'empacotar as composições';
  const pacote = path.join(saida, 'pacote');
  const serveUrl = await bundle({entryPoint: path.join(raiz, 'src', 'composicoes', 'index.ts'), publicDir: publica, outDir: pacote});
  log(`pacote em ${pacote}`);

  // o pacote não pode ir buscar fonte na internet: nada de fonts.gstatic.com (o endereço das fontes do @remotion/google-fonts).
  // O Studio do Remotion, que vai no mesmo pacote mas não roda na exportação, cita fonts.googleapis.com só para a amostra do seletor dele.
  const citam = [];
  const varrer = (pasta) => {
    for (const f of readdirSync(pasta)) {
      const p = path.join(pasta, f);
      if (statSync(p).isDirectory()) varrer(p);
      else if (/\.(js|html|css)$/.test(f) && /fonts\.gstatic\.com/.test(readFileSync(p, 'utf-8'))) citam.push(path.relative(pacote, p));
    }
  };
  varrer(pacote);
  if (citam.length) throw new Error(`o pacote ainda cita fonts.gstatic.com em: ${citam.join(', ')}`);
  log('o pacote não cita fonts.gstatic.com');

  const avisos = [];
  for (const c of casos) {
    etapa = `renderStill ${c.nome}`;
    const {props} = resolverCenas(c.doc);
    const composition = await selectComposition({serveUrl, id: 'VideoCenas', inputProps: props, onBrowserLog: (l) => /fontes\]/.test(l.text) && avisos.push(l.text)});
    const arquivo = path.join(saida, `fonte-${c.nome.replace(/\s+/g, '-')}.png`);
    const t = Date.now();
    await renderStill({composition: {...composition, props}, serveUrl, inputProps: props, frame: 30, output: arquivo, timeoutInMilliseconds: 60_000,
      onBrowserLog: (l) => /fontes\]/.test(l.text) && avisos.push(l.text)});
    log(`${c.nome}: ${arquivo} (${((Date.now() - t) / 1000).toFixed(1)} s, ${(statSync(arquivo).size / 1024).toFixed(0)} KB)`);
  }
  writeFileSync(path.join(saida, 'avisos.txt'), avisos.join('\n'));
  log(`avisos do console: ${avisos.length ? [...new Set(avisos)].join(' | ') : 'nenhum'}`);
  console.log('\nOK: cinco quadros em testes/saida/exportar-fontes/. As quatro fontes do app saem em fonte-<nome>.png e a Fantasma (arquivo inexistente) cai numa fonte do sistema, sem cancelar.');
} catch (e) {
  console.error(`\nFALHOU na etapa "${etapa}": ${e?.message ?? e}`);
  if (!existsSync(path.join(raiz, 'node_modules', '@remotion', 'renderer'))) console.error('(falta node_modules: rode npm install)');
  process.exit(1);
}
