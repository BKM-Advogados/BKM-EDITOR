// Exportação do carrossel: um PNG por página em saidas/<nome>/01.png, 02.png… e o PDF saidas/<nome>.pdf com uma
// página por imagem, do tamanho da imagem (1 px = 1 pt), sem margem: é o carrossel nativo do LinkedIn. A interface
// desenha cada página (exportarPaginas.ts, com o mesmo canvas do PNG simples) e manda os PNG prontos; aqui só se grava.
// Uma página sozinha, sem PDF, sai como "<nome> - 03.png" ao lado dos outros arquivos de saidas/. Sem Electron neste
// arquivo: o registro do IPC recebe o `lidar` e o `mostrar` do main.ts, e os testes chamam `gravarPaginas` direto.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
import type {PedidoExportarPaginas, ResultadoExportarPaginas} from '../compartilhado/api';
import {nomeDePasta, pastaLivre} from '../nucleo/criar-projeto';
import type {Projeto} from '../nucleo/projeto';

export type PaginaPronta = {png: Buffer; numero: number};

const DOIS = (n: number) => String(n).padStart(2, '0');

const dataUrlParaBuffer = (png: string) => Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64');

/** PDF com uma página por PNG, cada uma do tamanho exato da imagem, sem margem. */
export const pdfDasPaginas = async (pngs: Buffer[]) => {
  const pdf = await PDFDocument.create();
  pdf.setProducer('Estúdio');
  pdf.setCreator('Estúdio');
  for (const png of pngs) {
    const imagem = await pdf.embedPng(png);
    const pagina = pdf.addPage([imagem.width, imagem.height]);
    pagina.drawImage(imagem, {x: 0, y: 0, width: imagem.width, height: imagem.height});
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
export const gravarPaginas = async (o: {saidas: string; nome: string; paginas: PaginaPronta[]; pdf: boolean}): Promise<ResultadoExportarPaginas> => {
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
    writeFileSync(pdf, await pdfDasPaginas(o.paginas.map((p) => p.png)));
  }
  return {ok: true, pasta, pdf, arquivos, mostrar: pdf ?? arquivos[0]};
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

/** Registra o IPC (uma linha no main.ts). `mostrar` abre a pasta com o arquivo marcado (shell.showItemInFolder). */
export const registrarExportarPaginas = (lidar: Lidar, canal: string, deps: {projeto: () => Projeto; mostrar: (arquivo: string) => void}) =>
  lidar(canal, async (o: PedidoExportarPaginas) => {
    const p = deps.projeto();
    const nome = p.manifesto().documentos.find((d) => d.id === o.documento)?.titulo ?? o.documento;
    try {
      const r = await gravarPaginas({saidas: p.caminho('saidas'), nome, pdf: o.pdf, paginas: o.paginas.map((x) => ({numero: x.numero, png: dataUrlParaBuffer(x.png)}))});
      if (r.ok && r.mostrar) deps.mostrar(r.mostrar);
      return r;
    } catch (e) {
      return {ok: false, mensagem: (e as Error).message} satisfies ResultadoExportarPaginas;
    }
  });
