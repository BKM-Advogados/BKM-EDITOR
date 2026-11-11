// Ken Burns e marca d'água fora do Electron: um vídeo de cenas com três fotos paradas ganha "Movimento em todas as
// imagens", sai nos quatro formatos (9:16, 4:5, 1:1 e 16:9) com o logo de marca d'água ligado e mais uma vez em 9:16
// sem ele, pelo mesmo caminho do app (src/main/exportar.ts, src/nucleo/exportacao.ts e o registro das composições). No
// fim tira dois quadros de cada MP4 (no começo e no fim da primeira foto) com o ffmpeg que vem no compositor do
// Remotion, para olhar o movimento e onde a marca caiu. Fotos e logo são SVG em data URL: dispensa o servidor de mídia.
// Uso: npx tsx scripts/exportar-teste-kenburns.mjs [--completo]   (sem --completo: escala 0,5 e qualidade leve)
// Saída em testes/saida/kenburns/ (ignorada pelo git).
import {spawnSync} from 'node:child_process';
import {mkdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import jsonpatch from 'fast-json-patch';
import {patchMovimentoEmTodas} from '../src/composicoes/cenas/movimento';
import {novoDocCenas, resolverCenas} from '../src/nucleo/cenas';
import {argumentosDoRender, configPadraoMarca, fontesDaMarcaDagua, marcaDaguaDoDestino} from '../src/nucleo/exportacao';
import {temaDaMarca} from '../src/nucleo/marca';
import {KIT_TESTE} from '../testes/fixtures/kit-teste';
import {prepararRender, renderizarVideo} from '../src/main/exportar';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'kenburns');
const quadros = path.join(saida, 'quadros');
rmSync(saida, {recursive: true, force: true});
mkdirSync(quadros, {recursive: true});
const completo = process.argv.includes('--completo');
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${m}`);

const svg = (s) => `data:image/svg+xml;utf8,${encodeURIComponent(s)}`;
const foto = (ceu, sol, morro, n) => svg(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">`
  + `<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ceu}"/><stop offset="1" stop-color="${sol}"/></linearGradient></defs>`
  + `<rect width="1600" height="1000" fill="url(#c)"/><circle cx="${400 + n * 400}" cy="380" r="120" fill="${sol}"/>`
  + `<path d="M0 720 Q400 520 800 700 T1600 640 V1000 H0Z" fill="${morro}"/>`
  + Array.from({length: 15}, (_, k) => `<path d="M${(k + 1) * 100} 0V1000" stroke="#fff" stroke-opacity="0.25" stroke-width="3"/>`).join('')
  + Array.from({length: 9}, (_, k) => `<path d="M0 ${(k + 1) * 100}H1600" stroke="#fff" stroke-opacity="0.25" stroke-width="3"/>`).join('')
  + `<text x="800" y="560" text-anchor="middle" font-family="sans-serif" font-size="140" font-weight="700" fill="#fff">Foto ${n + 1}</text></svg>`);
const LOGO = svg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" rx="24" fill="#C88155"/>'
  + '<text x="40" y="138" font-family="sans-serif" font-size="110" font-weight="800" fill="#F4F0EA">LOGO</text></svg>');

// 1. três fotos paradas de 1,5 s (a cena inteira) e um kit de teste com logo; depois o botão "Movimento em todas as imagens"
const fotos = [['#3E6FA8', '#F2C46B', '#2E5E3A'], ['#7A4E8C', '#F28C6B', '#3D3A5E'], ['#1F7A8C', '#F5E6A8', '#5E4A2E']].map(([a, b, c], i) => foto(a, b, c, i));
const parado = {
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  tema: temaDaMarca(KIT_TESTE, {logo: LOGO, fontes_arquivos: []}),
  cenas: fotos.map((src, i) => ({id: `c${i + 1}`, duracao_ms: 1500, blocos: [
    {id: `c${i + 1}-imagem`, tipo: 'imagem', em: 0, x: 0, y: 0, largura: 1, altura: 1, ajuste: 'cobrir', src},
  ]})),
};
const mov = patchMovimentoEmTodas(parado);
const doc = jsonpatch.applyPatch(structuredClone(parado), mov.patch, true).newDocument;
log(`movimento em ${mov.n} imagens: ${doc.cenas.map((c) => c.blocos[0].movimento.tipo).join(', ')}`);
const {props} = resolverCenas(doc);
const formato = {largura: props.largura, altura: props.altura, fps: props.fps};
const fontes = fontesDaMarcaDagua(props);

// 2. um arquivo por destino, como o handler de exportar do main.ts: largura e altura do destino nas props e a marca
// d'água do destino (ligada, no canto padrão da rede); o último sai sem marca para comparar
const destinos = [
  {id: 'reels', largura: 1080, altura: 1920, marca: true}, {id: 'feed', largura: 1080, altura: 1350, marca: true},
  {id: 'quadrado', largura: 1080, altura: 1080, marca: true}, {id: 'youtube', largura: 1920, altura: 1080, marca: true},
  {id: 'reels', largura: 1080, altura: 1920, marca: false},
];
const opcoes = {destinos, codec: 'h264', qualidade: completo ? 'media' : 'leve', escala: completo ? 1 : 0.5};

let ultimoPasso = -1;
const aviso = (p) => {
  if (p.tipo === 'status') log(p.mensagem);
  else if (p.progresso !== undefined && Math.floor(p.progresso / 25) !== ultimoPasso) {
    ultimoPasso = Math.floor(p.progresso / 25);
    log(`  ${p.etapa}: ${Math.round(p.progresso)}%`);
  }
};
const ffmpeg = path.join(raiz, 'node_modules', '@remotion', 'compositor-win32-x64-msvc', 'ffmpeg.exe');

try {
  const preparado = await prepararRender({raizApp: raiz, empacotado: false, aviso});
  for (const d of destinos) {
    const a = argumentosDoRender(opcoes, d, formato, props.duracao_ms);
    const nome = `kenburns-${d.largura}x${d.altura}${d.marca ? '' : '-sem-marca'}`;
    const arquivo = path.join(saida, `${nome}.${a.ext}`);
    const marca = d.marca ? marcaDaguaDoDestino({...configPadraoMarca(d, fontes), ligada: true}, d, fontes, 3) : null;
    ultimoPasso = -1;
    await renderizarVideo(preparado, {props: {...props, largura: a.largura, altura: a.altura, ...(marca ? {marca_dagua: marca} : {})}, arquivo, codec: a.codec,
      videoBitrate: a.videoBitrate, quadros: a.frameRange}, aviso);
    log(`✔ ${path.relative(raiz, arquivo)} · ${a.largura}×${a.altura} · ${Math.round(statSync(arquivo).size / 1024)} KB`
      + (marca ? ` · marca em x ${marca.x.toFixed(3)}, y ${marca.y.toFixed(3)} (${marca.largura.toFixed(3)} × ${marca.altura.toFixed(3)}), segura: ${marca.segura}` : ' · sem marca'));
    // meio da primeira foto (aproximar), com o bloco já inteiro na tela: a 0,5 s e a 1,1 s
    for (const [rotulo, s] of [['a', 0.5], ['b', 1.1]]) {
      const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(s), '-i', arquivo, '-frames:v', '1', path.join(quadros, `${nome}-${rotulo}.png`)], {encoding: 'utf-8'});
      if (r.status !== 0) log(`  quadro ${rotulo} não saiu: ${r.error?.message ?? r.stderr}`);
    }
  }
  log(`pronto; quadros em ${path.relative(raiz, quadros)}`);
  process.exit(0);
} catch (e) {
  log(`falhou: ${e.message}`);
  process.exit(1);
}
