// Medidor de loudness (BS.1770, o que a EBU R128 e as redes usam) no inspetor do vídeo de cenas: o integrado em LUFS
// numa barra de −40 a 0 com o alvo marcado, o curto prazo (3 s) na cabeça de reprodução, que anda enquanto toca (escrito
// direto no DOM, sem passar pelo React, como a régua), o máximo dele e o pico verdadeiro em dBTP. A medida vem do
// processo principal (loudness.ts), que mixa os clipes como o render vai soar; a tela só pede de novo quando o som do
// vídeo muda (mexer num bloco de texto não mede de novo).
import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {AudioP} from '../../../nucleo/audio';
import {curtoPrazoEm, type MedidaLoudness, type MedidasLoudness} from '../../../nucleo/loudness';
import {loja, mensagemDe, useLoja} from '../../estado/loja';
import {aoQuadro, msAtual} from './tocador';

const ESCALA_MIN = -40;
const ESCALA_MAX = 0;
const pos = (lufs: number) => `${Math.max(0, Math.min(100, ((lufs - ESCALA_MIN) / (ESCALA_MAX - ESCALA_MIN)) * 100))}%`;
export const lufsTexto = (v: number | null | undefined, casas = 1) => (v === null || v === undefined || v <= -70 ? '—' : v.toFixed(casas).replace('.', ',').replace('-', '−'));

type Estado = {r?: MedidasLoudness; erro?: string; medindo: boolean};
const medidas = new Map<string, {chave: string; r?: MedidasLoudness; erro?: string}>(); // a última de cada vídeo, entre trocas de seleção
const pendentes = new Map<string, {chave: string; p: Promise<void>}>();

/** Medidas do som do vídeo; mede de novo (400 ms depois da última mudança) quando o som muda. */
export const useMedidasLoudness = (documento: string): Estado => {
  const montado = useLoja((e) => e.props[documento]);
  const props = montado && 'props' in montado ? (montado.props as {audio?: AudioP; duracao_ms: number; fps?: number}) : null;
  // a chave é o som que toca (sem os envelopes, que só servem à forma de onda): mudou, mede de novo
  const chave = useMemo(() => (props?.audio ? JSON.stringify([props.audio, props.duracao_ms, props.fps], (k, v) => (k === 'envelope' ? undefined : v)) : ''), [props]);
  const guardada = medidas.get(documento);
  const [estado, setEstado] = useState<Estado>(() => ({r: guardada?.r, erro: guardada?.erro, medindo: guardada?.chave !== chave}));
  useEffect(() => {
    if (!chave) return;
    const atual = medidas.get(documento);
    if (atual?.chave === chave) return setEstado({r: atual.r, erro: atual.erro, medindo: false});
    let vivo = true;
    setEstado((s) => ({...s, medindo: true}));
    const t = setTimeout(() => {
      let pend = pendentes.get(documento);
      if (pend?.chave !== chave) {
        const p = window.estudio.audio.medirLoudness(documento).then((r) => {
          // uma mais nova passou na frente: fica com o que vier dela
          if ('erro' in r && /substitu/.test(r.erro)) return;
          medidas.set(documento, 'erro' in r ? {chave, erro: r.erro} : {chave, r});
        }, (e) => void medidas.set(documento, {chave, erro: mensagemDe(e)}));
        pend = {chave, p};
        pendentes.set(documento, pend);
      }
      void pend.p.then(() => {
        if (pendentes.get(documento) === pend) pendentes.delete(documento);
        const m = medidas.get(documento);
        if (vivo && m?.chave === chave) setEstado({r: m.r, erro: m.erro, medindo: false});
      });
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [documento, chave]);
  return estado;
};

/** Um medidor: título, integrado (e quanto falta para o alvo), barra, curto prazo na cabeça e o pico verdadeiro. Sem
 *  `alvo` (música, efeitos), a barra não marca alvo; `nota` toma o lugar do "abaixo do alvo". */
export const MedidorLoudness: React.FC<{titulo: string; m: MedidaLoudness | null | undefined; alvo: number | null; pico: number; medindo?: boolean; nota?: React.ReactNode}> =
  ({titulo, m, alvo, pico, medindo, nota}) => {
    const marca = useRef<HTMLSpanElement>(null);
    const texto = useRef<HTMLSpanElement>(null);
    // o curto prazo segue a cabeça de reprodução sem render do React
    useEffect(() => {
      if (!m) return;
      const mostrar = (ms: number) => {
        const v = curtoPrazoEm(m, ms);
        if (texto.current) texto.current.textContent = lufsTexto(v);
        if (marca.current) {
          marca.current.style.left = v === null || v <= -70 ? '0%' : pos(v);
          marca.current.style.opacity = v === null || v <= -70 ? '0' : '1';
        }
      };
      mostrar(msAtual());
      const sair = aoQuadro(mostrar);
      const sairLoja = loja.assinar(() => mostrar(msAtual())); // parado: a cabeça muda pela loja (clique na régua)
      return () => {
        sair();
        sairLoja();
      };
    }, [m]);
    const i = m?.integrado_lufs ?? null;
    const dif = i === null || alvo === null ? null : Math.round((i - alvo) * 10) / 10;
    const noAlvo = dif !== null && Math.abs(dif) <= 1;
    const picoAlto = m?.pico_dbtp !== null && m?.pico_dbtp !== undefined && m.pico_dbtp > pico;
    return (
      <div className={`medidor${medindo ? ' medindo' : ''}`}>
        <div className="topo">
          <span className="titulo">{titulo}</span>
          <span className={`integrado${noAlvo ? ' ok' : ''}`} title="Loudness integrado (BS.1770): o número que as redes leem">
            <b>{lufsTexto(i)}</b> LUFS
          </span>
        </div>
        <div className="escala" title={`De ${ESCALA_MIN} a ${ESCALA_MAX} LUFS${alvo !== null ? `; a marca é o alvo (${alvo} LUFS)` : ''} e o traço claro, o curto prazo na cabeça`}>
          {i !== null && <span className="cheia" style={{width: pos(i)}} />}
          {alvo !== null && <span className="alvo" style={{left: pos(alvo)}} />}
          <span className="curto" ref={marca} />
        </div>
        <div className="linhas">
          <span>curto prazo <b ref={texto}>—</b> (máx. {lufsTexto(m?.curto_max_lufs)})</span>
          {m?.pico_dbtp !== null && m?.pico_dbtp !== undefined && (
            <span className={picoAlto ? 'alto' : undefined} title="Pico verdadeiro (sobreamostragem 4×)">pico {lufsTexto(m.pico_dbtp)} dBTP</span>
          )}
        </div>
        {m && i === null && <div className="nota">só silêncio</div>}
        {!m && <div className="nota">{medindo ? 'medindo…' : 'sem medida'}</div>}
        {nota ? <div className="nota">{nota}</div>
          : m && dif !== null && !noAlvo && <div className="nota">{Math.abs(dif).toFixed(1).replace('.', ',')} LU {dif < 0 ? 'abaixo' : 'acima'} do alvo</div>}
      </div>
    );
  };
