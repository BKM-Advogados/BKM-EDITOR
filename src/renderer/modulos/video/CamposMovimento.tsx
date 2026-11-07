// Grupo "Movimento" do bloco de imagem no inspetor do vídeo de cenas (InspectorCenas, no fim da seção Conteúdo): o tipo
// do Ken Burns, a intensidade e a atenuação. O objeto `movimento` é gravado inteiro, como o ducking; "Parada" tira o
// campo, e o documento volta a ser o de antes. Com movimento no encaixe Inteira, avisa que as faixas vazias andam junto
// e oferece "Preencher" (video-D12). A conta por quadro fica em composicoes/cenas/movimento.ts.
import React from 'react';
import {TriangleAlert} from 'lucide-react';
import type {BlocoCenas, MovimentoImagem} from '../../../nucleo/cenas';
import {INTENSIDADE_MAX, INTENSIDADE_MIN, INTENSIDADE_PADRAO, intensidadeDe, movimentoEmInteira, TIPOS_MOVIMENTO, type TipoMovimento} from '../../../composicoes/cenas/movimento';
import {trocar} from '../../estado/loja';
import {CampoDeslizante, CampoInterruptor, CampoSelecao, LinhaCampo} from '../../componentes/Campos';

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
          {movimentoEmInteira(b) && (
            <LinhaCampo rotulo={<TriangleAlert size={13} style={{color: 'var(--aviso)'}} />} como="div" alta>
              <div data-aviso-encaixe style={{display: 'flex', alignItems: 'center', gap: 8, minWidth: 0}}>
                <span style={{color: 'var(--aviso)', fontSize: 'var(--tam-2)', lineHeight: 1.35, flex: 1, minWidth: 0}}>Em Inteira, as faixas vazias andam junto com a foto.</span>
                <button type="button" className="bt mini" title="Encaixe Preencher: a foto cobre a caixa e o movimento sai limpo"
                  onClick={() => void trocar(documento, `${caminho}/ajuste`, 'cobrir', 'encaixe do bloco')}>Preencher</button>
              </div>
            </LinhaCampo>
          )}
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
