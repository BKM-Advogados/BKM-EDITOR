// Prévias que só a janela do app sabe desenhar (frente 3 do MCP): ver_imagem (a imagem e cada página do carrossel, com
// fundo, camadas, acabamento e a pilha de efeitos, pelo mesmo canvas da exportação, exportarPng.ts) e ver_cena_3d (um
// instantâneo da cena 3D pelo Three.js, carregado sob demanda). O documento é lido do disco aqui e vai à janela pela
// ponte (src/main/ponte-janela.ts → src/renderer/previas-janela.ts): ela desenha o que está gravado, não o que tiver na
// tela. O PNG fica em saidas/previas/ com as outras prévias (mcp-previa.ts: nome, limpeza da pasta, markdown) e uma
// miniatura em JPEG volta na resposta para o agente ver. Sem a janela (MCP por stdio com o app fechado), o serviço não
// está ligado e a resposta pede para abrir o projeto no Estúdio. Classe "livre", como as outras prévias: não mexem nos
// documentos nem no diário, nada sai do PC, e o que gravam é descartável.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {paginasDe, temPaginas} from './carrossel';
import type {DocCena3D, DocImagem, Vetor3} from './documentos';
import {escalaPara, limparPrevias, markdownDaPrevia, nomeDaPrevia, PASTA_PREVIAS} from './mcp-previa';
import {ErroProjeto, type Projeto} from './projeto';

const LADO_IMAGEM = 1600; // o lado maior da prévia da imagem, sem escala pedida (texto pequeno ainda se lê)
export const LADO_MINIATURA = 1024; // a imagem que vai dentro da resposta (o agente vê)
const IMAGEM_MCP_MAX_BYTES = 1_500_000;
export const CENA_3D_PADRAO = {largura: 1280, altura: 720};
export const CAMERA_3D_PADRAO: CameraCena = {posicao: [4, 3, 6], alvo: [0, 0.5, 0], fov: 40}; // a do monitor 3D (motor.ts)

export type CameraCena = {posicao: Vetor3; alvo: Vetor3; fov: number};
/** O que a janela devolve: o PNG em tamanho cheio e um JPEG pequeno (lado maior até `lado_miniatura`). */
export type QuadroDaJanela = {png: Uint8Array; miniatura?: Uint8Array | null; largura: number; altura: number; faltaram?: string[]};
export type ServicoPreviaJanela = {
  /** A imagem (ou a página `pagina`, 0 é a primeira, do carrossel) desenhada pela janela na escala dada. */
  imagem: (projeto: Projeto, p: {documento: string; doc: DocImagem; pagina?: number; escala: number; lado_miniatura: number}) => Promise<QuadroDaJanela>;
  /** A cena 3D vista pela câmera dada, em largura × altura px. */
  cena3d: (projeto: Projeto, p: {documento: string; doc: DocCena3D; camera: CameraCena; largura: number; altura: number; lado_miniatura: number}) => Promise<QuadroDaJanela>;
};

export const SEM_JANELA = 'esta prévia é desenhada pela janela do Estúdio: abra o projeto no Estúdio e chame de novo';

let servico: ServicoPreviaJanela | null = null;
export const definirServicoPreviaJanela = (s: ServicoPreviaJanela | null) => {
  servico = s;
};
const exigirServico = () => {
  if (!servico) throw new Error(SEM_JANELA);
  return servico;
};

// ---------- contas puras (testes/previas-janela.test.ts) ----------
/** O documento pedido, ou o que a pessoa está vendo, ou o primeiro do módulo; recusa outro módulo. */
export const documentoDoModulo = (projeto: Projeto, modulo: 'imagem' | '3d', documento?: string) => {
  const m = projeto.manifesto();
  const nome = modulo === 'imagem' ? 'imagem' : 'cena 3D';
  if (documento) {
    const d = m.documentos.find((x) => x.id === documento);
    if (!d) throw new ErroProjeto(`documento não achado: ${documento}`, 'nao_achado');
    if (d.modulo !== modulo) throw new ErroProjeto(`${documento} é ${d.modulo}, não ${nome}${d.modulo === 'video' || d.modulo === 'animacao' ? ': use ver_quadro' : ''}`, 'patch');
    return documento;
  }
  const visto = projeto.estado()?.documento;
  const d = m.documentos.find((x) => x.id === visto && x.modulo === modulo) ?? m.documentos.find((x) => x.modulo === modulo);
  if (!d) throw new ErroProjeto(`este projeto não tem ${nome}`, 'nao_achado');
  return d.id;
};

/** A página pedida (1 é a primeira) em índice; sem pedido, a primeira. Imagem sem páginas só aceita a 1. */
export const indiceDaPagina = (doc: DocImagem, pagina?: number) => {
  const n = temPaginas(doc) ? paginasDe(doc).length : 1;
  const p = pagina ?? 1;
  if (!Number.isInteger(p) || p < 1 || p > n) throw new ErroProjeto(`página ${p} não existe: ${n === 1 ? 'a imagem tem uma página só' : `o carrossel tem ${n} páginas, de 1 a ${n}`}`, 'nao_achado');
  return {indice: p - 1, total: n};
};

const vetor = (v: unknown): v is Vetor3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
/** A câmera pedida por cima da do documento (e esta por cima da padrão do monitor), campo a campo. */
export type CameraPedida = {posicao?: number[]; alvo?: number[]; fov?: number};
export const cameraDaCena = (doc: DocCena3D, pedida?: CameraPedida): CameraCena => {
  const docCam = (doc?.camera ?? {}) as Partial<CameraCena>;
  const fov = (x: unknown) => (typeof x === 'number' && x > 1 && x < 179 ? x : undefined);
  return {
    posicao: vetor(pedida?.posicao) ? pedida.posicao : vetor(docCam.posicao) ? docCam.posicao : CAMERA_3D_PADRAO.posicao,
    alvo: vetor(pedida?.alvo) ? pedida.alvo : vetor(docCam.alvo) ? docCam.alvo : CAMERA_3D_PADRAO.alvo,
    fov: fov(pedida?.fov) ?? fov(docCam.fov) ?? CAMERA_3D_PADRAO.fov,
  };
};

// ---------- resposta ----------
type Conteudo = {type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string};
const resposta = (dados: Record<string, unknown>, imagem?: Uint8Array | null) => {
  const content: Conteudo[] = [{type: 'text', text: JSON.stringify(dados, null, 2)}];
  if (imagem?.byteLength && imagem.byteLength <= IMAGEM_MCP_MAX_BYTES) content.push({type: 'image', data: Buffer.from(imagem).toString('base64'), mimeType: 'image/jpeg'});
  return {content};
};
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const COMO_MOSTRAR = 'Para a pessoa ver no chat da IDE (T3 Code, Claude Code), ponha o campo markdown na resposta.';

/** Grava o PNG da janela em saidas/previas/ e limpa as velhas; devolve o caminho absoluto. */
const gravarPrevia = (projeto: Projeto, tipo: string, documento: string, detalhe: string, png: Uint8Array) => {
  const pasta = projeto.caminho(PASTA_PREVIAS);
  mkdirSync(pasta, {recursive: true});
  const arquivo = path.join(pasta, nomeDaPrevia(tipo, documento, detalhe, 'png'));
  writeFileSync(arquivo, png);
  limparPrevias(pasta);
  return arquivo;
};

const vetorZ = z.array(z.number()).length(3);

export const registrarPreviaJanela = (servidor: McpServer, projeto: Projeto) => {
  servidor.registerTool('ver_imagem', {
    description: 'Desenha a imagem (ou uma página do carrossel) como ela sai na exportação, com fundo, camadas, sombra, contorno, degradê, máscara e a pilha de efeitos, e grava um PNG em saidas/previas/. '
      + 'Devolve o caminho absoluto, um markdown pronto para mostrar à pessoa e a imagem para você ver. Não muda nada no projeto. '
      + 'Só com o projeto aberto no app do Estúdio: quem desenha é a janela dele.',
    inputSchema: {
      documento: z.string().optional().describe('id do documento de imagem; sem ele, o que a pessoa está vendo ou a primeira imagem'),
      pagina: z.number().int().min(1).optional().describe('no carrossel, a página (1 é a primeira); padrão 1'),
      escala: z.number().min(0.1).max(1).optional().describe(`1 = tamanho do documento; sem ela, o lado maior fica em ${LADO_IMAGEM} px`),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; pagina?: number; escala?: number}) => {
    try {
      const s = exigirServico();
      const documento = documentoDoModulo(projeto, 'imagem', a.documento);
      const doc = projeto.lerJson<DocImagem>(projeto.arquivoDoDocumento(documento)).doc;
      const {indice, total} = indiceDaPagina(doc, a.pagina);
      const escala = a.escala ?? escalaPara(doc.largura, doc.altura, LADO_IMAGEM);
      const q = await s.imagem(projeto, {documento, doc, ...(temPaginas(doc) ? {pagina: indice} : {}), escala, lado_miniatura: LADO_MINIATURA});
      const detalhe = total > 1 ? `p${indice + 1}` : '';
      const arquivo = gravarPrevia(projeto, 'imagem', documento, detalhe, q.png);
      const nomePagina = temPaginas(doc) ? paginasDe(doc)[indice]?.nome : undefined;
      const alt = `${documento}${total > 1 ? `, página ${indice + 1} de ${total}${nomePagina ? ` (${nomePagina})` : ''}` : ''}`;
      return resposta({arquivo, markdown: markdownDaPrevia(alt, arquivo), documento, ...(total > 1 ? {pagina: indice + 1, paginas: total} : {}),
        largura: q.largura, altura: q.altura, ...(q.faltaram?.length ? {sem_imagem: q.faltaram, aviso: 'estas camadas não carregaram a imagem e saíram sem ela'} : {}),
        como_mostrar: COMO_MOSTRAR}, q.miniatura);
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('ver_cena_3d', {
    description: 'Tira um instantâneo da cena 3D (as primitivas, as luzes e o fundo, como no monitor 3D, sem o gizmo) e grava um PNG em saidas/previas/. '
      + 'Sem camera, usa a câmera do documento; camera {posicao, alvo, fov} vê de outro ponto sem mudar o documento (para gravar, aplicar_patch em /camera). '
      + 'Devolve o caminho absoluto, um markdown pronto para mostrar à pessoa e a imagem para você ver. Só com o projeto aberto no app do Estúdio: quem desenha é a janela dele.',
    inputSchema: {
      documento: z.string().optional().describe('id da cena 3D; sem ele, a que a pessoa está vendo ou a primeira'),
      camera: z.object({
        posicao: vetorZ.optional().describe('[x, y, z] de onde a câmera olha'),
        alvo: vetorZ.optional().describe('[x, y, z] para onde ela olha'),
        fov: z.number().min(5).max(120).optional().describe('abertura vertical em graus'),
      }).optional().describe('outro ponto de vista; o que faltar vem da câmera do documento'),
      largura: z.number().int().min(64).max(1920).optional().describe(`px; padrão ${CENA_3D_PADRAO.largura}`),
      altura: z.number().int().min(64).max(1920).optional().describe(`px; padrão ${CENA_3D_PADRAO.altura}`),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; camera?: CameraPedida; largura?: number; altura?: number}) => {
    try {
      const s = exigirServico();
      const documento = documentoDoModulo(projeto, '3d', a.documento);
      const doc = projeto.lerJson<DocCena3D>(projeto.arquivoDoDocumento(documento)).doc;
      const camera = cameraDaCena(doc, a.camera);
      const largura = a.largura ?? CENA_3D_PADRAO.largura;
      const altura = a.altura ?? CENA_3D_PADRAO.altura;
      const q = await s.cena3d(projeto, {documento, doc, camera, largura, altura, lado_miniatura: LADO_MINIATURA});
      const arquivo = gravarPrevia(projeto, 'cena3d', documento, a.camera ? 'camera' : '', q.png);
      const objetos = Array.isArray(doc.objetos) ? doc.objetos.length : 0;
      return resposta({arquivo, markdown: markdownDaPrevia(`${documento}${a.camera ? ', outra câmera' : ''}`, arquivo), documento, camera, largura: q.largura, altura: q.altura,
        objetos, ...(objetos ? {} : {aviso: 'a cena não tem objetos'}), como_mostrar: COMO_MOSTRAR}, q.miniatura);
    } catch (e) {
      return erro(e);
    }
  });
};
