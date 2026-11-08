// Frente IA (rodada 3, docs/ia.md): monta as conversas de todos os provedores e o IPC de Configurações › IA (lista de
// provedores, chaves, modelos, endereço, padrão e uso do mês). Registrado no main.ts com uma linha. A chave nunca sai
// daqui para a tela: só "tem chave", a origem e os 4 últimos caracteres.
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {EstadoProvedor, PedidoPortaoTela, ResultadoChave} from '../compartilhado/api';
import type {Projeto} from '../nucleo/projeto';
import type {McpHttp, Perguntador} from './mcp-http';
import {acharChave, CofreMemoria, finalDaChave, type Cofre} from './ia/chaves';
import {CofreArquivo, type Cifra} from './ia/cofre-arquivo';
import {AppsDeFora} from './ia/apps-de-fora';
import {apagarGuardada, guardarConversa, lerGuardada, listarGuardadas} from './ia/guardadas';
import {ConfiguracaoIA} from './ia/config';
import {textoDeSistema} from './ia/guia';
import {listarModelos} from './ia/modelos';
import {PROVEDORES, provedor as acharProvedor} from './ia/provedores';
import {acharExecutavel, SessoesIA, type OpcoesSessoes} from './ia/sessoes';
import {ambienteLimpo, PATH_COM_LOCAL} from './terminais';

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

let cofre: Cofre = new CofreMemoria();
let configuracao: ConfiguracaoIA | null = null;
/** Para os testes e para o registro: troca o cofre e a pasta da configuração. */
export const definirCofre = (c: Cofre, config?: ConfiguracaoIA) => {
  cofre = c;
  if (config) configuracao = config;
};

const ambienteAgente = () => ({...ambienteLimpo(), PATH: PATH_COM_LOCAL()});

export const criarSessoesIA = (o: Pick<OpcoesSessoes, 'evento' | 'vivasTerminal' | 'conexao' | 'claude'>) =>
  new SessoesIA({...o, cofre: {ler: (p) => cofre.ler(p), gravar: (p, c) => cofre.gravar(p, c), apagar: (p) => cofre.apagar(p)},
    sistema: textoDeSistema, ambiente: ambienteAgente,
    config: (p) => configuracao?.provedor(p) ?? {},
    aoParar: (origem) => cancelarPortaoDe(origem),
    aoUso: (p, _m, u, custo) => {
      try {
        configuracao?.registrarUso(p, u, custo ?? 0);
      } catch {
        /* a soma do mês nunca derruba a conversa */
      }
    }});

/** Cada provedor do catálogo com o que falta para usar. Agentes ACP só entram quando o executável é achado. */
export const estadoDosProvedores = async (o: {claudeInstalado: boolean; acharExe?: (n: string) => Promise<unknown>}): Promise<EstadoProvedor[]> => {
  const achar = o.acharExe ?? ((n: string) => acharExecutavel(n, ambienteAgente()));
  const cfg = configuracao?.ler() ?? {provedores: {}};
  const persistente = cofre instanceof CofreArquivo ? cofre.persistente() : false;
  const r: EstadoProvedor[] = [];
  for (const p of PROVEDORES) {
    const c = cfg.provedores[p.id] ?? {};
    const modelo = c.modelo ?? p.modelo;
    const base = c.base ?? p.base;
    const comum = {id: p.id, nome: p.nome, via: p.via, servidor: p.servidor, experimental: p.experimental, local: p.local, modelo, base,
      paginaChave: p.paginaChave, chave: p.chave, padrao: (cfg.padrao ?? 'claude') === p.id, cofre_persistente: persistente};
    if (p.via === 'claude-cli') {
      r.push({...comum, pronto: o.claudeInstalado, falta: o.claudeInstalado ? undefined : 'instalar o Claude Code'});
    } else if (p.via === 'acp') {
      if (await achar(p.exe!)) r.push({...comum, pronto: true});
    } else {
      const k = acharChave(cofre, p.id);
      const falta = !base ? 'endereço' : p.chave === 'exigida' && !k.chave ? 'chave' : !modelo ? 'modelo' : undefined;
      r.push({...comum, pronto: !falta, falta, chave_origem: k.origem, chave_final: finalDaChave(k.chave), chave_variavel: k.variavel});
    }
  }
  return r;
};

const conexaoDe = (id: string) => {
  const p = acharProvedor(id);
  if (!p || p.via !== 'openai') throw new Error('este provedor não usa chave nem endereço do app');
  const base = configuracao?.provedor(id).base ?? p.base;
  if (!base) throw new Error('falta o endereço deste provedor');
  return {p, base};
};

/** Testa a chave na lista de modelos (não gasta token). Recusada (401/403): não grava. Sem rede: grava e avisa. */
export const gravarChave = async (id: string, chave: string, f?: typeof fetch): Promise<ResultadoChave> => {
  const limpa = String(chave ?? '').trim();
  if (limpa.length < 8 || /\s/.test(limpa)) return {ok: false, mensagem: 'essa não parece uma chave de API (curta demais ou com espaço)'};
  const {p, base} = conexaoDe(id);
  const r = await listarModelos({base, chave: limpa, provedor: p.id, cabecalhos: p.cabecalhos, fetch: f});
  if (!r.ok && (r.status === 401 || r.status === 403)) return {ok: false, mensagem: r.mensagem};
  cofre.gravar(id, limpa);
  const persistente = cofre instanceof CofreArquivo ? cofre.persistente() : false;
  const onde = persistente ? 'guardada cifrada neste PC' : 'válida só enquanto o app estiver aberto (o Windows não ofereceu a cifra)';
  if (!r.ok) return {ok: true, persistente, mensagem: `chave ${onde}, mas não deu para testar agora: ${r.mensagem}`};
  return {ok: true, persistente, mensagem: `chave aceita e ${onde}`, modelos: r.modelos};
};

export const modelosDe = async (id: string, f?: typeof fetch) => {
  const {p, base} = conexaoDe(id);
  return listarModelos({base, chave: acharChave(cofre, id).chave, provedor: p.id, cabecalhos: p.cabecalhos, fetch: f});
};

// ---------- portão de permissão (src/nucleo/portao.ts): a pergunta vai à tela e a resposta volta por IPC ----------
const ESPERA_MAXIMA_MS = 10 * 60 * 1000;
type Espera = {origem: string; ok: (r: {permitir: boolean; sempre?: boolean}) => void; relogio: NodeJS.Timeout};
const esperas = new Map<string, Espera>();
let enviarATela: ((canal: string, ...a: unknown[]) => void) | null = null;
let canalPedido = '';
let canalCancelado = '';

const encerrarEspera = (id: string, r: {permitir: boolean; sempre?: boolean}, avisarTela: boolean) => {
  const e = esperas.get(id);
  if (!e) return;
  esperas.delete(id);
  clearTimeout(e.relogio);
  if (avisarTela) enviarATela?.(canalCancelado, id);
  e.ok(r);
};

/** O perguntador que o McpHttp usa: manda o pedido à tela e espera Permitir ou Negar (10 min no máximo). */
export const perguntarAPessoa: Perguntador = (p) => new Promise((ok) => {
  if (!enviarATela) return ok({permitir: false});
  const id = randomUUID();
  const relogio = setTimeout(() => encerrarEspera(id, {permitir: false}, true), ESPERA_MAXIMA_MS);
  esperas.set(id, {origem: p.origem, ok, relogio});
  p.sinal?.addEventListener('abort', () => encerrarEspera(id, {permitir: false}, true), {once: true});
  // a entrada vai curta: o cartão mostra o essencial (endereço, arquivo), nunca megabytes
  const entrada = JSON.parse(JSON.stringify(p.entrada, (_k, v) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v)));
  const pedido: PedidoPortaoTela = {id, origem: p.origem, ferramenta: p.ferramenta, motivo: p.motivo, entrada};
  enviarATela(canalPedido, pedido);
});

/** O Parar de uma conversa também nega o que esperava a pessoa naquela aba. */
export const cancelarPortaoDe = (origem: string) => {
  for (const [id, e] of esperas) if (e.origem === origem) encerrarEspera(id, {permitir: false}, true);
};

export type CanaisIa = {provedores: string; gravarChave: string; apagarChave: string; modelos: string; configurar: string; padrao: string;
  usoDoMes: string; conversaModelo: string; portaoPedido: string; portaoResposta: string; portaoCancelado: string; reverter: string;
  apps: string; appsLigar: string; appsNovo: string; appsConfigs: string; appsRevogar: string;
  guardar: string; guardadas: string; apagarGuardada: string};

/** Para o conversaAbrir do main: o que a conversa guardada precisa para continuar (histórico do laço, sessão do ACP). */
export const retomadaDe = (p: Projeto, sessao?: string) => {
  if (!sessao) return undefined;
  const g = lerGuardada(p, sessao);
  return g ? {historico: g.historico, agente: g.agente} : undefined;
};

// apps de IA de fora (padrão Screenpipe): criados no registro, ligados quando o MCP HTTP existir (iniciarAppsDeFora)
let apps: AppsDeFora | null = null;
export const iniciarAppsDeFora = () => apps?.iniciar();
export const fecharAppsDeFora = () => apps?.fechar();

export const registrarIpcIa = (o: {lidar: Lidar; canais: CanaisIa; claudeInstalado: () => boolean; pasta: string; cifra: Cifra;
  conversas: () => Pick<SessoesIA, 'definirModelo' | 'exportar'>; enviar: (canal: string, ...a: unknown[]) => void;
  ouvir: (canal: string, f: (...a: any[]) => void) => void; projeto: () => Projeto;
  mcp: () => McpHttp | null; ponte: () => {exe: string; script: string}}) => {
  enviarATela = o.enviar;
  canalPedido = o.canais.portaoPedido;
  canalCancelado = o.canais.portaoCancelado;
  o.ouvir(o.canais.portaoResposta, (id: string, permitir: boolean, sempre?: boolean) => encerrarEspera(String(id), {permitir: Boolean(permitir), sempre: Boolean(sempre)}, false));
  // Reverter por seq (cartão da conversa e Histórico): a pessoa reverte qualquer entrada; "mesmo assim" passa por cima
  o.lidar(o.canais.reverter, (seq: number, forcar?: boolean) => o.projeto().reverter(Number(seq), {autor: 'pessoa', origem: 'reverter', forcar: Boolean(forcar)}));
  definirCofre(new CofreArquivo(path.join(o.pasta, 'chaves.json'), o.cifra), new ConfiguracaoIA(o.pasta));
  const {lidar, canais} = o;
  lidar(canais.provedores, () => estadoDosProvedores({claudeInstalado: o.claudeInstalado()}));
  lidar(canais.gravarChave, (id: string, chave: string) => gravarChave(id, chave));
  lidar(canais.apagarChave, (id: string) => cofre.apagar(id));
  lidar(canais.modelos, (id: string) => modelosDe(id));
  lidar(canais.configurar, (id: string, c: {modelo?: string; base?: string}) => {
    const p = acharProvedor(id);
    if (!p) throw new Error('provedor desconhecido');
    // endereço só se edita no compatível e nos locais: os outros são os oficiais do catálogo
    if (c.base !== undefined && p.id !== 'compativel' && !p.local) throw new Error('o endereço deste provedor é fixo');
    return configuracao!.configurar(id, c);
  });
  lidar(canais.padrao, (id: string) => configuracao!.definirPadrao(id));
  lidar(canais.usoDoMes, () => configuracao!.usoDoMes());
  lidar(canais.conversaModelo, (id: number, modelo?: string) => o.conversas().definirModelo(id, modelo));
  apps = new AppsDeFora({pasta: o.pasta, cofre: {ler: (p) => cofre.ler(p), gravar: (p, c) => cofre.gravar(p, c), apagar: (p) => cofre.apagar(p)},
    mcp: o.mcp, ponte: o.ponte});
  lidar(canais.apps, () => apps!.estado());
  lidar(canais.appsLigar, (ligado: boolean, porta?: number) => apps!.ligar(Boolean(ligado), porta === undefined ? undefined : Number(porta)));
  lidar(canais.appsNovo, (nome: string) => apps!.novo(nome));
  lidar(canais.appsConfigs, (id: string) => apps!.configs(String(id)));
  lidar(canais.appsRevogar, (id: string) => apps!.revogar(String(id)));
  // conversas guardadas por projeto (F6, transversal-D9): a tela manda o que desenha; o processo principal junta o que a
  // via precisa para continuar (histórico do laço, sessão do agente ACP) e grava em .estudio/conversas/
  lidar(canais.guardar, (id: number, c: {titulo: string; itens: unknown[]; uso?: unknown}) => {
    const x = o.conversas().exportar(Number(id));
    if (!x) return null;
    return guardarConversa(o.projeto(), {...x, titulo: String(c.titulo ?? ''), itens: Array.isArray(c.itens) ? c.itens : [], uso: c.uso});
  });
  lidar(canais.guardadas, () => listarGuardadas(o.projeto()));
  lidar(canais.apagarGuardada, (sessao: string) => apagarGuardada(o.projeto(), String(sessao)));
};
