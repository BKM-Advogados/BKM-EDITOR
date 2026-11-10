// Narração por IA na tela (docs/narracao.md): abrir o painel, as vozes de cada provedor (guardadas na sessão), o andamento
// da geração, gerar (o processo principal chama o Google com a chave do cofre e põe as falas no vídeo como edição da pessoa:
// Ctrl+Z desfaz), ouvir a amostra, ajustar as cenas à fala e mudar a configuração e o dicionário. A conta é a do núcleo
// (narracao.ts, narracao-cenas.ts), a mesma do MCP.
import type {AndamentoNarracao, ResultadoNarracao} from '../../../nucleo/narracao-servico';
import {pronunciasValidas, type ConfigNarracao, type Pronuncia, type ProvedorNarracao, type VozNarracao} from '../../../nucleo/narracao';
import {ajustarCenasAFala} from '../../../nucleo/narracao-cenas';
import type {DocCenas} from '../../../nucleo/cenas';
import {aplicar, avisar, carregarDoc, loja, mensagemDe, trocar} from '../../estado/loja';
import {confirmar} from '../../componentes/Dialogo';

const docDe = (documento: string) => loja.get().docs[documento]?.doc as DocCenas | undefined;
const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: n < 0.1 ? 4 : 2})}`;
export const textoCusto = (n?: number) => (n === undefined ? 'custo fora da tabela' : n === 0 ? 'sem custo (do cache)' : `≈ ${usd(n)}`);

// ---------- um estado pequeno, fora do React (como o andamento da transcrição) ----------
type Estado = {aberto: string | null; andamento: AndamentoNarracao | null; ultimo: ResultadoNarracao | null; vozes: Partial<Record<ProvedorNarracao, {vozes: VozNarracao[]; aviso?: string}>>};
let estado: Estado = {aberto: null, andamento: null, ultimo: null, vozes: {}};
const ouvintes = new Set<() => void>();
const mudar = (x: Partial<Estado>) => {
  estado = {...estado, ...x};
  ouvintes.forEach((f) => f());
};
export const narracaoTela = {
  assinar: (f: () => void) => {
    ouvintes.add(f);
    ligar();
    return () => {
      ouvintes.delete(f);
    };
  },
  ler: () => estado,
};

let ligado = false;
const ligar = () => {
  if (ligado || !window.estudio?.narracao) return;
  ligado = true;
  window.estudio.narracao.aoAndamento((a) => mudar({andamento: a.fase === 'pronto' ? null : a}));
};

/** Abre o painel "Narração por IA" do vídeo (a linha do tempo o desenha, ao lado do "+ Áudio"). */
export const abrirNarracaoIA = (documento: string) => mudar({aberto: documento});
export const fecharNarracaoIA = () => mudar({aberto: null});

/** As vozes do provedor, da API (guardadas na sessão); `atualizar` busca de novo. Falhou: o aviso volta, a lista fica vazia. */
export const carregarVozes = async (p: ProvedorNarracao, atualizar = false) => {
  if (!atualizar && estado.vozes[p]) return estado.vozes[p]!;
  try {
    const r = await window.estudio.narracao.vozes(p, atualizar);
    mudar({vozes: {...estado.vozes, [p]: {vozes: r.vozes, aviso: r.aviso}}});
    return r;
  } catch (e) {
    const r = {vozes: [] as VozNarracao[], aviso: mensagemDe(e)};
    mudar({vozes: {...estado.vozes, [p]: r}});
    return r;
  }
};

/** Muda a configuração da narração (só os campos dados); `undefined` tira o campo. */
export const configurar = (documento: string, mudanca: Partial<ConfigNarracao>, rotulo = 'configuração da narração por IA') => {
  const d = docDe(documento);
  if (!d) return;
  const atual: Record<string, unknown> = d.narracao && typeof d.narracao === 'object' ? {...d.narracao} : {};
  for (const [k, v] of Object.entries(mudanca)) {
    if (v === undefined || v === '') delete atual[k];
    else atual[k] = v;
  }
  if (atual.provedor === 'google-tts') delete atual.modelo;
  return trocar(documento, '/narracao', Object.keys(atual).length ? atual : undefined, rotulo);
};

/** O texto falado de uma cena (cenas[i].narracao.texto); vazio tira a narração da cena. */
export const trocarTextoDaCena = (documento: string, i: number, texto: string) => {
  const d = docDe(documento);
  const atual = d?.cenas?.[i]?.narracao?.texto ?? '';
  if (!d || texto === atual) return;
  return trocar(documento, `/cenas/${i}/narracao`, texto.trim() ? {texto} : undefined, `fala da cena ${i + 1}`);
};

export const trocarPronuncias = (documento: string, lista: Pronuncia[], rotulo: string) => {
  const validas = pronunciasValidas(lista);
  return configurar(documento, {pronuncias: validas.length ? validas : undefined}, rotulo);
};

/** Gera as falas. `todas`: confirma antes, com o custo estimado. Devolve o resultado, ou null se a pessoa desistiu. */
export const gerarFalas = async (documento: string, o: {cenas?: string[]; refazer?: boolean; confirmarAntes?: boolean} = {}) => {
  if (estado.andamento) return avisar('Já há uma narração sendo gerada: espere ou cancele.', 'info'), null;
  try {
    const p = await window.estudio.narracao.previa(documento, {cenas: o.cenas, refazer: o.refazer});
    if (!p.itens.length) {
      avisar(p.sem_texto.length && !p.total.a_gerar ? 'Escreva o texto falado das cenas antes de gerar.' : 'Nada a gerar: as falas já estão em dia.', 'info');
      return null;
    }
    if (!p.tem_chave && p.total.vao_a_api) {
      avisar('Falta a chave do provedor: abra Configurações › IA (no "+ Conversa" ou no botão do painel).', 'erro');
      return null;
    }
    if (o.confirmarAntes && p.total.vao_a_api) {
      const seg = p.total.segundos_estimados.toLocaleString('pt-BR', {maximumFractionDigits: 1});
      const ok = await confirmar({titulo: `Gerar ${p.total.a_gerar} ${p.total.a_gerar === 1 ? 'fala' : 'falas'} com a IA?`, botao: 'Gerar',
        texto: `${p.total.vao_a_api} vão ao Google (${p.total.caracteres} caracteres, perto de ${seg} s de fala), ${textoCusto(p.total.custo_usd)} pela tabela de `
          + `${p.total.tabela ?? 'preços do app'}${p.total.nota ? `; ${p.total.nota}` : ''}. ${p.total.a_gerar - p.total.vao_a_api ? `${p.total.a_gerar - p.total.vao_a_api} saem do cache. ` : ''}`
          + 'As falas entram na faixa de voz no começo de cada cena; Ctrl+Z desfaz.'});
      if (!ok) return null;
    }
    mudar({andamento: {documento, feitas: 0, total: p.itens.length, fase: 'gerando', n: p.itens[0].n, cena: p.itens[0].cena}});
    const r = await window.estudio.narracao.gerar(documento, {cenas: o.cenas, refazer: o.refazer});
    mudar({andamento: null, ultimo: r});
    await carregarDoc(documento);
    if (r.ok) {
      const cache = r.geradas.filter((g) => g.do_cache).length;
      avisar(`Narração: ${r.geradas.length} ${r.geradas.length === 1 ? 'fala gerada' : 'falas geradas'}${cache ? ` (${cache} do cache)` : ''}${r.custo_usd ? `, ${textoCusto(r.custo_usd)}` : ''}.`
        + `${r.avisos.length ? ` ${r.avisos[0]}` : ''}`, r.avisos.length ? 'info' : 'ok');
    } else avisar(r.cancelado ? `Narração ${r.erro ?? 'cancelada'}.` : `A narração parou: ${r.erro}${r.geradas.length ? ` (${r.geradas.length} entraram no vídeo)` : ''}`, r.cancelado ? 'info' : 'erro');
    return r;
  } catch (e) {
    mudar({andamento: null});
    avisar(mensagemDe(e), 'erro');
    return null;
  }
};

export const cancelarFalas = () => window.estudio.narracao.cancelar();

/** "Ajustar a duração das cenas à fala": cada cena com fala dura folga + fala + margem, num patch só (Ctrl+Z ou Reverter desfaz). */
export const ajustarCenas = async (documento: string, o: {cenas?: string[]; apenas_alongar?: boolean} = {}) => {
  const d = docDe(documento);
  if (!d) return;
  const r = ajustarCenasAFala(d, o);
  if (!r.patch.length) return avisar('As cenas já duram a fala mais a margem (ou nenhuma cena tem fala gerada).', 'info');
  const ok = await aplicar(documento, r.patch, `cenas ajustadas à fala (${r.mudancas.length} ${r.mudancas.length === 1 ? 'cena' : 'cenas'})`);
  const s1 = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1});
  if (ok) avisar(`${r.mudancas.map((m) => `cena ${m.n}: ${s1(m.antes_ms)} → ${s1(m.depois_ms)} s`).join(' · ')}. Ctrl+Z desfaz.`, 'ok');
};

/** Toca a amostra (uma frase curta) na voz da configuração atual. */
let tocando: HTMLAudioElement | null = null;
export const ouvirAmostra = async (config: ConfigNarracao | undefined) => {
  try {
    const r = await window.estudio.narracao.amostra(config ?? {});
    tocando?.pause();
    const url = URL.createObjectURL(new Blob([r.wav], {type: 'audio/wav'}));
    tocando = new Audio(url);
    tocando.onended = () => URL.revokeObjectURL(url);
    await tocando.play();
    if (!r.do_cache && r.custo_usd) avisar(`Amostra gerada (${textoCusto(r.custo_usd)}); a mesma frase nesta voz não é paga de novo.`, 'info');
  } catch (e) {
    avisar(`Não deu para ouvir a amostra: ${mensagemDe(e)}`, 'erro');
  }
};
