// Teste de exportação com som, fora do Electron: monta um projeto de cenas com narração e música sintéticas (WAV), mede os
// envelopes como a interface faria, resolve as props (ducking incluído), empacota as composições, renderiza o MP4 com o
// renderMedia e confere que o arquivo saiu com faixa de áudio. Uso: npx tsx scripts/exportar-teste.mjs
// Saída em testes/saida/exportar-teste/ (ignorada pelo git). Se o Chrome Headless do Remotion não puder rodar neste PC,
// o script diz onde parou.
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {envelopeDeAmostras} from '../src/nucleo/audio.ts';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas.ts';
import {codificarWav, decodificarWav, musicaSintetica, narracaoSintetica, TAXA} from './audio-sintetico.ts';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'exportar-teste');
const publica = path.join(saida, 'publico'); // vira a pasta pública do pacote: staticFile('midia/x.wav') acha os arquivos
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${m}`);

rmSync(saida, {recursive: true, force: true});
mkdirSync(path.join(publica, 'midia'), {recursive: true});

// 1. mídia sintética e envelopes (o mesmo cálculo da interface, a partir do WAV)
const arquivos = {'midia/narracao.wav': narracaoSintetica(12), 'midia/musica.wav': musicaSintetica(14)};
const envelopes = {};
for (const [rel, amostras] of Object.entries(arquivos)) {
  const wav = codificarWav([amostras], TAXA);
  writeFileSync(path.join(publica, rel), wav);
  const {canais, taxa} = decodificarWav(wav);
  envelopes[rel] = envelopeDeAmostras(canais, taxa);
  writeFileSync(path.join(publica, `${rel}.envelope.json`), JSON.stringify(envelopes[rel]));
}
log(`mídia e envelopes em ${publica}`);

// 2. documento: três cenas (12 s), narração a partir de 0,5 s e música do começo ao fim com fade
const doc = {
  ...novoDocCenas({largura: 720, altura: 1280, fps: 30}),
  cenas: [
    {id: 'c1', duracao_ms: 4000, blocos: [{id: 'c1-t', tipo: 'titulo', x: 0.1, y: 0.38, largura: 0.8, texto: 'Teste de **som**'}]},
    {id: 'c2', duracao_ms: 4000, blocos: [{id: 'c2-t', tipo: 'texto', x: 0.1, y: 0.45, largura: 0.8, texto: 'Narração com música por baixo'}]},
    {id: 'c3', duracao_ms: 4000, blocos: [{id: 'c3-n', tipo: 'numero', x: 0.1, y: 0.3, largura: 0.8, de: 0, ate: 23, sufixo: ' LU', rotulo: 'abaixo da voz'}]},
  ],
  audio: {faixas: [
    {id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/narracao.wav', em: 500, duracao_ms: 11500}]},
    {id: 'musica', nome: 'Música', papel: 'musica', volume: 0.8, ducking: {ativo: true, alvo_lu: 20}, clipes: [{id: 'm1', arquivo: 'midia/musica.wav', em: 0, duracao_ms: 12000, fade_in_ms: 500, fade_out_ms: 1500}]},
  ]},
};
writeFileSync(path.join(saida, 'video.json'), JSON.stringify(doc, null, 2));
const {props, avisos} = resolverCenas(doc, {envelopes});
const duck = props.audio.faixas[1].clipes[0].ducking;
log(`props: ${props.duracao_ms} ms, ${props.largura}×${props.altura} a ${props.fps} qps; avisos: ${avisos.length ? avisos.join(' | ') : 'nenhum'}`);
log(`ducking medido: voz ${duck.voz_db} dB, música ${duck.musica_db} dB, redução ${duck.reducao_db} dB (alvo 20 LU); ganho mínimo ${Math.min(...duck.ganho)}`);
writeFileSync(path.join(saida, 'props.json'), JSON.stringify(props));

// 3. pacote, composição e render
let etapa = 'carregar @remotion/bundler e @remotion/renderer';
try {
  const {bundle} = await import('@remotion/bundler');
  const {ensureBrowser, getVideoMetadata, renderMedia, selectComposition} = await import('@remotion/renderer');
  etapa = 'baixar/achar o Chrome Headless do Remotion';
  await ensureBrowser({onBrowserDownload: () => ({version: null, onProgress: ({percent}) => percent >= 1 && log('navegador baixado')})});
  etapa = 'empacotar as composições (src/composicoes/index.ts)';
  const serveUrl = await bundle({entryPoint: path.join(raiz, 'src', 'composicoes', 'index.ts'), publicDir: publica, outDir: path.join(saida, 'pacote')});
  log(`pacote em ${serveUrl}`);
  etapa = 'selectComposition (abre o Chrome Headless)';
  const composition = await selectComposition({serveUrl, id: 'VideoCenas', inputProps: props});
  log(`composição: ${composition.durationInFrames} quadros`);
  etapa = 'renderMedia';
  const arquivo = path.join(saida, 'saida.mp4');
  let ultimo = -1;
  await renderMedia({
    composition, serveUrl, codec: 'h264', outputLocation: arquivo, inputProps: props, concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
    onProgress: ({progress}) => {
      const p = Math.floor(progress * 10);
      if (p !== ultimo) log(`render ${p * 10}%`), (ultimo = p);
    },
  });
  etapa = 'conferir o MP4';
  const meta = await getVideoMetadata(arquivo);
  log(`MP4: ${arquivo} · ${meta.durationInSeconds.toFixed(2)} s · vídeo ${meta.codec} · áudio ${meta.audioCodec ?? 'NENHUM'}`);
  if (!meta.audioCodec) {
    console.error('FALHOU: o MP4 saiu sem faixa de áudio');
    process.exit(2);
  }
  console.log('\nOK: o MP4 saiu com som. Abra o arquivo e ouça: a música cai quando a narração fala (0,5 s a 12 s) e volta nas pausas.');
} catch (e) {
  console.error(`\nFALHOU na etapa "${etapa}": ${e?.message ?? e}`);
  if (!existsSync(path.join(raiz, 'node_modules', '@remotion', 'renderer'))) console.error('(falta node_modules: rode npm install)');
  console.error('O que já ficou pronto está em', saida, '(video.json, props.json, mídia e envelopes). O que falta é só o render;',
    'no app, Exportar usa o mesmo renderMedia com estas props.');
  process.exit(1);
}
