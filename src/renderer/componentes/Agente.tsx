// O que o Claude mudou, onde a pessoa olha (estado/agente.ts): o aviso flutuante com Ver e Desfazer, o contorno
// violeta no monitor, a lista de campos com o valor de antes no inspetor e o contador do rodapé.
import React, {useEffect, useState} from 'react';
import {Sparkles, Undo2, X} from 'lucide-react';
import {avisar, carregarDiario, dispensarMudancasAgente, loja, selecionar, useLoja, type Area} from '../estado/loja';
import {camposMudados, haQuanto, objetoDoCaminho, textoDoValor, type MudancaAgente} from '../estado/agente';

/** Redesenha a cada `ms` enquanto `ligado` (o "há 12 s"). */
export const usarAgora = (ligado: boolean, ms = 1000) => {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!ligado) return;
    const t = setInterval(() => setAgora(Date.now()), ms);
    return () => clearInterval(t);
  }, [ligado, ms]);
  return agora;
};

/** Desfaz as mudanças, da mais nova para a mais velha (o inverso de cada uma vale sobre a de depois). */
export const desfazerMudancas = async (mudancas: MudancaAgente[]) => {
  let ok = 0;
  let erro = '';
  for (const m of [...mudancas].sort((a, b) => b.seq - a.seq)) {
    const r = await window.estudio.ia.reverter(m.seq).catch((e: Error) => ({ok: false, mensagem: e.message}));
    if (r.ok) ok++;
    else erro ||= r.mensagem ?? 'não deu para desfazer';
  }
  dispensarMudancasAgente();
  void carregarDiario();
  if (erro) avisar(`Desfeitas ${ok} de ${mudancas.length}: ${erro}`, 'erro');
  else avisar(ok === 1 ? 'Mudança do Claude desfeita' : `${ok} mudanças do Claude desfeitas`, 'ok');
};

/** Leva a tela ao documento e seleciona o primeiro objeto que mudou. */
export const verMudanca = (m: MudancaAgente) => {
  const e = loja.get();
  const modulo = e.info?.manifesto.documentos.find((d) => d.id === m.documento)?.modulo;
  if (!modulo) return;
  loja.definir((s) => ({area: modulo as Area, ativo: {...s.ativo, [modulo]: m.documento}}));
  const objeto = m.caminhos.map(objetoDoCaminho).find((c) => c.split('/').length > 2);
  if (objeto) selecionar({documento: m.documento, caminho: objeto});
};

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

/** Aviso flutuante no alto da doca: "Claude mudou 2 coisas em Vídeo 9:16 · Ver · Desfazer". */
export const AvisoAgente: React.FC = () => {
  const mudancas = useLoja((e) => e.mudancasAgente);
  const agora = usarAgora(mudancas.length > 0);
  const [ocupado, setOcupado] = useState(false);
  if (!mudancas.length) return null;
  const docs = [...new Set(mudancas.map((m) => m.titulo))];
  const n = mudancas.reduce((t, m) => t + Math.max(1, new Set(m.caminhos.map(objetoDoCaminho)).size), 0);
  const ultima = mudancas[mudancas.length - 1];
  return (
    <div className="aviso-agente" role="status" aria-live="polite">
      <Sparkles className="i14" />
      <span className="texto" title={mudancas.map((m) => `#${m.seq} ${m.rotulo}`).join('\n')}>
        Claude mudou {plural(n, 'coisa', 'coisas')} {docs.length === 1 ? `em ${docs[0]}` : `em ${docs.length} documentos`}
        <span className="quando"> · {haQuanto(ultima.em, agora)}</span>
      </span>
      <button className="bt mini" onClick={() => verMudanca(ultima)}>Ver</button>
      <button className="bt mini fantasma" disabled={ocupado} onClick={() => (setOcupado(true), void desfazerMudancas(mudancas).finally(() => setOcupado(false)))}
        title="Aplica o inverso de cada mudança, da mais nova para a mais velha"><Undo2 className="i14" />Desfazer</button>
      <button className="bti" onClick={dispensarMudancasAgente} title="Manter e tirar as marcas (Esc)" aria-label="Manter e tirar as marcas"><X className="i14" /></button>
    </div>
  );
};

/** Contorno tracejado violeta e a etiqueta "Claude mudou · há 12 s" sobre cada objeto que mudou no monitor. */
export const MarcasAgente: React.FC<{caixas: {chave: string; x: number; y: number; w: number; h: number}[]}> = ({caixas}) => {
  const mudancas = useLoja((e) => e.mudancasAgente);
  const agora = usarAgora(caixas.length > 0);
  if (!caixas.length) return null;
  const em = Math.max(...mudancas.map((m) => m.em));
  return (
    <>
      {caixas.map((c) => (
        <div key={c.chave} className="caixa-agente" style={{left: c.x, top: c.y, width: c.w, height: c.h}}>
          {<span className="etiqueta-agente"><Sparkles className="i12" />Claude mudou · {haQuanto(em, agora)}</span>}
        </div>
      ))}
    </>
  );
};

/** No inspetor: os campos do objeto que o Claude mudou, com o valor de antes, e Desfazer. */
export const MudancasNoInspetor: React.FC<{documento: string | undefined; objeto: string | undefined; formatar?: (campo: string, valor: unknown) => string | undefined}> =
  ({documento, objeto, formatar}) => {
  const mudancas = useLoja((e) => e.mudancasAgente);
  const agora = usarAgora(mudancas.length > 0);
  if (!documento || !objeto) return null;
  const campos = camposMudados(mudancas, documento, objeto);
  if (!campos.length) return null;
  const doObjeto = mudancas.filter((m) => m.documento === documento && m.caminhos.some((c) => c.startsWith(`${objeto}/`) || c === objeto));
  return (
    <div className="mudou-agente" role="status">
      <div className="topo"><Sparkles className="i14" />Claude mudou {plural(campos.length, 'campo', 'campos')} · {haQuanto(Math.max(...doObjeto.map((m) => m.em)), agora)}
        <span className="esp" />
        <button className="bt mini fantasma" onClick={() => void desfazerMudancas(doObjeto)}><Undo2 className="i14" />Desfazer</button>
      </div>
      {campos.map((c) => (
        <div key={c.caminho} className="linha-mudou" title={c.caminho}>
          <span className="campo-mudou">{c.campo.replace(/\//g, ' › ')}</span>
          {c.antes && <span className="era">era {(c.antes.tinha && formatar?.(c.campo, c.antes.valor)) || textoDoValor(c.antes)}</span>}
        </div>
      ))}
    </div>
  );
};

/** No rodapé: quantas mudanças do Claude ainda estão marcadas; o clique leva ao Histórico. */
export const ContadorAgente: React.FC = () => {
  const n = useLoja((e) => e.mudancasAgente.length);
  if (!n) return null;
  return (
    <button className="contador-agente" onClick={() => window.dispatchEvent(new CustomEvent('estudio:ver-historico'))} title="Ver no Histórico">
      <span className="ponto-agente" />{plural(n, 'mudança do Claude', 'mudanças do Claude')}
    </button>
  );
};
