// Chip de formato sobre o monitor: "Reels 9:16", "Feed 4:5", "Personalizado 1200×800". Clicar abre a lista do módulo e
// trocar grava por patch (diário e Reverter), a mesma troca do Formato do inspetor do vídeo e da Prancheta da imagem.
// Onde não cabe trocar (animação de formato fixo, roteiro antigo, 3D), o chip só informa. A regra está em
// nucleo/chip-formato.ts; aqui é só a casca.
import React from 'react';
import {Check} from 'lucide-react';
import type {Modulo} from '../../nucleo/documentos';
import {chipDoFormato, trocaDeFormato} from '../../nucleo/chip-formato';
import {aplicar, loja, patchTrocar, useLoja} from '../estado/loja';
import {BotaoMenu} from './Menu';

/** Distância do alto do monitor que o palco deixa livre para o chip (8 px de folga, 22 do chip, 4 de respiro). */
export const TOPO_CHIP = 34;

/** Grava a troca de formato do documento: um patch só, com o rótulo "formato Feed 4:5" no diário. */
export const trocarFormato = (documento: string, modulo: Modulo, id: string) => {
  const doc = loja.get().docs[documento]?.doc;
  const t = trocaDeFormato(modulo, doc, id);
  if (!t) return;
  void aplicar(documento, t.mudancas.flatMap((m) => patchTrocar(doc, m.caminho, m.valor)), t.rotulo);
};

export const ChipFormato: React.FC<{documento?: string; modulo: Modulo; doc?: unknown; className?: string}> = ({documento, modulo, doc, className}) => {
  const lido = useLoja((e) => (documento ? e.docs[documento]?.doc : undefined));
  const chip = chipDoFormato(modulo, doc ?? lido);
  if (!chip) return null;
  const classe = `chip-formato${className ? ` ${className}` : ''}`;
  if (!chip.trocavel || !documento) {
    return <span className={`${classe} so-informa`} title={chip.dica} role="note" aria-label={`Formato: ${chip.rotulo}. ${chip.motivo ?? ''}`}>{chip.rotulo}</span>;
  }
  return (
    <span className={classe} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <BotaoMenu titulo={chip.dica} className="chip-formato-bt" lado="esquerda" icone={null} rotulo={chip.rotulo}
        itens={chip.opcoes.map((o) => ({rotulo: `${o.rotulo} · ${o.largura}×${o.altura}`, icone: o.atual ? <Check className="i12" /> : <span className="i12" />,
          acao: () => trocarFormato(documento, modulo, o.id)}))} />
    </span>
  );
};
