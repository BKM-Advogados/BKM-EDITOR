// Painel "Narração por IA" do vídeo de cenas (docs/narracao.md), aberto no "+ Áudio" da linha do tempo, ao lado do gravador
// com teleprompter. Em cima, a voz: provedor (Gemini TTS com a chave do Gemini, ou Google Cloud TTS com as vozes Chirp 3: HD),
// modelo e voz (a lista vem da API e fica guardada na sessão), estilo (Gemini) ou velocidade (Cloud TTS), a folga e "Ouvir
// amostra". No meio, a fala de cada cena (o roteiro falado, diferente do texto da tela) com o estado: sem texto, a gerar,
// gerada ou desatualizada, e "Gerar" por cena. Embaixo, "Gerar todas" com o custo estimado antes e o andamento, "Ajustar as
// cenas à fala", "Criar legendas" (a transcrição local que já existe) e o dicionário de pronúncia.
import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {AudioLines, BookA, Captions, KeyRound, Play, Plus, RefreshCw, Timer, Trash2, X} from 'lucide-react';
import type {DocCenas} from '../../../nucleo/cenas';
import {configDaNarracao, MODELOS_GEMINI_TTS, NOMES_PROVEDOR, VELOCIDADE_MAX, VELOCIDADE_MIN, vozDoProvedor, type ProvedorNarracao} from '../../../nucleo/narracao';
import {itensDaNarracao, ROTULO_ESTADO, type EstadoFala} from '../../../nucleo/narracao-cenas';
import type {Previa} from '../../../nucleo/narracao-servico';
import type {EstadoNarracaoIA} from '../../../compartilhado/api';
import {useLoja} from '../../estado/loja';
import {abrirConfigIA, estadoConversas} from '../../paineis/conversas';
import {ajustarCenas, cancelarFalas, carregarVozes, configurar, gerarFalas, narracaoTela, ouvirAmostra, textoCusto, trocarPronuncias, trocarTextoDaCena} from './acoes-narracao';
import {transcreverEGerar} from './acoes-legendas';
import {Escolha, Segmentado} from '../../componentes/Controles';

const s1 = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1});
const COR_ESTADO: Record<EstadoFala, string> = {sem_texto: 'sem', pendente: 'pendente', gerada: 'gerada', desatualizada: 'velha'};

/** O texto falado de uma cena: grava ao sair do campo (ou Ctrl+Enter). */
const TextoDaCena: React.FC<{documento: string; i: number; valor: string}> = ({documento, i, valor}) => {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <textarea className="campo" rows={2} value={v} placeholder="O que a voz fala nesta cena (o texto da tela pode ser outro). [pausa] e [pausa longa] fazem pausa."
      onChange={(e) => setV(e.target.value)} onBlur={() => void trocarTextoDaCena(documento, i, v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void trocarTextoDaCena(documento, i, v)} />
  );
};

const Dicionario: React.FC<{documento: string; doc: DocCenas}> = ({documento, doc}) => {
  const lista = configDaNarracao(doc.narracao).pronuncias;
  const [de, setDe] = useState('');
  const [para, setPara] = useState('');
  const somar = () => {
    if (!de.trim()) return;
    const nova = [...lista.filter((p) => p.de !== de.trim()), {de: de.trim(), para}];
    void trocarPronuncias(documento, nova, `pronúncia: ${de.trim()} → ${para}`);
    setDe('');
    setPara('');
  };
  return (
    <details className="narracao-dicionario" open={lista.length > 0}>
      <summary><BookA size={13} /> Dicionário de pronúncia ({lista.length})</summary>
      <div className="vazio">A palavra inteira é trocada antes de ir à voz. Com maiúscula ("RH", "PIN"), só casa a mesma caixa; em minúsculas, casa qualquer caixa.</div>
      {lista.map((p) => (
        <div key={p.de} className="linha-gravador">
          <span className="etiqueta">{p.de}</span>→<span className="meta">{p.para || '(some)'}</span>
          <span className="espaco" />
          <button className="bti" title="Tirar do dicionário" aria-label={`Tirar ${p.de} do dicionário`} onClick={() => void trocarPronuncias(documento, lista.filter((x) => x.de !== p.de), `pronúncia sem ${p.de}`)}><Trash2 /></button>
        </div>
      ))}
      <div className="linha-gravador">
        <input className="campo" placeholder="escrito (ex.: RH)" value={de} onChange={(e) => setDe(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && somar()} />
        <input className="campo" placeholder="falado (ex.: erre agá)" value={para} onChange={(e) => setPara(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && somar()} />
        <button className="bt mini" disabled={!de.trim()} onClick={somar}><Plus size={12} />Pôr</button>
      </div>
    </details>
  );
};

export const NarracaoIA: React.FC<{documento: string; aoFechar: () => void}> = ({documento, aoFechar}) => {
  const lido = useLoja((e) => e.docs[documento]);
  const doc = lido?.doc as DocCenas | undefined;
  const tela = useSyncExternalStore(narracaoTela.assinar, narracaoTela.ler);
  const configAberta = useSyncExternalStore(estadoConversas.assinar, estadoConversas.configIA); // a chave pode ter mudado lá
  const [chaves, setChaves] = useState<EstadoNarracaoIA | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [estilo, setEstilo] = useState('');
  const cfg = configDaNarracao(doc?.narracao);
  const itens = useMemo(() => (doc ? itensDaNarracao(doc) : []), [doc]);
  const vozes = tela.vozes[cfg.provedor];
  const andamento = tela.andamento?.documento === documento ? tela.andamento : null;

  useEffect(() => setEstilo(cfg.estilo), [cfg.estilo]);
  useEffect(() => {
    void window.estudio.narracao.estado().then(setChaves).catch(() => setChaves(null));
  }, [cfg.provedor, configAberta]);
  useEffect(() => {
    void carregarVozes(cfg.provedor);
  }, [cfg.provedor, chaves?.[cfg.provedor].final]);
  // a prévia (custo estimado e o que sai do cache) acompanha cada versão do documento; não vai à rede
  useEffect(() => {
    if (!lido) return;
    let vivo = true;
    void window.estudio.narracao.previa(documento).then((p) => vivo && setPrevia(p)).catch(() => vivo && setPrevia(null));
    return () => {
      vivo = false;
    };
  }, [documento, lido?.versao]);

  if (!doc) return null;
  const chave = chaves?.[cfg.provedor];
  const temFala = itens.some((i) => i.clipe);
  const passam = itens.filter((i) => i.clipe && i.clipe.em + i.clipe.duracao_ms > i.t_out + 1);
  const trocarProvedor = (p: ProvedorNarracao) => void configurar(documento, {provedor: p, voz: vozDoProvedor(p, cfg.voz)}, `narração por ${NOMES_PROVEDOR[p]}`);
  const custoCena = (cena: string) => previa?.itens.find((x) => x.cena === cena);

  return (
    <div className="flutuante gravador narracao-ia" role="dialog" aria-label="Narração por IA">
      <div className="topo">
        <AudioLines className="i14" />
        <strong>Narração por IA</strong>
        <span className="espaco" />
        {chave && (chave.pronto
          ? <span className="meta" title={chave.origem === 'ambiente' ? `da variável ${chave.variavel}` : 'guardada neste PC'}><KeyRound size={12} /> …{chave.final}</span>
          : <button className="bt mini" onClick={() => abrirConfigIA(cfg.provedor === 'gemini' ? 'gemini' : 'narracao')}><KeyRound size={12} />Pôr a chave</button>)}
        <button className="bti" title="Fechar" aria-label="Fechar" onClick={aoFechar}><X /></button>
      </div>

      <div className="narracao-config">
        <div className="rotulo-campo curto"><span>Provedor</span>
          <Segmentado<ProvedorNarracao> rotulo="Provedor da narração" valor={cfg.provedor} aoMudar={trocarProvedor} desligado={Boolean(andamento)}
            opcoes={[['gemini', NOMES_PROVEDOR.gemini], ['google-tts', NOMES_PROVEDOR['google-tts']]]} />
        </div>
        {cfg.provedor === 'gemini' && (
          <div className="rotulo-campo"><span>Modelo</span>
            <Escolha<string> rotulo="Modelo da narração" valor={cfg.modelo} desligado={Boolean(andamento)}
              aoMudar={(m) => void configurar(documento, {modelo: m}, 'modelo da narração')}
              opcoes={[...(MODELOS_GEMINI_TTS.some((m) => m.id === cfg.modelo) ? [] : [[cfg.modelo, cfg.modelo] as [string, string]]),
                ...MODELOS_GEMINI_TTS.map((m): [string, string] => [m.id, m.nome])]} />
          </div>
        )}
        <div className="rotulo-campo"><span>Voz</span>
          <span className="par">
            <Escolha<string> rotulo="Voz da narração" valor={cfg.voz} desligado={Boolean(andamento)}
              aoMudar={(v) => void configurar(documento, {voz: v}, `voz ${v}`)}
              opcoes={[...(vozes?.vozes.some((v) => v.id === cfg.voz) ? [] : [[cfg.voz, cfg.voz] as [string, string]]),
                ...(vozes?.vozes ?? []).map((v): [string, string] => [v.id, `${v.nome}${v.descricao ? ` · ${v.descricao}` : ''}${v.genero ? ` (${v.genero})` : ''}`])]} />
            <button className="bti" title="Buscar a lista de vozes de novo" aria-label="Buscar a lista de vozes de novo" onClick={() => void carregarVozes(cfg.provedor, true)}><RefreshCw /></button>
          </span>
        </div>
        {cfg.provedor === 'gemini' ? (
          <label className="rotulo-campo largo">Estilo (como falar)
            <input className="campo" value={estilo} placeholder="ex.: calmo e didático, sem pressa" onChange={(e) => setEstilo(e.target.value)}
              onBlur={() => estilo.trim() !== cfg.estilo && void configurar(documento, {estilo: estilo.trim() || undefined}, 'estilo da narração')} />
          </label>
        ) : (
          <label className="rotulo-campo curto">Velocidade
            <input className="campo" type="number" min={VELOCIDADE_MIN} max={VELOCIDADE_MAX} step={0.05} value={cfg.velocidade} style={{width: 70}}
              onChange={(e) => Number(e.target.value) >= VELOCIDADE_MIN && Number(e.target.value) <= VELOCIDADE_MAX
                && void configurar(documento, {velocidade: Number(e.target.value) === 1 ? undefined : Number(e.target.value)}, 'velocidade da narração')} />
          </label>
        )}
        <label className="rotulo-campo curto" title="A fala entra quanto depois do começo da cena">Folga
          <span className="par"><input className="campo" type="number" min={0} max={5000} step={50} value={cfg.folga_ms} style={{width: 64, flex: 'none'}}
            onChange={(e) => Number(e.target.value) >= 0 && void configurar(documento, {folga_ms: Number(e.target.value) === 300 ? undefined : Number(e.target.value)}, 'folga da narração')} />ms</span>
        </label>
        <button className="bt mini" disabled={!chave?.pronto} title="Uma frase curta nesta voz (custa centavos de centavo; fica guardada neste PC)"
          onClick={() => void ouvirAmostra(doc.narracao)}><Play size={12} />Ouvir amostra</button>
      </div>
      {vozes?.aviso && <div className="vazio">{vozes.aviso}</div>}

      <div className="narracao-cenas">
        {itens.map((it, i) => {
          const p = custoCena(it.cena);
          return (
            <div key={it.cena} className="narracao-cena">
              <div className="linha-gravador">
                <strong>Cena {it.n}</strong>{it.nome && <span className="meta">{it.nome}</span>}
                <span className={`etiqueta estado-fala ${COR_ESTADO[it.estado]}`} title={it.motivo}>{ROTULO_ESTADO[it.estado]}</span>
                <span className="espaco" />
                {it.clipe && <span className={`meta${it.clipe.em + it.clipe.duracao_ms > it.t_out + 1 ? ' passa' : ''}`}
                  title="Duração da fala e da cena">fala {s1(it.clipe.duracao_ms)} s · cena {s1(it.t_out - it.t_in)} s</span>}
                {!it.clipe && it.medida && <span className="meta" title="Estimativa antes de gerar">~{s1(it.medida.segundos * 1000)} s</span>}
                {it.estado !== 'sem_texto' && (
                  <button className="bt mini" disabled={Boolean(andamento)}
                    title={it.estado === 'gerada' ? 'Pede outra tomada ao Google, com o mesmo texto e a mesma voz (tem custo; Ctrl+Z volta à anterior)'
                      : p ? `${p.caracteres} caracteres · ${textoCusto(p.em_cache ? 0 : p.custo_usd)}` : undefined}
                    onClick={() => void gerarFalas(documento, {cenas: [it.cena], refazer: it.estado === 'gerada'})}>{it.estado === 'gerada' ? 'Outra tomada' : 'Gerar esta cena'}</button>
                )}
              </div>
              <TextoDaCena documento={documento} i={i} valor={doc.cenas[i]?.narracao?.texto ?? ''} />
            </div>
          );
        })}
      </div>

      {andamento ? (
        <div className="linha-gravador">
          <div className="som-andamento"><span style={{width: `${Math.round((andamento.feitas / Math.max(1, andamento.total)) * 100)}%`}} /></div>
          <span className="meta">cena {andamento.n ?? '…'} · {andamento.feitas} de {andamento.total}</span>
          <button className="bt mini fantasma" onClick={cancelarFalas}>Cancelar</button>
        </div>
      ) : (
        <div className="linha-gravador">
          <span className="meta">{previa && previa.total.a_gerar
            ? `${previa.total.a_gerar} a gerar · ~${s1(previa.total.segundos_estimados * 1000)} s · ${textoCusto(previa.total.custo_usd)}${previa.total.tabela ? ` (tabela de ${previa.total.tabela})` : ''}`
            : itens.some((i) => i.estado !== 'sem_texto') ? 'tudo gerado' : 'escreva a fala das cenas'}</span>
          <span className="espaco" />
          <button className="bt principal mini" disabled={!previa?.total.a_gerar} onClick={() => void gerarFalas(documento, {confirmarAntes: true})}>Gerar todas</button>
        </div>
      )}
      <div className="linha-gravador">
        <button className="bt mini" disabled={!temFala || Boolean(andamento)} title={`Cada cena com fala passa a durar folga + fala + margem (${s1(cfg.margem_ms)} s). Ctrl+Z desfaz.`}
          onClick={() => void ajustarCenas(documento)}><Timer size={12} />Ajustar as cenas à fala{passam.length ? ` (${passam.length} passam)` : ''}</button>
        <button className="bt mini" disabled={!temFala || Boolean(andamento)} title="Transcreve as falas no PC (whisper) e gera as legendas com o tempo de cada palavra"
          onClick={() => void transcreverEGerar(documento)}><Captions size={12} />Criar legendas</button>
      </div>
      {tela.ultimo?.ok && tela.ultimo.documento === documento && tela.ultimo.geradas.length > 0 && !andamento && (
        <div className="vazio">Falas novas no vídeo. {passam.length ? 'Algumas passam do fim da cena: "Ajustar as cenas à fala". ' : ''}Para as legendas, "Criar legendas".</div>
      )}
      <Dicionario documento={documento} doc={doc} />
      <div className="vazio">A fala entra numa faixa de voz no começo de cada cena, e a música com ducking cai sob ela. Cache em midia/narracao: só a cena que mudou volta ao Google. A chave fica no processo principal; esta tela não a vê.</div>
    </div>
  );
};
