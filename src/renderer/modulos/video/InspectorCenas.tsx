// Propriedades do vídeo de cenas, com nomes de quem edita. Sem seleção: o formato (trocar 9:16 por 16:9 não desmonta
// nada, porque a posição é relativa ao quadro) e as cores do tema. Cena: nome, duração e fundo. Bloco: conteúdo,
// tempo (segundos na cena), posição e tamanho em % do quadro e a letra em px do formato atual. Faixa de áudio: nome,
// papel, volume, mudo e o ducking (música); clipe: arquivo, tempo, corte, volume, fades e mudo, com o que foi medido.
// Bloco e cena mostram em "Fatos citados" os `refs` (ids dos fatos da pesquisa) como etiquetas, com a afirmação ao lado;
// clicar leva ao fato no painel Pesquisa e o × tira um da lista. O som tem ainda o loudness (o alvo do arquivo exportado
// e os medidores da narração e da mistura no resumo do vídeo; o da faixa no inspetor dela) e, no clipe de voz, a limpeza.
// No tempo do bloco, "Entra na palavra" e "Sai na palavra" prendem o bloco a uma palavra da fala da cena (as palavras das
// legendas que caem nela); mudar o tempo em segundos, aqui ou na linha do tempo, solta o bloco da palavra.
import React, {useState, useSyncExternalStore} from 'react';
import {rotuloDoAtalho} from '../../teclas';
import {Clapperboard, CopyPlus, Film, FileAudio, FileJson, ImagePlus, Link, Quote, Scissors, Shuffle, Sparkles, Trash2, Undo2, X} from 'lucide-react';
import {ALVO_LU_MAX, ALVO_LU_MIN, ALVO_LUFS_MAX, ALVO_LUFS_MIN, ALVO_LUFS_PADRAO, DUCKING_PADRAO, PAPEIS, PICO_DBTP_MAX, PICO_DBTP_MIN, PICO_DBTP_PADRAO, type AudioP,
  type ClipeAudio, type ClipeAudioP, type CurvaFade, type FaixaAudio, type FaixaAudioP, type IntensidadeLimpeza, type PapelFaixa} from '../../../nucleo/audio';
import {INTENSIDADE_PADRAO, INTENSIDADES} from '../../../nucleo/limpeza-voz';
import {palavrasDaCena, TEMA_NEUTRO, TIPOS_BLOCO_CENAS, type BlocoCenas, type CenaCenas, type CenaCenasP, type DocCenas, type PropsCenas} from '../../../nucleo/cenas';
import {ancoraDaPalavra, tempoDaAncora, type Palavra} from '../../../nucleo/ancora-palavra';
import {FORMATOS_VIDEO, formatoDoVideo, rotuloFormato} from '../../../nucleo/formatos';
import {aplicar, avisar, loja, mensagemDe, patchTrocar, trocar, useLoja, valorEm, verFato} from '../../estado/loja';
import {CriarEmMusica, MusicaDoClipe} from '../musica/NoVideo'; // frente Música
import {CabecalhoInspector, CampoCor, CampoDeslizante, CampoInterruptor, CampoLeitura, CampoNumero, CampoSelecao, CampoTexto, Secao, copiar, numeroBr} from '../../componentes/Campos';
import type {ItemMenu} from '../../componentes/Menu';
import {formatarTempo} from './tocador';
import {resumoBloco, tipoDe} from './tipos';
import {duplicarSelecao, excluirSelecao} from './acoes';
import {andamentoLimpeza, assinarLimpeza, cancelarLimpeza, crossfadeComSeguinte, dividirSelecaoAudio, duplicarSelecaoAudio, excluirSelecaoAudio, ICONES_PAPEL, limparVozDoClipe, partesAudio, trocarArquivoDoClipe,
  voltarAoOriginal} from './acoes-audio';
import {CamposMovimento} from './CamposMovimento';
import {abrirNarracaoIA, gerarFalas, narracaoTela, trocarTextoDaCena} from './acoes-narracao'; // narração por IA (docs/narracao.md)
import {itensDaNarracao, ROTULO_ESTADO} from '../../../nucleo/narracao-cenas';
import {lufsTexto, MedidorLoudness, useMedidasLoudness} from './MedidorLoudness';
import {MudancasNoInspetor} from '../../componentes/Agente';

const CURVAS_OPCOES: [CurvaFade, string][] = [['linear', 'Linear'], ['suave', 'Suave'], ['potencia', 'Potência igual']]; // frente Som: forma do fade
const pct = (v: number | undefined, padrao: number) => Math.round((v ?? padrao) * 1000) / 10;
const ALINHAR: [NonNullable<BlocoCenas['alinhar']>, string][] = [['esquerda', 'Esquerda'], ['centro', 'Centro'], ['direita', 'Direita']];
const PESOS: [string, string][] = [['400', 'Normal'], ['500', 'Médio'], ['600', 'Seminegrito'], ['700', 'Negrito'], ['800', 'Extranegrito']];

const sinal = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1).replace('.', ',')}`;

/** O alvo do arquivo exportado e os medidores da narração e da mistura (como o render vai soar). */
const SecaoLoudness: React.FC<{documento: string; doc: DocCenas}> = ({documento, doc}) => {
  const {r, erro, medindo} = useMedidasLoudness(documento);
  const alvo = doc.audio?.alvo_lufs ?? ALVO_LUFS_PADRAO;
  const pico = doc.audio?.pico_dbtp ?? PICO_DBTP_PADRAO;
  const i = r?.mistura.integrado_lufs ?? null;
  const ganho = i === null ? null : Math.round((alvo - i) * 10) / 10;
  const picoDepois = ganho !== null && r?.mistura.pico_dbtp !== null && r?.mistura.pico_dbtp !== undefined ? r.mistura.pico_dbtp + ganho : null;
  const notaMistura = ganho === null ? undefined : Math.abs(ganho) <= 0.5 ? 'já no alvo' : <>na exportação: {sinal(ganho)} dB até {lufsTexto(alvo, 0)} LUFS
    {picoDepois !== null && picoDepois > pico ? <>; o limitador segura o pico em {lufsTexto(pico)} dBTP</> : null}</>;
  const campo = (k: 'alvo_lufs' | 'pico_dbtp', min: number, max: number, padrao: number, nome: string, unidade: string) => (v: number) =>
    v >= min && v <= max ? void trocar(documento, `/audio/${k}`, v === padrao ? undefined : Math.round(v * 10) / 10, `${nome}: ${numeroBr(v, 1)} ${unidade}`)
      : avisar(`${nome[0].toUpperCase()}${nome.slice(1)} vai de ${min} a ${max} ${unidade}`, 'erro');
  return (
    <Secao titulo="Loudness" chave="cenas:loudness">
      <CampoNumero rotulo="Alvo" unidade="LUFS" passo={1} valor={alvo} padrao={ALVO_LUFS_PADRAO} dica="Loudness integrado do arquivo exportado; −14 é o das redes (YouTube, Instagram, Spotify)"
        aoMudar={campo('alvo_lufs', ALVO_LUFS_MIN, ALVO_LUFS_MAX, ALVO_LUFS_PADRAO, 'o alvo de loudness', 'LUFS')} />
      <CampoNumero rotulo="Pico máximo" unidade="dBTP" passo={0.5} valor={pico} padrao={PICO_DBTP_PADRAO} dica="Pico verdadeiro máximo do arquivo exportado"
        aoMudar={campo('pico_dbtp', PICO_DBTP_MIN, PICO_DBTP_MAX, PICO_DBTP_PADRAO, 'o pico máximo', 'dBTP')} />
      {(r?.voz || (!r && medindo)) && <MedidorLoudness titulo="Narração" m={r?.voz} alvo={alvo} pico={pico} medindo={medindo} />}
      <MedidorLoudness titulo="Mistura" m={r?.mistura} alvo={alvo} pico={pico} medindo={medindo} nota={notaMistura} />
      {erro && <div className="vazio" style={{color: 'var(--erro)'}}>Não deu para medir: {erro}</div>}
      {r?.faltando.length ? <div className="vazio">Ficaram fora da medida (não abriram): {r.faltando.map((a) => a.split('/').pop()).join(', ')}</div> : null}
      <div className="vazio">Na exportação, o arquivo final é medido e o ganho corrigido até o alvo (±0,5 LU), com o pico até {lufsTexto(pico)} dBTP. A mistura entre as faixas não muda.</div>
    </Secao>
  );
};

const ResumoVideo: React.FC<{documento: string; doc: DocCenas; titulo: string; duracao: number; avisos: string[]; erro?: string}> = ({documento, doc, titulo, duracao, avisos, erro}) => {
  const f = formatoDoVideo(doc);
  const preset = FORMATOS_VIDEO.find((p) => p.largura === f.largura && p.altura === f.altura);
  const tema = doc.tema ?? {};
  const nBlocos = doc.cenas.reduce((n, c) => n + (c.blocos?.length ?? 0), 0);
  const nClipes = (doc.audio?.faixas ?? []).reduce((n, f) => n + (f.clipes?.length ?? 0), 0);
  return (
    <div className="painel">
      <CabecalhoInspector icone={<Film />} nome={titulo} sub="Vídeo de cenas" dica={rotuloFormato(f)} />
      <div className="insp-corpo">
        <div className="resumo">
          {rotuloFormato(f)} · {formatarTempo(duracao)}<br />
          <b>{doc.cenas.length}</b> {doc.cenas.length === 1 ? 'cena' : 'cenas'} · <b>{nBlocos}</b> {nBlocos === 1 ? 'bloco' : 'blocos'}
          {nClipes > 0 ? <> · <b>{nClipes}</b> {nClipes === 1 ? 'clipe de áudio' : 'clipes de áudio'}</> : <> · sem som (use "+ Áudio" na linha do tempo)</>}
        </div>
        <Secao titulo="Formato" chave="cenas:formato">
          <CampoSelecao rotulo="Destino" valor={preset?.id ?? 'livre'}
            opcoes={[...FORMATOS_VIDEO.map((p): [string, string] => [p.id, `${p.nome} · ${p.proporcao}`]), ...(preset ? [] : [['livre', `${f.largura}×${f.altura}`] as [string, string]])]}
            aoMudar={(id) => {
              const p = FORMATOS_VIDEO.find((x) => x.id === id);
              if (p) void trocar(documento, '/formato', {...f, largura: p.largura, altura: p.altura}, `formato ${p.proporcao}`);
            }} />
          <CampoSelecao rotulo="Quadros por segundo" valor={String(f.fps)} opcoes={['24', '25', '30', '50', '60'].map((n): [string, string] => [n, n])}
            aoMudar={(n) => void trocar(documento, '/formato', {...f, fps: Number(n)}, `${n} quadros por segundo`)} />
        </Secao>
        <Secao titulo="Cores" chave="cenas:cores">
          <CampoCor rotulo="Fundo" valor={tema.fundo ?? TEMA_NEUTRO.fundo} aoMudar={(v) => void trocar(documento, '/tema/fundo', v, 'cor de fundo')} />
          <CampoCor rotulo="Texto" valor={tema.texto ?? TEMA_NEUTRO.texto} aoMudar={(v) => void trocar(documento, '/tema/texto', v, 'cor do texto')} />
          <CampoCor rotulo="Destaque" valor={tema.destaque ?? TEMA_NEUTRO.destaque} aoMudar={(v) => void trocar(documento, '/tema/destaque', v, 'cor de destaque')} />
          <CampoCor rotulo="Texto suave" valor={tema.suave ?? TEMA_NEUTRO.suave} aoMudar={(v) => void trocar(documento, '/tema/suave', v, 'cor do texto suave')} />
        </Secao>
        {nClipes > 0 && <SecaoLoudness documento={documento} doc={doc} />}
        {erro && <Secao titulo="Não deu para montar o vídeo"><div className="texto-livre" style={{color: 'var(--erro)'}}>{erro}</div></Secao>}
        {avisos.length > 0 && <Secao titulo={`Avisos (${avisos.length})`}><div className="avisos-roteiro">{avisos.map((a, i) => <div key={i}>{a}</div>)}</div></Secao>}
        <div className="vazio">Clique num bloco no monitor, na lista ou na linha do tempo para editar. "**trecho**" no texto sai na cor de destaque.</div>
      </div>
    </div>
  );
};

/** Os fatos que o bloco (ou a cena) cita, um por etiqueta. Tirar um grava `refs` sem ele (ou some com o campo). */
const FatosCitados: React.FC<{documento: string; caminho: string; refs?: string[]; nome: string}> = ({documento, caminho, refs, nome}) => {
  const lista = Array.isArray(refs) ? refs : [];
  // a afirmação de cada fato vem da pesquisa da loja (pesquisa/pesquisa.json); ainda não lida, só o id
  const fatos = useLoja((e) => e.pesquisa?.fatos);
  const tirar = (id: string) => {
    const resto = lista.filter((r) => r !== id);
    void trocar(documento, `${caminho}/refs`, resto.length ? resto : undefined, `tirar o fato ${id} ${nome}`);
  };
  return (
    <Secao titulo={lista.length ? `Fatos citados (${lista.length})` : 'Fatos citados'} chave="cenas:refs">
      {lista.length ? (
        <div className="etiquetas-fato">
          {lista.map((id) => {
            const fato = fatos?.find((f) => f.id === id);
            const sem = Boolean(fatos && !fato); // id que não está na pesquisa: só aviso, o bloco segue igual
            return (
              <span key={id} className={`etiqueta etiqueta-fato${sem ? ' sem-fato' : ''}`} onClick={() => verFato(id)}
                title={fato ? `${id}: ${fato.afirmacao}\n${fato.estado === 'trecho_confere' ? 'trecho confere' : 'a revisar'} · clique para ver no painel Pesquisa`
                  : sem ? `O ${id} não está na pesquisa deste projeto` : `Fato ${id} da pesquisa`}>
                <Quote />
                {id}
                {fato && <span className="afirmacao">{fato.afirmacao}</span>}
                <button type="button" aria-label={`Tirar o fato ${id}`} title="Tirar este fato da lista"
                  onClick={(e) => (e.stopPropagation(), tirar(id))}><X /></button>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="vazio">Nenhum fato da pesquisa citado. Peça ao Claude para ligar a este bloco os fatos que sustentam o texto.</div>
      )}
    </Secao>
  );
};

/** A fala da cena (narração por IA): o roteiro falado, o estado dela e "Gerar esta cena"; o resto fica no painel Narração por IA. */
const FalaDaCena: React.FC<{documento: string; n: number}> = ({documento, n}) => {
  const doc = useLoja((e) => e.docs[documento]?.doc) as DocCenas | undefined;
  const andamento = useSyncExternalStore(narracaoTela.assinar, () => narracaoTela.ler().andamento);
  const it = doc ? itensDaNarracao(doc)[n - 1] : undefined;
  if (!doc || !it) return null;
  return (
    <Secao titulo={`Fala (narração por IA) · ${ROTULO_ESTADO[it.estado]}`} chave="cenas:fala">
      <CampoTexto rotulo="Texto falado" multilinha dica="O que a voz fala nesta cena; o texto da tela pode ser outro. [pausa] e [pausa longa] fazem pausa."
        valor={doc.cenas[n - 1]?.narracao?.texto ?? ''} aoMudar={(v) => void trocarTextoDaCena(documento, n - 1, v)} />
      {it.clipe && <CampoLeitura rotulo="Fala gerada">{numeroBr(it.clipe.duracao_ms / 1000, 1)} s{it.clipe.em + it.clipe.duracao_ms > it.t_out + 1 ? ' · passa do fim da cena' : ''}</CampoLeitura>}
      <div style={{padding: '2px 10px 6px 18px', display: 'flex', gap: 6}}>
        {it.estado !== 'sem_texto' && it.estado !== 'gravada' && <button className="bt mini" disabled={Boolean(andamento)} onClick={() => void gerarFalas(documento, {cenas: [it.cena], refazer: it.estado === 'gerada'})}
          title={it.estado === 'gerada' ? `Pede outra tomada ao Google (tem custo; ${rotuloDoAtalho('Ctrl+Z')} volta à anterior)` : undefined}>{it.estado === 'gerada' ? 'Outra tomada' : 'Gerar esta cena'}</button>}
        <button className="bt mini fantasma" onClick={() => abrirNarracaoIA(documento)}>Narração por IA…</button>
      </div>
    </Secao>
  );
};

const PropsCena: React.FC<{documento: string; caminho: string; c: CenaCenas; n: number; menu: ItemMenu[]}> = ({documento, caminho, c, n, menu}) => (
  <div className="painel">
    <CabecalhoInspector icone={<Clapperboard />} nome={c.nome || `Cena ${n}`} sub={`Cena ${n} · ${numeroBr((c.duracao_ms ?? 0) / 1000, 1)} s`} dica={caminho} menu={menu} />
    <div className="insp-corpo">
      <Secao titulo="Cena" chave="cenas:cena">
        <CampoTexto rotulo="Nome" valor={c.nome ?? ''} aoMudar={(v) => void trocar(documento, `${caminho}/nome`, v || undefined, 'nome da cena')} />
        <CampoNumero rotulo="Duração" unidade="s" passo={0.1} valor={(c.duracao_ms ?? 4000) / 1000}
          aoMudar={(v) => (v >= 0.3 ? void trocar(documento, `${caminho}/duracao_ms`, Math.round(v * 1000), `duração: ${numeroBr(v, 1)} s`) : avisar('A cena precisa de pelo menos 0,3 s', 'erro'))} />
        <CampoCor rotulo="Fundo" valor={c.fundo ?? ''} aoMudar={(v) => void trocar(documento, `${caminho}/fundo`, v, 'fundo da cena')} />
        {c.fundo !== undefined && (
          <div style={{padding: '2px 10px 6px 18px'}}>
            <button className="bt mini" title="Tira a cor própria: a cena volta a usar o fundo do tema (Ctrl+Z desfaz)"
              onClick={() => void trocar(documento, `${caminho}/fundo`, undefined, 'fundo da cena volta ao tema')}>Voltar ao fundo do tema</button>
          </div>
        )}{/* video-D15 (frente C) */}
      </Secao>
      <FalaDaCena documento={documento} n={n} />
      {c.refs?.length ? <FatosCitados documento={documento} caminho={caminho} refs={c.refs} nome="da cena" /> : null}
      <div className="vazio">Arraste a ponta azul da cena na linha do tempo para mudar a duração.</div>
    </div>
  </div>
);

/** Prende a entrada ou a saída do bloco a uma palavra da fala da cena: a lista traz as palavras transcritas que caem na
 *  cena, com o segundo em que cada uma começa (ou acaba, na saída). Escolher grava a âncora (`em_palavra`/`sai_palavra`)
 *  e põe o tempo em ms no mesmo ponto, que vale quando a palavra some (fala trocada, legendas apagadas). "Nenhuma" solta. */
const CampoPalavra: React.FC<{documento: string; caminho: string; b: BlocoCenas; qual: 'em' | 'sai'; palavras: Palavra[]; durCena: number}> =
  ({documento, caminho, b, qual, palavras, durCena}) => {
    const chave = qual === 'em' ? 'em_palavra' : 'sai_palavra';
    const atual = b[chave];
    const fim = qual === 'sai';
    const verbo = qual === 'em' ? 'entra' : 'sai';
    const opcoes: [string, string][] = [['', 'Nenhuma (tempo em s)'],
      ...palavras.flatMap((p): [string, string][] => {
        const a = ancoraDaPalavra(p, fim);
        return a ? [[a, `${p.w.trim()} · ${numeroBr((fim ? p.e : p.s) / 1000, 1)} s`]] : [];
      })];
    const r = typeof atual === 'string' && atual ? tempoDaAncora(atual, palavras) : null;
    const escolher = (v: string) => {
      if (!v) return void trocar(documento, `${caminho}/${chave}`, undefined, `bloco solto da palavra (${qual === 'em' ? 'entrada' : 'saída'})`);
      const doc = loja.get().docs[documento]?.doc;
      const achado = tempoDaAncora(v, palavras);
      const ms = 'ms' in achado ? Math.round(Math.max(0, Math.min(durCena, achado.ms))) : undefined;
      const w = 'ms' in achado ? achado.palavra.w.trim() : v;
      const tempo = ms === undefined ? []
        : qual === 'em' ? patchTrocar(doc, `${caminho}/em`, Math.min(ms, durCena - 100))
          : patchTrocar(doc, `${caminho}/sai`, ms >= durCena ? undefined : Math.max((b.em ?? 0) + 100, ms));
      void aplicar(documento, [...patchTrocar(doc, `${caminho}/${chave}`, v), ...tempo], `bloco ${verbo} em "${w}"`);
    };
    return (
      <>
        <CampoSelecao rotulo={qual === 'em' ? 'Entra na palavra' : 'Sai na palavra'} valor={typeof atual === 'string' ? atual : ''} opcoes={opcoes} padrao=""
          aoMudar={escolher} />
        {r && 'erro' in r && (
          <div className="vazio">{palavras.length ? `Não achei a palavra (${r.erro}); o bloco ${verbo} no tempo em segundos.`
            : `A cena não tem fala transcrita; o bloco ${verbo} no tempo em segundos até a fala ser transcrita.`}</div>
        )}
      </>
    );
  };

const PropsBloco: React.FC<{documento: string; caminho: string; b: BlocoCenas; formato: {largura: number; altura: number}; durCena: number; menu: ItemMenu[]; sub: string;
  palavras: Palavra[]}> =
  ({documento, caminho, b, formato, durCena, menu, sub, palavras}) => {
    const t = tipoDe(b.tipo);
    const Icone = t.icone;
    const padrao = TIPOS_BLOCO_CENAS[b.tipo] ?? TIPOS_BLOCO_CENAS.texto;
    const menor = Math.min(formato.largura, formato.altura);
    const campo = (k: keyof BlocoCenas, rotulo: string) => (v: unknown) => void trocar(documento, `${caminho}/${k}`, v, `${rotulo} do bloco`);
    // o tempo em segundos escolhido à mão solta o bloco da palavra naquela ponta (senão a palavra continuaria mandando)
    const tempoEmMs = (k: 'em' | 'sai', v: number | undefined, rotulo: string) => {
      const ancora = k === 'em' ? 'em_palavra' : 'sai_palavra';
      if (b[ancora] === undefined) return campo(k, rotulo)(v);
      const doc = loja.get().docs[documento]?.doc;
      void aplicar(documento, [...patchTrocar(doc, `${caminho}/${k}`, v), ...patchTrocar(doc, `${caminho}/${ancora}`, undefined)], `${rotulo} do bloco (solto da palavra)`);
    };
    const fracao = (k: 'x' | 'y' | 'largura' | 'altura', rotulo: string, p: number) => (
      <CampoNumero rotulo={rotulo} unidade="%" passo={1} valor={pct(b[k], p)} aoMudar={(v) => campo(k, rotulo.toLowerCase())(Math.round(v * 10) / 1000)} />
    );
    const escolherImagem = async () => {
      try {
        const src = await window.estudio.escolherMidia('imagem');
        if (src) await trocar(documento, `${caminho}/src`, src, 'imagem do bloco');
      } catch (e) {
        avisar(mensagemDe(e), 'erro');
      }
    };
    return (
      <div className="painel">
        <CabecalhoInspector icone={<Icone />} familia={t.familia} nome={[t.nome, resumoBloco(b, 28)].filter(Boolean).join(' · ')} sub={sub} dica={b.id} menu={menu} />
        <MudancasNoInspetor documento={documento} objeto={caminho}
          formatar={(campo, v) => (typeof v === 'number' && ['x', 'y', 'largura'].includes(campo) ? `${numeroBr(v * 100, 1)} %` : undefined)} />
        <div className="insp-corpo">
          <Secao titulo="Conteúdo" chave="cenas:conteudo">
            {(b.tipo === 'titulo' || b.tipo === 'texto') && <CampoTexto rotulo="Texto" multilinha valor={b.texto ?? ''} aoMudar={campo('texto', 'texto')} />}
            {b.tipo === 'lista' && <CampoTexto rotulo="Itens (um por linha)" multilinha valor={(b.itens ?? []).join('\n')}
              aoMudar={(v) => campo('itens', 'itens')(v.split('\n').map((x) => x.trim()).filter(Boolean))} />}
            {b.tipo === 'numero' && (
              <>
                <CampoNumero rotulo="Conta de" valor={b.de ?? 0} aoMudar={campo('de', 'início da contagem')} />
                <CampoNumero rotulo="Conta até" valor={b.ate ?? 0} aoMudar={campo('ate', 'fim da contagem')} />
                <CampoTexto rotulo="Antes" valor={b.prefixo ?? ''} aoMudar={(v) => campo('prefixo', 'prefixo')(v || undefined)} />
                <CampoTexto rotulo="Depois" valor={b.sufixo ?? ''} aoMudar={(v) => campo('sufixo', 'sufixo')(v || undefined)} />
                <CampoTexto rotulo="Legenda" valor={b.rotulo ?? ''} aoMudar={(v) => campo('rotulo', 'legenda')(v || undefined)} />
                <CampoSelecao rotulo="Casas decimais" valor={b.casas === undefined ? 'auto' : String(b.casas)}
                  opcoes={[['auto', 'Automático'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']]} padrao="auto"
                  aoMudar={(v) => campo('casas', 'casas decimais')(v === 'auto' ? undefined : Number(v))} />{/* video-D8 (frente C) */}
              </>
            )}
            {b.tipo === 'imagem' && (
              <>
                <CampoLeitura rotulo="Arquivo">{b.src ? b.src.split('/').pop() : 'nenhum'}</CampoLeitura>
                <div style={{padding: '2px 8px 6px'}}><button className="bt" onClick={() => void escolherImagem()}><ImagePlus size={14} />{b.src ? 'Trocar imagem…' : 'Escolher imagem…'}</button></div>
                <CampoSelecao rotulo="Encaixe" valor={b.ajuste ?? 'conter'} opcoes={[['conter', 'Inteira'], ['cobrir', 'Preencher']]} aoMudar={campo('ajuste', 'encaixe')} />
                <CamposMovimento documento={documento} caminho={caminho} b={b} />{/* Ken Burns (frente C) */}
              </>
            )}
          </Secao>
          <Secao titulo="Tempo" chave="cenas:tempo">
            <CampoNumero rotulo="Entra" unidade="s" passo={0.1} valor={(b.em ?? 0) / 1000}
              aoMudar={(v) => tempoEmMs('em', Math.max(0, Math.min(durCena - 100, Math.round(v * 1000))), 'entrada')} />
            <CampoNumero rotulo="Sai" unidade="s" passo={0.1} valor={(b.sai ?? durCena) / 1000} padrao={durCena / 1000}
              aoRedefinir={b.sai !== undefined ? () => tempoEmMs('sai', undefined, 'saída') : undefined}
              aoMudar={(v) => tempoEmMs('sai', v * 1000 >= durCena ? undefined : Math.max((b.em ?? 0) + 100, Math.round(v * 1000)), 'saída')} />
            {palavras.length || b.em_palavra !== undefined || b.sai_palavra !== undefined ? (
              <>
                <CampoPalavra documento={documento} caminho={caminho} b={b} qual="em" palavras={palavras} durCena={durCena} />
                <CampoPalavra documento={documento} caminho={caminho} b={b} qual="sai" palavras={palavras} durCena={durCena} />
              </>
            ) : <div className="vazio">Com a fala da cena transcrita (legendas), dá para prender o bloco a uma palavra.</div>}
          </Secao>
          <Secao titulo="Posição e tamanho" chave="cenas:posicao">
            {fracao('x', 'X', 0.1)}
            {fracao('y', 'Y', 0.4)}
            {fracao('largura', 'Largura', 0.8)}
            {b.tipo === 'imagem' && fracao('altura', 'Altura', 0.4)}
            {b.tipo !== 'imagem' && (
              <CampoNumero rotulo="Letra" unidade="px" valor={Math.round((b.tam ?? padrao.tam) * menor)} padrao={Math.round(padrao.tam * menor)}
                aoRedefinir={b.tam !== undefined ? () => campo('tam', 'tamanho da letra')(undefined) : undefined}
                aoMudar={(v) => (v > 4 ? campo('tam', 'tamanho da letra')(Math.round((v / menor) * 10000) / 10000) : avisar('Letra muito pequena', 'erro'))} />
            )}
          </Secao>
          {b.tipo !== 'imagem' && (
            <Secao titulo="Estilo" chave="cenas:estilo">
              <CampoSelecao rotulo="Alinhar" valor={b.alinhar ?? 'centro'} opcoes={ALINHAR} aoMudar={campo('alinhar', 'alinhamento')} />
              <CampoSelecao rotulo="Peso" valor={String(b.peso ?? padrao.peso)} opcoes={PESOS} aoMudar={(v) => campo('peso', 'peso da letra')(Number(v))} />
              <CampoCor rotulo="Cor" valor={b.cor ?? ''} aoMudar={campo('cor', 'cor')} />
              {b.cor !== undefined && (
                <div style={{padding: '2px 10px 6px 18px'}}>
                  <button className="bt mini" title="Tira a cor própria: o bloco volta a usar a cor do tema (Ctrl+Z desfaz)"
                    onClick={() => campo('cor', 'cor volta ao tema')(undefined)}>Voltar à cor do tema</button>
                </div>
              )}{/* video-D15 (frente C) */}
            </Secao>
          )}
          <FatosCitados documento={documento} caminho={caminho} refs={b.refs} nome="do bloco" />
        </div>
      </div>
    );
  };

const PAPEL_OPCOES = (Object.keys(PAPEIS) as PapelFaixa[]).map((p): [PapelFaixa, string] => [p, PAPEIS[p].nome_faixa]);
const pctDe = (v: number | undefined) => Math.round((v ?? 1) * 100);
const dbTexto = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1).replace('.', ',')} dB`);

/** O loudness da faixa sozinha na mistura; música e efeitos dizem quantos LU ficam abaixo da narração enquanto ela fala. */
const LoudnessDaFaixa: React.FC<{documento: string; fp?: FaixaAudioP; nome: string; mudo: boolean; som?: AudioP}> = ({documento, fp, nome, mudo, som}) => {
  const {r, medindo} = useMedidasLoudness(documento);
  const m = fp ? r?.faixas[fp.origem] : undefined;
  const abaixo = m?.abaixo_da_voz_lu;
  const nota = mudo ? 'faixa muda: fica fora da mistura'
    : abaixo !== null && abaixo !== undefined ? `sob a voz: ${numeroBr(abaixo, 1)} LU abaixo da narração (mediana; a casa mixa de 18 a 23)`
      : abaixo === null ? 'calada enquanto a narração fala' : undefined;
  return (
    <Secao titulo="Loudness" chave="audio:loudness">
      <MedidorLoudness titulo={nome} m={mudo ? null : m} alvo={fp?.papel === 'voz' ? som?.alvo_lufs ?? ALVO_LUFS_PADRAO : null} pico={som?.pico_dbtp ?? PICO_DBTP_PADRAO}
        medindo={medindo && !mudo} nota={nota} />
    </Secao>
  );
};

const PropsFaixa: React.FC<{documento: string; caminho: string; f: FaixaAudio; fp?: FaixaAudioP; som?: AudioP; menu: ItemMenu[]}> = ({documento, caminho, f, fp, som, menu}) => {
  const papel = fp?.papel ?? 'efeitos';
  const Icone = ICONES_PAPEL[papel];
  const campo = (k: keyof FaixaAudio, rotulo: string) => (v: unknown) => void trocar(documento, `${caminho}/${k}`, v, `${rotulo} da faixa ${f.nome}`);
  const d = f.ducking ?? {};
  // o ducking é um objeto só: grava inteiro, sem a chave que voltou ao padrão
  const duck = (k: 'ativo' | 'alvo_lu' | 'ataque_ms' | 'soltura_ms', rotulo: string) => (v: unknown) => {
    const novo: Record<string, unknown> = {...d};
    if (v === undefined) delete novo[k];
    else novo[k] = v;
    void trocar(documento, `${caminho}/ducking`, Object.keys(novo).length ? novo : undefined, `${rotulo} do ducking`);
  };
  const medidos = (fp?.clipes ?? []).map((c) => c.ducking).filter((x): x is NonNullable<ClipeAudioP['ducking']> => Boolean(x));
  const m = medidos[0];
  const n = f.clipes?.length ?? 0;
  return (
    <div className="painel">
      <CabecalhoInspector icone={<Icone />} familia={'audio' as never} nome={f.nome} sub={`Faixa de ${PAPEIS[papel].nome_faixa.toLowerCase()} · ${n} ${n === 1 ? 'clipe' : 'clipes'}`} dica={caminho} menu={menu} />
      <div className="insp-corpo">
        <Secao titulo="Faixa" chave="audio:faixa">
          <CampoTexto rotulo="Nome" valor={f.nome ?? ''} aoMudar={(v) => campo('nome', 'nome')(v || PAPEIS[papel].nome_faixa)} />
          <CampoSelecao rotulo="Papel" valor={papel} opcoes={PAPEL_OPCOES} aoMudar={campo('papel', 'papel')} />
          <CampoDeslizante rotulo="Volume" min={0} max={100} passo={1} valor={pctDe(f.volume)} padrao={100} formatar={(v) => `${v} %`}
            aoMudar={(v) => campo('volume', 'volume')(v === 100 ? undefined : Math.round(v) / 100)} />
          <CampoInterruptor rotulo="Mudo" valor={Boolean(f.mudo)} aoMudar={(v) => campo('mudo', 'mudo')(v || undefined)} texto={f.mudo ? 'a faixa não toca' : 'toca'} />
        </Secao>
        {papel === 'musica' && (
          <Secao titulo="Ducking (cai sob a voz)" chave="audio:ducking">
            <CampoInterruptor rotulo="Ligado" valor={d.ativo !== false} aoMudar={(v) => duck('ativo', 'ligar')(v ? undefined : false)}
              dica="A música baixa enquanto a narração fala e volta nas pausas" />
            <CampoDeslizante rotulo="Abaixo da voz" min={ALVO_LU_MIN} max={ALVO_LU_MAX} passo={1} valor={d.alvo_lu ?? DUCKING_PADRAO.alvo_lu} padrao={DUCKING_PADRAO.alvo_lu}
              formatar={(v) => `${v} LU`} aoMudar={(v) => duck('alvo_lu', 'alvo')(v === DUCKING_PADRAO.alvo_lu ? undefined : v)} />
            <CampoNumero rotulo="Ataque" unidade="ms" valor={d.ataque_ms ?? DUCKING_PADRAO.ataque_ms} padrao={DUCKING_PADRAO.ataque_ms}
              aoMudar={(v) => duck('ataque_ms', 'ataque')(Math.max(1, Math.round(v)))} aoRedefinir={() => duck('ataque_ms', 'ataque')(undefined)} />
            <CampoNumero rotulo="Soltura" unidade="ms" valor={d.soltura_ms ?? DUCKING_PADRAO.soltura_ms} padrao={DUCKING_PADRAO.soltura_ms}
              aoMudar={(v) => duck('soltura_ms', 'soltura')(Math.max(1, Math.round(v)))} aoRedefinir={() => duck('soltura_ms', 'soltura')(undefined)} />
            <CampoLeitura rotulo="Medido" dica="Mediana da voz e da música com os volumes de faixa e clipe; a redução é o que falta para a música ficar o alvo abaixo da voz">
              {m ? (m.medido ? <>voz {dbTexto(m.voz_db)} · música {dbTexto(m.musica_db)} · cai <b>{dbTexto(m.reducao_db)}</b></> : <>medindo… (por ora cai {dbTexto(m.reducao_db)})</>)
                : n ? 'sem narração para seguir' : 'sem clipes'}
            </CampoLeitura>
            <div className="vazio">A casa mixa música e efeitos bem baixos: de 18 a 23 LU abaixo da voz.</div>
          </Secao>
        )}
        {n > 0 && <LoudnessDaFaixa documento={documento} fp={fp} nome={f.nome} mudo={Boolean(f.mudo)} som={som} />}
        {papel !== 'voz' && <CriarEmMusica documento={documento} faixa={f} />}
      </div>
    </div>
  );
};

/** Limpeza de voz do clipe: intensidade, Limpar (com andamento e Cancelar) e, já limpo, o que mudou e "Voltar ao original". */
const SecaoLimpeza: React.FC<{documento: string; caminho: string; c: ClipeAudio}> = ({documento, caminho, c}) => {
  const andamento = useSyncExternalStore(assinarLimpeza, andamentoLimpeza);
  const [intensidade, setIntensidade] = useState<IntensidadeLimpeza>(c.limpeza?.intensidade ?? INTENSIDADE_PADRAO);
  const aqui = andamento?.documento === documento && andamento.caminho === caminho;
  const l = c.original ? c.limpeza : undefined;
  return (
    <Secao titulo="Limpeza de voz" chave="audio:limpeza">
      {c.original && (
        <CampoLeitura rotulo="Limpa" dica={`O clipe toca ${c.arquivo}; o original (${c.original}) continua em midia/`}>
          {l ? INTENSIDADES[l.intensidade]?.nome ?? l.intensidade : c.original.split('/').pop()}
        </CampoLeitura>
      )}
      {l && <CampoLeitura rotulo="Ruído" dica="Ruído de fundo nas pausas (as 10 % janelas mais quietas), antes e depois">{dbTexto(l.ruido_antes_db)} → <b>{dbTexto(l.ruido_depois_db)}</b></CampoLeitura>}
      {l && <CampoLeitura rotulo="Voz" dica="Nível da voz (mediana, ponderação K) antes e depois">{dbTexto(l.voz_antes_db)} → {dbTexto(l.voz_depois_db)}</CampoLeitura>}
      <CampoSelecao rotulo="Intensidade" valor={intensidade} opcoes={(Object.keys(INTENSIDADES) as IntensidadeLimpeza[]).map((k): [IntensidadeLimpeza, string] => [k, INTENSIDADES[k].nome])}
        aoMudar={setIntensidade} />
      {aqui ? (
        <div className="limpeza-andamento">
          <div className="som-andamento"><span style={{width: `${andamento.progresso}%`}} /></div>
          <span className="ler">{andamento.progresso} %</span>
          <button className="bt" onClick={cancelarLimpeza}><X size={14} />Cancelar</button>
        </div>
      ) : (
        <div className="limpeza-botoes">
          <button className="bt" disabled={Boolean(andamento)} onClick={() => void limparVozDoClipe(documento, caminho, intensidade)}>
            <Sparkles size={14} />{c.original ? 'Limpar de novo' : 'Limpar voz'}
          </button>
          {c.original && <button className="bt" disabled={Boolean(andamento)} onClick={() => void voltarAoOriginal(documento, caminho)}><Undo2 size={14} />Voltar ao original</button>}
        </div>
      )}
      <div className="vazio">Tira o zumbido e o ruído de fundo das pausas, corta o grave e o chiado e suaviza o "s". Grava um arquivo novo em midia/; o original não muda.</div>
    </Secao>
  );
};

const PropsClipe: React.FC<{documento: string; caminho: string; c: ClipeAudio; cp?: ClipeAudioP; faixa: FaixaAudio; papel: PapelFaixa; menu: ItemMenu[]; sub: string}> =
  ({documento, caminho, c, cp, faixa, papel, menu, sub}) => {
    const Icone = ICONES_PAPEL[papel];
    const nome = c.nome || c.arquivo.split('/').pop() || c.arquivo;
    const campo = (k: keyof ClipeAudio, rotulo: string) => (v: unknown) => void trocar(documento, `${caminho}/${k}`, v, `${rotulo} do clipe ${nome}`);
    const env = cp?.envelope;
    const maxDur = env ? Math.max(0.1, (env.duracao_ms - (c.corte_ms ?? 0)) / 1000) : undefined;
    return (
      <div className="painel">
        <CabecalhoInspector icone={<Icone />} familia={'audio' as never} nome={nome} sub={sub} dica={c.id} menu={menu} />
        <div className="insp-corpo">
          <Secao titulo="Arquivo" chave="audio:arquivo">
            <CampoLeitura rotulo="Arquivo" dica={c.arquivo}>{c.arquivo.split('/').pop()}</CampoLeitura>
            <CampoLeitura rotulo="Medido">{env ? <>{numeroBr(env.duracao_ms / 1000, 1)} s · {dbTexto(cp?.nivel_db)} (mediana)</> : 'medindo…'}</CampoLeitura>
            <div style={{padding: '2px 8px 6px'}}><button className="bt" onClick={() => void trocarArquivoDoClipe(documento, caminho)}><FileAudio size={14} />Trocar arquivo…</button></div>
            <CampoTexto rotulo="Nome" valor={c.nome ?? ''} aoMudar={(v) => campo('nome', 'nome')(v || undefined)} dica="Como aparece na linha do tempo (vazio = nome do arquivo)" />
          </Secao>
          <Secao titulo="Tempo" chave="audio:tempo">
            <CampoNumero rotulo="Começa em" unidade="s" passo={0.1} valor={(c.em ?? 0) / 1000} aoMudar={(v) => campo('em', 'começo')(Math.max(0, Math.round(v * 1000)))} />
            <CampoNumero rotulo="Duração" unidade="s" passo={0.1} valor={(c.duracao_ms ?? 0) / 1000} padrao={maxDur} aoRedefinir={maxDur !== undefined ? () => campo('duracao_ms', 'duração')(Math.round(maxDur * 1000)) : undefined}
              aoMudar={(v) => (v >= 0.1 ? campo('duracao_ms', 'duração')(Math.round(Math.min(maxDur ?? Infinity, v) * 1000)) : avisar('O clipe precisa de pelo menos 0,1 s', 'erro'))} />
            <CampoNumero rotulo="Corte no arquivo" unidade="s" passo={0.1} valor={(c.corte_ms ?? 0) / 1000} padrao={0} dica="Quanto do começo do arquivo fica de fora"
              aoRedefinir={c.corte_ms ? () => campo('corte_ms', 'corte')(undefined) : undefined}
              aoMudar={(v) => campo('corte_ms', 'corte')(v > 0 ? Math.round(v * 1000) : undefined)} />
            <div className="limpeza-botoes" style={{padding: '2px 8px 6px'}}>
              <button className="bt" onClick={() => void dividirSelecaoAudio(documento)} title="Divide o clipe onde está a cabeça (Ctrl+K): as duas metades tocam o mesmo som, com as legendas"><Scissors size={14} />Dividir na cabeça</button>
              <button className="bt" onClick={() => void crossfadeComSeguinte(documento)} title="Os dois clipes se sobrepõem e um desce enquanto o outro sobe"><Shuffle size={14} />Crossfade com o seguinte</button>
            </div>
          </Secao>
          <Secao titulo="Volume" chave="audio:volume">
            <CampoDeslizante rotulo="Volume" min={0} max={100} passo={1} valor={pctDe(c.volume)} padrao={100} formatar={(v) => `${v} %`}
              aoMudar={(v) => campo('volume', 'volume')(v === 100 ? undefined : Math.round(v) / 100)} />
            <CampoNumero rotulo="Fade de entrada" unidade="s" passo={0.1} valor={(c.fade_in_ms ?? 0) / 1000} padrao={0}
              aoMudar={(v) => campo('fade_in_ms', 'fade de entrada')(v > 0 ? Math.round(v * 1000) : undefined)} />
            {(c.fade_in_ms ?? 0) > 0 && <CampoSelecao rotulo="Curva da entrada" valor={c.fade_in_curva ?? 'linear'} opcoes={CURVAS_OPCOES} aoMudar={(v) => campo('fade_in_curva', 'curva da entrada')(v === 'linear' ? undefined : v)} />}
            <CampoNumero rotulo="Fade de saída" unidade="s" passo={0.1} valor={(c.fade_out_ms ?? 0) / 1000} padrao={0}
              aoMudar={(v) => campo('fade_out_ms', 'fade de saída')(v > 0 ? Math.round(v * 1000) : undefined)} />
            {(c.fade_out_ms ?? 0) > 0 && <CampoSelecao rotulo="Curva da saída" valor={c.fade_out_curva ?? 'linear'} opcoes={CURVAS_OPCOES} aoMudar={(v) => campo('fade_out_curva', 'curva da saída')(v === 'linear' ? undefined : v)} />}
            <CampoInterruptor rotulo="Mudo" valor={Boolean(c.mudo)} aoMudar={(v) => campo('mudo', 'mudo')(v || undefined)} texto={c.mudo ? 'não toca' : 'toca'} />
            {cp?.ducking && (
              <CampoLeitura rotulo="Ducking" dica="Vem da faixa de música: a redução sob a voz, medida">
                {cp.ducking.reducao_db > 0 ? <>cai <b>{dbTexto(cp.ducking.reducao_db)}</b> sob a voz{cp.ducking.medido ? '' : ' (estimado até medir)'}</> : 'nada a baixar: a música já está abaixo do alvo'}
              </CampoLeitura>
            )}
          </Secao>
          {(papel === 'voz' || c.original) && <SecaoLimpeza key={caminho} documento={documento} caminho={caminho} c={c} />}
          {papel !== 'voz' && <MusicaDoClipe documento={documento} caminho={caminho} c={c} faixa={faixa} />}
          <div className="vazio">Arraste o clipe na linha do tempo para mudar onde começa; as alças aparam o começo e o fim. Faixa: {faixa.nome}.</div>
        </div>
      </div>
    );
  };

export const InspectorCenas: React.FC<{documento: string}> = ({documento}) => {
  const lido = useLoja((e) => e.docs[documento]);
  const montado = useLoja((e) => e.props[documento]);
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === documento)?.titulo ?? documento);
  const selecao = useLoja((e) => e.selecao);
  const doc = lido?.doc as DocCenas;
  const props = montado && 'props' in montado ? montado.props : null;
  const caminho = selecao?.documento === documento ? selecao.caminho : null;
  const pa = caminho ? partesAudio(caminho) : null;
  const faixaDoc = pa ? doc.audio?.faixas?.[pa.faixa] : undefined;
  if (caminho && pa && faixaDoc) {
    const fp = (props as PropsCenas | null)?.audio?.faixas.find((f) => f.origem === `/audio/faixas/${pa.faixa}`);
    const menuAudio: ItemMenu[] = [
      {rotulo: 'Duplicar', icone: <CopyPlus className="i14" />, tecla: 'Ctrl+D', acao: () => void duplicarSelecaoAudio(documento)},
      ...(pa.clipe !== null ? [
        {rotulo: 'Dividir na cabeça', icone: <Scissors className="i14" />, tecla: 'Ctrl+K', acao: () => void dividirSelecaoAudio(documento)},
        {rotulo: 'Crossfade com o seguinte', icone: <Shuffle className="i14" />, acao: () => void crossfadeComSeguinte(documento)},
      ] : []),
      {rotulo: 'Excluir', icone: <Trash2 className="i14" />, tecla: 'Delete', acao: () => void excluirSelecaoAudio(documento)},
      'sep',
      {rotulo: 'Copiar caminho', icone: <Link className="i14" />, acao: () => copiar(caminho, `Caminho ${caminho} copiado`)},
      {rotulo: 'Copiar JSON', icone: <FileJson className="i14" />, acao: () => copiar(JSON.stringify(valorEm(doc, caminho), null, 2), 'JSON copiado')},
    ];
    if (pa.clipe === null) return <PropsFaixa documento={documento} caminho={caminho} f={faixaDoc} fp={fp} som={(props as PropsCenas | null)?.audio} menu={menuAudio} />;
    const clipe = faixaDoc.clipes?.[pa.clipe];
    if (clipe) {
      return <PropsClipe documento={documento} caminho={caminho} c={clipe} cp={fp?.clipes.find((c) => c.origem === caminho)} faixa={faixaDoc} papel={fp?.papel ?? 'efeitos'} menu={menuAudio}
        sub={`${faixaDoc.nome} · clipe ${pa.clipe + 1} · ${numeroBr((clipe.duracao_ms ?? 0) / 1000, 1)} s`} />;
    }
  }
  const m = caminho ? /^\/cenas\/(\d+)(?:\/blocos\/(\d+))?$/.exec(caminho) : null;
  const obj = caminho && m ? valorEm(doc, caminho) : undefined;
  if (!caminho || !m || !obj || typeof obj !== 'object') {
    return <ResumoVideo documento={documento} doc={doc} titulo={titulo} duracao={props?.duracao_ms ?? 0}
      avisos={montado && 'avisos' in montado ? montado.avisos : []} erro={montado && 'erro' in montado ? montado.erro : undefined} />;
  }
  const n = Number(m[1]) + 1;
  const cena = doc.cenas[Number(m[1])];
  const menu: ItemMenu[] = [
    {rotulo: 'Duplicar', icone: <CopyPlus className="i14" />, tecla: 'Ctrl+D', acao: () => void duplicarSelecao(documento)},
    {rotulo: 'Excluir', icone: <Trash2 className="i14" />, tecla: 'Delete', acao: () => void excluirSelecao(documento)},
    'sep',
    {rotulo: 'Copiar caminho', icone: <Link className="i14" />, acao: () => copiar(caminho, `Caminho ${caminho} copiado`)},
    {rotulo: 'Copiar JSON', icone: <FileJson className="i14" />, acao: () => copiar(JSON.stringify(obj, null, 2), 'JSON copiado')},
  ];
  if (m[2] === undefined) return <PropsCena documento={documento} caminho={caminho} c={obj as CenaCenas} n={n} menu={menu} />;
  const cenaP: CenaCenasP | undefined = (props as PropsCenas | null)?.cenas?.[Number(m[1])];
  const palavras = cenaP ? palavrasDaCena((props as PropsCenas).legendas_cenas, cenaP.t_in, cenaP.t_out) : [];
  return <PropsBloco documento={documento} caminho={caminho} b={obj as BlocoCenas} formato={formatoDoVideo(doc)} durCena={cena?.duracao_ms ?? 4000} menu={menu}
    sub={`Cena ${n}${cena?.nome ? ` · ${cena.nome}` : ''} · bloco ${Number(m[2]) + 1}`} palavras={palavras} />;
};

