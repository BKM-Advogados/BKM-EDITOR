// Histórico: o diário de mudanças do projeto, agrupado por rodada (a mesma conversa do Claude, ou a mesma sessão de
// edição da pessoa), com um resumo em português, o antes → depois de cada campo, Ver e Desfazer o grupo. É o mesmo
// diário que o agente lê com listar_mudancas. Ctrl+Z desfaz só as edições da própria pessoa; Reverter desfaz qualquer
// uma (de qualquer autor e de qualquer provedor) e, se o valor mudou depois, pergunta antes de passar por cima.
import React, {useMemo, useState} from 'react';
import {ChevronDown, ChevronRight, Eye, Sparkles, Undo2, User} from 'lucide-react';
import type {ResumoDiario} from '../../nucleo/documentos';
import {avisar, carregarDiario, desfazer, loja, selecionar, useLoja, type Area} from '../estado/loja';
import {agruparDiario, diferencasDa, objetoDoCaminho, resumoDoGrupo, textoDoValor, type GrupoHistorico} from '../estado/agente';
import {confirmar} from '../componentes/Dialogo';

const reverterEntrada = async (seq: number, rotulo: string) => {
  let r = await window.estudio.ia.reverter(seq);
  if (!r.ok && r.mudou_depois && await confirmar({titulo: `Reverter "${rotulo}" mesmo assim?`, texto: `${r.mensagem}. Reverter agora passa por cima do que veio depois nesse ponto.`, botao: 'Reverter', perigo: true})) {
    r = await window.estudio.ia.reverter(seq, true);
  }
  if (!r.ok && !r.mudou_depois) avisar(r.mensagem, 'erro');
  return r.ok;
};

const hora = (em: string) => new Date(em).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});

/** Leva a tela ao documento e ao objeto da entrada. */
const ver = (e: ResumoDiario) => {
  const d = loja.get().info?.manifesto.documentos.find((x) => x.caminho === e.documento || x.id === e.documento);
  if (!d) return;
  loja.definir((s) => ({area: d.modulo as Area, ativo: {...s.ativo, [d.modulo]: d.id}}));
  const op = e.patch.find((o) => o.op !== 'test');
  const objeto = op ? objetoDoCaminho(op.path) : undefined;
  if (objeto && objeto.split('/').length > 2) selecionar({documento: d.id, caminho: objeto});
};

const Grupo: React.FC<{g: GrupoHistorico; revertidas: Set<number>}> = ({g, revertidas}) => {
  const [aberto, setAberto] = useState(g.autor === 'agente');
  const [ocupado, setOcupado] = useState(false);
  const agente = g.autor === 'agente';
  const reversiveis = g.entradas.filter((e) => e.desfaz === undefined && !revertidas.has(e.seq) && e.inverso?.length > 0);
  const desfazerGrupo = async () => {
    setOcupado(true);
    let n = 0;
    for (const e of reversiveis) if (await reverterEntrada(e.seq, e.rotulo)) n++; // já vem da mais nova para a mais velha
    setOcupado(false);
    if (n) avisar(n === 1 ? 'Mudança desfeita' : `${n} mudanças desfeitas`, 'ok');
    void carregarDiario();
  };
  return (
    <li className={`grupo-hist${agente ? ' agente' : ''}`}>
      <div className="grupo-topo" role="button" tabIndex={0} aria-expanded={aberto} onClick={() => setAberto((a) => !a)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setAberto((a) => !a))}>
        {aberto ? <ChevronDown className="i12" /> : <ChevronRight className="i12" />}
        <span className={`etiqueta ${g.autor}`}>{agente ? <Sparkles /> : <User />}{agente ? g.origem || 'Claude' : g.autor === 'pessoa' ? 'Você' : g.autor}</span>
        <span className="resumo-grupo">{resumoDoGrupo(g)}</span>
        <span className="hora">{hora(g.fim)}</span>
      </div>
      {aberto && (
        <>
          <ul className="entradas-hist">
            {g.entradas.map((e) => {
              const revertida = revertidas.has(e.seq);
              const difs = diferencasDa(e).slice(0, 6);
              return (
                <li key={e.seq} className={revertida ? 'revertida' : ''}>
                  <div className="entrada-topo">
                    <span className="rotulo-entrada">{e.desfaz !== undefined ? <Undo2 className="i12" /> : null}{e.rotulo}</span>
                    {revertida && <span className="etiqueta sistema">desfeita</span>}
                    <button className="bti" title="Ver no documento" aria-label="Ver no documento" onClick={() => ver(e)}><Eye className="i14" /></button>
                  </div>
                  {difs.length > 0 && (
                    <div className="difs">
                      {difs.map((d) => (
                        <span key={d.caminho} className="dif" title={d.caminho}>
                          {d.campo}{' '}
                          {d.antes && <s>{textoDoValor(d.antes)}</s>}{d.antes && ' → '}<ins>{textoDoValor(d.depois)}</ins>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {reversiveis.length > 0 && (
            <div className="grupo-acoes">
              <button className="bt mini" disabled={ocupado} onClick={() => void desfazerGrupo()}
                title="Aplica o inverso de cada mudança do grupo, da mais nova para a mais velha"><Undo2 className="i14" />{reversiveis.length === 1 ? 'Desfazer' : `Desfazer as ${reversiveis.length}`}</button>
            </div>
          )}
        </>
      )}
    </li>
  );
};

export const Historico: React.FC = () => {
  const diario = useLoja((e) => e.diario);
  const docs = useLoja((e) => e.info?.manifesto.documentos ?? []);
  const grupos = useMemo(() => agruparDiario(diario, docs), [diario, docs]);
  const revertidas = useMemo(() => new Set(diario.filter((e) => e.desfaz !== undefined).map((e) => e.desfaz!)), [diario]);
  return (
    <div className="painel historico">
      <div className="painel-topo">
        <span className="rotulo" title="Ctrl+Z desfaz só as suas edições. Desfazer, aqui, vale para qualquer mudança, inclusive as do Claude.">
          Ctrl+Z desfaz só as suas edições; aqui, qualquer uma.
        </span>
        <span className="esp" />
        <button className="bt mini" onClick={() => void desfazer()} title="Desfaz a sua última edição (Ctrl+Z)"><Undo2 className="i14" />Ctrl+Z</button>
      </div>
      <div className="painel-corpo sem-margem">
        {grupos.length === 0 && <div className="vazio">Nenhuma mudança ainda.</div>}
        <ul className="lista-hist">
          {grupos.map((g) => <Grupo key={g.chave} g={g} revertidas={revertidas} />)}
        </ul>
      </div>
    </div>
  );
};
