// O selo da barra (transversal-D11): "Salvo" só enquanto a última gravação deu certo. Enquanto grava mostra "Gravando…" e,
// se a gravação falhou, "Não salvo" com o motivo, até a próxima gravação dar certo. O estado vem de loja.gravacao.
import React from 'react';
import {rotuloDoAtalho} from '../teclas';
import {Check, LoaderCircle, TriangleAlert} from 'lucide-react';
import {useLoja} from '../estado/loja';

export const SeloSalvo: React.FC<{git: boolean}> = ({git}) => {
  const g = useLoja((e) => e.gravacao);
  if (g.estado === 'gravando') return <span className="salvo gravando" role="status"><LoaderCircle size={12} />Gravando…</span>;
  if (g.estado === 'falhou') {
    return <span className="salvo falhou" role="alert" title={g.erro ?? 'A última edição não foi gravada.'}><TriangleAlert size={12} />Não salvo</span>;
  }
  return (
    <span className="salvo" role="status" title={git ? `Cada edição grava na hora. ${rotuloDoAtalho('Ctrl+S')} marca um ponto de restauração.` : 'Cada edição grava na hora. Sem o Git, não há pontos de restauração.'}>
      <Check size={12} />Salvo
    </span>
  );
};
