// Campos que o inspector 3D precisa além dos comuns: vetor x/y/z lado a lado (filete na cor do eixo, pelos tokens),
// escolha numa lista e cor com prévia ao vivo que grava só ao fechar o seletor (um patch por gesto, não por movimento).
import React, {useEffect, useState} from 'react';
import type {Vetor3} from '../../../nucleo/documentos';
import {CampoCor, CampoSelecao, LinhaCampo, numeroBr} from '../../componentes/Campos';

const EIXOS = [
  {nome: 'X', cor: 'var(--eixo-x)'},
  {nome: 'Y', cor: 'var(--eixo-y)'},
  {nome: 'Z', cor: 'var(--eixo-z)'},
];

const Eixo: React.FC<{valor: number | undefined; nome: string; cor: string; unidade?: string; aoMudar: (n: number) => void}> = ({valor, nome, cor, unidade, aoMudar}) => {
  const texto = valor === undefined ? '' : numeroBr(valor);
  const [v, setV] = useState(texto);
  useEffect(() => setV(texto), [texto]);
  const gravar = () => {
    const n = Number(v.trim().replace(',', '.'));
    if (v.trim() !== '' && Number.isFinite(n) && n !== valor) aoMudar(n);
    else if (!Number.isFinite(n)) setV(texto);
  };
  return (
    <div className="campo num" style={{padding: '0 6px', boxShadow: `inset 2px 0 0 ${cor}`}} title={nome}>
      <input type="text" inputMode="decimal" value={v} aria-label={nome} onChange={(e) => setV(e.target.value)} onBlur={gravar} onKeyDown={(e) => e.key === 'Enter' && gravar()} />
      {unidade && <span className="u">{unidade}</span>}
    </div>
  );
};

/** Três números lado a lado; cada eixo grava sozinho ao sair do campo ou com Enter. O ponto à esquerda aparece quando
 *  o vetor difere do padrão, e clicar nele redefine. */
export const CampoVetor: React.FC<{rotulo: string; valor: Vetor3 | undefined; aoMudar: (v: Vetor3) => void; passo?: number; padrao?: Vetor3; unidade?: string; aoRedefinir?: () => void}> = ({rotulo, valor, aoMudar, padrao = [0, 0, 0], unidade, aoRedefinir}) => {
  const difere = !!valor && valor.some((x, i) => x !== padrao[i]);
  return (
    <LinhaCampo rotulo={rotulo} como="div" difere={difere} padrao={padrao.map((x) => numeroBr(x)).join('; ')} aoRedefinir={aoRedefinir ?? (() => aoMudar(padrao))}>
      <div className="lado l3">
        {EIXOS.map((e, i) => (
          <Eixo key={e.nome} nome={`${rotulo} ${e.nome}`} cor={e.cor} unidade={unidade} valor={valor?.[i]}
            aoMudar={(n) => aoMudar((valor ?? padrao).map((x, j) => (j === i ? n : x)) as Vetor3)} />
        ))}
      </div>
    </LinhaCampo>
  );
};

export const CampoEscolha = <T extends string>({rotulo, valor, opcoes, aoMudar}: {rotulo: string; valor: T; opcoes: {valor: T; nome: string}[]; aoMudar: (v: T) => void}) => (
  <CampoSelecao<T> rotulo={rotulo} valor={valor} opcoes={opcoes.map((o) => [o.valor, o.nome] as [T, string])} aoMudar={aoMudar} />
);

/** Cor com prévia ao vivo (aoVer) e gravação só no 'change' nativo, que o seletor dispara ao fechar. */
export const CampoCorAoSoltar: React.FC<{rotulo: string; valor: string; aoMudar: (v: string) => void; aoVer?: (v: string) => void}> = (p) => <CampoCor {...p} />;
