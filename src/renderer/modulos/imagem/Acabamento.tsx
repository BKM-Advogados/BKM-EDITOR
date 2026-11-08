// Seções do inspector para o acabamento da camada (sombra, contorno, degradê) e o editor de degradê que o fundo da
// prancheta também usa. Cada campo grava um patch no caminho dele (ex.: /camadas/2/sombra/desfoque); o controle que
// desliza mostra o valor pela prévia ao vivo antes. As predefinições de um clique (sombra suave, contorno e degradê da
// marca) saem do kit cuja cor de fundo é a da imagem, ou do primeiro kit (acabamento.ts, kitDaImagem).
import React from 'react';
import {Plus, Minus} from 'lucide-react';
import type {CamadaImagem, Degrade, DocImagem} from '../../../nucleo/documentos';
import {
  CONTORNO_PADRAO, ESTILOS_TRACO, JUNCOES_TRACO, POSICOES_CONTORNO, PONTAS_TRACO, SOMBRA_PADRAO, SOMBRA_SUAVE, contornoDaMarca, degradeDaMarca, degradeDe, ehVetorial, kitDaImagem,
} from '../../../nucleo/acabamento';
import {MARCAS_INICIAIS, type Marca} from '../../../nucleo/marca';
import {avisar, trocar} from '../../estado/loja';
import {usarKits} from '../../estado/kits';
import {CampoCor, CampoDeslizante, CampoNumero, CampoSelecao, Secao} from '../../componentes/Campos';
import {definirPrevia} from './comum';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** O kit das predefinições desta imagem. */
export const usarKitDaImagem = (doc: Pick<DocImagem, 'fundo' | 'marca'>) => kitDaImagem(doc, usarKits()) ?? MARCAS_INICIAIS[0];

type Gravar = (campo: string, valor: unknown, rotulo?: string) => void;
type Ver = (campo: string) => (valor: unknown) => void;

/** Editor de um degradê em `caminho` (o objeto inteiro): tipo, ângulo ou centro e as cores com posição e opacidade. */
export const EditorDegrade: React.FC<{documento: string; caminho: string; d: Degrade}> = ({documento, caminho, d}) => {
  const g = degradeDe(d);
  const gravar: Gravar = (campo, valor, rotulo) => void trocar(documento, `${caminho}/${campo}`, valor, rotulo ?? `degradê: ${campo}`);
  const ver: Ver = (campo) => (valor) => definirPrevia({documento, caminho: `${caminho}/${campo}`, valor});
  const paradas = Array.isArray(d.paradas) ? d.paradas : [];
  const maisUma = () => {
    const ultima = paradas[paradas.length - 1];
    void trocar(documento, `${caminho}/paradas`, [...paradas, {cor: ultima?.cor ?? '#FFFFFF', posicao: 1}], 'degradê: mais uma cor');
  };
  return (
    <>
      <CampoSelecao rotulo="Tipo" valor={g?.tipo ?? 'linear'} opcoes={[['linear', 'Linear'], ['radial', 'Radial (do centro)']]} aoMudar={(v) => gravar('tipo', v)} />
      {g?.tipo !== 'radial'
        ? <CampoNumero rotulo="Ângulo" valor={g?.angulo ?? 180} unidade="°" padrao={180} aoRedefinir={() => gravar('angulo', undefined)} aoMudar={(v) => gravar('angulo', v)}
          dica="Como no CSS: 180 vai de cima para baixo, 90 da esquerda para a direita" />
        : (
          <>
            <CampoDeslizante rotulo="Centro X" valor={g.centro.x} min={0} max={1} passo={0.01} padrao={0.5} formatar={pct}
              aoVer={(v) => ver('centro')({...g.centro, x: v})} aoMudar={(v) => gravar('centro', {...g.centro, x: v})} />
            <CampoDeslizante rotulo="Centro Y" valor={g.centro.y} min={0} max={1} passo={0.01} padrao={0.5} formatar={pct}
              aoVer={(v) => ver('centro')({...g.centro, y: v})} aoMudar={(v) => gravar('centro', {...g.centro, y: v})} />
          </>
        )}
      {paradas.map((p, k) => (
        <React.Fragment key={k}>
          <CampoCor rotulo={`Cor ${k + 1}`} valor={p.cor} aoVer={ver(`paradas/${k}/cor`)} aoMudar={(v) => gravar(`paradas/${k}/cor`, v)} />
          <CampoDeslizante rotulo="  posição" valor={p.posicao ?? 0} min={0} max={1} passo={0.01} formatar={pct}
            aoVer={ver(`paradas/${k}/posicao`)} aoMudar={(v) => gravar(`paradas/${k}/posicao`, v)} />
          <CampoDeslizante rotulo="  opacidade" valor={p.opacidade ?? 1} min={0} max={1} passo={0.01} padrao={1} formatar={pct}
            aoVer={ver(`paradas/${k}/opacidade`)} aoMudar={(v) => gravar(`paradas/${k}/opacidade`, v === 1 ? undefined : v)} />
        </React.Fragment>
      ))}
      <div style={{display: 'flex', gap: 6, justifyContent: 'flex-end', padding: '2px 0'}}>
        {paradas.length > 2 && (
          <button type="button" className="bt fantasma mini" title="Tira a última cor" onClick={() => void trocar(documento, `${caminho}/paradas`, paradas.slice(0, -1), 'degradê: uma cor a menos')}>
            <Minus />cor
          </button>
        )}
        <button type="button" className="bt fantasma mini" title="Mais uma cor no fim do degradê" onClick={maisUma}><Plus />cor</button>
      </div>
    </>
  );
};

/** Botão de predefinição no título da seção (não abre nem fecha a seção). */
const Pronto: React.FC<{rotulo: string; dica: string; aoClicar: () => void}> = ({rotulo, dica, aoClicar}) => (
  <button type="button" className="redef" title={dica} onClick={aoClicar}>{rotulo}</button>
);

/** Sombra, contorno e degradê da camada. Numa foto recortada, o acabamento é o da máscara (a seção avisa). */
export const SecoesAcabamento: React.FC<{documento: string; caminho: string; c: CamadaImagem; kit: Marca; referencia?: boolean; recortada?: string}> = ({documento, caminho, c, kit, referencia = false, recortada}) => {
  const gravar: Gravar = (campo, valor, rotulo) => void trocar(documento, `${caminho}/${campo}`, valor, rotulo ?? `${campo} de ${c.id}`);
  const ver: Ver = (campo) => (valor) => definirPrevia({documento, caminho: `${caminho}/${campo}`, valor});
  if (recortada) {
    return (
      <Secao titulo="Acabamento" chave="imagem:acabamento">
        <div className="vazio" style={{padding: '4px 0'}}>A sombra e o contorno desta foto vêm da máscara ({recortada}): selecione a máscara para mudar.</div>
      </Secao>
    );
  }
  const s = c.sombra;
  const k = c.contorno;
  const d = c.degrade;
  const temDegrade = c.tipo !== 'imagem';
  return (
    <>
      <Secao titulo="Sombra" chave="imagem:sombra" aoRedefinir={s ? () => gravar('sombra', undefined, `${c.id} sem sombra`) : undefined}
        acao={<Pronto rotulo="Suave" dica="Sombra suave: preta a 35%, 24 px de desfoque, 8 px para baixo" aoClicar={() => gravar('sombra', {...SOMBRA_SUAVE}, `sombra suave em ${c.id}`)} />}>
        {!s ? <div className="vazio" style={{padding: '4px 0'}}>Sem sombra. "Suave" põe uma.</div> : (
          <>
            <CampoCor rotulo="Cor" valor={s.cor ?? SOMBRA_PADRAO.cor} aoVer={ver('sombra/cor')} aoMudar={(v) => gravar('sombra/cor', v)} />
            <CampoDeslizante rotulo="Opacidade" valor={s.opacidade ?? SOMBRA_PADRAO.opacidade} min={0} max={1} passo={0.01} formatar={pct}
              aoVer={ver('sombra/opacidade')} aoMudar={(v) => gravar('sombra/opacidade', v)} />
            <CampoNumero rotulo="Desfoque" valor={s.desfoque ?? SOMBRA_PADRAO.desfoque} unidade="px" aoMudar={(v) => (v >= 0 ? gravar('sombra/desfoque', v) : avisar('o desfoque não pode ser negativo', 'erro'))} />
            <CampoNumero rotulo="Desloca X" valor={s.x ?? SOMBRA_PADRAO.x} unidade="px" aoMudar={(v) => gravar('sombra/x', v)} dica="Para a direita (negativo: esquerda), na direção da página" />
            <CampoNumero rotulo="Desloca Y" valor={s.y ?? SOMBRA_PADRAO.y} unidade="px" aoMudar={(v) => gravar('sombra/y', v)} dica="Para baixo (negativo: para cima), na direção da página" />
          </>
        )}
      </Secao>
      <Secao titulo="Contorno" chave="imagem:contorno" aoRedefinir={k ? () => gravar('contorno', undefined, `${c.id} sem contorno`) : undefined}
        acao={<Pronto rotulo="Da marca" dica={`Contorno na cor de destaque de ${kit.nome}, por fora`} aoClicar={() => gravar('contorno', contornoDaMarca(kit, c, referencia), `contorno da marca em ${c.id}`)} />}>
        {!k ? <div className="vazio" style={{padding: '4px 0'}}>Sem contorno. "Da marca" põe um{c.tipo === 'imagem' ? ' (numa foto sem fundo, contorna a pessoa)' : ''}.</div> : (
          <>
            <CampoCor rotulo="Cor" valor={k.cor ?? CONTORNO_PADRAO.cor} aoVer={ver('contorno/cor')} aoMudar={(v) => gravar('contorno/cor', v)} />
            <CampoNumero rotulo="Espessura" valor={k.espessura} unidade="px" aoMudar={(v) => (v > 0 ? gravar('contorno/espessura', v) : avisar('a espessura precisa ser maior que zero', 'erro'))} />
            <CampoSelecao rotulo="Posição" valor={k.posicao ?? CONTORNO_PADRAO.posicao} opcoes={POSICOES_CONTORNO} aoMudar={(v) => gravar('contorno/posicao', v)} />
            {c.tipo !== 'imagem' && !ehVetorial(c) && (
              <>
                <CampoSelecao rotulo="Estilo" valor={k.estilo ?? CONTORNO_PADRAO.estilo} opcoes={ESTILOS_TRACO} aoMudar={(v) => gravar('contorno/estilo', v === 'solido' ? undefined : v)} />
                <CampoSelecao rotulo="Pontas" valor={k.pontas ?? CONTORNO_PADRAO.pontas} opcoes={PONTAS_TRACO} aoMudar={(v) => gravar('contorno/pontas', v === 'redonda' ? undefined : v)} />
                <CampoSelecao rotulo="Junção" valor={k.juncao ?? CONTORNO_PADRAO.juncao} opcoes={JUNCOES_TRACO} aoMudar={(v) => gravar('contorno/juncao', v === 'redonda' ? undefined : v)} />
              </>
            )}
          </>
        )}
      </Secao>
      {temDegrade && (
        <Secao titulo="Degradê" chave="imagem:degrade" aoRedefinir={d ? () => gravar('degrade', undefined, `${c.id} sem degradê`) : undefined}
          acao={<Pronto rotulo="Da marca" dica={`Degradê com o destaque de ${kit.nome}, no lugar da cor`} aoClicar={() => gravar('degrade', degradeDaMarca(kit, 'camada', referencia), `degradê da marca em ${c.id}`)} />}>
          {!d ? <div className="vazio" style={{padding: '4px 0'}}>Sem degradê: vale a cor {c.tipo === 'texto' ? 'do texto' : 'de preenchimento'}. "Da marca" põe um.</div>
            : <EditorDegrade documento={documento} caminho={`${caminho}/degrade`} d={d} />}
        </Secao>
      )}
    </>
  );
};

/** Degradê do fundo da prancheta (todas as páginas), por cima da cor de fundo. */
export const SecaoFundoDegrade: React.FC<{documento: string; doc: DocImagem; kit: Marca}> = ({documento, doc, kit}) => {
  const d = doc.fundo_degrade;
  return (
    <Secao titulo="Fundo em degradê" chave="imagem:fundo-degrade" aoRedefinir={d ? () => void trocar(documento, '/fundo_degrade', undefined, 'fundo sem degradê') : undefined}
      acao={<Pronto rotulo="Da marca" dica={`Fundo de ${kit.nome} esquentando para baixo com o destaque`} aoClicar={() => void trocar(documento, '/fundo_degrade', degradeDaMarca(kit, 'fundo', Boolean(doc.marca)), 'fundo em degradê da marca')} />}>
      {!d ? <div className="vazio" style={{padding: '4px 0'}}>Fundo de uma cor só. "Da marca" põe um degradê.</div>
        : <EditorDegrade documento={documento} caminho="/fundo_degrade" d={d} />}
    </Secao>
  );
};
