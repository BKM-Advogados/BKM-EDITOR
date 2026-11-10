// Exportação do carrossel: um PNG por página em saidas/<nome>/01.png, 02.png… e o PDF saidas/<nome>.pdf com uma
// página por imagem, sem margem. A imagem de rede sai com 1 px = 1 pt (o carrossel nativo do LinkedIn); a de impressão
// (A4 a 300 dpi) sai no tamanho do papel (imagem-D12). A interface desenha cada página (exportarPaginas.ts, com o mesmo
// canvas do PNG simples) e manda uma por vez, em partes (abrir, parte, fechar: imagem-D19): cada PNG vai para o disco
// assim que chega e o PDF é montado lendo de lá, sem guardar o carrossel inteiro em memória dos dois lados. Uma página
// sozinha, sem PDF, sai como "<nome> - 03.png" ao lado dos outros arquivos de saidas/. Sem Electron neste arquivo: o
// registro do IPC recebe o `lidar` e o `mostrar` do main.ts, e os testes chamam as funções direto.
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import {CANAL, type PedidoExportarPaginas, type ResultadoExportarPaginas} from '../compartilhado/api';
import {pontosPorPixel} from '../nucleo/carrossel';
import type {DocImagem} from '../nucleo/documentos';
import {nomeDePasta, pastaLivre} from '../nucleo/criar-projeto';
import type {Projeto} from '../nucleo/projeto';

export type PaginaPronta = {png: Buffer; numero: number};

const DOIS = (n: number) => String(n).padStart(2, '0');

const dataUrlParaBuffer = (png: string) => Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64');

/** PDF com uma página por PNG, sem margem, cada uma do tamanho da imagem vezes `ptPorPx` (1 nas imagens de rede;
 *  72/300 no A4 a 300 dpi, para a página sair com 21 × 29,7 cm). Os PNG podem vir como bytes ou como arquivos (lidos um
 *  de cada vez). */
export const pdfDasPaginas = async (pngs: (Buffer | string)[], ptPorPx = 1) => {
  const pdf = await PDFDocument.create();
  pdf.setProducer('Estúdio');
  pdf.setCreator('Estúdio');
  for (const png of pngs) {
    const imagem = await pdf.embedPng(typeof png === 'string' ? readFileSync(png) : png);
    const w = imagem.width * ptPorPx;
    const h = imagem.height * ptPorPx;
    const pagina = pdf.addPage([w, h]);
    pagina.drawImage(imagem, {x: 0, y: 0, width: w, height: h});
  }
  return Buffer.from(await pdf.save({useObjectStreams: false}));
};

/** Arquivo que ainda não existe em `pasta`: "Nome.png", "Nome (2).png"… (o mesmo critério do main.ts). */
const arquivoLivre = (pasta: string, nome: string, ext: string) => {
  const base = nomeDePasta(nome) || 'saida';
  let p = path.join(pasta, `${base}.${ext}`);
  for (let n = 2; existsSync(p); n++) p = path.join(pasta, `${base} (${n}).${ext}`);
  return p;
};

/** Grava as páginas em `saidas`. Várias páginas (ou com PDF): pasta própria "<nome>/" e "<nome>.pdf" com o mesmo
 *  sufixo da pasta; uma página sem PDF: "<nome> - 03.png" direto em `saidas`. Nada é sobrescrito. */
export const gravarPaginas = async (o: {saidas: string; nome: string; paginas: PaginaPronta[]; pdf: boolean; ptPorPx?: number}): Promise<ResultadoExportarPaginas> => {
  if (!o.paginas.length) return {ok: false, mensagem: 'nenhuma página para exportar'};
  mkdirSync(o.saidas, {recursive: true});
  if (o.paginas.length === 1 && !o.pdf) {
    const arquivo = arquivoLivre(o.saidas, `${o.nome} - ${DOIS(o.paginas[0].numero)}`, 'png');
    writeFileSync(arquivo, o.paginas[0].png);
    return {ok: true, arquivos: [arquivo], mostrar: arquivo};
  }
  // "<nome>" e "<nome>.pdf" têm de estar livres juntos: a pasta decide o sufixo e o PDF vai com o mesmo nome
  const pasta = pastaLivre(o.saidas, o.nome, (p) => existsSync(p) || existsSync(`${p}.pdf`));
  mkdirSync(pasta, {recursive: true});
  const arquivos: string[] = [];
  for (const pg of o.paginas) {
    const arquivo = path.join(pasta, `${DOIS(pg.numero)}.png`);
    writeFileSync(arquivo, pg.png);
    arquivos.push(arquivo);
  }
  let pdf: string | undefined;
  if (o.pdf) {
    pdf = `${pasta}.pdf`;
    writeFileSync(pdf, await pdfDasPaginas(o.paginas.map((p) => p.png), o.ptPorPx));
  }
  return {ok: true, pasta, pdf, arquivos, mostrar: pdf ?? arquivos[0]};
};

// ---------- em partes (imagem-D19) ----------
type Sessao = {pasta: string; pdf: boolean; ptPorPx: number; arquivos: string[]};
const sessoes = new Map<string, Sessao>();

/** Abre uma exportação em partes: a pasta "<nome>/" (com "<nome>.pdf" livre junto) já fica reservada. */
export const abrirExportacao = (o: {saidas: string; nome: string; pdf: boolean; ptPorPx?: number}) => {
  mkdirSync(o.saidas, {recursive: true});
  const pasta = pastaLivre(o.saidas, o.nome, (p) => existsSync(p) || existsSync(`${p}.pdf`));
  mkdirSync(pasta, {recursive: true});
  const sessao = randomUUID();
  sessoes.set(sessao, {pasta, pdf: o.pdf, ptPorPx: o.ptPorPx ?? 1, arquivos: []});
  return {sessao, pasta};
};

/** Uma página: vai direto para o disco ("03.png"). */
export const gravarParte = (sessao: string, pagina: PaginaPronta) => {
  const s = sessoes.get(sessao);
  if (!s) throw new Error('exportação não achada (já fechada?)');
  const arquivo = path.join(s.pasta, `${DOIS(pagina.numero)}.png`);
  writeFileSync(arquivo, pagina.png);
  s.arquivos.push(arquivo);
  return true;
};

/** Fecha: o PDF é montado lendo os PNG do disco, na ordem dos números. */
export const fecharExportacao = async (sessao: string): Promise<ResultadoExportarPaginas> => {
  const s = sessoes.get(sessao);
  sessoes.delete(sessao);
  if (!s) return {ok: false, mensagem: 'exportação não achada (já fechada?)'};
  if (!s.arquivos.length) return {ok: false, mensagem: 'nenhuma página para exportar'};
  const arquivos = [...s.arquivos].sort();
  let pdf: string | undefined;
  if (s.pdf) {
    pdf = `${s.pasta}.pdf`;
    writeFileSync(pdf, await pdfDasPaginas(arquivos, s.ptPorPx));
  }
  return {ok: true, pasta: s.pasta, pdf, arquivos, mostrar: pdf ?? arquivos[0]};
};

/** Pontos de PDF por pixel do documento (imagem-D12): A4 a 300 dpi sai no tamanho do papel. */
const ptPorPxDe = (p: Projeto, documento: string) => {
  try {
    const {doc} = p.lerJson<DocImagem>(p.arquivoDoDocumento(documento));
    return pontosPorPixel(doc.largura, doc.altura);
  } catch {
    return 1;
  }
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

/** Registra o IPC (uma linha no main.ts; os canais das partes vêm junto). `mostrar` abre a pasta com o arquivo marcado
 *  (shell.showItemInFolder). */
export const registrarExportarPaginas = (lidar: Lidar, canal: string, deps: {projeto: () => Projeto; mostrar: (arquivo: string) => void}) => {
  lidar(CANAL.exportarPaginasAbrir, (o: {documento: string; pdf: boolean}) => {
    const p = deps.projeto();
    const nome = p.manifesto().documentos.find((d) => d.id === o.documento)?.titulo ?? o.documento;
    return {sessao: abrirExportacao({saidas: p.caminho('saidas'), nome, pdf: o.pdf, ptPorPx: ptPorPxDe(p, o.documento)}).sessao};
  });
  lidar(CANAL.exportarPaginasParte, (sessao: string, pagina: {png: string; numero: number}) => gravarParte(sessao, {numero: pagina.numero, png: dataUrlParaBuffer(pagina.png)}));
  lidar(CANAL.exportarPaginasFechar, async (sessao: string) => {
    try {
      const r = await fecharExportacao(sessao);
      if (r.ok && r.mostrar) deps.mostrar(r.mostrar);
      return r;
    } catch (e) {
      return {ok: false, mensagem: (e as Error).message} satisfies ResultadoExportarPaginas;
    }
  });
  lidar(canal, async (o: PedidoExportarPaginas) => {
    const p = deps.projeto();
    const nome = p.manifesto().documentos.find((d) => d.id === o.documento)?.titulo ?? o.documento;
    try {
      const r = await gravarPaginas({saidas: p.caminho('saidas'), nome, pdf: o.pdf, ptPorPx: ptPorPxDe(p, o.documento),
        paginas: o.paginas.map((x) => ({numero: x.numero, png: dataUrlParaBuffer(x.png)}))});
      if (r.ok && r.mostrar) deps.mostrar(r.mostrar);
      return r;
    } catch (e) {
      return {ok: false, mensagem: (e as Error).message} satisfies ResultadoExportarPaginas;
    }
  });
};
