// Criar e duplicar a pasta de um projeto do Estúdio (frente 2 do MCP): o mesmo caminho para a tela inicial (src/main/main.ts,
// IPC criarProjeto e duplicarProjeto) e para as ferramentas criar_projeto e duplicar_projeto do MCP, com o app aberto
// (main.ts) ou fechado (o MCP do Claude Desktop e o da IDE: src/nucleo/mcp-desktop.ts e mcp/nucleo.ts). Só disco: abrir o
// projeto na tela é do app.
import {cpSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {aplicarMarcaAoPlano, gravarPlano, nomePadrao, pastaLivre, planoDoProjeto} from './criar-projeto';
import type {Manifesto} from './documentos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO, FPS_PADRAO, limitarTamanho, type Formato} from './formatos';
import {MODELOS, type IdModelo} from './modelos';
import type {MarcaLida} from './pasta-marcas';
import {ErroProjeto, Projeto, semBom, serializar} from './projeto';

/** Um formato da tela (id de formatos.ts) ou um tamanho em pixels. */
export type PedidoFormato = string | {largura: number; altura: number; fps?: number};

/** O formato do projeto novo: o fixo do modelo (animação), o id de um formato da tela ("reels", "feed", "quadrado"…) ou o
 *  tamanho dito. Cena 3D não tem formato. Sem pedido, o documento nasce no formato padrão do módulo. */
export const formatoDoPedido = (modelo: IdModelo, pedido?: PedidoFormato): Formato | undefined => {
  const m = MODELOS.find((x) => x.id === modelo);
  if (!m) throw new ErroProjeto(`modelo desconhecido: ${modelo} (vale ${MODELOS.map((x) => x.id).join(', ')})`, 'patch');
  if (m.modulo === '3d') return undefined;
  const lista = m.modulo === 'imagem' ? FORMATOS_IMAGEM : FORMATOS_VIDEO;
  const id = m.formato_fixo ?? (typeof pedido === 'string' ? pedido : undefined);
  if (id !== undefined) {
    const p = lista.find((f) => f.id === id);
    if (!p) throw new ErroProjeto(`formato desconhecido: ${id} (vale ${lista.map((f) => f.id).join(', ')} ou {largura, altura})`, 'patch');
    return {largura: p.largura, altura: p.altura, fps: FPS_PADRAO};
  }
  if (pedido && typeof pedido === 'object') return {largura: limitarTamanho(pedido.largura), altura: limitarTamanho(pedido.altura), fps: pedido.fps ?? FPS_PADRAO};
  return undefined;
};

/** Grava a pasta do projeto novo em `pasta` (com um nome livre: "Vídeo", "Vídeo (2)") e devolve onde ficou. */
export const criarPastaDoProjeto = (o: {nome?: string; modelo: IdModelo; formato?: Formato | {largura: number; altura: number}; marca?: MarcaLida | null;
  pasta: string; agora?: Date}) => {
  const nome = o.nome?.trim() || nomePadrao(o.agora ?? new Date());
  const raiz = pastaLivre(o.pasta, nome);
  const plano = planoDoProjeto({nome, modelo: o.modelo, formato: o.formato});
  if (o.marca) aplicarMarcaAoPlano(plano, o.marca);
  gravarPlano(raiz, plano);
  return {raiz, nome};
};

/** Pastas que a cópia não leva: sem histórico, diário, estado e saídas, ela começa limpa. */
const FORA_DA_COPIA = ['.git', '.estudio', 'saidas'];

/** Copia o projeto ao lado dele ("Nome (cópia)" ou o nome dado) e devolve onde ficou. */
export const duplicarPastaDoProjeto = (origem: string, nome?: string) => {
  if (!existsSync(path.join(origem, 'estudio.json'))) throw new ErroProjeto(`a pasta do projeto não existe mais: ${origem}`, 'nao_achado');
  const n = nome?.trim() || `${new Projeto(origem).manifesto().nome} (cópia)`;
  const raiz = pastaLivre(path.dirname(origem), n);
  cpSync(origem, raiz, {recursive: true, filter: (src) => !FORA_DA_COPIA.includes(path.relative(origem, src).split(path.sep)[0])});
  const arq = path.join(raiz, 'estudio.json');
  writeFileSync(arq, serializar({...(JSON.parse(semBom(readFileSync(arq, 'utf-8'))) as Manifesto), nome: n}), 'utf-8');
  return {raiz, nome: n};
};

/** O que as ferramentas de projeto devolvem: nome, pasta e documentos. */
export const resumoDoProjeto = (raiz: string) => {
  const m = new Projeto(raiz).manifesto();
  return {nome: m.nome, pasta: raiz, documentos: m.documentos.map((d) => ({id: d.id, titulo: d.titulo, modulo: d.modulo}))};
};
