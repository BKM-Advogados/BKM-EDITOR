// Uma conversa com o Claude desenhada como conversa, não como terminal: a fala da pessoa em balões, o texto do Claude
// em prosa, cada ação como um cartão legível (com Ver e Reverter quando muda um documento do projeto) e os pedidos de
// permissão com botões. A caixa de pedido já leva o que está na tela (seleção, comentário, tempo) como contexto.
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ArrowUp, CircleAlert, CircleCheck, CircleX, LoaderCircle, ShieldQuestion, Sparkle, SquareTerminal, X} from 'lucide-react';
import type {OperacaoPatch} from '../../nucleo/documentos';
import {FERRAMENTAS_ESTUDIO, normalizarFerramenta} from '../../compartilhado/ferramentas';
import {mudancasDoResultado} from '../../nucleo/portao';
import {confirmar} from '../componentes/Dialogo';
import {Escolha} from '../componentes/Controles';
import {avisar, loja, selecionar, useLoja, valorEm, type Area} from '../estado/loja';
import {enviar, estadoConversas, guardarRascunho, lerConta, parar, responderPermissao, trocarModelo, type Anexo, type Bloco, type Conversa as TConversa} from './conversas';
import './conversa.css';

// ── texto do Claude: markdown pequeno (parágrafos, listas, negrito, itálico, código), sempre escapado ──
// transversal-D13: aspas também escapadas, para um endereço com aspas não virar atributo no link
const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const emLinha = (s: string) =>
  escapar(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s&]+(?:&amp;[^)\s&]+)*)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
const markdown = (t: string) => {
  const partes = t.split(/```[^\n]*\n?([\s\S]*?)```/g);
  return partes.map((p, i) => {
    if (i % 2) return `<pre><code>${escapar(p.replace(/\n$/, ''))}</code></pre>`;
    return p.split(/\n{2,}/).map((bloco) => {
      const linhas = bloco.split('\n').filter((l) => l.trim());
      if (!linhas.length) return '';
      if (linhas.every((l) => /^\s*([-*]|\d+[.)])\s+/.test(l))) {
        const num = /^\s*\d/.test(linhas[0]);
        return `<${num ? 'ol' : 'ul'}>${linhas.map((l) => `<li>${emLinha(l.replace(/^\s*([-*]|\d+[.)])\s+/, ''))}</li>`).join('')}</${num ? 'ol' : 'ul'}>`;
      }
      if (/^#{1,4}\s/.test(linhas[0])) return `<p class="titulo-md">${emLinha(linhas[0].replace(/^#+\s/, ''))}</p>${linhas.length > 1 ? `<p>${linhas.slice(1).map(emLinha).join('<br>')}</p>` : ''}`;
      return `<p>${linhas.map(emLinha).join('<br>')}</p>`;
    }).join('');
  }).join('');
};

// ── ações do Claude em português de quem edita ──
type Diff = {campo: string; antes?: unknown; depois?: unknown; tipo: 'troca' | 'novo' | 'tira'};
type Desc = {verbo: string; alvo?: string; extra?: string; codigo?: string; diffs?: Diff[]; ir?: {documento: string; caminho: string}};
const nomeArquivo = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).pop() : undefined);
const curto = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '—' : s.length > 28 ? `${s.slice(0, 27)}…` : s;
};
const tentarJson = (s?: string): any => {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
};

const arquivoDe = (e: Record<string, any>) => nomeArquivo(e.file_path ?? e.absolute_path ?? e.path ?? e.notebook_path);

const descrever = (bruto: string, e: Record<string, any>, resultado?: string): Desc => {
  // o mesmo cartão para qualquer provedor: o nome chega sem o prefixo de cada agente (compartilhado/ferramentas.ts)
  const f = normalizarFerramenta(bruto, FERRAMENTAS_ESTUDIO);
  const mcp = f.servidor === 'estudio' ? f.nome : undefined;
  const nome = f.nome;
  if (mcp === 'aplicar_patch') {
    const ops = (Array.isArray(e.patch) ? e.patch : []) as OperacaoPatch[];
    const testes = new Map(ops.filter((o) => o.op === 'test').map((o) => [o.path, (o as {value?: unknown}).value]));
    const diffs: Diff[] = [];
    for (const o of ops) {
      const campo = o.path.split('/').pop() ?? o.path;
      if (o.op === 'replace') diffs.push({campo, antes: testes.get(o.path), depois: o.value, tipo: 'troca'});
      else if (o.op === 'add') diffs.push({campo, depois: o.value, tipo: 'novo'});
      else if (o.op === 'remove') diffs.push({campo, tipo: 'tira'});
    }
    const primeiro = ops.find((o) => o.op !== 'test');
    const pai = primeiro ? primeiro.path.split('/').slice(0, -1).join('/') : '';
    // o Reverter sai do diário (CartaoAcao), para qualquer ferramenta que grave
    return {verbo: 'Mudou', alvo: e.rotulo ?? e.documento, diffs, ir: e.documento && pai ? {documento: e.documento, caminho: pai} : undefined};
  }
  if (mcp === 'ler_comentario') return {verbo: 'Leu o comentário', alvo: e.id, extra: tentarJson(resultado)?.texto};
  if (mcp === 'responder_comentario') return {verbo: 'Respondeu ao comentário', alvo: e.id, extra: e.texto};
  if (mcp === 'resolver_comentario') return {verbo: 'Resolveu o comentário', alvo: e.id};
  if (mcp === 'listar_comentarios') return {verbo: 'Viu os comentários', extra: e.estado ? `(${e.estado})` : undefined};
  if (mcp === 'ler_documento') return {verbo: 'Leu', alvo: e.documento};
  if (mcp === 'estado_do_editor') return {verbo: 'Viu o que está na tela'};
  if (mcp === 'projeto_info') return {verbo: 'Viu o projeto'};
  if (mcp === 'listar_mudancas') return {verbo: 'Viu as últimas mudanças'};
  if (mcp) return {verbo: mcp.replace(/_/g, ' ')};
  switch (f.servidor === 'interno' ? nome : '') {
    case 'ler_arquivo': return {verbo: 'Leu', alvo: arquivoDe(e)};
    case 'editar_arquivo': return {verbo: 'Editou', alvo: arquivoDe(e)};
    case 'escrever_arquivo': return {verbo: 'Escreveu', alvo: arquivoDe(e)};
    case 'shell': return {verbo: 'Rodou', codigo: String(e.command ?? '')};
    case 'procurar': return {verbo: 'Procurou', codigo: String(e.pattern ?? '')};
    case 'abrir_pagina': return {verbo: 'Abriu', alvo: String(e.url ?? e.prompt ?? '')};
    case 'buscar_web': return {verbo: 'Pesquisou', alvo: String(e.query ?? '')};
    case 'lista_de_tarefas': return {verbo: 'Atualizou a lista de tarefas'};
    case 'subagente': return {verbo: 'Pediu a um subagente', alvo: e.description};
    case 'skill': return {verbo: 'Usou a skill', alvo: e.skill ?? e.name};
    default: return {verbo: nome.replace(/_/g, ' ')};
  }
};

const pedidoEmTexto = (bruto: string, e: Record<string, any>): {acao: string; codigo?: string} => {
  const f = normalizarFerramenta(bruto, FERRAMENTAS_ESTUDIO);
  const caminho = e.file_path ?? e.absolute_path ?? e.path ?? e.notebook_path;
  switch (f.servidor === 'interno' ? f.nome : '') {
    case 'shell': return {acao: 'rodar um comando', codigo: String(e.command ?? '')};
    case 'editar_arquivo': case 'escrever_arquivo': return {acao: `editar ${nomeArquivo(caminho) ?? 'um arquivo'}`, codigo: caminho};
    case 'ler_arquivo': return {acao: `ler ${nomeArquivo(caminho) ?? 'um arquivo'}`, codigo: caminho};
    case 'abrir_pagina': return {acao: 'abrir uma página', codigo: e.url};
    case 'buscar_web': return {acao: 'pesquisar na web', codigo: e.query};
    default: return {acao: `usar ${f.nome.replace(/_/g, ' ')}`};
  }
};

const irPara = (documento: string, caminho: string) => {
  const d = loja.get().info?.manifesto.documentos.find((x) => x.id === documento || x.caminho === documento);
  if (d) {
    const area = d.modulo === '3d' ? '3d' : d.modulo;
    loja.definir((s) => ({area: area as typeof s.area, ativo: {...s.ativo, [d.modulo]: d.id}}));
    selecionar({documento: d.id, caminho});
  }
};

/** O nome da IA da conversa sem o número: "DeepSeek 1" vira "DeepSeek". */
const nomeIA = (c: TConversa) => c.titulo.split(' · ')[0].replace(/\s+\d+$/, '');
const milhares = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1})} mil` : String(n));
/** Tokens e custo da conversa, com a composição: entrada (parte do cache) e saída. */
const rodapeUso = (c: TConversa) => {
  const u = c.uso;
  if (!u || (!u.entrada && !u.saida && !u.custo_usd)) return nomeIA(c);
  const tokens = u.entrada || u.saida ? `${milhares(u.entrada)} tokens de entrada${u.cache ? ` (${milhares(u.cache)} do cache)` : ''} · ${milhares(u.saida)} de saída` : '';
  const custo = u.custo_usd !== undefined ? `≈ US$ ${u.custo_usd.toLocaleString('pt-BR', {maximumFractionDigits: 4})}` : '';
  return [nomeIA(c), custo, tokens].filter(Boolean).join(' · ');
};

// ── seletor de modelo (rodada 3, "Seletor de modelo e painel de conexões"): grava o modelo da conversa e vale na próxima
// mensagem; o rótulo mostra o modelo que a abertura da sessão devolveu. No Claude, os apelidos que o Claude Code aceita;
// no laço próprio, a lista do próprio endereço; agente ACP usa o modelo da configuração dele.
const APELIDOS_CLAUDE: [string, string][] = [['', 'padrão da conta'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']];
const SeletorModelo: React.FC<{c: TConversa; desligado: boolean}> = ({c, desligado}) => {
  const [lista, setLista] = useState<string[] | null>(null);
  const provedor = useSyncExternalStore(estadoConversas.assinar, () => estadoConversas.provedores().find((p) => p.id === c.provedor));
  if (provedor?.via === 'acp') return <>{c.modelo ?? nomeIA(c)}</>;
  const opcoes: [string, string][] = c.provedor === 'claude' ? APELIDOS_CLAUDE : (lista ?? []).map((m) => [m, m]);
  const atual = c.modelo ?? '';
  if (atual && !opcoes.some(([v]) => v === atual)) opcoes.unshift([atual, atual]);
  return (
    <Escolha className="seletor-modelo" valor={atual} desligado={desligado} rotulo="Modelo desta conversa" dica="Modelo desta conversa: vale a partir da próxima mensagem"
      aoAbrir={() => c.provedor !== 'claude' && lista === null && void window.estudio.ia.modelos(c.provedor).then((r) => setLista(r.ok ? r.modelos : []))}
      aoMudar={(m) => void trocarModelo(c.id, m)} opcoes={opcoes.length ? opcoes : [['', nomeIA(c)]]} />
  );
};

// Ver e Reverter pelo diário (frente IA, rodada 3): o portão do MCP põe no resultado as mudanças que a ferramenta fez
// (seq, documento); o Reverter aplica o inverso daquela entrada, com qualquer provedor e qualquer ferramenta que grave.
// transversal-D12: falhou, o cartão diz por quê e oferece "Reverter mesmo assim" quando o valor mudou depois.
const reverterSeqs = async (seqs: number[], forcar = false): Promise<{ok: boolean; mudou?: boolean; mensagem?: string}> => {
  for (const seq of [...seqs].reverse()) {
    const r = await window.estudio.ia.reverter(seq, forcar);
    if (!r.ok) return {ok: false, mudou: r.mudou_depois, mensagem: r.mensagem};
  }
  return {ok: true};
};

const CartaoAcao: React.FC<{b: Extract<Bloco, {tipo: 'acao'}>}> = ({b}) => {
  const d = useMemo(() => descrever(b.nome, b.entrada, b.resultado), [b.nome, b.entrada, b.resultado]);
  const mudancas = useMemo(() => mudancasDoResultado(b.resultado), [b.resultado]);
  const [estado, setEstado] = useState<'nada' | 'revertido' | 'mudou' | 'falhou'>('nada');
  const icone = b.ok === undefined ? <LoaderCircle size={14} className="girando" /> : b.ok ? <CircleCheck size={14} className="feito" /> : <CircleX size={14} className="falhou" />;
  const ir = d.ir ?? (mudancas[0] ? {documento: mudancas[0].documento, caminho: ''} : undefined);
  const reverter = async (forcar = false) => {
    if (forcar && !(await confirmar({titulo: 'Reverter mesmo assim?', texto: 'O valor mudou depois desta ação. Reverter agora desfaz também o que veio depois nesse ponto.', botao: 'Reverter', perigo: true}))) return;
    const r = await reverterSeqs(mudancas.map((m) => m.seq), forcar);
    if (r.ok) return setEstado('revertido');
    setEstado(r.mudou ? 'mudou' : 'falhou');
    avisar(r.mensagem ?? 'não deu para reverter', 'erro');
  };
  return (
    <div className={`acao${b.ok === false ? ' com-erro' : ''}`} title={b.ok === false ? b.resultado : undefined}>
      {icone}
      <span className="desc">
        {d.verbo}{d.alvo && <> <b>{d.alvo}</b></>}{d.extra && <em> “{curto(d.extra)}”</em>}
        {d.codigo && <code className="cmd">{d.codigo}</code>}
      </span>
      {d.diffs?.slice(0, 3).map((x, i) => (
        <span key={i} className="diff">{x.campo}{x.tipo === 'troca' && <> <s>{curto(x.antes)}</s> → <ins>{curto(x.depois)}</ins></>}{x.tipo === 'novo' && <> + <ins>{curto(x.depois)}</ins></>}{x.tipo === 'tira' && ' removido'}</span>
      ))}
      {ir && b.ok && <button className="link" onClick={() => irPara(ir.documento, ir.caminho)}>Ver</button>}
      {mudancas.length > 0 && b.ok && estado === 'nada' && <button className="link fraco" onClick={() => void reverter()}>Reverter</button>}
      {estado === 'revertido' && <span className="link fraco">Revertido</span>}
      {estado === 'mudou' && <button className="link fraco" onClick={() => void reverter(true)}>Mudou depois · Reverter mesmo assim</button>}
      {estado === 'falhou' && <span className="link fraco" title="Veja o motivo no aviso; o Histórico também reverte">Não revertido</span>}
    </div>
  );
};

// o resumo do que o portão do MCP vai fazer: endereço, arquivo ou documento, nunca o JSON inteiro
const resumoDoPortao = (e: Record<string, any>) => {
  const v = e.url ?? e.arquivo ?? e.origem ?? (e.documento ? `documento ${e.documento}` : undefined);
  return v === undefined ? undefined : String(v);
};

const CartaoPermissao: React.FC<{c: TConversa; b: Extract<Bloco, {tipo: 'permissao'}>}> = ({c, b}) => {
  // pedido do portão do MCP (src/nucleo/portao.ts): o motivo vem pronto, em português; senão, o pedido do próprio agente
  const p = b.pedido.startsWith('portao:') && b.titulo ? {acao: b.titulo, codigo: resumoDoPortao(b.entrada)} : pedidoEmTexto(b.ferramenta, b.entrada);
  return (
    <div className={`permissao${b.decisao ? ' decidida' : ''}`}>
      <div className="perm-topo"><ShieldQuestion size={15} />{nomeIA(c)} quer {p.acao}</div>
      {p.codigo && <pre className="perm-cmd">{p.codigo}</pre>}
      {b.decisao ? (
        <div className="perm-decisao">{b.decisao === 'permitida' ? 'Permitido' : b.decisao === 'negada' ? 'Negado' : 'Cancelado'}</div>
      ) : (
        <div className="perm-botoes">
          <button className="bt principal mini" onClick={() => responderPermissao(c.id, b.pedido, 'permitir')}>Permitir</button>
          {b.pode_sempre && <button className="bt mini" onClick={() => responderPermissao(c.id, b.pedido, 'permitir', true)}>Sempre nesta conversa</button>}
          <button className="bt fantasma mini" onClick={() => responderPermissao(c.id, b.pedido, 'negar')}>Negar</button>
        </div>
      )}
    </div>
  );
};

// ── contexto da tela que vai junto com o pedido ──
const tc = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.floor(((ms % 1000) * 30) / 1000)).padStart(2, '0')}`;
};
const rotuloObjeto = (v: any, caminho: string) => {
  if (v && typeof v === 'object') {
    const nome = v.nome ?? v.titulo;
    const texto = typeof v.texto === 'string' ? v.texto.replace(/\*\*/g, '') : v.ate !== undefined ? `${v.ate}${v.sufixo ?? ''}` : undefined;
    const r = [v.tipo, nome ?? texto].filter(Boolean).join(' · ');
    if (r) return r.length > 34 ? `${r.slice(0, 33)}…` : r;
  }
  return caminho.split('/').slice(-2).join('/');
};

const NOME_AREA: Record<string, string> = {video: 'Vídeo', imagem: 'Imagem', '3d': '3D', efeitos: 'Efeitos', musica: 'Música'};

const useAnexos = (): Anexo[] => {
  const selecao = useLoja((e) => e.selecao);
  const docs = useLoja((e) => e.docs);
  const aberto = useLoja((e) => e.comentarioAberto);
  const comentarios = useLoja((e) => e.comentarios);
  const area = useLoja((e) => e.area);
  const segundo = useLoja((e) => Math.floor(e.tempo_ms / 1000));
  const ativo = useLoja((e) => e.ativo);
  const info = useLoja((e) => e.info);
  return useMemo(() => {
    const r: Anexo[] = [];
    // frente IA, F6: a IA sempre sabe em que módulo e documento a pessoa está, com qualquer provedor
    const doc = info?.manifesto.documentos.find((d) => d.id === (ativo as Record<string, string | undefined>)[area === '3d' ? '3d' : area]);
    r.push({chave: 'modulo', tipo: 'modulo', rotulo: `${NOME_AREA[area] ?? area}${doc ? ` · ${doc.titulo ?? doc.id}` : ''}`,
      contexto: `módulo ${NOME_AREA[area] ?? area}${doc ? `, documento ${doc.id} ("${doc.titulo ?? doc.id}")` : ''}`});
    if (selecao) {
      const v = valorEm(docs[selecao.documento]?.doc, selecao.caminho);
      const rotulo = rotuloObjeto(v, selecao.caminho);
      r.push({chave: `s:${selecao.documento}:${selecao.caminho}`, tipo: 'selecao', rotulo, contexto: `seleção: ${rotulo} (documento ${selecao.documento}, caminho ${selecao.caminho})`});
    }
    const cm = aberto ? comentarios.find((x) => x.id === aberto) : undefined;
    if (cm) r.push({chave: `c:${cm.id}`, tipo: 'comentario', rotulo: cm.id, contexto: `comentário ${cm.id} aberto: "${cm.texto}"`});
    if (area === 'video') {
      const ms = loja.get().tempo_ms;
      r.push({chave: 'tempo', tipo: 'tempo', rotulo: tc(ms), contexto: `tempo da prévia do vídeo: ${tc(ms)} (${ms} ms)`});
    }
    return r;
  }, [selecao, docs, aberto, comentarios, area, segundo, ativo, info]);
};

const ChipAnexo: React.FC<{a: Anexo; tirar?: () => void}> = ({a, tirar}) => (
  <span className={`anexo ${a.tipo}`}>
    {a.tipo === 'comentario' && <span className="ponto-c" />}
    <span className={a.tipo === 'tempo' ? 'mono' : undefined}>{a.rotulo}</span>
    {tirar && <button className="tirar" onClick={tirar} title="Não mandar este contexto"><X size={11} /></button>}
  </span>
);

// sugestões da conversa vazia, pela área em que a pessoa está (na Música e na Animação não existe "bloco")
export const SUGESTOES: Record<Area, string[]> = {
  video: ['Resolva os comentários abertos', 'Deixe o bloco selecionado um pouco maior', 'Faça um vídeo de 5 cenas sobre férias proporcionais'],
  imagem: ['Crie um carrossel de 5 páginas sobre este assunto', 'Alinhe as camadas selecionadas ao centro', 'Aplique o kit de marca nesta imagem'],
  '3d': ['Ponha uma luz quente vindo da esquerda', 'Faça a câmera girar devagar em volta do objeto', 'O que tem nesta cena?'],
  efeitos: ['Deixe o vídeo com cara de cinema', 'Tire o tom azulado da imagem', 'O que cada efeito da pilha faz?'],
  musica: ['Deixe a batida mais calma', 'Ponha um baixo seguindo os acordes', 'Faça uma trilha de 20 s para ficar sob a voz'],
  animacao: ['Faça o logo entrar girando', 'Revele a arte em pixel devagar', 'Ponha o texto subindo depois do logo'],
};

// ── a conversa ──
// liberarSessao: fecha o terminal que estiver com esta mesma sessão aberta (duas execuções misturariam o histórico)
export const Conversa: React.FC<{c: TConversa; abrirTerminal: () => void; liberarSessao?: (sessao: string) => void}> = ({c, abrirTerminal, liberarSessao}) => {
  const lista = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);
  const colado = useRef(true);
  const [texto, setTexto] = useState(c.rascunho);
  const [tirados, setTirados] = useState<Set<string>>(new Set());
  const [, tique] = useState(0);
  const conta = useConta();
  const areaAtual = useLoja((e) => e.area);
  const eClaude = c.provedor === 'claude';
  const sugeridos = useAnexos();
  const anexos = sugeridos.filter((a) => !tirados.has(a.chave));
  const trabalhando = c.estado === 'trabalhando' || c.estado === 'precisa';

  useEffect(() => setTexto(c.rascunho), [c.id, c.rascunho]);
  useEffect(() => {
    if (!trabalhando) return;
    const t = window.setInterval(() => tique((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [trabalhando]);
  useLayoutEffect(() => {
    const el = lista.current;
    if (el && colado.current) el.scrollTop = el.scrollHeight;
  });
  useLayoutEffect(() => {
    const t = caixa.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(160, t.scrollHeight)}px`;
  }, [texto]);

  const mandar = async () => {
    if (!texto.trim() || trabalhando) return;
    const t = texto;
    setTexto('');
    setTirados(new Set());
    colado.current = true;
    liberarSessao?.(c.sessao);
    await enviar(c.id, t, anexos);
  };

  return (
    <div className="conversa">
      <div className="mensagens" ref={lista} onScroll={(e) => {
        const el = e.currentTarget;
        colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}>
        {eClaude && conta && (!conta.instalado || !conta.logado) && (
          <div className="faixa-conta">
            <CircleAlert size={15} />
            <div>
              {!conta.instalado ? <>O Claude Code não está instalado neste PC. Instale pelo site da Anthropic (claude.ai/install) e abra o Estúdio de novo.</>
                : <>O Claude Code deste PC não está logado. Abra um terminal e digite <code>/login</code>: o login é feito pela Anthropic, no navegador, com a sua conta.</>}
              {conta.instalado && <div className="faixa-botoes"><button className="bt mini" onClick={abrirTerminal}><SquareTerminal size={13} />Abrir terminal</button><button className="bt fantasma mini" onClick={() => void lerConta(true)}>Já entrei</button></div>}
            </div>
          </div>
        )}
        {eClaude && conta?.chave_api && <div className="faixa-conta aviso"><CircleAlert size={15} /><div>Há uma ANTHROPIC_API_KEY neste PC: nesta conversa o Claude cobra pela API, não pela assinatura.</div></div>}
        {!c.itens.length && (
          <div className="vazio-conversa">
            <Sparkle size={22} />
            <p>Converse com {eClaude ? 'o Claude' : nomeIA(c)} sobre este projeto. A IA vê o que você seleciona, lê os comentários e muda os documentos; cada mudança aparece aqui e no Histórico, e dá para reverter.</p>
            <div className="sugestoes">{SUGESTOES[areaAtual].map((s) => <button key={s} className="anexo" onClick={() => (setTexto(s), caixa.current?.focus())}>{s}</button>)}</div>
          </div>
        )}
        {c.itens.map((it, i) => {
          if (it.tipo === 'pessoa') return (
            <div key={i} className="msg-pessoa">
              {it.anexos.length > 0 && <div className="anexos">{it.anexos.map((a) => <ChipAnexo key={a.chave} a={a} />)}</div>}
              <div className="bolha">{it.texto}</div>
            </div>
          );
          if (it.tipo === 'aviso') return <div key={i} className={`aviso-conversa${it.erro ? ' erro' : ''}`}>{it.texto}</div>;
          const acoes = it.blocos.filter((b) => b.tipo === 'acao');
          return (
            <div key={i} className="msg-claude">
              <div className="quem"><Sparkle size={13} />{c.titulo.split(' · ')[0]}{it.fim?.duracao_ms ? <span className="hora">· {Math.max(1, Math.round(it.fim.duracao_ms / 1000))} s</span> : null}</div>
              {it.blocos.map((b, j) => {
                if (b.tipo === 'texto') return <div key={j} className={`prosa${b.aoVivo ? ' ao-vivo' : ''}`} dangerouslySetInnerHTML={{__html: markdown(b.texto)}} />;
                if (b.tipo === 'permissao') return <CartaoPermissao key={j} c={c} b={b} />;
                // ações seguidas viram um bloco só, como uma lista de passos
                const anterior = it.blocos[j - 1];
                if (anterior?.tipo === 'acao') return null;
                const grupo: Extract<Bloco, {tipo: 'acao'}>[] = [];
                for (let k = j; k < it.blocos.length && it.blocos[k].tipo === 'acao'; k++) grupo.push(it.blocos[k] as Extract<Bloco, {tipo: 'acao'}>);
                return <div key={j} className="acoes-ag">{grupo.map((g) => <CartaoAcao key={g.uso} b={g} />)}</div>;
              })}
              {acoes.length === 0 && it.blocos.length === 0 && !it.fim && <div className="prosa ao-vivo"><p> </p></div>}
            </div>
          );
        })}
        {trabalhando && (
          <div className="trabalhando">
            <span className="ponto" />
            {c.estado === 'precisa' ? 'Esperando você responder acima' : `${c.detalhe ? c.detalhe[0].toUpperCase() + c.detalhe.slice(1) : 'Trabalhando'} · ${Math.max(0, Math.round((Date.now() - (c.desde ?? Date.now())) / 1000))} s`}
            <button className="parar" onClick={() => parar(c.id)}>Parar · Esc</button>
          </div>
        )}
      </div>
      <div className="compositor">
        <div className="caixa-pedido">
          {anexos.length > 0 && <div className="anexos">{anexos.map((a) => <ChipAnexo key={a.chave} a={a} tirar={() => setTirados((s) => new Set(s).add(a.chave))} />)}</div>}
          <textarea ref={caixa} rows={1} value={texto} placeholder={trabalhando ? `${nomeIA(c)} está trabalhando… (Esc para parar)` : `Peça a ${nomeIA(c)}…`}
            onChange={(e) => (setTexto(e.target.value), guardarRascunho(c.id, e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void mandar();
              } else if (e.key === 'Escape' && trabalhando) {
                e.preventDefault();
                parar(c.id);
              }
            }} />
          <div className="baixo">
            <span className="modelo"><SeletorModelo c={c} desligado={trabalhando} />{c.estado === 'hibernada' && ' · hibernada (volta na próxima mensagem)'}</span>
            <button className="enviar" disabled={!texto.trim() || trabalhando} onClick={() => void mandar()} title="Enviar · Enter"><ArrowUp size={15} /></button>
          </div>
        </div>
        <div className="rodape-pedido">
          <span>{eClaude ? (conta?.logado ? `Sua conta Claude${conta.plano ? ` · ${conta.plano}` : conta.email ? ` · ${conta.email}` : ''}` : 'Sua conta Claude') : rodapeUso(c)}</span>
          <span>Enter envia · Shift+Enter quebra a linha</span>
        </div>
      </div>
    </div>
  );
};

// lê `claude auth status` uma vez; sem login, confere de novo a cada 20 s (para a faixa sumir quando a pessoa entrar)
const useConta = () => {
  const conta = useSyncExternalStore(estadoConversas.assinar, estadoConversas.conta);
  useEffect(() => {
    void lerConta();
  }, []);
  useEffect(() => {
    if (!conta || conta.logado || !conta.instalado) return;
    const t = window.setInterval(() => void lerConta(true), 20000);
    return () => window.clearInterval(t);
  }, [conta]);
  return conta;
};
