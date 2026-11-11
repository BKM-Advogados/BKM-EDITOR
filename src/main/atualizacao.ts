// Atualização do Estúdio (docs/atualizacao.md): quando procurar, o que mostrar e quando reiniciar. Não importa o Electron:
// o main.ts liga a rede, o navegador, a tela e os motores (atualizacao-windows.ts, atualizacao-linux.ts), e os testes
// trocam tudo por falsos.
//
// Regras: procura 15 s depois de abrir e a cada 6 horas, se a preferência deixar; sem rede fica em silêncio (só o
// "Procurar agora" diz que falhou); em desenvolvimento não faz nada; versão de teste fica de fora; o reinício espera a
// exportação e a gravação terminarem.
import type {AcaoAtualizacao, EstadoAtualizacao, ModoAtualizacao, OcupadoNaTela} from '../compartilhado/atualizacao';
import {ATRASO_INICIAL_MS, type Buscar, COMANDO_LINUX, ehVersaoDeTeste, INTERVALO_MS, instaladoPeloScript, type Novidade, PAGINA_RELEASES, procurar,
  urlPermitida} from '../nucleo/atualizacao';

/** O electron-updater do Windows, reduzido ao que o atualizador usa (atualizacao-windows.ts). */
export type MotorWindows = {
  /** A versão nova anunciada no latest.yml da última release, ou null se está em dia. Lança sem rede. As notas vêm do
   *  feed do GitHub (HTML, ou uma lista por versão) e passam por textoDasNotas. */
  procurar: () => Promise<{versao: string; titulo?: string; notas?: unknown} | null>;
  baixar: (aoProgresso: (fracao: number) => void) => Promise<void>;
  /** Fecha o app e roda o instalador baixado em silêncio, reabrindo o Estúdio depois. */
  instalarAgora: () => void;
};

/** A troca da pasta do Linux instalado pelo script (atualizacao-linux.ts). */
export type MotorLinux = {
  /** Baixa o zip, confere o SHA-256 pelo SHA256SUMS.txt da release e deixa a pasta nova pronta ao lado. */
  preparar: (n: Novidade, aoProgresso: (fracao: number) => void) => Promise<void>;
  /** Troca a pasta instalada pela nova e reabre o app por ela. */
  trocarEReabrir: () => Promise<void>;
};

export type Relogio = {
  setTimeout: (f: () => void, ms: number) => unknown;
  clearTimeout: (t: unknown) => void;
  agora: () => number;
};

export type DepsAtualizador = {
  empacotado: boolean;
  plataforma: string;
  arch: string;
  versao: string;
  home: string;
  executavel: string;
  /** ESTUDIO_ATUALIZACAO_TESTE=1: pre-releases e versões com hífen entram (para testar uma atualização de verdade). */
  aceitarTestes?: boolean;
  prefs: () => {procurar_atualizacoes?: boolean; versao_pulada?: string};
  gravarPrefs: (p: {versao_pulada?: string}) => void;
  buscar: Buscar;
  abrirNoNavegador: (url: string) => void;
  avisarTela: (e: EstadoAtualizacao) => void;
  /** O que o processo principal está fazendo e segura o reinício ("a exportação"), ou null. */
  ocupadoNoPrincipal: () => string | null;
  /** Fecha projeto, terminais, conversas e apps de fora, com o commit da última edição, antes de reiniciar. */
  encerrar: () => Promise<void>;
  /** Carregado na primeira procura (o electron-updater só existe para o Windows). */
  windows?: () => Promise<MotorWindows>;
  linux?: MotorLinux;
  relogio?: Relogio;
  registrar?: (msg: string) => void;
};

export type Atualizador = {
  iniciar: () => void;
  parar: () => void;
  estado: () => EstadoAtualizacao;
  /** "Procurar agora" (manual: diz o resultado e mostra até a versão pulada). */
  procurarAgora: () => Promise<EstadoAtualizacao>;
  acao: (a: AcaoAtualizacao) => Promise<EstadoAtualizacao>;
  /** A tela conta o que está fazendo (gravação da narração, documento sendo salvo). */
  ocupadoNaTela: (o: OcupadoNaTela) => void;
  /** O processo principal terminou algo que segurava o reinício (fim da exportação). */
  livre: () => void;
};

const RELOGIO_PADRAO: Relogio = {setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>), agora: () => Date.now()};

export const modoDe = (empacotado: boolean, plataforma: string, temWindows = true): ModoAtualizacao =>
  !empacotado ? 'desligado' : plataforma === 'win32' ? (temWindows ? 'windows' : 'desligado') : 'aviso';

/** As notas do latest.yml vêm em HTML (o feed do GitHub): viram texto. */
export const textoDasNotas = (notas: unknown): string => {
  const bruto = Array.isArray(notas) ? notas.map((n) => (typeof n?.note === 'string' ? n.note : '')).join('\n') : typeof notas === 'string' ? notas : '';
  return bruto.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|div)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
};

export const criarAtualizador = (d: DepsAtualizador): Atualizador => {
  const relogio = d.relogio ?? RELOGIO_PADRAO;
  const modo = modoDe(d.empacotado, d.plataforma, Boolean(d.windows));
  const linuxScript = modo === 'aviso' && Boolean(d.linux) && instaladoPeloScript(d.plataforma, d.executavel, d.home);
  const registrar = d.registrar ?? (() => undefined);
  const automatico = () => d.prefs().procurar_atualizacoes !== false;
  let motorWin: Promise<MotorWindows> | null = null;
  const windows = () => (motorWin ??= d.windows!().catch((x) => {
    motorWin = null; // tenta carregar de novo na próxima procura
    throw x;
  }));

  let e: EstadoAtualizacao = {versao_atual: d.versao, modo, linux_script: linuxScript, ...(linuxScript ? {comando_linux: COMANDO_LINUX} : {}),
    automatico: automatico(), procurando: false, fase: 'nada', adiada: false};
  let tela: OcupadoNaTela = {};
  let relogioCiclo: unknown = null;
  let parado = false;

  const mudar = (m: Partial<EstadoAtualizacao>) => {
    e = {...e, ...m, automatico: automatico()};
    d.avisarTela(e);
    return e;
  };
  const semCampos = (...campos: (keyof EstadoAtualizacao)[]) => {
    const c = {...e};
    for (const k of campos) delete c[k];
    e = c;
  };

  const ocupadoCom = (): string | null => d.ocupadoNoPrincipal()
    ?? (tela.gravando_narracao ? 'a gravação da narração' : tela.exportando ? 'a exportação' : tela.salvando ? 'a gravação do documento' : null);

  // ---------- reinício ----------
  const reiniciar = async () => {
    const motivo = ocupadoCom();
    if (motivo) return mudar({fase: 'aguardando', esperando: motivo});
    semCampos('esperando');
    mudar({fase: 'instalando'});
    try {
      await d.encerrar();
      if (modo === 'windows') (await windows()).instalarAgora();
      else await d.linux!.trocarEReabrir();
    } catch (x) {
      registrar(`atualização: o reinício falhou: ${(x as Error).message}`);
      mudar({fase: 'falhou', erro: `Não deu para reiniciar e atualizar: ${(x as Error).message}`});
    }
    return e;
  };
  const talvezReiniciar = () => {
    if (e.fase === 'aguardando' && !ocupadoCom()) void reiniciar();
    else if (e.fase === 'aguardando') mudar({esperando: ocupadoCom()!});
  };

  // ---------- procura ----------
  const procurarWindows = async (manual: boolean) => {
    const w = await windows();
    const info = await w.procurar();
    if (!info || (!d.aceitarTestes && ehVersaoDeTeste(info.versao))) {
      if (manual) mudar({mensagem: `Você já está na versão mais nova (${d.versao}).`});
      return;
    }
    const novidade: Novidade = {versao: info.versao, tag: '', titulo: info.titulo?.trim() || `Estúdio ${info.versao}`, notas: textoDasNotas(info.notas),
      pagina: PAGINA_RELEASES, arquivo: null};
    mudar({novidade, fase: 'baixando', progresso: 0, adiada: false, procurando: false, mensagem: manual ? `Baixando a versão ${info.versao}…` : undefined});
    try {
      await w.baixar((p) => mudar({progresso: Math.max(0, Math.min(1, p))}));
    } catch (x) {
      registrar(`atualização: o download falhou: ${(x as Error).message}`);
      // automático: some em silêncio e tenta de novo na próxima procura
      if (manual) mudar({fase: 'falhou', erro: 'O download da versão nova falhou. Tente de novo mais tarde.'});
      else {
        semCampos('novidade', 'progresso');
        mudar({fase: 'nada'});
      }
      return;
    }
    semCampos('progresso');
    mudar({fase: 'pronta', mensagem: manual ? `A versão ${info.versao} está pronta: instala ao fechar o Estúdio.` : undefined});
  };

  const procurarAviso = async (manual: boolean) => {
    const r = await procurar(d.buscar, {versaoAtual: d.versao, versaoApp: d.versao, plataforma: d.plataforma, arch: d.arch,
      pulada: manual ? undefined : d.prefs().versao_pulada, aceitarTestes: d.aceitarTestes});
    if (r.tipo === 'falhou') {
      registrar(`atualização: procura falhou: ${r.detalhe}`);
      if (manual) mudar({mensagem: 'Não deu para procurar agora: sem conexão, ou o GitHub não respondeu.'});
      return;
    }
    if (r.tipo !== 'nova') {
      if (manual) mudar({mensagem: `Você já está na versão mais nova (${d.versao}).`});
      return;
    }
    // mesma versão já aberta no aviso: o "Lembrar depois" vale até a próxima procura
    mudar({novidade: r.novidade, fase: 'disponivel', adiada: false, mensagem: manual ? `Há uma versão nova: ${r.novidade.versao}.` : undefined});
  };

  const procurarUmaVez = async (manual: boolean) => {
    if (modo === 'desligado') {
      if (manual) mudar({mensagem: 'Em desenvolvimento o Estúdio não procura atualizações.'});
      return e;
    }
    // já baixando ou pronta (ou reiniciando): não procura de novo por cima
    if (e.procurando || ['baixando', 'pronta', 'aguardando', 'instalando'].includes(e.fase)) {
      if (manual) mudar({});
      return e;
    }
    semCampos('mensagem', 'erro');
    mudar({procurando: true, ...(e.fase === 'falhou' ? {fase: 'nada' as const} : {})});
    try {
      if (modo === 'windows') await procurarWindows(manual);
      else await procurarAviso(manual);
    } catch (x) {
      registrar(`atualização: procura falhou: ${(x as Error).message}`);
      if (manual) mudar({mensagem: 'Não deu para procurar agora: sem conexão, ou o GitHub não respondeu.'});
    }
    return mudar({procurando: false, ultima_procura: new Date(relogio.agora()).toISOString()});
  };

  const ciclo = () => {
    relogioCiclo = null;
    if (parado) return;
    const vez = automatico() ? procurarUmaVez(false) : Promise.resolve(e);
    void vez.catch(() => undefined).finally(() => {
      if (!parado) relogioCiclo = relogio.setTimeout(ciclo, INTERVALO_MS);
    });
  };

  return {
    iniciar() {
      if (modo === 'desligado' || relogioCiclo || parado) return;
      relogioCiclo = relogio.setTimeout(ciclo, ATRASO_INICIAL_MS);
    },
    parar() {
      parado = true;
      if (relogioCiclo) relogio.clearTimeout(relogioCiclo);
      relogioCiclo = null;
    },
    estado: () => ({...e, automatico: automatico()}),
    procurarAgora: () => procurarUmaVez(true),
    async acao(a) {
      const n = e.novidade;
      switch (a) {
        case 'baixar': {
          const url = n?.arquivo?.url ?? n?.pagina ?? PAGINA_RELEASES;
          if (urlPermitida(url)) d.abrirNoNavegador(url);
          return e;
        }
        case 'pular':
          if (!n || modo === 'windows') return e;
          d.gravarPrefs({versao_pulada: n.versao});
          semCampos('novidade', 'progresso', 'erro');
          return mudar({fase: 'nada', adiada: false});
        case 'depois':
          return mudar({adiada: true});
        case 'mostrar':
          return mudar({adiada: false});
        case 'atualizar_linux': {
          if (!linuxScript || !n?.arquivo || !n.somas || !['disponivel', 'falhou'].includes(e.fase)) return e;
          semCampos('erro');
          mudar({fase: 'baixando', progresso: 0, adiada: false});
          try {
            await d.linux!.preparar(n, (p) => mudar({progresso: Math.max(0, Math.min(1, p))}));
          } catch (x) {
            registrar(`atualização: o Linux não atualizou: ${(x as Error).message}`);
            semCampos('progresso');
            return mudar({fase: 'falhou', erro: `Não deu para atualizar: ${(x as Error).message}`});
          }
          semCampos('progresso');
          return mudar({fase: 'pronta'});
        }
        case 'reiniciar':
          return e.fase === 'pronta' || e.fase === 'aguardando' ? reiniciar() : e;
        case 'cancelar_reinicio':
          if (e.fase !== 'aguardando') return e;
          semCampos('esperando');
          return mudar({fase: 'pronta'});
        default:
          return e;
      }
    },
    ocupadoNaTela(o) {
      tela = {gravando_narracao: Boolean(o?.gravando_narracao), exportando: Boolean(o?.exportando), salvando: Boolean(o?.salvando)};
      talvezReiniciar();
    },
    livre: () => talvezReiniciar(),
  };
};
