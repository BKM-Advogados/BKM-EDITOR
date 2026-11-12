// Pesquisa do projeto: as fontes que o Claude leu e os fatos que ele tirou delas (pesquisa/pesquisa.json). É só um
// visualizador: fato é fato, não há aprovar, reprovar nem apagar, e o texto da fonte aparece como foi baixado, sem
// nada escondido. Os selos (trecho exato, parecido ou não encontrado; números que faltam; marcas de vigência) só
// informam. Clicar num fato leva ao bloco do vídeo que o cita; "Ver na fonte" abre o texto com o trecho marcado.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight, ExternalLink, FileText, Quote, Search, X} from 'lucide-react';
import {avisar, carregarPesquisa, loja, mensagemDe, quandoTrocarProjeto, selecionar, useLoja} from '../estado/loja';
import {CATALOGO_FONTES} from '../../nucleo/catalogo-fontes';
import type {Fato, Fonte} from '../../nucleo/pesquisa'; // só os tipos: pesquisa.ts usa node:crypto
import './pesquisa.css';

const PAGINA = 6000; // caracteres por página, como o texto_da_fonte do MCP

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
// filtro sem acento e sem caixa: "rescisao" acha "rescisão"
const chave = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const casa = (filtro: string, ...campos: (string | undefined)[]) => !filtro || campos.some((c) => c && chave(c).includes(filtro));
const tamanho = (bytes?: number) =>
  bytes === undefined ? '' : bytes >= 1048576 ? `${(bytes / 1048576).toLocaleString('pt-BR', {maximumFractionDigits: 1})} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const NIVEL: Record<Fonte['nivel'], {texto: string; dica: string}> = {
  1: {texto: 'nível 1', dica: 'Norma, decisão ou diário oficial (catálogo de fontes)'},
  2: {texto: 'nível 2', dica: 'Órgão de governo ou agência pública de notícias: contexto e data, não a regra (catálogo de fontes)'},
  0: {texto: 'fora do catálogo', dica: 'Endereço fora do catálogo de fontes; vale como qualquer outra para ver'},
};
// Rótulo de cada marca de SINAIS_VIGENCIA (pesquisa.ts guarda o pedaço que procura, como "(Revogad"; aqui vai a
// palavra inteira). O mapa mora no painel porque pesquisa.ts usa node:crypto; marca nova sem rótulo sai sem parêntese.
const ROTULO_VIGENCIA: Record<string, string> = {
  '(Revogad': 'revogado', 'Redação dada pela': 'redação dada', '(Incluído': 'incluído', '(Vide': 'vide', cancelad: 'cancelada',
  convertid: 'convertida', superad: 'superada', 'em vigor': 'em vigor', 'DOU de': 'DOU', 'Vigência': 'vigência',
};
const rotuloDoSinal = (s: string) => ROTULO_VIGENCIA[s] ?? s.replace(/^\(/, '').toLowerCase();

const ACHADO: Record<Fato['achado'], {texto: string; classe: string; dica: string}> = {
  exato: {texto: 'trecho exato', classe: 'ok', dica: 'O trecho está, letra por letra, no texto baixado da fonte'},
  parecido: {texto: 'trecho parecido', classe: 'aviso', dica: 'O trecho só aparece ignorando acentos, maiúsculas ou pontuação'},
  nao: {texto: 'trecho não encontrado', classe: 'aviso', dica: 'O trecho não aparece no texto baixado da fonte'},
};

/** Onde cada fato é citado: blocos (e cenas) dos vídeos de cenas com `refs`, o vídeo ativo primeiro. */
type Uso = {documento: string; caminho: string; bloco: boolean};
const usosDosFatos = (e: ReturnType<typeof loja.get>): Map<string, Uso[]> => {
  const usos = new Map<string, Uso[]>();
  const anotar = (id: unknown, u: Uso) => typeof id === 'string' && usos.set(id, [...(usos.get(id) ?? []), u]);
  const videos = (e.info?.manifesto.documentos ?? []).filter((d) => d.modulo === 'video').map((d) => d.id);
  videos.sort((a, b) => Number(b === e.ativo.video) - Number(a === e.ativo.video));
  for (const documento of videos) {
    const cenas = (e.docs[documento]?.doc as {cenas?: unknown} | undefined)?.cenas;
    if (!Array.isArray(cenas)) continue;
    cenas.forEach((c: {refs?: unknown; blocos?: unknown}, i) => {
      if (Array.isArray(c?.blocos)) c.blocos.forEach((b: {refs?: unknown}, j) => {
        if (Array.isArray(b?.refs)) b.refs.forEach((id) => anotar(id, {documento, caminho: `/cenas/${i}/blocos/${j}`, bloco: true}));
      });
      if (Array.isArray(c?.refs)) c.refs.forEach((id) => anotar(id, {documento, caminho: `/cenas/${i}`, bloco: false}));
    });
  }
  return usos;
};

// texto já baixado, um por fonte, só a última versão (o sha256 muda quando o Claude lê a fonte de novo); a CLT inteira
// passa de 600 KB, então versão velha sai e a troca de projeto esvazia tudo
const textos = new Map<string, {versao: string; texto: string}>();
quandoTrocarProjeto(() => textos.clear());
const versaoTexto = (f: Fonte) => `${f.sha256}:${f.acessado_em}`;
const lerTexto = async (f: Fonte) => {
  const versao = versaoTexto(f);
  const guardado = textos.get(f.id);
  if (guardado?.versao === versao) return guardado.texto;
  const texto = await window.estudio.textoFonte(f.id);
  textos.set(f.id, {versao, texto});
  return texto;
};

// O texto de um PDF traz um "\f" entre as páginas do arquivo (src/nucleo/pdf-texto.ts): na tela vira uma linha
// "página N do PDF". Na conferência do trecho o "\f" vale espaço, então a marca pode atravessar a quebra.
const QUEBRA_PDF = /\n?\f\n?/;
/** Página do PDF onde cai a posição `i` do texto (1 + quantos "\f" vêm antes). */
export const paginaPdfEm = (texto: string, i: number): number => {
  let n = 1;
  for (let k = texto.indexOf('\f'); k >= 0 && k < i; k = texto.indexOf('\f', k + 1)) n++;
  return n;
};
/** O pedaço de texto com cada "\f" trocado pelo aviso da página nova; `pagina` é a página do PDF onde ele começa. */
export const comPaginasPdf = (pedaco: string, pagina: number): React.ReactNode => {
  if (!pedaco.includes('\f')) return pedaco;
  return pedaco.split(QUEBRA_PDF).map((parte, k) => (
    <React.Fragment key={k}>
      {k > 0 && <span className="pesq-quebra-pdf">página {pagina + k} do PDF</span>}
      {parte}
    </React.Fragment>
  ));
};

/** Texto limpo da fonte, 6.000 caracteres por página; com destaque, abre na página do trecho e o marca. */
const TextoFonte: React.FC<{fonte: Fonte; destaque?: {inicio: number; fim: number}}> = ({fonte, destaque}) => {
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const marca = useRef<HTMLElement | null>(null);
  const versao = `${fonte.id}:${versaoTexto(fonte)}`; // a pesquisa relida traz objetos novos; o texto só se relê se a fonte mudou
  useEffect(() => {
    let vivo = true;
    setTexto(null);
    setErro(null);
    lerTexto(fonte).then((t) => vivo && setTexto(t), (e) => vivo && setErro(mensagemDe(e)));
    return () => {
      vivo = false;
    };
  }, [versao]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPagina(destaque ? Math.floor(destaque.inicio / PAGINA) : 0), [destaque]);
  useEffect(() => marca.current?.scrollIntoView({block: 'center'}), [texto, pagina, destaque]);
  if (erro) {
    // o processo principal diz "não está nesta pasta" quando falta o arquivo; o resto é outro problema de leitura
    return erro.includes('não está nesta pasta')
      ? <div className="pesq-texto-aviso">O texto desta fonte não está nesta pasta ({fonte.arquivo}). O texto baixado não vai junto quando a pasta é copiada; peça ao Claude para ler a fonte de novo.</div>
      : <div className="pesq-texto-aviso">Não deu para ler o texto desta fonte. <span className="rotulo">{erro}</span></div>;
  }
  if (texto === null) return <div className="vazio">carregando o texto…</div>;
  if (!texto) return <div className="vazio">O texto desta fonte está vazio.</div>;
  const paginas = Math.max(1, Math.ceil(texto.length / PAGINA));
  const ini = pagina * PAGINA;
  // o trecho que passa da borda da página vem inteiro, para não cortar a marca ao meio
  const fim = Math.min(texto.length, Math.max(ini + PAGINA, destaque && destaque.inicio >= ini && destaque.inicio < ini + PAGINA ? destaque.fim : 0));
  const pedaco = texto.slice(ini, fim);
  const pdf = fonte.tipo === 'pdf';
  const paginaPdf = pdf ? paginaPdfEm(texto, ini) : 1;
  // no PDF, cada parte leva a página do arquivo onde começa (a marca do trecho pode atravessar a quebra)
  const parte = (de: number, ate: number) => (pdf ? comPaginasPdf(pedaco.slice(de, ate), paginaPdfEm(texto, ini + de)) : pedaco.slice(de, ate));
  let corpo: React.ReactNode = parte(0, pedaco.length);
  if (destaque && destaque.fim > ini && destaque.inicio < fim) {
    const a = Math.max(0, destaque.inicio - ini);
    const b = Math.min(pedaco.length, destaque.fim - ini);
    corpo = <>{parte(0, a)}<mark ref={marca}>{parte(a, b)}</mark>{parte(b, pedaco.length)}</>;
  }
  return (
    <div className="pesq-texto">
      <div className="pesq-paginas">
        <button className="bt mini fantasma" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)} title="Página anterior"><ChevronLeft size={13} /></button>
        <span className="rotulo">página {pagina + 1} de {paginas} · {texto.length.toLocaleString('pt-BR')} caracteres{pdf ? ` · começa na página ${paginaPdf} do PDF` : ''}</span>
        <button className="bt mini fantasma" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)} title="Próxima página"><ChevronRight size={13} /></button>
        {destaque && Math.floor(destaque.inicio / PAGINA) !== pagina && (
          <button className="bt mini fantasma" onClick={() => setPagina(Math.floor(destaque.inicio / PAGINA))}>Ir ao trecho</button>
        )}
      </div>
      <div className="pesq-texto-corpo">{corpo}</div>
    </div>
  );
};

/** Título que se lê: nome de arquivo ("Del5452compilado", "lei_14020-2020.pdf") vira palavras, com o órgão ou o site na
 *  frente; sem título, o site e o caminho do endereço. */
export const tituloLegivel = (f: Pick<Fonte, 'titulo' | 'url' | 'url_final' | 'orgao'>): string => {
  const t = f.titulo?.trim();
  let site = '';
  try {
    site = new URL(f.url_final ?? f.url).hostname.replace(/^www\./, '');
  } catch {
    site = f.url;
  }
  if (t && /\s/.test(t)) return t;
  const cru = t || (() => {
    try {
      return decodeURIComponent(new URL(f.url_final ?? f.url).pathname.split('/').filter(Boolean).pop() ?? '');
    } catch {
      return '';
    }
  })();
  const palavras = cru.replace(/\.(pdf|html?|php|aspx?|docx?|txt)$/i, '').replace(/[_+-]+/g, ' ')
    .replace(/([a-zà-ú])([A-Z\d])/g, '$1 $2').replace(/(\d)([A-Za-zÀ-ú])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  if (!palavras) return f.orgao || site;
  const frase = palavras.charAt(0).toUpperCase() + palavras.slice(1);
  return `${f.orgao || site} · ${frase}`;
};

/** "baixada · 1,4 MB" ("PDF de 12 páginas · 1,4 MB"); se o site respondeu fora do normal, diz o código (a fonte foi
 *  gravada assim mesmo). */
export const baixada = (f: Pick<Fonte, 'bytes' | 'http' | 'tipo' | 'paginas_pdf'>) => {
  const t = [f.tipo === 'pdf' ? (f.paginas_pdf ? `PDF de ${plural(f.paginas_pdf, 'página', 'páginas')}` : 'PDF') : '', tamanho(f.bytes)].filter(Boolean).join(' · ');
  const ok = f.http === undefined || (f.http >= 200 && f.http < 300);
  return ok ? (t ? `baixada · ${t}` : 'baixada') : `o site respondeu com o código ${f.http}${t ? ` · ${t}` : ''}`;
};

const abrirNoNavegador = async (url: string) => {
  const ok = await window.estudio.abrirFonte(url).catch(() => false);
  if (!ok) avisar('Este endereço não abre no navegador (só http e https).', 'erro');
};

const CartaoFonte: React.FC<{f: Fonte; nFatos: number; aberto: boolean; destaque?: {inicio: number; fim: number}; aoAlternar: () => void}> = ({f, nFatos, aberto, destaque, aoAlternar}) => {
  const cat = CATALOGO_FONTES.find((c) => c.id === f.catalogo);
  const nivel = NIVEL[f.nivel] ?? NIVEL[0];
  return (
    <div id={`pesq-fonte-${f.id}`} className={`pesq-cartao${aberto ? ' aberto' : ''}`}>
      <div className="pesq-cabeca">
        <b>{f.id}</b>
        <span className={`pesq-selo nivel-${f.nivel}`} title={cat ? `${nivel.dica}: ${cat.nome}` : nivel.dica}>{nivel.texto}</span>
        {f.tipo === 'pdf' && <span className="pesq-selo" title="A fonte é um PDF: o texto saiu da camada de texto do arquivo (sem OCR); o original abre em Abrir">PDF</span>}
        <span className="esp" />
        <span className="rotulo" title="Quando o texto foi baixado">acessado em {quando(f.acessado_em)}</span>
      </div>
      <div className="pesq-titulo" title={f.titulo || f.url}>{tituloLegivel(f)}</div>
      {f.orgao && <div className="rotulo">{f.orgao}</div>}
      <div className="pesq-url" title={f.url_final && f.url_final !== f.url ? `${f.url}\nfoi para ${f.url_final}` : f.url}>{f.url_final ?? f.url}</div>
      {f.sinais_vigencia.length > 0 && (
        <div className="pesq-sinais" title="Marcas de vigência que aparecem no texto da fonte">
          {f.sinais_vigencia.map((s) => <span key={s} className="etiqueta">{rotuloDoSinal(s)}</span>)}
        </div>
      )}
      <div className="pesq-observacao">
        <span className="rotulo">Observação de quem baixou</span>
        {f.observacao ? <div className="pesq-observacao-texto">{f.observacao}</div> : <div className="rotulo">Sem observação ainda.</div>}
      </div>
      <div className="pesq-rodape">
        <span className="rotulo" title={`Código de conferência do texto baixado (muda quando o texto da fonte muda): ${f.sha256}`}>
          {[baixada(f), plural(nFatos, 'fato', 'fatos'), `por ${f.autor}`].filter(Boolean).join(' · ')}
        </span>
        <span className="esp" />
        <button className="bt mini" onClick={() => void abrirNoNavegador(f.url)} title={`Abrir ${f.url} no navegador`}><ExternalLink size={13} />Abrir</button>
        <button className={`bt mini${aberto ? ' ligado' : ''}`} onClick={aoAlternar} title={f.tipo === 'pdf' ? 'Mostra o texto tirado do PDF, com a quebra de cada página' : 'Mostra o texto limpo que foi baixado'}><FileText size={13} />{aberto ? 'Fechar texto' : 'Ver texto'}</button>
      </div>
      {aberto && <TextoFonte fonte={f} destaque={destaque} />}
    </div>
  );
};

const CartaoFato: React.FC<{f: Fato; fonte?: Fonte; usos: Uso[]; aberto: boolean; aoVerNaFonte: () => void}> = ({f, fonte, usos, aberto, aoVerNaFonte}) => {
  const achado = ACHADO[f.achado] ?? ACHADO.nao;
  const usoBloco = usos.find((u) => u.bloco) ?? usos[0];
  const nBlocos = usos.filter((u) => u.bloco).length;
  const confere = f.estado === 'trecho_confere';
  const ir = () => {
    // arrastar para selecionar e copiar o trecho termina num clique: com texto selecionado, não sai do lugar
    if (window.getSelection()?.toString()) return;
    loja.definir({fatoAberto: f.id});
    if (!usoBloco) return avisar(`Nenhum bloco do vídeo cita o ${f.id} ainda.`, 'info');
    loja.definir((e) => ({area: 'video', ativo: {...e.ativo, video: usoBloco.documento}}));
    selecionar({documento: usoBloco.documento, caminho: usoBloco.caminho});
  };
  return (
    <div id={`pesq-fato-${f.id}`} className={`pesq-cartao fato${aberto ? ' aberto' : ''}`} onClick={ir}
      title={usoBloco ? 'Clique para selecionar o bloco que cita este fato' : 'Nenhum bloco do vídeo cita este fato ainda'}>
      <div className="pesq-cabeca">
        <b>{f.id}</b>
        <span className={`pesq-selo ${confere ? 'ok' : 'aviso'}`}
          title={confere ? 'Trecho exato e todos os números da afirmação aparecem nele (não quer dizer que o trecho sustenta a afirmação)' : 'Algo não conferiu por programa: veja os selos'}>
          {confere ? 'trecho confere' : 'a revisar'}
        </span>
        <span className={`pesq-selo ${achado.classe}`} title={achado.dica}>{achado.texto}</span>
        <span className="esp" />
        <span className="rotulo">{f.autor} · {quando(f.criado_em)}</span>
      </div>
      <div className="pesq-afirmacao">{f.afirmacao}</div>
      <div className="rotulo">
        {[f.localizador, fonte ? `${fonte.id} · ${tituloLegivel(fonte)}` : `fonte ${f.fonte_id} (não está na lista)`].filter(Boolean).join(' · ')}
      </div>
      <blockquote className="pesq-trecho">{f.trecho}</blockquote>
      {f.digitos.faltando.length > 0 && (
        <div className="pesq-falta">Números da afirmação que não aparecem no trecho: {f.digitos.faltando.join(', ')}</div>
      )}
      {f.vigencia.length > 0 && (
        <>
          <div className="pesq-sinais" title="Marcas de vigência perto do trecho, na fonte">
            {f.vigencia.map((s) => <span key={s} className="etiqueta">{rotuloDoSinal(s)}</span>)}
          </div>
          <div className="rotulo">marca de vigência perto do trecho: leia a fonte; a marca sozinha não diz se o trecho vale</div>
        </>
      )}
      {f.nota && <div className="pesq-nota">{f.nota}</div>}
      <div className="pesq-rodape">
        <span className="rotulo">{nBlocos ? `citado em ${plural(nBlocos, 'bloco', 'blocos')}` : usos.length ? 'citado na cena' : 'nenhum bloco cita ainda'}</span>
        <span className="esp" />
        {fonte && (
          <button className="bt mini" onClick={(e) => (e.stopPropagation(), aoVerNaFonte())} title="Abre o texto da fonte com o trecho marcado">
            <Quote size={13} />Ver na fonte
          </button>
        )}
      </div>
    </div>
  );
};

export const Pesquisa: React.FC = () => {
  const pesquisa = useLoja((e) => e.pesquisa);
  const erroPesquisa = useLoja((e) => e.erroPesquisa);
  const fatoAberto = useLoja((e) => e.fatoAberto);
  const info = useLoja((e) => e.info);
  const docs = useLoja((e) => e.docs);
  const ativoVideo = useLoja((e) => e.ativo.video);
  const usos = useMemo(() => usosDosFatos(loja.get()), [info, docs, ativoVideo]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filtro, setFiltro] = useState('');
  // fonte com o texto aberto; de um fato, guarda o id dele, e o trecho a marcar sai da pesquisa atual a cada vez: se o
  // Claude reler a fonte e o fato mudar de lugar, a marca vai junto
  const [textoAberto, setTextoAberto] = useState<{fonte: string; fato?: string} | null>(null);
  const fatoDoTexto = textoAberto?.fato ? pesquisa?.fatos.find((x) => x.id === textoAberto.fato) : undefined;
  const inicioDestaque = fatoDoTexto?.fonte_id === textoAberto?.fonte ? fatoDoTexto?.inicio : undefined;
  const fimDestaque = fatoDoTexto?.fonte_id === textoAberto?.fonte ? fatoDoTexto?.fim : undefined;
  // mesmo objeto enquanto o lugar não muda: o TextoFonte só volta à página do trecho quando o trecho anda
  const destaque = useMemo(
    () => (inicioDestaque !== undefined && fimDestaque !== undefined ? {inicio: inicioDestaque, fim: fimDestaque} : undefined),
    [inicioDestaque, fimDestaque],
  );

  useEffect(() => {
    if (fatoAberto) document.getElementById(`pesq-fato-${fatoAberto}`)?.scrollIntoView({block: 'nearest'});
  }, [fatoAberto, pesquisa]);
  useEffect(() => {
    if (textoAberto) document.getElementById(`pesq-fonte-${textoAberto.fonte}`)?.scrollIntoView({block: 'nearest'});
  }, [textoAberto]);
  // trocou de projeto: nada aberto do anterior
  useEffect(() => {
    setTextoAberto(null);
    setFiltro('');
  }, [info?.raiz]);

  if (!pesquisa) {
    return (
      <div className="painel">
        {erroPesquisa ? (
          <div className="vazio">
            Não deu para ler a pesquisa (pesquisa/pesquisa.json). <span className="rotulo">{erroPesquisa}</span>
            <div><button className="bt mini" onClick={() => void carregarPesquisa()}>Tentar de novo</button></div>
          </div>
        ) : <div className="vazio">carregando a pesquisa…</div>}
      </div>
    );
  }
  const f = chave(filtro.trim());
  const fontes = pesquisa.fontes.filter((x) => casa(f, x.id, x.titulo, x.url, x.url_final, x.orgao, x.observacao, ...x.sinais_vigencia.map(rotuloDoSinal)));
  const fatos = pesquisa.fatos.filter((x) => casa(f, x.id, x.afirmacao, x.trecho, x.localizador, x.nota, x.fonte_id, x.autor));
  const fontePorId = new Map(pesquisa.fontes.map((x) => [x.id, x]));
  const verNaFonte = (fato: Fato) => setTextoAberto({fonte: fato.fonte_id, fato: fato.id});
  const vazio = pesquisa.fontes.length === 0 && pesquisa.fatos.length === 0;

  return (
    <div className="painel pesquisa">
      <div className="painel-topo">
        <span className="titulo">Pesquisa</span>
        <span className="rotulo">· {plural(pesquisa.fontes.length, 'fonte', 'fontes')} · {plural(pesquisa.fatos.length, 'fato', 'fatos')}</span>
        <span className="esp" />
      </div>
      {erroPesquisa && <div className="pesq-texto-aviso pesq-erro">A última leitura da pesquisa falhou; a lista abaixo é a anterior. <span className="rotulo">{erroPesquisa}</span></div>}
      {!vazio && (
        <div className="pesq-filtro">
          <Search size={13} />
          <input className="campo" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar fontes e fatos…"
            onKeyDown={(e) => e.key === 'Escape' && setFiltro('')} />
          {filtro && <button className="bt mini fantasma" onClick={() => setFiltro('')} title="Limpar o filtro"><X size={13} /></button>}
        </div>
      )}
      <div className="painel-corpo">
        {vazio && <div className="vazio">Nenhuma fonte ainda. Peça ao Claude: pesquise a regra (por exemplo, o prazo para pagar a rescisão) e registre os fatos com a fonte.</div>}
        {!vazio && (
          <>
            <div className="lista-titulo">Fontes{f ? ` (${fontes.length} de ${pesquisa.fontes.length})` : ''}</div>
            {fontes.length === 0 && <div className="vazio">Nenhuma fonte com “{filtro}”.</div>}
            {fontes.map((x) => (
              <CartaoFonte key={x.id} f={x} nFatos={pesquisa.fatos.filter((y) => y.fonte_id === x.id).length} aberto={textoAberto?.fonte === x.id}
                destaque={textoAberto?.fonte === x.id ? destaque : undefined}
                aoAlternar={() => setTextoAberto(textoAberto?.fonte === x.id ? null : {fonte: x.id})} />
            ))}
            <div className="lista-titulo">Fatos{f ? ` (${fatos.length} de ${pesquisa.fatos.length})` : ''}</div>
            {fatos.length === 0 && <div className="vazio">{pesquisa.fatos.length ? `Nenhum fato com “${filtro}”.` : 'Nenhum fato registrado ainda.'}</div>}
            {fatos.map((x) => (
              <CartaoFato key={x.id} f={x} fonte={fontePorId.get(x.fonte_id)} usos={usos.get(x.id) ?? []} aberto={x.id === fatoAberto} aoVerNaFonte={() => verNaFonte(x)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
};
