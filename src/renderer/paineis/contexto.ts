// O contexto da tela numa linha (frente IA, F6), para o terminal: módulo, documento, seleção e tempo do vídeo. A
// conversa do painel manda o mesmo em chips (Conversa.tsx, useAnexos); a IA também lê pelo estado_do_editor.
import {loja, valorEm} from '../estado/loja';

const NOME: Record<string, string> = {video: 'Vídeo', imagem: 'Imagem', '3d': '3D', efeitos: 'Efeitos', musica: 'Música'};

const tempo = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const contextoDaTela = () => {
  const e = loja.get();
  const partes: string[] = [`módulo ${NOME[e.area] ?? e.area}`];
  const docId = (e.ativo as Record<string, string | undefined>)[e.area];
  const doc = e.info?.manifesto.documentos.find((d) => d.id === docId);
  if (doc) partes.push(`documento ${doc.id}`);
  if (e.selecao) {
    const v = valorEm(e.docs[e.selecao.documento]?.doc, e.selecao.caminho) as {id?: string; nome?: string; tipo?: string} | undefined;
    partes.push(`seleção ${e.selecao.caminho}${v && typeof v === 'object' && (v.nome || v.id) ? ` (${v.tipo ?? ''} ${v.nome ?? v.id})`.replace('( ', '(') : ''}`);
  }
  if (e.area === 'video') partes.push(`tempo ${tempo(e.tempo_ms)}`);
  return partes.join(' · ');
};
