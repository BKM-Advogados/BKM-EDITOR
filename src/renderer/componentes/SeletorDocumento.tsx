// Seletor do documento aberto na área, no topo da lista (Imagem, Animação, Música): só aparece com mais de um
// documento do módulo no projeto, ou com o botão de criar outro (`novo`, na Música). Trocar limpa a seleção; no Vídeo, na Animação e na Música a agulha volta ao começo.
import React from 'react';
import {Plus} from 'lucide-react';
import type {Modulo} from '../../nucleo/documentos';
import {loja, useLoja, type Area} from '../estado/loja';
import {Escolha} from './Controles';

export const trocarDocumento = (modulo: Exclude<Modulo, '3d'> | '3d', id: string) =>
  loja.definir((s) => ({ativo: {...s.ativo, [modulo]: id}, selecao: null, ...(modulo === 'animacao' || modulo === 'musica' || modulo === 'video' ? {tempo_ms: 0} : {})}));

export const SeletorDocumento: React.FC<{modulo: Modulo & Area; rotulo?: string; aoTrocar?: () => void; novo?: {rotulo: string; acao: () => void}}> = ({modulo, rotulo, aoTrocar, novo}) => {
  const docs = useLoja((e) => e.info?.manifesto.documentos.filter((d) => d.modulo === modulo) ?? []);
  const ativo = useLoja((e) => (e.ativo as Record<string, string | undefined>)[modulo]);
  if (docs.length < 2 && !novo) return null;
  const titulo = rotulo ?? {video: 'Vídeo aberto', imagem: 'Imagem aberta', '3d': 'Cena aberta', musica: 'Música aberta', animacao: 'Animação aberta', efeitos: 'Documento'}[modulo];
  return (
    <div className="painel-topo seletor-documento">
      {docs.length >= 2 && <Escolha valor={ativo} rotulo={titulo} aoMudar={(id) => (trocarDocumento(modulo, id), aoTrocar?.())} opcoes={docs.map((d): [string, string] => [d.id, d.titulo])} />}
      {novo && (docs.length >= 2
        ? <button className="bti" onClick={novo.acao} title={novo.rotulo} aria-label={novo.rotulo}><Plus size={14} /></button>
        : <button className="bt" onClick={novo.acao}><Plus size={14} />{novo.rotulo}</button>)}
    </div>
  );
};
