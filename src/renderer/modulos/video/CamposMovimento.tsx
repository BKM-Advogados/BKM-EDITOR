// Grupo "Movimento" do bloco de imagem no inspetor do vídeo de cenas (InspectorCenas, no fim da seção Conteúdo): o tipo
// do Ken Burns, a intensidade e a atenuação. O objeto `movimento` é gravado inteiro, como o ducking; "Parada" tira o
// campo, e o documento volta a ser o de antes. A conta por quadro fica em composicoes/cenas/movimento.ts.
import React from 'react';
import type {BlocoCenas, MovimentoImagem} from '../../../nucleo/cenas';
import {INTENSIDADE_MAX, INTENSIDADE_MIN, INTENSIDADE_PADRAO, intensidadeDe, TIPOS_MOVIMENTO, type TipoMovimento} from '../../../composicoes/cenas/movimento';
import {trocar} from '../../estado/loja';
import {CampoDeslizante, CampoInterruptor, CampoSelecao} from '../../componentes/Campos';

const OPCOES: [TipoMovimento | 'parada', string][] = [['parada', 'Parada'], ...TIPOS_MOVIMENTO.map((t): [TipoMovimento, string] => [t.id, t.nome])];

export const CamposMovimento: React.FC<{documento: string; caminho: string; b: BlocoCenas}> = ({documento, caminho, b}) => {
  const m = b.movimento;
  const gravar = (novo: MovimentoImagem | undefined, rotulo: string) => void trocar(documento, `${caminho}/movimento`, novo, `${rotulo} da imagem`);
  // sem a chave que voltou ao padrão, para o JSON ficar curto
  const com = (k: 'intensidade' | 'suave', v: number | boolean, padrao: number | boolean): MovimentoImagem => {
    const novo: Record<string, unknown> = {...m};
    if (v === padrao) delete novo[k];
    else novo[k] = v;
    return novo as MovimentoImagem;
  };
  return (
    <>
      <CampoSelecao rotulo="Movimento" valor={m?.tipo ?? 'parada'} opcoes={OPCOES} padrao="parada"
        aoMudar={(v) => gravar(v === 'parada' ? undefined : {...m, tipo: v}, 'movimento')} />
      {m && (
        <>
          <CampoDeslizante rotulo="Intensidade" valor={Math.round(intensidadeDe(m) * 100)} min={INTENSIDADE_MIN * 100} max={INTENSIDADE_MAX * 100} passo={1} unidade="%"
            padrao={INTENSIDADE_PADRAO * 100} formatar={(v) => `${Math.round(v)}%`}
            aoMudar={(v) => gravar(com('intensidade', Math.round(v) / 100, INTENSIDADE_PADRAO), 'intensidade do movimento')} />
          <CampoInterruptor rotulo="Suave" valor={m.suave !== false} texto="começa e termina devagar"
            aoMudar={(v) => gravar(com('suave', v, true), 'atenuação do movimento')} />
        </>
      )}
    </>
  );
};
