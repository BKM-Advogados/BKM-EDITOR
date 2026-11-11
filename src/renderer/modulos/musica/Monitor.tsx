// Monitor da Música: o transporte (tocar, parar, posição em compasso e em tempo, BPM, loop, metrônomo, voz guia e
// "Ouvir como no vídeo") e, embaixo, o sequenciador de passos do padrão em foco ou o mixer. Aqui também o motor fica em
// dia com o documento: cada mudança refaz o som (só o que mudou) e a cabeça anda enquanto toca.
import React, {useEffect, useMemo, useState} from 'react';
import {Mic, Pause, Play, Repeat, Square, Timer, Tv, Clapperboard, Download} from 'lucide-react';
import {BotaoMenu} from '../../componentes/Menu';
import {resolverMusica, NOME_PECA, PECAS, posicaoEmCompasso, type DocMusica, type PecaBateria} from '../../../nucleo/musica';
import {PianoRoll} from './PianoRoll';
import {VideoNaMusica} from './VideoNaMusica';
import {ESTILOS} from '../../../nucleo/musica-estilos';
import type {DocCenas} from '../../../nucleo/cenas';
import type {PropsVideo} from '../../../compartilhado/api';
import type {AudioP} from '../../../nucleo/audio';
import {criarDocumento, useLoja} from '../../estado/loja';
import {MODELOS_MUSICA} from '../../../nucleo/musica-modelos';
import {numeroBr} from '../../componentes/Campos';
import {docMusica, musica, selecionarMusica, transicaoAberta, useMusica} from './estado';
import {motor, vozGuiaDe} from './motor';
import {campo, campoFaixa, estilo, exportarMusica, forcaDaNota, novaBateria, novoPadrao, passo, novaMusicaDoModelo} from './acoes';
import {Escolha} from '../../componentes/Controles';

export const useDocMusica = () => {
  const id = useLoja((e) => e.ativo.musica);
  const lido = useLoja((e) => (id ? e.docs[id] : undefined));
  return {id, doc: lido?.doc as DocMusica | undefined, versao: lido?.versao};
};

const tempoTexto = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};

/** O clipe do vídeo ligado a esta música (para "Ouvir como no vídeo"); durante a transição, antes de concluir, o clipe
 *  de origem do áudio (a música ainda não está ligada a ele). */
const clipeLigado = (id: string, doc: DocMusica | undefined, video: DocCenas | undefined, props: PropsVideo | undefined) => {
  if (!video?.audio || !props || !('props' in props)) return null;
  const audio = (props.props as {audio?: AudioP}).audio;
  const por = (fi: number, ci: number) => {
    const fp = audio?.faixas.find((x) => x.origem === `/audio/faixas/${fi}`);
    const cp = fp?.clipes.find((x) => x.origem === `/audio/faixas/${fi}/clipes/${ci}`);
    return fp && cp ? {f: fp, c: cp} : null;
  };
  for (const [fi, f] of video.audio.faixas.entries()) {
    const ci = (f.clipes ?? []).findIndex((c) => c.musica === id);
    if (ci >= 0) return por(fi, ci);
  }
  // o clipe de origem (o áudio do vídeo que abriu esta música), que ainda não tem `musica`
  const origem = doc?.arranjo.clipes.map((c) => c.origem).find((o) => o?.documento === doc?.video?.documento && o?.clipe);
  if (origem) {
    for (const [fi, f] of video.audio.faixas.entries()) {
      const ci = (f.clipes ?? []).findIndex((c) => c.id === origem.clipe);
      if (ci >= 0) return por(fi, ci);
    }
  }
  return null;
};

/** Mantém o motor em dia e anda a cabeça; montado uma vez no monitor. */
const useMotorVivo = (id: string | undefined, doc: DocMusica | undefined) => {
  const videoId = doc?.video?.documento;
  const video = useLoja((e) => (videoId ? (e.docs[videoId]?.doc as DocCenas | undefined) : undefined));
  const props = useLoja((e) => (videoId ? e.props[videoId] : undefined));
  const comoNoVideo = useMusica((e) => e.comoNoVideo);
  const metronomo = useMusica((e) => e.metronomo);
  const [, mudou] = React.useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      void motor.preparar(doc).then(async (novo) => {
        const audio = props && 'props' in props ? (props.props as {audio?: AudioP}).audio : undefined;
        await motor.prepararGuia(doc.video?.voz_guia === false ? null : vozGuiaDe(audio, doc.video?.em_ms ?? 0));
        motor.prepararMetronomo(doc);
        motor.definirCurva(comoNoVideo && id ? clipeLigado(id, doc, video, props) : null);
        musica.definir({avisos: motor.avisos});
        if (novo) mudou();
      });
    }, 120);
    return () => clearTimeout(t);
  }, [doc, props, video, comoNoVideo, id]);

  useEffect(() => {
    if (doc) motor.prepararMetronomo(doc);
  }, [metronomo, doc]);

  // a cabeça anda enquanto toca
  useEffect(() => {
    let quadro = 0;
    const andar = () => {
      if (motor.estaTocando()) musica.definir({cabeca_s: motor.posicao()});
      else if (musica.get().tocando) musica.definir({tocando: false});
      quadro = requestAnimationFrame(andar);
    };
    quadro = requestAnimationFrame(andar);
    return () => cancelAnimationFrame(quadro);
  }, []);

  useEffect(() => () => motor.parar(), [id]);
};

export const tocarOuPausar = () => {
  const e = musica.get();
  if (motor.estaTocando()) {
    motor.parar();
    musica.definir({tocando: false});
    return;
  }
  const doc = docMusica();
  if (!doc) return;
  const m = resolverMusica(doc).musica;
  const loop: [number, number] | null = e.loop
    ? [((e.loopDe ?? 0) * m.seg_por_batida), (e.loopAte ?? m.duracao_batidas) * m.seg_por_batida]
    : null;
  const de = loop && (e.cabeca_s < loop[0] || e.cabeca_s >= loop[1]) ? loop[0] : e.cabeca_s >= m.duracao_s - 0.01 ? 0 : e.cabeca_s;
  motor.tocar(de, {loop, guia: doc.video?.voz_guia !== false, metronomo: e.metronomo});
  musica.definir({tocando: true});
};

export const parar = () => {
  motor.parar();
  const e = musica.get();
  musica.definir({tocando: false, cabeca_s: e.loop && e.loopDe !== undefined ? e.loopDe * (60 / (docMusica()?.bpm ?? 120)) : 0});
};

const Transporte: React.FC<{doc: DocMusica}> = ({doc}) => {
  const tocando = useMusica((e) => e.tocando);
  const cabeca = useMusica((e) => e.cabeca_s);
  const loop = useMusica((e) => e.loop);
  const metronomo = useMusica((e) => e.metronomo);
  const comoNoVideo = useMusica((e) => e.comoNoVideo);
  const verVideo = useMusica((e) => e.verVideo);
  const renderizando = useMusica((e) => e.renderizando);
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const [bpm, setBpm] = useState(String(doc.bpm));
  useEffect(() => setBpm(String(doc.bpm)), [doc.bpm]);
  const batida = cabeca / m.seg_por_batida;
  const ligado = Boolean(doc.video);
  return (
    <div className="musica-transporte">
      <button className="bti" title={tocando ? 'Pausar (Espaço)' : 'Tocar (Espaço)'} onClick={tocarOuPausar}>{tocando ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className="bti" title="Parar e voltar ao começo" onClick={parar}><Square size={14} /></button>
      <span className="pos" title={`Compasso.tempo · minutos:segundos${motor.ultimoRender_ms ? ` (o som foi refeito em ${motor.ultimoRender_ms} ms na última mudança)` : ''}`}>{posicaoEmCompasso(batida, m.compasso).split('+')[0]}<small>{tempoTexto(cabeca)} / {tempoTexto(m.duracao_s)}</small></span>
      <span className="sep" />
      <label title="Batidas por minuto">BPM <input className="campo bpm" value={bpm} onChange={(e) => setBpm(e.target.value)}
        onBlur={() => {
          const n = Number(bpm.replace(',', '.'));
          if (Number.isFinite(n) && n !== doc.bpm) void campo('/bpm', Math.min(300, Math.max(20, Math.round(n * 10) / 10)), `BPM ${n}`);
          else setBpm(String(doc.bpm));
        }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
      <span className="ler">{m.compasso[0]}/{m.compasso[1]}</span>
      <span className="sep" />
      <button className={`bti${loop ? ' ligado' : ''}`} title="Repetir (L): o trecho do clipe selecionado, ou a música inteira" onClick={() => alternarLoop()}><Repeat size={15} /></button>
      <button className={`bti${metronomo ? ' ligado' : ''}`} title="Metrônomo" onClick={() => {
        musica.definir({metronomo: !metronomo});
        if (motor.estaTocando()) (motor.parar(), tocarOuPausar());
      }}><Timer size={15} /></button>
      {ligado && (
        <>
          <button className={`bti${doc.video?.voz_guia !== false ? ' ligado' : ''}`} title="Voz do vídeo como guia (não entra na música)"
            onClick={() => void campo('/video/voz_guia', doc.video?.voz_guia === false ? true : false, 'voz guia')}><Mic size={15} /></button>
          <button className={`bti${comoNoVideo ? ' ligado' : ''}`} title="Ouvir como no vídeo: volume, fades e ducking do clipe ligado"
            onClick={() => musica.definir({comoNoVideo: !comoNoVideo})}><Tv size={15} /></button>
          <button className={`bti${verVideo ? ' ligado' : ''}`} title="Ver o vídeo na posição da cabeça (sem som)" onClick={() => musica.definir({verVideo: !verVideo})}>
            <Clapperboard size={15} /></button>
        </>
      )}
      <span className="estado" title="Quanto o som levou para ser refeito depois da última mudança">{renderizando ? 'atualizando a trilha no vídeo…' : ''}</span>
      <BotaoMenu titulo="Exportar a música em arquivo (pasta saidas do projeto)" icone={<Download size={14} />} rotulo="Exportar" className="bt" lado="direita"
        itens={[
          {rotulo: 'WAV (24 bits)', acao: () => void exportarMusica({formato: 'wav'})},
          {rotulo: 'WAV e um WAV por faixa (stems)', acao: () => void exportarMusica({formato: 'wav', stems: true})},
          {rotulo: 'M4A (AAC)', acao: () => void exportarMusica({formato: 'm4a'})},
          {rotulo: 'Opus', acao: () => void exportarMusica({formato: 'opus'})},
          'sep',
          {rotulo: 'MIDI (só as notas)', acao: () => void exportarMusica({formato: 'mid'})},
        ]} />
    </div>
  );
};

/** L: repete o clipe selecionado (ou a música inteira); de novo, desliga. */
export const alternarLoop = () => {
  const e = musica.get();
  const doc = docMusica();
  if (e.loop) return musica.definir({loop: false, loopDe: undefined, loopAte: undefined});
  const c = e.selecao?.tipo === 'clipe' && doc ? doc.arranjo.clipes.find((x) => x.id === e.selecao!.id) : undefined;
  musica.definir({loop: true, loopDe: c?.em, loopAte: c ? c.em + c.dur : undefined});
  if (motor.estaTocando()) (motor.parar(), tocarOuPausar());
};

// ---------- sequenciador de passos ----------
const padraoEmFoco = (doc: DocMusica, s: ReturnType<typeof musica.get>['selecao']) => {
  if (s?.tipo === 'padrao') return doc.padroes.find((p) => p.id === s.id);
  if (s?.tipo === 'clipe') {
    const c = doc.arranjo.clipes.find((x) => x.id === s.id);
    if (c?.padrao) return doc.padroes.find((p) => p.id === c.padrao);
  }
  if (s?.tipo === 'canal') return doc.padroes.find((p) => p.canal === s.id);
  return doc.padroes[0];
};

const Passos: React.FC<{doc: DocMusica}> = ({doc}) => {
  const selecao = useMusica((e) => e.selecao);
  const cabeca = useMusica((e) => e.cabeca_s);
  const tocando = useMusica((e) => e.tocando);
  const p = padraoEmFoco(doc, selecao);
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  if (!p) {
    return (
      <div className="musica-vazio">
        <div>Nenhum padrão ainda.</div>
        <button className="bt principal" onClick={() => void novaBateria()}>+ Bateria com o estilo básico</button>
      </div>
    );
  }
  const pp = m.padroes[p.id];
  const passos = pp.passos;
  const passoBat = pp.dur / passos;
  const canal = doc.canais.find((c) => c.id === p.canal);
  // a nota que toca agora, no clipe deste padrão que estiver sob a cabeça
  let agora = -1;
  if (tocando) {
    const b = cabeca / m.seg_por_batida;
    const c = m.clipes.find((x) => x.padrao === p.id && b >= x.em && b < x.em + x.dur);
    if (c) agora = Math.floor((((b - c.em + c.inicio) % pp.dur) + 1e-9) / passoBat);
  }
  const notaEm = (peca: PecaBateria, k: number) => p.notas.find((n) => n.peca === peca && Math.abs(n.em - k * passoBat) < 1e-6);
  const pecas = PECAS;
  const doCanal = doc.padroes.filter((x) => x.canal === p.canal);
  if (canal?.tipo === 'sintetizador') {
    const b = cabeca / m.seg_por_batida;
    const c = tocando ? m.clipes.find((x) => x.padrao === p.id && b >= x.em && b < x.em + x.dur) : undefined;
    return <PianoRoll doc={doc} padrao={p.id} agora_bat={c ? (b - c.em + c.inicio) % pp.dur : null} />;
  }
  return (
    <div>
      <div className="passos-topo">
        <span className="escolha-curta"><Escolha valor={p.id} rotulo="Padrão do canal" aoMudar={(id) => selecionarMusica({tipo: 'padrao', id})}
          opcoes={doCanal.map((x): [string, string] => [x.id, x.nome ?? x.id])} /></span>
        <span className="escolha-curta"><Escolha valor={undefined as string | undefined} rotulo="Troca as notas pelas de um estilo da casa" vazio="Estilo…" aoMudar={(id) => void estilo(p.id, id)}
          opcoes={ESTILOS.map((e): [string, string] => [e.id, `${e.nome} (~${e.bpm} BPM)`])} /></span>
        <button className="bt" onClick={() => void novoPadrao(p.canal)}>+ Padrão</button>
        <button className="bt" onClick={() => void novoPadrao(p.canal, {clonar: p.id})}>Clonar</button>
        <button className="bt" title="Cópia com mudanças pequenas: tira e põe notas fracas, muda as forças (bumbo e caixa nos tempos ficam)"
          onClick={() => void novoPadrao(p.canal, {variar: p.id})}>Variação</button>
        <label title="Atrasa as semicolcheias do contratempo (0 = reto, 100 = tercina)">Swing
          <input type="range" min={0} max={100} step={5} defaultValue={Math.round((doc.swing ?? 0) * 100)} key={doc.swing}
            onPointerUp={(e) => void campo('/swing', Number((e.target as HTMLInputElement).value) / 100, 'swing')} /> {Math.round((doc.swing ?? 0) * 100)}%</label>
      </div>
      <div className="passos" style={{gridTemplateColumns: `110px repeat(${passos}, minmax(14px, 1fr))`}}>
        {pecas.map((peca) => (
          <React.Fragment key={peca}>
            <span className="peca" title="Tocar a peça" onClick={() => motor.tocarBatida(peca, canal?.pecas?.[peca], 100, doc.semente)}>{NOME_PECA[peca]}</span>
            {Array.from({length: passos}, (_, k) => {
              const n = notaEm(peca, k);
              const forca = n?.forca ?? 100;
              return (
                <button key={k} className={`passo${n ? ' on' : ''}${(k * passoBat) % 1 < 1e-6 ? ' tempo' : ''}${agora === k ? ' agora' : ''}`}
                  title={`${NOME_PECA[peca]} · ${posicaoEmCompasso(k * passoBat, doc.compasso)}${n ? ` · força ${forca} (roda do mouse muda)` : ''}`}
                  onClick={() => {
                    if (!n) motor.tocarBatida(peca, canal?.pecas?.[peca], 100, doc.semente);
                    void passo(p.id, peca, k * passoBat);
                  }}
                  onWheel={(e) => n && void forcaDaNota(p.id, peca, k * passoBat, forca + (e.deltaY < 0 ? 10 : -10))}>
                  {n && <span className="forca" style={{height: `${Math.round((1 - forca / 127) * 100)}%`}} />}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ---------- mixer ----------
/** Medidor ao vivo: o pico da faixa (ou do master) na posição da cabeça, de −48 a 0 dBFS; vermelho perto do 0. */
const Medidor: React.FC<{faixa?: string}> = ({faixa}) => {
  const cabeca = useMusica((e) => e.cabeca_s);
  const tocando = useMusica((e) => e.tocando);
  const db = tocando ? motor.nivelEm(cabeca, faixa) : null;
  const pct = db === null ? 0 : Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
  return (
    <div className="nivel-vivo" title={db === null ? 'toque para ver o nível' : `pico ${numeroBr(db, 1)} dBFS`}>
      <span className={db !== null && db > -3 ? 'alto' : ''} style={{width: `${pct}%`}} />
    </div>
  );
};

const Mixer: React.FC<{doc: DocMusica}> = ({doc}) => {
  const selecao = useMusica((e) => e.selecao);
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const algumSolo = m.faixas.some((f) => f.solo);
  return (
    <div className="mixer">
      {m.faixas.map((f) => (
        <div key={f.id} className={`tira${selecao?.tipo === 'faixa' && selecao.id === f.id ? ' sel' : ''}`} style={{opacity: f.mudo || (algumSolo && !f.solo) ? 0.55 : 1}}>
          <span className="nome" title={f.id} onClick={() => selecionarMusica({tipo: 'faixa', id: f.id})}>{f.nome}</span>
          <Medidor faixa={f.id} />
          <label>Volume {numeroBr(f.volume_db, 1)} dB
            <input type="range" min={-40} max={12} step={0.5} defaultValue={f.volume_db} key={`v${f.volume_db}`}
              onPointerUp={(e) => void campoFaixa(f.id, 'volume_db', Number((e.target as HTMLInputElement).value), `volume de ${f.nome}`)} /></label>
          <label>Pan {f.pan === 0 ? 'centro' : f.pan < 0 ? `${Math.round(-f.pan * 100)} E` : `${Math.round(f.pan * 100)} D`}
            <input type="range" min={-1} max={1} step={0.05} defaultValue={f.pan} key={`p${f.pan}`}
              onPointerUp={(e) => void campoFaixa(f.id, 'pan', Number((e.target as HTMLInputElement).value), `pan de ${f.nome}`)} /></label>
          <label>Reverb {Math.round(f.reverb * 100)}%
            <input type="range" min={0} max={1} step={0.05} defaultValue={f.reverb} key={`r${f.reverb}`}
              onPointerUp={(e) => void campoFaixa(f.id, 'reverb', Number((e.target as HTMLInputElement).value) || undefined, `reverb de ${f.nome}`)} /></label>
          <label>Delay {Math.round(f.delay * 100)}%
            <input type="range" min={0} max={1} step={0.05} defaultValue={f.delay} key={`d${f.delay}`}
              onPointerUp={(e) => void campoFaixa(f.id, 'delay', Number((e.target as HTMLInputElement).value) || undefined, `delay de ${f.nome}`)} /></label>
          <span className="botoes">
            <button className={`bti${f.mudo ? ' ligado' : ''}`} title="Mudo" onClick={() => void campoFaixa(f.id, 'mudo', f.mudo ? undefined : true, `mudo em ${f.nome}`)}>M</button>
            <button className={`bti${f.solo ? ' ligado' : ''}`} title="Solo" onClick={() => void campoFaixa(f.id, 'solo', f.solo ? undefined : true, `solo em ${f.nome}`)}>S</button>
          </span>
        </div>
      ))}
      <div className="tira master">
        <span className="nome">Master</span>
        <Medidor />
        {m.master.limitador.ativo && (
          <span className="ler" title={`Limitador em ${numeroBr(m.master.limitador.teto_db, 1)} dB: quanto ele tirou dos picos no último render`}>
            Limitador {motor.limitador_db ? `−${numeroBr(motor.limitador_db, 1)} dB` : 'sem redução'}</span>
        )}
        <label>Volume {numeroBr(m.master.volume_db, 1)} dB
          <input type="range" min={-40} max={12} step={0.5} defaultValue={m.master.volume_db} key={`mv${m.master.volume_db}`}
            onPointerUp={(e) => void campo('/mixer/master/volume_db', Number((e.target as HTMLInputElement).value), 'volume do master')} /></label>
        <label>Sala do reverb {Math.round(m.master.reverb.tamanho * 100)}%
          <input type="range" min={0} max={1} step={0.05} defaultValue={m.master.reverb.tamanho} key={`rt${m.master.reverb.tamanho}`}
            onPointerUp={(e) => void campo(doc.mixer.master?.reverb ? '/mixer/master/reverb/tamanho' : '/mixer/master/reverb', doc.mixer.master?.reverb
              ? Number((e.target as HTMLInputElement).value) : {tamanho: Number((e.target as HTMLInputElement).value)}, 'sala do reverb')} /></label>
      </div>
    </div>
  );
};

export const MonitorMusica: React.FC = () => {
  const {id, doc} = useDocMusica();
  const aba = useMusica((e) => e.aba);
  const avisos = useMusica((e) => e.avisos);
  const verVideo = useMusica((e) => e.verVideo);
  useMotorVivo(id, doc);
  if (!doc) {
    return (
      <div className="musica-vazio">
        <div className="titulo-vazio">Este projeto ainda não tem música</div>
        <div>Comece por um modelo pronto (dá para mudar tudo depois) ou por uma música vazia:</div>
        <div className="modelos-musica">
          {MODELOS_MUSICA.filter((x) => x.id !== 'vazio').map((x) => (
            <button key={x.id} className={`musica-modelo${x.id === 'batida' ? ' destaque' : ''}`} onClick={() => void novaMusicaDoModelo(x.id)}>
              <b>{x.nome}</b><span>{x.descricao}</span>
            </button>
          ))}
          <button className="musica-modelo" onClick={() => void criarDocumento('musica')}><b>Música vazia</b><span>sem canais: ponha bateria, instrumento ou áudio você mesmo</span></button>
        </div>
        <div className="dica-vazia">Dentro de um vídeo: selecione um clipe de música e clique em "Editar em Música", ou uma faixa e "Criar em Música".</div>
      </div>
    );
  }
  const temAberta = Boolean(transicaoAberta());
  return (
    <div className="musica-monitor">
      <Transporte doc={doc} />
      <div className="musica-abas">
        <button className={aba === 'passos' ? 'ativa' : ''} onClick={() => musica.definir({aba: 'passos'})}>Passos</button>
        <button className={aba === 'mixer' ? 'ativa' : ''} onClick={() => musica.definir({aba: 'mixer'})}>Mixer</button>
        {temAberta && <span style={{marginLeft: 'auto', color: 'var(--texto-2)', alignSelf: 'center', fontSize: 11}}>editando para o vídeo</span>}
      </div>
      <div className="musica-corpo">
        <div className="musica-corpo-linha">
          <div className="musica-corpo-principal">{aba === 'passos' ? <Passos doc={doc} /> : <Mixer doc={doc} />}</div>
          {verVideo && doc.video && <VideoNaMusica doc={doc} />}
        </div>
        {avisos.length > 0 && <div className="vazio" style={{marginTop: 8}}>{avisos.slice(0, 4).join(' · ')}</div>}
      </div>
    </div>
  );
};

