// Prévia × PNG exportado, fora do Electron (que não roda neste PC): sobe o Vite da prévia web, abre a página no
// Chromium de render do Remotion (o mesmo do exportar-teste), monta um carrossel de teste com sombra, contorno,
// degradê, fundo em degradê, foto recortada no círculo e, com --foto e o modelo em testes/saida/modelos/modnet/, a foto
// da pessoa sem fundo pelo mesmo caminho do botão (worker + ONNX). Rodada 3: texto com hífen no fim da linha (imagem-D6,
// em DOM na prévia) e texto que cabe na caixa (`caber`). Fotografa o monitor em 50% e compara pixel a pixel
// com o desenharDocumento do PNG na mesma escala, página por página; grava em testes/saida/acabamento/ a prévia, o PNG,
// a diferença ampliada, o carrossel em PNG (resolução cheia) e o PDF (pdfDasPaginas, o mesmo do app).
// Uso: npx tsx scripts/comparar-imagem.mjs [--foto caminho/da/foto.jpg] [--chrome caminho/do/chrome-headless-shell.exe]
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {pdfDasPaginas} from '../src/main/exportar-paginas';
import {MODELO_FUNDO} from '../src/nucleo/remover-fundo';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'testes', 'saida', 'acabamento');
mkdirSync(saida, {recursive: true});
const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// o navegador de render do Remotion, nesta pasta ou na do repositório principal (as worktrees ficam dentro dele)
const chrome = arg('--chrome') ?? [raiz, path.resolve(raiz, '..', '..', '..')]
  .map((r) => path.join(r, 'node_modules', '.remotion', 'chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))
  .find(existsSync);
if (!chrome) throw new Error('não achei o chrome-headless-shell do Remotion: rode o exportar-teste uma vez ou passe --chrome');

const temModelo = existsSync(path.join(raiz, 'testes', 'saida', 'modelos', MODELO_FUNDO.id, MODELO_FUNDO.arquivo));
const fotoPessoa = arg('--foto');
if (fotoPessoa) copyFileSync(fotoPessoa, path.join(saida, `pessoa${path.extname(fotoPessoa).toLowerCase()}`));
const SRC_PESSOA = fotoPessoa ? `testes/saida/acabamento/pessoa${path.extname(fotoPessoa).toLowerCase()}` : null;

const FOTO = 'exemplos/exemplo/midia/Cidade Exemplo.jpg';
const LOGO = 'exemplos/exemplo/midia/logo-exemplo.png';
const DEGRADE_FUNDO = {tipo: 'linear', angulo: 180, paradas: [{cor: '#171A19', posicao: 0}, {cor: '#44352B', posicao: 1}]};
const capa = [
  {id: 'faixa', nome: 'Faixa', tipo: 'forma', forma: 'retangulo', x: 80, y: 900, largura: 920, altura: 330, raio: 32,
    degrade: {tipo: 'radial', centro: {x: 0.3, y: 0.2}, paradas: [{cor: '#2E3331', posicao: 0}, {cor: '#171A19', posicao: 1, opacidade: 0.6}]},
    contorno: {cor: '#C88155', espessura: 6, posicao: 'dentro'}},
  {id: 'foto', nome: 'Foto', tipo: 'imagem', src: FOTO, ajuste: 'cobrir', x: 200, y: 120, largura: 680, altura: 680, mascara: 'circulo'},
  {id: 'circulo', nome: 'Círculo', tipo: 'forma', forma: 'elipse', x: 290, y: 170, largura: 500, altura: 500,
    contorno: {cor: '#F4F0EA', espessura: 10}, sombra: {cor: '#000000', opacidade: 0.5, desfoque: 30, y: 14}},
  {id: 'titulo', nome: 'Título', tipo: 'texto', texto: 'Transferência\nde cidade', fonte: 'Archivo', peso: 800, tamanho: 104, alinhar: 'centro', x: 80, y: 700, largura: 920, altura: 250,
    degrade: {tipo: 'linear', angulo: 135, paradas: [{cor: '#C88155', posicao: 0}, {cor: '#E4B492', posicao: 1}]}, sombra: {opacidade: 0.55, desfoque: 18, y: 6}},
  {id: 'subtitulo', nome: 'Subtítulo', tipo: 'texto', texto: 'O que muda no seu contrato', fonte: 'IBM Plex Sans', peso: 600, tamanho: 52, cor: '#F4F0EA', alinhar: 'centro',
    x: 80, y: 1010, largura: 920, altura: 70, contorno: {cor: '#795033', espessura: 3}},
  {id: 'logo', nome: 'Logo', tipo: 'imagem', src: LOGO, ajuste: 'conter', x: 420, y: 1120, largura: 240, altura: 90, contorno: {cor: '#C88155', espessura: 3}, sombra: {opacidade: 0.4, desfoque: 10, y: 4}},
];
const advogado = [
  {id: 'circulo-fundo', nome: 'Luz', tipo: 'forma', forma: 'elipse', x: 140, y: 160, largura: 800, altura: 800,
    degrade: {tipo: 'radial', paradas: [{cor: '#C88155', posicao: 0, opacidade: 0.55}, {cor: '#C88155', posicao: 1, opacidade: 0}]}},
  SRC_PESSOA
    ? {id: 'pessoa', nome: 'Advogado', tipo: 'imagem', src: SRC_PESSOA, ajuste: 'conter', x: 140, y: 160, largura: 800, altura: 900,
      contorno: {cor: '#F4F0EA', espessura: 8}, sombra: {opacidade: 0.5, desfoque: 24, x: 0, y: 12}}
    : {id: 'pessoa', nome: 'Silhueta', tipo: 'forma', forma: 'elipse', x: 340, y: 260, largura: 400, altura: 520, preenchimento: '#2E3331',
      contorno: {cor: '#F4F0EA', espessura: 8}, sombra: {opacidade: 0.5, desfoque: 24, y: 12}},
  {id: 'nome', nome: 'Nome', tipo: 'texto', texto: 'Dra. Ana Exemplo', fonte: 'Archivo', peso: 700, tamanho: 84, alinhar: 'centro', x: 60, y: 1080, largura: 960, altura: 100,
    cor: '#F4F0EA', contorno: {cor: '#171A19', espessura: 4, posicao: 'centro'}, sombra: {opacidade: 0.6, desfoque: 12, x: 4, y: 4}},
  // rodada 3: hífen no fim da linha em texto sem acabamento (DOM na prévia, imagem-D6) e texto que cabe na caixa
  {id: 'hifen', nome: 'Hífen', tipo: 'texto', texto: 'Rescisão com pré-aviso indenizado', fonte: 'IBM Plex Sans', peso: 600, tamanho: 44, cor: '#F4F0EA', x: 60, y: 40, largura: 420, altura: 110},
  {id: 'cabe', nome: 'Cabe', tipo: 'texto', texto: 'Prazo de 10 dias', fonte: 'Archivo', peso: 800, tamanho: 30, cor: '#E4B492', caber: true, x: 560, y: 30, largura: 460, altura: 150},
  {id: 'cargo', nome: 'Cargo', tipo: 'texto', texto: 'Direito do trabalho', fonte: 'IBM Plex Mono', peso: 400, tamanho: 40, alinhar: 'centro', x: 60, y: 1190, largura: 960, altura: 60,
    degrade: {tipo: 'linear', angulo: 90, paradas: [{cor: '#E4B492', posicao: 0}, {cor: '#C88155', posicao: 0.5}, {cor: '#E4B492', posicao: 1}]}},
];
const DOC = {formato: 1, largura: 1080, altura: 1350, fundo: '#171A19', fundo_degrade: DEGRADE_FUNDO, camadas: [],
  paginas: [{id: 'pagina-1', nome: 'Capa', camadas: capa}, {id: 'pagina-2', nome: 'Advogado', camadas: advogado}]};

/** Memória (MB) somada dos processos do Chromium de teste, pelo tasklist do Windows. */
const memoriaDoNavegador = () => {
  try {
    const csv = execFileSync('tasklist', ['/fi', 'imagename eq chrome-headless-shell.exe', '/fo', 'csv', '/nh'], {encoding: 'utf-8'});
    return Math.round(csv.split('\n').map((l) => Number((l.split('","')[4] ?? '').replace(/[^\d]/g, '')) || 0).reduce((a, b) => a + b, 0) / 1024);
  } catch {
    return null;
  }
};

const servidor = await createServer({configFile: path.join(raiz, 'vite.renderer.config.ts'), root: raiz, server: {port: 0, strictPort: false}, logLevel: 'error'});
await servidor.listen();
const base = servidor.resolvedUrls.local[0].replace(/\/$/, '');
const navegador = await chromium.launch({executablePath: chrome});
const pagina = await navegador.newPage({viewport: {width: 1700, height: 1100}, deviceScaleFactor: 1});
const erros = [];
pagina.on('pageerror', (e) => erros.push(e.message));
pagina.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
const sair = async (codigo) => {
  await navegador.close().catch(() => undefined);
  await servidor.close();
  process.exit(codigo);
};

try {
  await pagina.goto(`${base}/scripts/previa-web/index.html?vista`);
  await pagina.getByRole('tab', {name: 'Imagem'}).click();
  await pagina.getByRole('button', {name: /^Post retrato/}).dblclick();
  await pagina.locator('.palco').waitFor();

  // o documento de teste entra pela ponte e a loja relê (como faz depois de um patch do Claude)
  const id = await pagina.evaluate(async (doc) => {
    const loja = await import('/src/renderer/estado/loja.ts');
    const info = await window.estudio.projetoAtual();
    const id = info.manifesto.documentos.find((d) => d.modulo === 'imagem').id;
    const lido = await window.estudio.lerDocumento(id);
    await window.estudio.aplicarPatch({documento: id, versao_base: lido.versao, patch: [{op: 'replace', path: '', value: doc}]});
    await loja.carregarDoc(id);
    loja.selecionar(null);
    return id;
  }, DOC);

  let fundo = null;
  if (SRC_PESSOA && temModelo) {
    const antes = memoriaDoNavegador();
    fundo = await pagina.evaluate(async ({id, src}) => {
      const loja = await import('/src/renderer/estado/loja.ts');
      const rf = await import('/src/renderer/modulos/imagem/removerFundo.ts');
      await window.estudio.removerFundo.baixar();
      const t0 = performance.now();
      const r = await rf.calcularSemFundo(src);
      const total = Math.round(performance.now() - t0);
      const caminho = await window.estudio.removerFundo.gravar(src, r.png);
      const img = new Image();
      img.src = r.png;
      await img.decode();
      const doc = loja.loja.get().docs[id].doc;
      const i = doc.paginas[1].camadas.findIndex((c) => c.id === 'pessoa');
      await loja.aplicar(id, [{op: 'replace', path: `/paginas/1/camadas/${i}/src`, value: caminho}, {op: 'add', path: `/paginas/1/camadas/${i}/src_original`, value: src}], 'teste: sem fundo');
      return {ms_modelo: r.ms, ms_total: total, entrada: r.entrada, foto: `${img.naturalWidth}×${img.naturalHeight}`, caminho};
    }, {id, src: SRC_PESSOA});
    fundo.memoria_mb = {antes, depois: memoriaDoNavegador()};
    // segunda vez: o modelo já está carregado no worker (o tempo que a pessoa vê do segundo clique em diante)
    fundo.ms_segunda = await pagina.evaluate(async (src) => (await (await import('/src/renderer/modulos/imagem/removerFundo.ts')).calcularSemFundo(src)).ms, SRC_PESSOA);
  }

  // monitor em 50%, sem seleção nem cursor por cima
  await pagina.locator('.zoom-bt').click();
  await pagina.getByText('50%', {exact: true}).click();
  await pagina.mouse.move(0, 0);

  const resultados = [];
  const pngs = [];
  for (let p = 0; p < DOC.paginas.length; p++) {
    await pagina.evaluate(async ({id, p}) => {
      const loja = await import('/src/renderer/estado/loja.ts');
      loja.loja.definir((e) => ({paginaAtiva: {...e.paginaAtiva, [id]: e.docs[id].doc.paginas[p].id}, selecao: null}));
    }, {id, p});
    await pagina.waitForTimeout(2500);
    await pagina.evaluate(() => document.fonts.ready);
    const caixa = await pagina.evaluate(() => {
      const r = document.querySelector('.palco').getBoundingClientRect();
      return {x: r.x, y: r.y, width: r.width, height: r.height};
    });
    const previa = await pagina.screenshot({clip: caixa});
    const r = await pagina.evaluate(async ({id, p, previa}) => {
      const loja = await import('/src/renderer/estado/loja.ts');
      const {desenharDocumento} = await import('/src/renderer/modulos/imagem/exportarPng.ts');
      const {vistaDaPagina} = await import('/src/nucleo/carrossel.ts');
      const doc = loja.loja.get().docs[id].doc;
      const meio = await desenharDocumento(vistaDaPagina(doc, p), 0.5);
      const cheio = await desenharDocumento(vistaDaPagina(doc, p), 1);
      const png = cheio.canvas.toDataURL('image/png');
      const img = new Image();
      img.src = `data:image/png;base64,${previa}`;
      await img.decode();
      const W = meio.canvas.width;
      const H = meio.canvas.height;
      const tela = document.createElement('canvas');
      tela.width = W;
      tela.height = H;
      const t = tela.getContext('2d');
      t.drawImage(img, 0, 0);
      const a = t.getImageData(0, 0, W, H).data;
      const b = meio.canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const dif = t.createImageData(W, H);
      let soma = 0;
      let acima16 = 0;
      let acima48 = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        soma += d;
        if (d > 16) acima16++;
        if (d > 48) acima48++;
        dif.data[i] = dif.data[i + 1] = dif.data[i + 2] = Math.min(255, d * 4);
        dif.data[i + 3] = 255;
      }
      t.putImageData(dif, 0, 0);
      const n = a.length / 4;
      return {tamanho_previa: `${img.naturalWidth}×${img.naturalHeight}`, tamanho_png: `${W}×${H}`, media: +(soma / n).toFixed(2),
        pct_acima_16: +((acima16 / n) * 100).toFixed(2), pct_acima_48: +((acima48 / n) * 100).toFixed(2),
        diferenca: tela.toDataURL('image/png'), meio: meio.canvas.toDataURL('image/png'), png, faltaram: [...meio.faltaram, ...cheio.faltaram]};
    }, {id, p, previa: previa.toString('base64')});
    const nome = DOC.paginas[p].nome.toLowerCase();
    writeFileSync(path.join(saida, `previa-${nome}.png`), previa);
    writeFileSync(path.join(saida, `png-50-${nome}.png`), Buffer.from(r.meio.split(',')[1], 'base64'));
    writeFileSync(path.join(saida, `diferenca-${nome}.png`), Buffer.from(r.diferenca.split(',')[1], 'base64'));
    const cheio = Buffer.from(r.png.split(',')[1], 'base64');
    writeFileSync(path.join(saida, `${String(p + 1).padStart(2, '0')}.png`), cheio);
    pngs.push(cheio);
    const {diferenca: _d, meio: _m, png: _p, ...stats} = r;
    resultados.push({pagina: DOC.paginas[p].nome, ...stats});
  }
  writeFileSync(path.join(saida, 'carrossel.pdf'), await pdfDasPaginas(pngs));

  console.log(JSON.stringify({resultados, remover_fundo: fundo ?? (SRC_PESSOA ? 'sem o modelo em testes/saida/modelos/' : 'sem --foto'), erros: erros.slice(0, 10)}, null, 2));
  console.log(`arquivos em ${path.relative(raiz, saida)}`);
  // prévia e PNG batem: diferença média baixa e quase nenhum pixel muito diferente (borda de letra e de foto reduzida)
  const ok = resultados.every((r) => r.tamanho_previa === r.tamanho_png && r.media < 3 && r.pct_acima_48 < 1 && !r.faltaram.length);
  console.log(ok ? '✔ prévia e PNG batem' : '✘ prévia e PNG diferem além do esperado');
  await sair(ok ? 0 : 1);
} catch (e) {
  console.error(`falhou: ${e.message}`);
  if (erros.length) console.error(erros.slice(0, 10).join('\n'));
  await sair(1);
}
