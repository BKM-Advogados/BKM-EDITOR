// Gravar a narração com teleprompter e monitoramento (rodada 3, frente Som): o texto rola na velocidade pedida com a palavra
// da vez em destaque, o medidor mostra o pico e avisa do corte, e a pessoa pode ouvir a própria voz nos fones. Ao parar, a
// tomada vira midia/narracao-gravada.wav (PCM 24 bits, 48 kHz, sem processamento do navegador) e entra na faixa de narração,
// já medida (adicionarClipeAudio mede o envelope). O texto fica no documento (`teleprompter`), onde a IA também o escreve.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Mic, Square, X} from 'lucide-react';
import type {DocCenas} from '../../../nucleo/cenas';
import {palavrasDoTeleprompter, palavraEm, PICO_CORTADO_DB, PPM_MAX, PPM_MIN, teleprompterDe, temposDoTeleprompter, textoDasCenas} from '../../../nucleo/gravacao';
import {avisar, mensagemDe, trocar, useLoja} from '../../estado/loja';
import {usarFora} from '../../componentes/Menu';
import {adicionarClipeAudio} from './acoes-audio';
import {iniciarGravacao, listarMicrofones, type NivelGravacao, type SessaoGravacao} from './gravador';
import {Caixa, Escolha} from '../../componentes/Controles';

const CONTAGEM = 3;
const dbTexto = (v: number) => (v <= -99 ? '−∞' : `${v.toFixed(0).replace('-', '−')} dB`);
const tempo = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

export const GravadorNarracao: React.FC<{documento: string; aoFechar: () => void}> = ({documento, aoFechar}) => {
  const doc = useLoja((e) => e.docs[documento]?.doc) as DocCenas | undefined;
  const salvo = teleprompterDe(doc?.teleprompter);
  const [texto, setTexto] = useState(salvo?.texto ?? '');
  const [ppm, setPpm] = useState(salvo?.palavras_por_minuto ?? 150);
  const [espelhar, setEspelhar] = useState(salvo?.espelhar ?? false);
  const [microfones, setMicrofones] = useState<{id: string; nome: string}[]>([]);
  const [dispositivo, setDispositivo] = useState('');
  const [monitor, setMonitor] = useState(false);
  const [estado, setEstado] = useState<'parado' | 'contagem' | 'gravando' | 'salvando'>('parado');
  const [contagem, setContagem] = useState(CONTAGEM);
  const [nivel, setNivel] = useState<NivelGravacao>({pico_db: -100, rms_db: -100, cortou: false});
  const [decorrido, setDecorrido] = useState(0);
  const sessao = useRef<SessaoGravacao | null>(null);
  const caixa = usarFora(estado === 'parado', aoFechar);
  const atual = useRef<HTMLSpanElement | null>(null);

  const palavras = useMemo(() => palavrasDoTeleprompter(texto), [texto]);
  const tempos = useMemo(() => temposDoTeleprompter(texto, ppm), [texto, ppm]);
  const vez = estado === 'gravando' ? palavraEm(tempos, decorrido) : -1;

  useEffect(() => {
    listarMicrofones().then(setMicrofones).catch(() => undefined); // sem permissão ainda, a lista vem sem nomes
  }, []);
  useEffect(() => {
    if (estado === 'gravando') atual.current?.scrollIntoView({block: 'center', behavior: 'smooth'});
  }, [vez, estado]);
  useEffect(() => {
    if (estado !== 'gravando') return;
    const id = window.setInterval(() => setDecorrido(sessao.current?.decorrido() ?? 0), 80);
    return () => window.clearInterval(id);
  }, [estado]);
  useEffect(() => () => sessao.current?.cancelar(), []);
  useEffect(() => sessao.current?.monitor(monitor), [monitor]);

  const guardarTexto = () => {
    const novo = {texto, palavras_por_minuto: ppm, ...(espelhar ? {espelhar: true} : {})};
    const antes = salvo && {texto: salvo.texto, palavras_por_minuto: salvo.palavras_por_minuto, ...(salvo.espelhar ? {espelhar: true} : {})};
    if (!texto.trim() || JSON.stringify(novo) === JSON.stringify(antes)) return;
    void trocar(documento, '/teleprompter', novo, 'texto do teleprompter');
  };

  const gravar = async () => {
    try {
      guardarTexto();
      setEstado('contagem');
      for (let n = CONTAGEM; n > 0; n--) {
        setContagem(n);
        await new Promise((ok) => setTimeout(ok, 1000));
      }
      sessao.current = await iniciarGravacao({dispositivo: dispositivo || undefined, monitor, aoNivel: setNivel});
      listarMicrofones().then(setMicrofones).catch(() => undefined); // agora com os nomes
      setDecorrido(0);
      setEstado('gravando');
    } catch (e) {
      setEstado('parado');
      avisar(`Não deu para abrir o microfone: ${mensagemDe(e)}. ${/Windows/.test(navigator.userAgent) ? 'Confira em Configurações do Windows › Privacidade › Microfone.' : 'Confira o microfone nas configurações de som do sistema (PipeWire ou PulseAudio).'}`, 'erro');
    }
  };
  const parar = async () => {
    const s = sessao.current;
    if (!s) return;
    setEstado('salvando');
    try {
      const t = await s.parar();
      sessao.current = null;
      const arquivo = await window.estudio.audio.salvarTomada(t.wav.buffer.slice(t.wav.byteOffset, t.wav.byteOffset + t.wav.byteLength) as ArrayBuffer);
      await adicionarClipeAudio(documento, 'voz', arquivo);
      if (t.cortou) avisar(`A tomada passou de ${PICO_CORTADO_DB} dB e pode ter cortado; confira a forma de onda ou grave de novo mais longe do microfone.`, 'info');
      aoFechar();
    } catch (e) {
      setEstado('parado');
      avisar(mensagemDe(e), 'erro');
    }
  };
  const cancelar = () => {
    sessao.current?.cancelar();
    sessao.current = null;
    setEstado('parado');
    setDecorrido(0);
  };

  return (
    <div ref={caixa} className="flutuante gravador" role="dialog" aria-label="Gravar narração">
      <div className="topo">
        <Mic className="i14" />
        <strong>Gravar narração</strong>
        <span className="espaco" />
        {estado === 'gravando' && <span className="ler" style={{color: 'var(--erro)'}}>● {tempo(decorrido)}</span>}
        {estado === 'parado' && <button aria-label="Fechar" className="bti" title="Fechar" onClick={aoFechar}><X /></button>}
      </div>
      <div className={`prompter${espelhar ? ' espelho' : ''}`} style={{fontSize: `${Math.round((salvo?.tamanho ?? 0.045) * 700)}px`}}>
        {estado === 'contagem' && <div className="contagem">{contagem}</div>}
        {estado === 'parado' ? (
          <textarea className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={guardarTexto}
            placeholder="Cole ou escreva o texto da narração. Deixe uma linha em branco entre os parágrafos." rows={8} />
        ) : (
          <p>{palavras.map((p, i) => (
            <span key={i} ref={i === vez ? atual : undefined} className={i < vez ? 'lida' : i === vez ? 'vez' : ''}>{p} </span>
          ))}</p>
        )}
      </div>
      {estado === 'parado' && (
        <div className="linha-gravador">
          <button className="bt fantasma mini" onClick={() => doc && setTexto(textoDasCenas(doc))} title="Usa os títulos, textos e listas das cenas">Texto das cenas</button>
          <label className="meta">Velocidade <input className="campo" type="number" min={PPM_MIN} max={PPM_MAX} step={10} value={ppm}
            onChange={(e) => setPpm(Number(e.target.value) || 150)} style={{width: 56}} /> palavras/min</label>
          <Caixa marcado={espelhar} aoMudar={setEspelhar} className="meta">Espelhar</Caixa>
        </div>
      )}
      <div className="linha-gravador">
        <span style={{flex: 1, minWidth: 0, display: 'flex'}}>
          <Escolha valor={dispositivo} rotulo="Microfone" desligado={estado !== 'parado'} aoMudar={setDispositivo}
            opcoes={[['', 'Microfone padrão'] as [string, string], ...microfones.map((m): [string, string] => [m.id, m.nome])]} />
        </span>
        <Caixa marcado={monitor} aoMudar={setMonitor} className="meta" dica="Ouça a própria voz nos fones. Sem fones, o microfone pega o som do alto-falante.">Ouvir a mim mesmo (fones)</Caixa>
      </div>
      <div className="linha-gravador">
        <div className={`nivel${nivel.cortou ? ' cortou' : ''}`} title={`Pico ${dbTexto(nivel.pico_db)} · voz ${dbTexto(nivel.rms_db)}`}>
          <span style={{width: `${Math.max(0, Math.min(100, ((nivel.pico_db + 60) / 60) * 100))}%`}} />
        </div>
        <span className="meta">{dbTexto(nivel.pico_db)}</span>
        <span className="espaco" />
        {estado === 'parado' && <button className="bt" onClick={() => void gravar()}><Mic size={14} />Gravar</button>}
        {estado === 'contagem' && <button className="bt" onClick={cancelar}><X size={14} />Cancelar</button>}
        {estado === 'gravando' && <><button className="bt fantasma" onClick={cancelar}><X size={14} />Descartar</button><button className="bt" onClick={() => void parar()}><Square size={14} />Parar</button></>}
        {estado === 'salvando' && <span className="meta">salvando e medindo…</span>}
      </div>
      <div className="vazio">Sem cancelamento de eco, supressão de ruído nem ganho automático: o que o microfone ouve é o que fica gravado (WAV de 24 bits, 48 kHz). A limpeza de voz vem depois, se quiser.</div>
    </div>
  );
};
