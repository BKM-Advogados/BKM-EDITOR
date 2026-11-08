// Ações que criam camadas na imagem (texto, forma, imagem do projeto) e as de página do carrossel (nova, duplicar,
// mover, renomear, excluir, "Novo carrossel"). O trilho do monitor e a barra de páginas usam estas funções; cada uma é
// um patch e deixa a seleção (ou a página ativa) no que acabou de nascer. As camadas entram sempre na página ativa.
import type {CamadaImagem, DocImagem} from '../../../nucleo/documentos';
import {formaNova, iconeNovo, textoNovo} from '../../../nucleo/camadas-novas';
import {linhaDaPredefinicao} from '../../../nucleo/linha';
import {docCarrossel, patchCarrossel, patchDuplicarPagina, patchExcluirPagina, patchMoverPagina, patchNovaPagina, patchRenomearPagina, type ResultadoPaginas} from '../../../nucleo/carrossel';
import {aplicar, avisar, criarDocumento, loja, selecionar} from '../../estado/loja';
import {pedirTexto} from '../../componentes/Dialogo';
import {caminhoNoProjeto, idNovo, medirImagem, paginaAtivaDe} from './comum';

const docDe = (documento: string) => loja.get().docs[documento]?.doc as DocImagem | undefined;
const ativa = (documento: string, doc: DocImagem) => paginaAtivaDe(loja.get(), documento, doc);

export const adicionarCamada = async (documento: string, base: string, camada: Omit<CamadaImagem, 'id'>) => {
  const doc = docDe(documento);
  if (!doc) return false;
  const pg = ativa(documento, doc);
  const nova: CamadaImagem = {id: idNovo(base, pg.camadas), ...camada};
  if (!(await aplicar(documento, [{op: 'add', path: `${pg.base}/-`, value: nova}], `nova camada ${nova.id}${pg.paginas.length > 1 ? ` em ${pg.pagina.nome}` : ''}`))) return false;
  const depois = docDe(documento);
  const i = depois ? ativa(documento, depois).camadas.findIndex((c) => c.id === nova.id) : -1;
  if (i >= 0) selecionar({documento, caminho: `${pg.base}/${i}`});
  return true;
};

/** Texto novo; com ponto (coordenadas do documento), nasce onde a pessoa clicou. */
export const novoTexto = (documento: string, doc: DocImagem, ponto?: {x: number; y: number}) => adicionarCamada(documento, 'texto', textoNovo(doc, ponto));

/** Forma nova: na caixa desenhada ou, sem caixa, um quadrado de 30% no centro (ou no ponto clicado). */
export const novaForma = (documento: string, doc: DocImagem, caixa?: {x: number; y: number; largura: number; altura: number}) =>
  adicionarCamada(documento, 'forma', formaNova(doc, caixa));

/** Ícone novo do Lucide no centro da página ativa, na cor de destaque do kit. */
export const novoIcone = (documento: string, doc: DocImagem, nome: string) => adicionarCamada(documento, 'icone', iconeNovo(doc, nome));

/** Linha ou seta de uma predefinição (segmento horizontal de 40% da largura, no centro): o giro, o inspector. */
export const novaLinha = async (documento: string, doc: DocImagem, predefinicao: string) => {
  const camada = linhaDaPredefinicao(doc, predefinicao);
  return camada ? adicionarCamada(documento, camada.nome === 'Seta' ? 'seta' : 'linha', camada) : false;
};

export const novaImagem = async (documento: string, doc: DocImagem, bruto: string) => {
  const src = caminhoNoProjeto(bruto);
  if (!src) {
    avisar('Use um caminho dentro da pasta do projeto, ex.: midia/logo-exemplo.png', 'erro');
    return false;
  }
  try {
    const {iw, ih} = await medirImagem(src);
    const largura = Math.round(doc.largura * 0.5);
    const altura = Math.max(1, Math.round((largura * ih) / iw));
    const nome = src.split('/').pop()!.replace(/\.[^.]+$/, '');
    return await adicionarCamada(documento, nome, {
      nome, tipo: 'imagem', src, ajuste: 'conter',
      x: Math.round((doc.largura - largura) / 2), y: Math.round((doc.altura - altura) / 2), largura, altura,
    });
  } catch (e) {
    avisar((e as Error).message, 'erro');
    return false;
  }
};

// ---------- páginas ----------
/** Aplica o patch de página e deixa ativa a página que o resultado aponta. */
const aplicarPaginas = async (documento: string, r: ResultadoPaginas | null, rotulo: string) => {
  if (!r || !r.patch.length) return false;
  const id = r.paginas[r.indice]?.id;
  if (!(await aplicar(documento, r.patch, rotulo))) return false;
  loja.definir((e) => ({paginaAtiva: {...e.paginaAtiva, [documento]: id}, selecao: e.selecao?.documento === documento ? null : e.selecao}));
  return true;
};

/** Página nova (vazia) depois da ativa. */
export const novaPagina = async (documento: string) => {
  const doc = docDe(documento);
  if (!doc) return false;
  const {p, paginas} = ativa(documento, doc);
  return aplicarPaginas(documento, patchNovaPagina(doc, p), `nova página (${paginas.length + 1} páginas)`);
};

export const duplicarPagina = async (documento: string, p?: number) => {
  const doc = docDe(documento);
  if (!doc) return false;
  const pg = ativa(documento, doc);
  const i = p ?? pg.p;
  return aplicarPaginas(documento, patchDuplicarPagina(doc, i), `duplicar página ${pg.paginas[i]?.nome ?? i + 1}`);
};

export const moverPagina = async (documento: string, de: number, para: number) => {
  const doc = docDe(documento);
  if (!doc) return false;
  const nome = ativa(documento, doc).paginas[de]?.nome ?? de + 1;
  return aplicarPaginas(documento, patchMoverPagina(doc, de, para), `página ${nome} para a posição ${para + 1}`);
};

export const renomearPagina = async (documento: string, p: number, nome: string) => {
  const doc = docDe(documento);
  if (!doc || !nome.trim()) return false;
  return aplicarPaginas(documento, patchRenomearPagina(doc, p, nome), `página ${p + 1} chama-se ${nome.trim()}`);
};

export const excluirPagina = async (documento: string, p?: number) => {
  const doc = docDe(documento);
  if (!doc) return false;
  const pg = ativa(documento, doc);
  const i = p ?? pg.p;
  const r = patchExcluirPagina(doc, i);
  if (!r) {
    avisar('A última página não sai: o documento precisa de pelo menos uma.', 'info');
    return false;
  }
  return aplicarPaginas(documento, r, `excluir página ${pg.paginas[i]?.nome ?? i + 1}`);
};

/** "Novo carrossel": um documento de imagem novo no projeto, já com capa, N páginas de conteúdo e final. */
export const criarCarrossel = async (formato: {largura: number; altura: number}, paginas: number, titulo = 'Carrossel') => {
  const n = Math.max(1, Math.min(30, Math.round(paginas) || 7));
  const entrada = await criarDocumento('imagem', formato, titulo);
  if (!entrada) return null;
  const modelo = docCarrossel({largura: formato.largura, altura: formato.altura, paginas: n});
  if (!(await aplicar(entrada.id, patchCarrossel(modelo), `carrossel de ${n} páginas`))) return null;
  loja.definir((e) => ({paginaAtiva: {...e.paginaAtiva, [entrada.id]: modelo.paginas![0].id}, selecao: null}));
  avisar(`${entrada.titulo}: ${n} páginas. Peça ao Claude para preencher os campos titulo e texto de cada página.`, 'ok');
  return entrada;
};

/** Pergunta quantas páginas e cria o carrossel no formato dado. */
export const novoCarrossel = async (formato: {largura: number; altura: number}) => {
  const t = await pedirTexto({titulo: 'Novo carrossel', rotulo: 'Quantas páginas (com a capa e a final)', valor: '7', botao: 'Criar carrossel',
    texto: `${formato.largura} × ${formato.altura}. Capa, páginas de conteúdo e página final, cada uma com título, texto e número de página, para o Claude preencher.`});
  if (t === null) return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 1 || n > 30) {
    avisar('Escolha de 1 a 30 páginas.', 'erro');
    return null;
  }
  return criarCarrossel(formato, Math.round(n));
};
