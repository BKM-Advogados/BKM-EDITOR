// Exportação fora do Electron: renderiza um vídeo de cenas de teste nos três formatos (9:16, 4:5 e 16:9) em
// testes/saida/exportar/, pelo mesmo caminho do app (src/main/exportar.ts e src/nucleo/exportacao.ts). Serve para
// conferir o renderMedia neste PC quando o Electron de desenvolvimento não roda. A primeira vez empacota as composições
// e pode baixar o navegador de render do Remotion.
// Uso: npx tsx scripts/exportar-teste.mjs [--rapido]   (--rapido: escala 0,5 e qualidade leve)
import {mkdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas';
import {argumentosDoRender, nomesDosArquivos} from '../src/nucleo/exportacao';
import {prepararRender, renderizarVideo} from '../src/main/exportar';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'exportar');
mkdirSync(saida, {recursive: true});
const rapido = process.argv.includes('--rapido');

const doc = {
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'c1', duracao_ms: 2000, blocos: [{id: 'c1-t', tipo: 'titulo', x: 0.1, y: 0.35, largura: 0.8, texto: 'Exportar em **três** formatos'}]},
    {id: 'c2', duracao_ms: 2000, blocos: [
      {id: 'c2-n', tipo: 'numero', x: 0.1, y: 0.3, largura: 0.8, de: 0, ate: 100, sufixo: '%', rotulo: 'do quadro em frações'},
      {id: 'c2-x', tipo: 'texto', x: 0.1, y: 0.7, largura: 0.8, em: 600, texto: 'o mesmo documento, três proporções'},
    ]},
  ],
};
const {props} = resolverCenas(doc);
const formato = {largura: props.largura, altura: props.altura, fps: props.fps};
const opcoes = {
  destinos: [{id: 'reels', largura: 1080, altura: 1920}, {id: 'feed', largura: 1080, altura: 1350}, {id: 'youtube', largura: 1920, altura: 1080}],
  codec: 'h264', qualidade: rapido ? 'leve' : 'media', escala: rapido ? 0.5 : 1,
};

let ultimoPasso = -1;
const aviso = (p) => {
  if (p.tipo === 'status') console.log(p.mensagem);
  else if (p.progresso !== undefined) {
    const passo = Math.floor(p.progresso / 20);
    if (passo !== ultimoPasso) {
      ultimoPasso = passo;
      console.log(`  ${p.etapa}: ${Math.round(p.progresso)}%`);
    }
  }
};

const t0 = Date.now();
try {
  const preparado = await prepararRender({raizApp: raiz, empacotado: false, aviso});
  for (const plano of nomesDosArquivos('teste', opcoes.destinos, formato)) {
    const a = argumentosDoRender(opcoes, plano.destino, formato, props.duracao_ms);
    const arquivo = path.join(saida, `${plano.nome}.${a.ext}`);
    ultimoPasso = -1;
    await renderizarVideo(preparado, {props: {...props, largura: a.largura, altura: a.altura}, arquivo, codec: a.codec, videoBitrate: a.videoBitrate, quadros: a.frameRange}, aviso);
    console.log(`✔ ${path.relative(raiz, arquivo)} · ${a.largura}×${a.altura} · ${Math.round(statSync(arquivo).size / 1024)} KB`);
  }
  console.log(`pronto em ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(0);
} catch (e) {
  console.error(`falhou: ${e.message}`);
  process.exit(1);
}
