// Painel das legendas do vídeo de cenas (docs/legendas.md), no lugar do inspector quando a seleção é a faixa de
// legendas ou uma legenda. De cima para baixo: transcrever a fala no PC (whisper.cpp, com andamento e Cancelar),
// estilo (predefinição, posição, tamanho, maiúsculas, falante, cores do tema), localizar e substituir em lote, a lista
// (tempo que leva a cabeça ao clicar, texto editável, juntar com a próxima, dividir na cabeça ou no meio, excluir) e
// SRT/VTT (importar, exportar para saidas/). Toda mudança é JSON Patch: vai para o diário e o Ctrl+Z desfaz.
import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Captions, Combine, Download, FileUp, FolderOpen, Mic, Plus, RefreshCw, Scissors, Trash2, X} from 'lucide-react';
import type {EstadoTranscricao} from '../../../compartilhado/api';
import {TEMA_NEUTRO, type DocCenas, type PropsCenas} from '../../../nucleo/cenas';
import {formatoDoVideo} from '../../../nucleo/formatos';
import {
  arquivoDaFala, arquivoDasPalavras, clipesDeVoz, CPS_MAX, cpsDe, P_DUVIDA, palavrasDuvidosas, legendasDeOutraTomada, localizar, POSICOES_LEGENDA, PREDEFINICOES_LEGENDA, resolverEstilo, segmentosEm, type EstiloLegenda, type IdEstiloLegenda, type PosicaoLegenda,
  type EstadoDaFala, type PalavraLegenda, type SegmentoLegenda,
} from '../../../nucleo/legendas';
import type {CorteFala} from '../../../nucleo/cortes-fala';
import {selecionar, trocar, useLoja} from '../../estado/loja';
import {CabecalhoInspector, CampoCor, CampoDeslizante, CampoInterruptor, CampoSelecao, Secao} from '../../componentes/Campos';
import {
  assinarAndamento, cancelarTranscricao, dividir, editarTexto, estadoDasFalas, excluirSegmento, exportarArquivo, gerarDasTranscricoes, importarArquivo, juntarComProxima,
  aplicarCortesDoClipe, lerAndamento, tirarDoDicionario, mudarEstilo, ouvirAndamento, proporCortesDoClipe, voltarCortesDoClipe, novaLegenda, refazerLegendas, substituirTudo, transcreverEGerar, trocarPredefinicao,
} from './acoes-legendas';
import {aoQuadro, irPara, msAtual} from './tocador';
import './legendas.css';
import {Caixa} from '../../componentes/Controles';

const tempoCurto = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 100)) / 10;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;
};

/** O id da legenda que está tocando, atualizado só quando muda (a cabeça anda a 30 Hz). */
const usarLegendaDaHora = (props: PropsCenas | undefined) => {
  const [id, setId] = useState<string | null>(null);
  const segs = props?.legendas_cenas?.segmentos;
  useEffect(() => {
    const ver = (ms: number) => setId(segs ? segmentosEm(segs, ms)[0]?.id ?? null : null);
    ver(msAtual());
    return aoQuadro(ver);
  }, [segs]);
  return id;
};

const ItemLegenda: React.FC<{documento: string; s: SegmentoLegenda; em: number; sai: number; ultima: boolean; agora: boolean; sel: boolean; achado: boolean; i: number}> =
  ({documento, s, em, sai, ultima, agora, sel, achado, i}) => {
    const [texto, setTexto] = useState(s.texto);
    useEffect(() => setTexto(s.texto), [s.texto]);
    const raiz = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (sel) raiz.current?.scrollIntoView({block: 'nearest'});
    }, [sel]);
    const gravar = () => {
      const t = texto.replace(/[ \t]+/g, ' ').trim();
      if (t && t !== s.texto) void editarTexto(documento, s.id, t);
      else setTexto(s.texto);
    };
    const cabeca = msAtual();
    return (
      <div ref={raiz} className={`item-legenda${agora ? ' agora' : ''}${sel ? ' sel' : ''}${achado ? ' achado' : ''}`}>
        <button className="tempo" title="Levar a cabeça ao começo desta legenda. Selecionada: [ e ] mudam o começo, { e } o fim, um quadro por vez" onClick={() => {
          irPara(em);
          selecionar({documento, caminho: `/legendas/segmentos/${i}`});
        }}>
          {tempoCurto(em)}<br />{tempoCurto(sai)}
        </button>
        <textarea value={texto} rows={1} aria-label={`Texto da legenda ${i + 1}`} onChange={(e) => setTexto(e.target.value)} onBlur={gravar}
          onFocus={() => selecionar({documento, caminho: `/legendas/segmentos/${i}`})}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            } else if (e.key === 'Escape') {
              setTexto(s.texto);
              (e.target as HTMLTextAreaElement).blur();
            }
          }} />
        {s.falante && <span className="falante">{s.falante}</span>}
        {palavrasDuvidosas(s.palavras).length > 0 && (
          <span className="duvida" title={`O whisper teve pouca certeza nestas palavras (p < ${String(P_DUVIDA).replace('.', ',')}): ouça e corrija se for o caso`}>
            confira: {palavrasDuvidosas(s.palavras).join(', ')}
          </span>
        )}
        {cpsDe({texto: s.texto, em, sai}) > CPS_MAX && (
          <span className="rapida" title={`Rápida para ler: ${String(cpsDe({texto: s.texto, em, sai})).replace('.', ',')} caracteres por segundo (a régua é até ${CPS_MAX}). Estique o fim, divida ou encurte o texto.`}>
            {String(cpsDe({texto: s.texto, em, sai})).replace('.', ',')} car/s
          </span>
        )}
        <span className="acoes-item">
          <button className="bti" title="Juntar com a próxima" disabled={ultima} onClick={() => void juntarComProxima(documento, s.id)}><Combine /></button>
          <button className="bti" title={cabeca > em && cabeca < sai ? 'Dividir na cabeça' : 'Dividir no meio'} onClick={() => void dividir(documento, s.id, cabeca > em && cabeca < sai ? cabeca - (em - s.em) : undefined)}>
            <Scissors />
          </button>
          <button className="bti" title="Excluir esta legenda" onClick={() => void excluirSegmento(documento, s.id)}><Trash2 /></button>
        </span>
      </div>
    );
  };

/** Cortes pela fala: por clipe de voz transcrito, os cortes sugeridos (pausa longa, "ãh", pontas), para marcar e
 *  aplicar; o clipe cortado mostra "Voltar ao áudio sem cortes". */
const CortesFala: React.FC<{documento: string; doc: DocCenas}> = ({documento, doc}) => {
  const clipes = clipesDeVoz(doc);
  const [propostas, setPropostas] = useState<Record<string, {cortes: CorteFala[]; palavras: PalavraLegenda[]; marcados: boolean[]} | null>>({});
  const [ocupado, setOcupado] = useState(false);
  if (!clipes.length) return null;
  const tela = (c: (typeof clipes)[number]['clipe'], ms: number) => (Number(c.em) || 0) + ms - (Number(c.corte_ms) || 0);
  return (
    <Secao titulo="Cortes pela fala" chave="legendas:cortes" fechadaDePadrao>
      <div className="nota-fala">Tira as pausas longas (ficam 0,3 s) e o "ãh" e o "hum" da narração, pela transcrição: nenhum corte encosta numa palavra, e cada emenda tem
        um crossfade de 8 ms. O clipe passa a tocar o áudio emendado e as legendas vão junto.</div>
      {clipes.map(({clipe}) => {
        const p = propostas[clipe.id];
        const marcados = p ? p.cortes.filter((_, i) => p.marcados[i]) : [];
        const economia = marcados.reduce((s, c) => s + c.ate_ms - c.de_ms, 0);
        return (
          <div key={clipe.id} className="cortes-clipe">
            <div className="linha-botoes">
              <b>{clipe.nome || clipe.arquivo.split('/').pop()}</b>
              {clipe.cortes_fala ? <button className="bt fantasma mini" disabled={ocupado} onClick={() => void voltarCortesDoClipe(documento, clipe.id)}>Voltar ao áudio sem cortes</button> : null}
              <button className="bt fantasma mini" disabled={ocupado} onClick={() => void proporCortesDoClipe(documento, clipe.id).then((r) =>
                setPropostas((x) => ({...x, [clipe.id]: r ? {...r, marcados: r.cortes.map(() => true)} : null})))}><Scissors /> Propor cortes</button>
            </div>
            {p === null && <div className="nota-fala">Transcreva a fala deste clipe antes.</div>}
            {p && !p.cortes.length && <div className="nota-fala">Nada a cortar: nenhuma pausa acima de 0,7 s nem "ãh".</div>}
            {p && p.cortes.length > 0 && (
              <>
                <div className="lista-cortes">
                  {p.cortes.map((c, i) => (
                    <div key={i} className="corte">
                      <Caixa marcado={p.marcados[i]} rotulo="Usar esta proposta" aoMudar={(v) => setPropostas((x) => ({...x, [clipe.id]: {...p, marcados: p.marcados.map((m, k) => (k === i ? v : m))}}))} />
                      <span className="tempo" onClick={() => irPara(tela(clipe, c.de_ms))}>{tempoCurto(tela(clipe, c.de_ms))}</span>
                      <span>{c.motivo === 'preenchimento' ? `"${c.texto}"` : 'pausa'} · −{((c.ate_ms - c.de_ms) / 1000).toFixed(1).replace('.', ',')} s</span>
                    </div>
                  ))}
                </div>
                <button className="bt principal mini" disabled={ocupado || !marcados.length} onClick={() => {
                  setOcupado(true);
                  void aplicarCortesDoClipe(documento, clipe.id, marcados, p.palavras).then((ok) => {
                    setOcupado(false);
                    if (ok) setPropostas((x) => ({...x, [clipe.id]: undefined as never}));
                  });
                }}>Aplicar {marcados.length} {marcados.length === 1 ? 'corte' : 'cortes'} (−{(economia / 1000).toFixed(1).replace('.', ',')} s)</button>
              </>
            )}
          </div>
        );
      })}
    </Secao>
  );
};

const Transcricao: React.FC<{documento: string; doc: DocCenas}> = ({documento, doc}) => {
  const andamento = useSyncExternalStore(assinarAndamento, lerAndamento);
  useEffect(() => ouvirAndamento(), []);
  const [estado, setEstado] = useState<EstadoTranscricao | null>(null);
  const [modelo, setModelo] = useState<'small' | 'base'>('small');
  const [falas, setFalas] = useState<Record<string, EstadoDaFala>>({});
  const clipes = clipesDeVoz(doc);
  // a fala do clipe de voz limpa é a do original: limpar a voz não pede outra transcrição
  const arquivos = [...new Set(clipes.map((c) => arquivoDaFala(c.clipe)))];
  const chave = arquivos.join('|');
  useEffect(() => {
    let vivo = true;
    void window.estudio.fala.estado(modelo).then((e) => vivo && setEstado(e)).catch(() => vivo && setEstado(null));
    void estadoDasFalas(arquivos).then((r) => vivo && setFalas(r));
    return () => {
      vivo = false;
    };
  }, [chave, modelo, andamento === null, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  // sem o whisper-cli (Linux), a pessoa compila no terminal e volta: a janela que ganha o foco confere de novo
  const semPlataforma = estado?.plataforma === false;
  useEffect(() => {
    if (!semPlataforma) return;
    const conferir = () => void window.estudio.fala.estado(modelo).then(setEstado).catch(() => undefined);
    window.addEventListener('focus', conferir);
    return () => window.removeEventListener('focus', conferir);
  }, [semPlataforma, modelo]);
  const comLegenda = new Set((doc.legendas?.segmentos ?? []).map((s) => s?.clipe));
  const emDia = (a: string) => falas[a] === 'em_dia';
  const algum = arquivos.some(emDia);
  const faltaTranscrever = arquivos.some((a) => !emDia(a));
  const faltaLegenda = clipes.some(({clipe}) => !comLegenda.has(clipe.id));
  // o clipe trocou de arquivo depois das legendas (som-N2): elas são da tomada de antes
  const outra = new Set(legendasDeOutraTomada(doc));
  return (
    <Secao titulo="Transcrever a fala" chave="legendas:transcrever">
      {!arquivos.length ? (
        <div className="nota-fala">Ponha a narração na linha do tempo ("+ Áudio → Narração…"): a fala dos clipes de voz vira legenda, com o nome do clipe ou da faixa como falante.</div>
      ) : (
        <div className="clipes-voz">
          {clipes.map(({clipe, faixa}) => {
            const fala = arquivoDaFala(clipe);
            const e = falas[fala];
            return (
              <div key={clipe.id} title={e === 'velha' ? `O áudio mudou depois da transcrição: ${fala}` : arquivoDasPalavras(fala)}>
                {e === 'em_dia' ? <span className="ok">✓ </span> : e === 'velha' ? <span className="velha">↻ </span> : '· '}
                {clipe.nome || clipe.arquivo.split('/').pop()} <span style={{color: 'var(--texto-3)'}}>({faixa.nome}{!comLegenda.has(clipe.id) ? ', sem legendas' : outra.has(clipe.id) ? ', legendas de outro arquivo' : ''})</span>
              </div>
            );
          })}
        </div>
      )}
      {andamento ? (
        <div className="andamento">
          <div className="msg"><span>{andamento.pela_ia ? 'A IA pediu: ' : ''}{andamento.mensagem}{andamento.progresso !== undefined ? ` · ${Math.round(andamento.progresso)}%` : ''}</span>
            <button className="bt fantasma mini" onClick={cancelarTranscricao}><X /> Cancelar</button></div>
          <div className="barra"><div style={{width: `${Math.max(2, andamento.progresso ?? 0)}%`}} /></div>
        </div>
      ) : (
        <div className="linha-botoes">
          {faltaTranscrever || outra.size ? (
            <button className="bt principal mini" disabled={!arquivos.length || estado?.plataforma === false} onClick={() => void transcreverEGerar(documento, {modelo})}
              title="Roda o whisper.cpp neste PC: nada sai da máquina. Os clipes que já têm legendas ficam como estão">
              <Mic /> {!faltaTranscrever ? 'Atualizar as legendas…' : algum ? 'Transcrever o que falta' : 'Transcrever e gerar legendas'}
            </button>
          ) : faltaLegenda ? (
            <button className="bt principal mini" onClick={() => void gerarDasTranscricoes(documento)} title="Gera as legendas dos clipes que ainda não têm; as outras ficam como estão">
              <Captions /> Gerar o que falta</button>
          ) : (
            <button className="bt principal mini" onClick={() => void refazerLegendas(documento)} title="Gera de novo as legendas da transcrição, guardando as palavras corrigidas à mão">
              <Captions /> Refazer as legendas…</button>
          )}
          {algum && <button className="bt fantasma mini" onClick={() => void transcreverEGerar(documento, {modelo, refazer: true})} title="Transcreve de novo todos os clipes de voz e refaz as legendas">
            <RefreshCw /> Transcrever de novo…</button>}
          {algum && faltaTranscrever && faltaLegenda && <button className="bt fantasma mini" onClick={() => void gerarDasTranscricoes(documento)}>Só das transcritas</button>}
        </div>
      )}
      <CampoSelecao rotulo="Modelo" valor={modelo} opcoes={[['small', 'Small · erra pouco (190 MB)'], ['base', 'Base · 2× mais rápido (60 MB)']]} aoMudar={setModelo} />
      {estado && (
        <div className="nota-fala">
          {!estado.plataforma ? (estado.aviso ? `${estado.aviso[0].toUpperCase()}${estado.aviso.slice(1)}.` : 'A transcrição local por enquanto só roda no Windows x64.')
            : !estado.ffmpeg ? 'Não achei o ffmpeg do compositor do Remotion: reinstale o app.'
            : estado.falta.length ? <>Na primeira vez baixa <b>{estado.falta.join(' e ')}</b> para {estado.pasta}, com o SHA-256 conferido. Leva perto de metade da duração da fala.</>
            : <>Tudo instalado em {estado.pasta}. Leva perto de metade da duração da fala.</>}
        </div>
      )}
    </Secao>
  );
};

export const PainelLegendas: React.FC<{documento: string}> = ({documento}) => {
  const doc = useLoja((e) => e.docs[documento]?.doc as DocCenas | undefined);
  const props = useLoja((e) => {
    const m = e.props[documento];
    return m && 'props' in m ? (m.props as unknown as PropsCenas) : undefined;
  });
  const selecao = useLoja((e) => (e.selecao?.documento === documento ? e.selecao.caminho : null));
  const agora = usarLegendaDaHora(props);
  const [procurar, setProcurar] = useState('');
  const [troca, setTroca] = useState('');
  const [caixa, setCaixa] = useState(false);
  const [inteira, setInteira] = useState(false);
  const [guardar, setGuardar] = useState(false);
  const [exportado, setExportado] = useState<string | null>(null);
  const leg = doc?.legendas;
  const segs = leg?.segmentos ?? [];
  const achados = useMemo(() => new Set(procurar ? localizar(segs, procurar, {caixa, palavra_inteira: inteira}) : []), [segs, procurar, caixa, inteira]);
  if (!doc) return <div className="vazio">sem vídeo</div>;
  const estilo: EstiloLegenda = leg?.estilo ?? {predefinicao: 'classica'};
  const pre = PREDEFINICOES_LEGENDA[estilo.predefinicao] ?? PREDEFINICOES_LEGENDA.classica;
  const f = formatoDoVideo(doc);
  const menor = Math.min(f.largura, f.altura);
  // os padrões do estilo escolhido (a faixa da marca troca o fundo pelo destaque): o que a pessoa não mudou
  const padrao = resolverEstilo({predefinicao: estilo.predefinicao}, {...TEMA_NEUTRO, ...doc.tema});
  const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // tempos da lista: os da saída (com o clipe de voz no lugar em que está), pelo id
  const saida = new Map((props?.legendas_cenas?.segmentos ?? []).map((s) => [s.id, s]));
  const m = selecao ? /^\/legendas\/segmentos\/(\d+)$/.exec(selecao) : null;
  const idSel = m ? segs[Number(m[1])]?.id : undefined;

  return (
    <div className="painel painel-legendas">
      <CabecalhoInspector icone={<Captions />} familia="texto" nome="Legendas"
        sub={segs.length ? `${segs.length} ${segs.length === 1 ? 'legenda' : 'legendas'} · ${pre.nome}${leg?.oculto ? ' · escondidas' : ''}` : 'Vídeo de cenas'} dica="/legendas" />
      <div className="insp-corpo">
        <Transcricao documento={documento} doc={doc} />
        <CortesFala documento={documento} doc={doc} />
        {leg && (
          <Secao titulo="Estilo" chave="legendas:estilo">
            <div className="predefs">
              {Object.values(PREDEFINICOES_LEGENDA).map((p) => (
                <button key={p.id} className={`predef${p.id === estilo.predefinicao ? ' ligado' : ''}`} title={p.descricao}
                  onClick={() => p.id !== estilo.predefinicao && void trocarPredefinicao(documento, {predefinicao: p.id as IdEstiloLegenda,
                    ...(estilo.falante ? {falante: true} : {}), ...(estilo.cor ? {cor: estilo.cor} : {}), ...(estilo.cor_destaque ? {cor_destaque: estilo.cor_destaque} : {}),
                    ...(estilo.fundo ? {fundo: estilo.fundo} : {}), ...(estilo.no_quadrado === false ? {no_quadrado: false} : {})})}>
                  <b>{p.nome}</b>{p.descricao}
                </button>
              ))}
            </div>
            <CampoSelecao<PosicaoLegenda> rotulo="Posição" valor={estilo.posicao ?? pre.posicao} padrao={pre.posicao} opcoes={POSICOES_LEGENDA}
              aoMudar={(v) => void mudarEstilo(documento, 'posicao', v === pre.posicao ? undefined : v, 'posição das legendas')} />
            <CampoDeslizante rotulo="Letra" valor={Math.round((estilo.tam ?? pre.tam) * menor)} min={14} max={Math.round(menor * 0.14)} passo={1} unidade=" px"
              padrao={Math.round(pre.tam * menor)}
              aoMudar={(v) => void mudarEstilo(documento, 'tam', v === Math.round(pre.tam * menor) ? undefined : Math.round((v / menor) * 10000) / 10000, 'tamanho das legendas')} />
            <CampoInterruptor rotulo="Maiúsculas" valor={estilo.maiusculas ?? pre.maiusculas}
              aoMudar={(v) => void mudarEstilo(documento, 'maiusculas', v === pre.maiusculas ? undefined : v, v ? 'legendas em maiúsculas' : 'legendas sem maiúsculas')} />
            {Math.abs(formatoDoVideo(doc).largura / formatoDoVideo(doc).altura - 0.8) < 0.01 && (
              <CampoInterruptor rotulo="No quadrado" valor={estilo.no_quadrado !== false} texto="dentro do corte 1:1 do 4:5"
                dica="A prévia quadrada do WhatsApp, do LinkedIn e da grade corta o 4:5 em cima e embaixo: ligado, a legenda fica dentro do quadrado"
                aoMudar={(v) => void mudarEstilo(documento, 'no_quadrado', v ? undefined : false, v ? 'legendas dentro do quadrado' : 'legendas na altura toda do 4:5')} />
            )}
            <CampoInterruptor rotulo="Falante" valor={Boolean(estilo.falante)} texto="nome acima do texto"
              aoMudar={(v) => void mudarEstilo(documento, 'falante', v || undefined, v ? 'mostrar o falante' : 'esconder o falante')} />
            <CampoInterruptor rotulo="No vídeo" valor={!leg.oculto} texto="mostrar no vídeo e na exportação"
              aoMudar={(v) => void trocar(documento, '/legendas/oculto', v ? undefined : true, v ? 'mostrar legendas' : 'esconder legendas')}
              dica="Escondidas, as legendas continuam na lista e no SRT" />
            <CampoCor rotulo="Texto" valor={estilo.cor ?? padrao.cor} padrao={padrao.cor}
              aoMudar={(v) => void mudarEstilo(documento, 'cor', igual(v, padrao.cor) ? undefined : v, 'cor das legendas')} />
            <CampoCor rotulo="Palavra falada" valor={estilo.cor_destaque ?? padrao.cor_destaque} padrao={padrao.cor_destaque}
              aoMudar={(v) => void mudarEstilo(documento, 'cor_destaque', igual(v, padrao.cor_destaque) ? undefined : v, 'cor da palavra falada')} />
            <CampoCor rotulo="Caixa e faixa" valor={estilo.fundo ?? padrao.fundo} padrao={padrao.fundo}
              aoMudar={(v) => void mudarEstilo(documento, 'fundo', igual(v, padrao.fundo) ? undefined : v, 'fundo das legendas')} />
            <div className="nota-fala">As cores e a fonte vêm do tema do vídeo (menu → Marca…). A legenda fica dentro da área segura de {f.largura}×{f.altura}.</div>
          </Secao>
        )}
        {segs.length > 0 && (
          <Secao titulo="Localizar e substituir" chave="legendas:busca" fechadaDePadrao>
            <div className="busca">
              <input type="text" className="campo" placeholder="Localizar" value={procurar} onChange={(e) => setProcurar(e.target.value)} aria-label="Localizar nas legendas" />
              <input type="text" className="campo" placeholder="Substituir por" value={troca} onChange={(e) => setTroca(e.target.value)} aria-label="Substituir por" />
              <div className="opcoes">
                <Caixa marcado={caixa} aoMudar={setCaixa}>maiúsculas e acentos</Caixa>
                <Caixa marcado={inteira} aoMudar={setInteira}>palavra inteira</Caixa>
                <Caixa marcado={guardar} aoMudar={setGuardar} dica="A troca volta a valer quando as legendas forem geradas de novo, e entra no vocabulário do whisper">guardar no dicionário</Caixa>
              </div>
              <div className="opcoes">
                <span>{procurar ? `${achados.size} ${achados.size === 1 ? 'legenda' : 'legendas'}` : ' '}</span>
                <button className="bt mini" disabled={!procurar || (!achados.size && !guardar)} onClick={() => void substituirTudo(documento, procurar, troca, {caixa, palavra_inteira: inteira, guardar})}>
                  Substituir em todas
                </button>
              </div>
              {(leg?.dicionario?.length ?? 0) > 0 && (
                <div className="dicionario">
                  <span>Dicionário do vídeo (vale ao gerar de novo; as siglas da casa, como CLT e FGTS, já valem sempre):</span>
                  {leg!.dicionario!.map((e) => (
                    <span key={e.de} className="entrada">{e.de} → {e.para}
                      <button className="bti" title="Tirar do dicionário" onClick={() => void tirarDoDicionario(documento, e.de)}><X /></button></span>
                  ))}
                </div>
              )}
            </div>
          </Secao>
        )}
        <Secao titulo={`Lista${segs.length ? ` (${segs.length})` : ''}`} chave="legendas:lista"
          acao={<button className="bt fantasma mini" title="Legenda nova no tempo da cabeça" onClick={() => void novaLegenda(documento, msAtual())}><Plus /> No tempo atual</button>}>
          {!segs.length && <div className="nota-fala">Sem legendas ainda: transcreva a narração, importe um SRT ou VTT, ou crie uma no tempo atual.</div>}
          <div className="lista-legendas">
            {segs.map((s, i) => {
              const p = saida.get(s.id);
              return <ItemLegenda key={s.id} documento={documento} s={s} em={p?.em ?? s.em} sai={p?.sai ?? s.sai} i={i} ultima={i === segs.length - 1}
                agora={agora === s.id} sel={idSel === s.id} achado={achados.has(s.id)} />;
            })}
          </div>
        </Secao>
        <Secao titulo="SRT e VTT" chave="legendas:arquivos">
          <div className="linha-botoes">
            <button className="bt mini" onClick={() => void importarArquivo(documento)} title="Troca as legendas pelas do arquivo (Ctrl+Z desfaz)"><FileUp /> Importar…</button>
            <button className="bt mini" disabled={!segs.length} onClick={() => void exportarArquivo(documento, 'srt').then((c) => c && setExportado(c))}><Download /> SRT</button>
            <button className="bt mini" disabled={!segs.length} onClick={() => void exportarArquivo(documento, 'vtt').then((c) => c && setExportado(c))}><Download /> VTT</button>
            {exportado && <button className="bt fantasma mini" onClick={() => window.estudio.mostrarArquivo(exportado)} title={exportado}><FolderOpen /> Mostrar na pasta</button>}
          </div>
          <div className="nota-fala">Os arquivos vão para saidas/ com o nome do vídeo, nos tempos da exportação. O VTT leva o falante (&lt;v Nome&gt;).</div>
        </Secao>
      </div>
    </div>
  );
};
