// Teste de ponta a ponta da frente Fala, fora do Electron: os primeiros 15 s da narração real do exemplo Cliente C2 viram
// palavras.json pela transcrição local (o mesmo Transcritor do app: whisper.cpp no PC), as palavras viram legendas no
// vídeo de cenas, e o Remotion renderiza o MP4 com som e legenda (o mesmo renderMedia do Exportar), uma foto de cada
// estilo (renderStill) e o SRT e o VTT. Sem o whisper instalado (ou com --sem-whisper), usa o palavras.json do exemplo.
// Uso: npx tsx scripts/exportar-teste-legendas.mjs [classica|caixa|karaoke|faixa|discreta] [--sem-whisper]
// Saída em testes/saida/exportar-legendas/ (ignorada pelo git).
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas.ts';
import {legendasDoDocumento, paraSrt, paraVtt, PREDEFINICOES_LEGENDA, requebrar} from '../src/nucleo/legendas.ts';
import {Projeto} from '../src/nucleo/projeto.ts';
import {Transcritor} from '../src/main/transcricao.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'exportar-legendas');
const publica = path.join(saida, 'publico'); // pasta do projeto e pasta pública do pacote: staticFile('midia/x') acha
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);
const estilo = process.argv.slice(2).find((a) => a in PREDEFINICOES_LEGENDA) ?? 'classica';
const semWhisper = process.argv.includes('--sem-whisper');
const TRECHO_MS = 15_500;

rmSync(saida, {recursive: true, force: true});
mkdirSync(path.join(publica, 'midia'), {recursive: true});
copyFileSync(path.join(raiz, 'exemplos', 'exemplo', 'midia', 'video-exemplo.mp4'), path.join(publica, 'midia', 'narracao.mp4'));
const projeto = new Projeto(publica);

// 1. a fala vira palavras.json (só o trecho que o vídeo usa)
const transcritor = new Transcritor({raizApp: raiz});
const estado = transcritor.estado();
if (!semWhisper && estado.plataforma && estado.ffmpeg) {
  log(estado.falta.length ? `baixando: ${estado.falta.join(', ')}` : 'whisper.cpp e modelo já instalados');
  const r = await transcritor.transcrever(projeto, {arquivo: 'midia/narracao.mp4', dur_ms: TRECHO_MS}, (p) => p.etapa !== 'transcrevendo' && log(`${p.etapa}: ${p.mensagem}`));
  log(`transcrito: ${r.n} palavras em ${r.duracao_s} s: "${r.texto}"`);
} else {
  const ref = JSON.parse(readFileSync(path.join(raiz, 'exemplos', 'exemplo', 'video', 'palavras.json'), 'utf-8')).filter((p) => p.s < TRECHO_MS);
  projeto.gravarTexto('midia/narracao.mp4.palavras.json', JSON.stringify(ref));
  log(`sem o whisper: ${ref.length} palavras do palavras.json do exemplo`);
}

// 2. documento: três cenas (16 s), a narração a partir de 0,5 s e as legendas geradas da transcrição
const doc = {
  ...novoDocCenas({largura: 720, altura: 1280, fps: 30}),
  tema: {fundo: '#171A19', texto: '#F4F0EA', destaque: '#C88155', suave: '#A39E95', fonte: 'Inter'}, // as cores da Cliente
  cenas: [
    {id: 'c1', duracao_ms: 5000, blocos: [{id: 'c1-t', tipo: 'titulo', x: 0.1, y: 0.3, largura: 0.8, texto: 'Mudar de **cidade**?'}]},
    {id: 'c2', duracao_ms: 5500, blocos: [{id: 'c2-t', tipo: 'texto', x: 0.1, y: 0.32, largura: 0.8, texto: 'Primeira regra: a mudança depende de você'}]},
    {id: 'c3', duracao_ms: 5500, blocos: [{id: 'c3-n', tipo: 'numero', x: 0.1, y: 0.25, largura: 0.8, de: 0, ate: 25, sufixo: '%', rotulo: 'de adicional'}]},
  ],
  audio: {faixas: [{id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/narracao.mp4', em: 500, duracao_ms: TRECHO_MS - 500}]}]},
};
const {legendas, faltam} = legendasDoDocumento(doc, (c) => projeto.lerJson(c).doc, {largura: doc.formato.largura, altura: doc.formato.altura, estilo: {predefinicao: estilo}});
if (faltam.length) throw new Error(`sem transcrição: ${faltam.join(', ')}`);
doc.legendas = legendas;
writeFileSync(path.join(saida, 'video.json'), JSON.stringify(doc, null, 2));
const {props, avisos} = resolverCenas(doc);
const segs = props.legendas_cenas.segmentos;
log(`${segs.length} legendas no estilo ${estilo}; avisos: ${avisos.length ? avisos.join(' | ') : 'nenhum'}`);
writeFileSync(path.join(saida, 'legendas.srt'), paraSrt(segs));
writeFileSync(path.join(saida, 'legendas.vtt'), paraVtt(segs));
// um instante no meio de uma palavra da terceira legenda, para as fotos mostrarem a palavra falada em destaque
const alvo = segs[Math.min(2, segs.length - 1)];
const palavra = alvo.palavras[Math.floor(alvo.palavras.length / 2)];
const quadroFoto = Math.round((((palavra.s + palavra.e) / 2) / 1000) * props.fps);

// 3. pacote, MP4 com som e legenda, uma foto por estilo
let etapa = 'carregar @remotion/bundler e @remotion/renderer';
try {
  const {bundle} = await import('@remotion/bundler');
  const {ensureBrowser, getVideoMetadata, renderMedia, renderStill, selectComposition} = await import('@remotion/renderer');
  etapa = 'baixar/achar o Chrome Headless do Remotion';
  await ensureBrowser();
  etapa = 'empacotar as composições';
  const serveUrl = await bundle({entryPoint: path.join(raiz, 'src', 'composicoes', 'index.ts'), publicDir: publica, outDir: path.join(saida, 'pacote')});
  etapa = 'selectComposition';
  const composition = await selectComposition({serveUrl, id: 'VideoCenas', inputProps: props});
  etapa = 'renderMedia';
  const arquivo = path.join(saida, `saida-${estilo}.mp4`);
  let ultimo = -1;
  await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: arquivo, inputProps: props, concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
    onProgress: ({progress}) => {
      const p = Math.floor(progress * 4);
      if (p !== ultimo) log(`render ${p * 25}%`), (ultimo = p);
    }});
  const meta = await getVideoMetadata(arquivo);
  log(`MP4: ${arquivo} · ${meta.durationInSeconds.toFixed(2)} s · ${meta.width}×${meta.height} · vídeo ${meta.codec} · áudio ${meta.audioCodec ?? 'NENHUM'}`);
  if (!meta.audioCodec) throw new Error('o MP4 saiu sem faixa de áudio');
  etapa = 'renderStill (uma foto por estilo)';
  for (const id of Object.keys(PREDEFINICOES_LEGENDA)) {
    // como no app: trocar de estilo quebra de novo (largura e palavras por vez de cada um)
    const d = {...doc, legendas: requebrar(doc.legendas, {predefinicao: id}, doc.formato.largura, doc.formato.altura)};
    const p = resolverCenas(d).props;
    await renderStill({composition: {...composition, props: p}, serveUrl, inputProps: p, frame: quadroFoto, output: path.join(saida, `foto-${id}.png`)});
  }
  log(`fotos no quadro ${quadroFoto} (palavra "${palavra.w}"): ${Object.keys(PREDEFINICOES_LEGENDA).map((id) => `foto-${id}.png`).join(', ')}`);
  console.log(`\nOK: ${arquivo} saiu com som e ${segs.length} legendas. Abra e confira a palavra falada em destaque; SRT e VTT ao lado.`);
} catch (e) {
  console.error(`\nFALHOU na etapa "${etapa}": ${e?.message ?? e}`);
  if (!existsSync(path.join(raiz, 'node_modules', '@remotion', 'renderer'))) console.error('(falta node_modules: rode npm install)');
  process.exit(1);
}
