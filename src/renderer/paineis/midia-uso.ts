// "Usar em…" do painel de mídia (frente Casca, rodada 3): leva um arquivo de midia/ para o documento ativo de outro módulo, pelo
// mesmo caminho que a pessoa faria à mão (bloco de imagem no vídeo, clipe de áudio na linha do tempo, camada na imagem). Cada
// destino aparece como item do menu só quando existe e serve ao tipo do arquivo, e o que entra é um patch normal: tem diário,
// Ctrl+Z e Reverter. A frente Música acrescenta o destino dela aqui quando o contrato `levar_para` existir (docs/casca.md).
import type {ItemMenu} from '../componentes/Menu';
import {ehDocCenas} from '../../nucleo/cenas';
import type {DocImagem} from '../../nucleo/documentos';
import type {PapelFaixa} from '../../nucleo/audio';
import type {EntradaMidia} from '../../nucleo/midia';
import {avisar, loja, selecionar, trocar} from '../estado/loja';
import {novaImagem} from '../modulos/imagem/acoes';
import {adicionarBloco} from '../modulos/video/acoes';
import {adicionarClipeAudio} from '../modulos/video/acoes-audio';

const docAtivo = (modulo: 'video' | 'imagem') => {
  const id = loja.get().ativo[modulo];
  const lido = id ? loja.get().docs[id] : undefined;
  return id && lido ? {id, doc: lido.doc as unknown} : null;
};

/** Bloco de imagem na cena de trabalho do vídeo ativo, com o arquivo já no `src`. */
export const imagemNoVideo = async (caminho: string) => {
  const v = docAtivo('video');
  if (!v || !ehDocCenas(v.doc)) return avisar('Abra um vídeo de cenas para pôr a imagem nele.', 'info');
  await adicionarBloco(v.id, 'imagem');
  const sel = loja.get().selecao;
  if (sel?.documento === v.id && /^\/cenas\/\d+\/blocos\/\d+$/.test(sel.caminho)) {
    if (await trocar(v.id, `${sel.caminho}/src`, caminho, `imagem ${caminho.split('/').pop()}`)) selecionar(sel);
  }
};

export const audioNoVideo = async (caminho: string, papel: PapelFaixa) => {
  const v = docAtivo('video');
  if (!v || !ehDocCenas(v.doc)) return avisar('Abra um vídeo de cenas para pôr o áudio nele.', 'info');
  await adicionarClipeAudio(v.id, papel, caminho);
};

export const camadaNaImagem = async (caminho: string) => {
  const i = docAtivo('imagem');
  if (!i) return avisar('Abra uma imagem para pôr a foto nela.', 'info');
  await novaImagem(i.id, i.doc as DocImagem, caminho);
};

/** Os destinos que servem ao arquivo, para o menu "Usar em…". Lista vazia: o botão fica desligado com a razão no título. */
export const destinosDaMidia = (e: EntradaMidia): {itens: ItemMenu[]; porque?: string} => {
  const video = docAtivo('video');
  const imagem = docAtivo('imagem');
  const cenas = video && ehDocCenas(video.doc);
  const itens: ItemMenu[] = [];
  if (e.tipo === 'imagem') {
    if (cenas) itens.push({rotulo: 'No vídeo: bloco de imagem', acao: () => void imagemNoVideo(e.caminho)});
    if (imagem) itens.push({rotulo: 'Na imagem: nova camada', acao: () => void camadaNaImagem(e.caminho)});
  } else if (e.tipo === 'audio') {
    if (cenas) {
      itens.push({rotulo: 'No vídeo: narração', acao: () => void audioNoVideo(e.caminho, 'voz')});
      itens.push({rotulo: 'No vídeo: música', acao: () => void audioNoVideo(e.caminho, 'musica')});
      itens.push({rotulo: 'No vídeo: efeito sonoro', acao: () => void audioNoVideo(e.caminho, 'efeitos')});
    }
  }
  if (itens.length) return {itens};
  if (e.tipo === 'video') return {itens, porque: 'Vídeo bruto ainda não entra nas cenas: use para ver e marcar as tomadas, e peça ao Claude para cortar'};
  if (e.tipo === 'outro') return {itens, porque: 'Este tipo de arquivo não entra em nenhum módulo'};
  return {itens, porque: e.tipo === 'imagem' ? 'Abra um vídeo de cenas ou uma imagem para usar a foto' : 'Abra um vídeo de cenas para usar o áudio'};
};
