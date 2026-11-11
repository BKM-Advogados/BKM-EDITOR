// Seletor do documento aberto na área, no topo da lista (Imagem, Animação, Música): só aparece com mais de um
// documento do módulo no projeto. Trocar limpa a seleção; na Animação e na Música a agulha volta ao começo.
import React from 'react';
import type {Modulo} from '../../nucleo/documentos';
import {loja, useLoja, type Area} from '../estado/loja';

export const trocarDocumento = (modulo: Exclude<Modulo, '3d'> | '3d', id: string) =>
  loja.definir((s) => ({ativo: {...s.ativo, [modulo]: id}, selecao: null, ...(modulo === 'animacao' || modulo === 'musica' ? {tempo_ms: 0} : {})}));

export const SeletorDocumento: React.FC<{modulo: Modulo & Area; rotulo?: string}> = ({modulo, rotulo}) => {
  const docs = useLoja((e) => e.info?.manifesto.documentos.filter((d) => d.modulo === modulo) ?? []);
  const ativo = useLoja((e) => (e.ativo as Record<string, string | undefined>)[modulo]);
  if (docs.length < 2) return null;
  const titulo = rotulo ?? {video: 'Vídeo aberto', imagem: 'Imagem aberta', '3d': 'Cena aberta', musica: 'Música aberta', animacao: 'Animação aberta', efeitos: 'Documento'}[modulo];
  return (
    <div className="painel-topo seletor-documento">
      <select className="campo" value={ativo ?? ''} title={titulo} aria-label={titulo} onChange={(e) => trocarDocumento(modulo, e.target.value)}>
        {!ativo && <option value="">Escolha…</option>}
        {docs.map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
      </select>
    </div>
  );
};
