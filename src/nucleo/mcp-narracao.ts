// Ferramentas MCP da narração por IA (docs/narracao.md). As que vão à rede (vozes_narracao, narrar) declaram
// openWorldHint: o portão mostra o cartão de permissão antes; `narrar` com previa: true não sai do PC e roda direto (portao.ts).
// As outras são livres: gravam no diário e têm Reverter. Esquema sem z.any() nem união solta, como as outras frentes.
// O serviço (chave, fetch, preço) vem de quem registra: do processo principal no app (a chave do cofre nunca chega à tela) e
// das variáveis de ambiente no MCP por stdio (mcp/nucleo.ts). Registrado com uma linha no fim de registrarFerramentas.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {aplicarPronuncias, configDaNarracao, MODELOS_GEMINI_TTS, NOMES_PROVEDOR, PROVEDORES_NARRACAO, pronunciasValidas, VELOCIDADE_MAX, VELOCIDADE_MIN, vozDoProvedor,
  type ConfigNarracao, type Pronuncia, type ProvedorNarracao} from './narracao';
import {ajustarCenasAFala, itensDaNarracao, ROTULO_ESTADO} from './narracao-cenas';
import {gerarNarracao, listarVozes, previaDaNarracao, videoDeCenasDe, type ServicoNarracao} from './narracao-servico';
import {ErroProjeto, type Projeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const seguro = <A,>(f: (a: A, sinal?: AbortSignal) => unknown) => async (a: A, extra?: {signal?: AbortSignal}) => {
  try {
    return texto(await f(a, extra?.signal));
  } catch (e) {
    return erro(e);
  }
};
const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1});
const SEM_SERVICO = 'este MCP não tem o serviço de narração: abra o projeto no Estúdio, ou rode o MCP por stdio com GEMINI_API_KEY ou GOOGLE_TTS_API_KEY';
const LEGENDAS = 'para as legendas, chame transcrever (sem argumentos): ele transcreve as falas novas no PC e gera as legendas com o tempo de cada palavra';

/** O estado da fala de cada cena, curto, para a IA decidir o que gerar. */
const resumoDasCenas = (projeto: Projeto, doc: Parameters<typeof itensDaNarracao>[0]) => itensDaNarracao(doc, (r) => projeto.existe(r)).map((i) => ({
  cena: i.cena, n: i.n, estado: i.estado, rotulo: ROTULO_ESTADO[i.estado], ...(i.motivo ? {motivo: i.motivo} : {}),
  ...(i.clipe ? {clipe: i.clipe.id, fala_ms: i.clipe.duracao_ms} : {}), duracao_cena_ms: i.t_out - i.t_in}));

export const registrarNarracao = (servidor: McpServer, projeto: Projeto, autor: string, origem: string, servico?: ServicoNarracao) => {
  servidor.registerTool('vozes_narracao', {
    description: 'Lista as vozes da narração por IA. gemini: as 30 vozes prontas (Kore, Charon, Puck, Leda…) e, com a chave, as da biblioteca estendida em português. google-tts: as vozes Chirp 3: HD em português (pt-BR-Chirp3-HD-<Nome>) que a chave enxerga. Não tem custo; usa a chave da pessoa. O "id" vai em configurar_narracao {voz}.',
    inputSchema: {provedor: z.enum(['gemini', 'google-tts']).optional().describe('padrão: o da configuração do vídeo, ou gemini')},
    annotations: {openWorldHint: true},
  }, seguro(async ({provedor}: {provedor?: ProvedorNarracao}, sinal) => {
    if (!servico) throw new ErroProjeto(SEM_SERVICO, 'patch');
    let p = provedor;
    if (!p) {
      try {
        p = configDaNarracao(videoDeCenasDe(projeto).doc.narracao).provedor;
      } catch {
        p = 'gemini';
      }
    }
    const r = await listarVozes(servico, p, sinal);
    return {provedor: r.provedor, nome: NOMES_PROVEDOR[r.provedor], vozes: r.vozes.map((v) => ({id: v.id, ...(v.descricao ? {descricao: v.descricao} : {}), ...(v.genero ? {genero: v.genero} : {})})),
      ...(r.aviso ? {aviso: r.aviso} : {})};
  }));

  servidor.registerTool('configurar_narracao', {
    description: `Muda a configuração da narração por IA do vídeo de cenas (campo "narracao" na raiz): provedor (gemini = Gemini TTS do Google AI Studio, com a chave do Gemini; google-tts = Google Cloud TTS com as vozes Chirp 3: HD), modelo (só gemini: ${MODELOS_GEMINI_TTS.map((m) => m.id).join(', ')}), voz (vozes_narracao), estilo (só gemini: como falar, em linguagem natural, ex.: "calmo e didático, sem pressa"), velocidade (só google-tts: ${VELOCIDADE_MIN} a ${VELOCIDADE_MAX}), folga_ms (a fala entra quanto depois do começo da cena; padrão 300) e margem_ms (o que sobra depois da fala ao ajustar as cenas; padrão 500). Só os campos passados mudam. Mudar voz, modelo, estilo ou velocidade deixa as falas já geradas desatualizadas. Vai para o diário: Reverter desfaz.`,
    inputSchema: {
      provedor: z.enum(['gemini', 'google-tts']).optional(),
      modelo: z.string().optional(),
      voz: z.string().optional(),
      estilo: z.string().max(2000).optional().describe('vazio tira o estilo'),
      velocidade: z.number().min(VELOCIDADE_MIN).max(VELOCIDADE_MAX).optional(),
      folga_ms: z.number().min(0).max(5000).optional(),
      margem_ms: z.number().min(0).max(10000).optional(),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro((a: ConfigNarracao & {documento?: string}) => {
    const {alvo, rel, doc, versao} = videoDeCenasDe(projeto, a.documento);
    const atual: ConfigNarracao = doc.narracao && typeof doc.narracao === 'object' ? {...doc.narracao} : {};
    const novo: ConfigNarracao = {...atual};
    for (const k of ['provedor', 'modelo', 'voz', 'estilo', 'velocidade', 'folga_ms', 'margem_ms'] as const) {
      if (a[k] === undefined) continue;
      if (k === 'estilo' && !String(a.estilo).trim()) delete novo.estilo;
      else (novo as Record<string, unknown>)[k] = typeof a[k] === 'string' ? String(a[k]).trim() : a[k];
    }
    if (a.provedor && a.provedor !== atual.provedor && a.voz === undefined && novo.voz) novo.voz = vozDoProvedor(a.provedor, novo.voz);
    if (novo.provedor === 'google-tts') delete novo.modelo;
    const antes = itensDaNarracao(doc).filter((i) => i.estado === 'gerada').length;
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: [{op: doc.narracao ? 'replace' : 'add', path: '/narracao', value: novo}], autor, origem,
      rotulo: 'configuração da narração por IA'});
    const depois = videoDeCenasDe(projeto, alvo).doc;
    const cfg = configDaNarracao(depois.narracao);
    const desatualizadas = itensDaNarracao(depois).filter((i) => i.estado === 'desatualizada').length;
    return {ok: true, documento: alvo, versao: gravado.versao, narracao: {provedor: cfg.provedor, modelo: cfg.modelo, voz: cfg.voz, estilo: cfg.estilo || undefined,
      velocidade: cfg.provedor === 'google-tts' ? cfg.velocidade : undefined, folga_ms: cfg.folga_ms, margem_ms: cfg.margem_ms},
      ...(antes && desatualizadas ? {desatualizadas, nota: 'as falas já geradas não batem mais com a configuração: gere de novo com narrar'} : {})};
  }));

  servidor.registerTool('pronuncias_narracao', {
    description: 'Lê e muda o dicionário de pronúncia da narração por IA ("narracao.pronuncias" do vídeo): cada item {de, para} troca a palavra inteira "de" por "para" no texto antes de ir a qualquer provedor (ex.: PIN → pin, RH → erre agá, CLT → cê ele tê). Com maiúscula no "de" (sigla), só casa a mesma caixa; todo em minúsculas, casa qualquer caixa. Sem argumentos, só lê. "definir" acrescenta ou troca; "tirar" remove pelo "de"; "testar" devolve um texto com as trocas aplicadas. Mudar o dicionário deixa desatualizadas as falas que ele afeta. Vai para o diário: Reverter desfaz.',
    inputSchema: {
      definir: z.array(z.object({de: z.string().min(1).max(200), para: z.string().max(400)})).optional(),
      tirar: z.array(z.string()).optional().describe('os "de" a remover'),
      testar: z.string().max(5000).optional().describe('um texto para ver como fica com o dicionário'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({definir, tirar, testar, documento}: {definir?: Pronuncia[]; tirar?: string[]; testar?: string; documento?: string}) => {
    const {alvo, rel, doc, versao} = videoDeCenasDe(projeto, documento);
    const lista = pronunciasValidas(doc.narracao?.pronuncias);
    let nova = lista;
    if (tirar?.length) nova = nova.filter((p) => !tirar.some((t) => t.trim() === p.de));
    for (const d of pronunciasValidas(definir)) {
      const i = nova.findIndex((p) => p.de === d.de);
      nova = i >= 0 ? nova.map((p, j) => (j === i ? d : p)) : [...nova, d];
    }
    const mudou = JSON.stringify(nova) !== JSON.stringify(lista);
    let versaoNova = versao;
    if (mudou) {
      const antes = new Set(itensDaNarracao(doc).filter((i) => i.estado === 'gerada').map((i) => i.cena));
      const narracao = {...(doc.narracao && typeof doc.narracao === 'object' ? doc.narracao : {}), pronuncias: nova};
      if (!nova.length) delete (narracao as ConfigNarracao).pronuncias;
      const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: [{op: doc.narracao ? 'replace' : 'add', path: '/narracao', value: narracao}], autor, origem,
        rotulo: `dicionário de pronúncia (${nova.length} ${nova.length === 1 ? 'item' : 'itens'})`});
      versaoNova = gravado.versao;
      const depois = itensDaNarracao(videoDeCenasDe(projeto, alvo).doc).filter((i) => i.estado === 'desatualizada' && antes.has(i.cena)).map((i) => i.n);
      return {ok: true, documento: alvo, versao: versaoNova, pronuncias: nova, ...(depois.length ? {cenas_desatualizadas: depois, nota: 'gere de novo essas cenas com narrar'} : {}),
        ...(testar !== undefined ? {teste: aplicarPronuncias(testar, nova)} : {})};
    }
    return {documento: alvo, versao: versaoNova, pronuncias: nova, ...(testar !== undefined ? {teste: aplicarPronuncias(testar, nova)} : {})};
  }));

  servidor.registerTool('narrar', {
    description: `Gera a narração por IA das cenas do vídeo, com a voz do Google (configurar_narracao): o texto de cada cena vem de cenas[i].narracao.texto (o roteiro falado, diferente do texto da tela), passa pelo dicionário de pronúncia e vira um WAV em midia/narracao/<hash>.wav, que entra numa faixa de voz no começo da cena (mais a folga). Cache pelo hash do texto e da voz: só vai ao Google a cena que mudou. Sem "cenas", gera as que estão a gerar ou desatualizadas. Pausas no texto: [pausa], [pausa longa]. Com previa: true, não chama a API: devolve o texto final de cada cena (com as pronúncias), os caracteres, a duração e o custo estimados — mostre à pessoa antes de gerar. Depois de gerar: ajustar_cenas_a_fala para a cena durar a fala, e transcrever para as legendas. Vai para o diário: Reverter desfaz.`,
    inputSchema: {
      cenas: z.array(z.string()).optional().describe('ids das cenas (ou o número: "2"); sem ele, as que faltam'),
      previa: z.boolean().optional().describe('true: só o texto final, os caracteres e o custo estimado, sem chamar a API'),
      refazer: z.boolean().optional().describe('gera de novo mesmo o que está no cache (outra tomada)'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
    annotations: {openWorldHint: true},
  }, seguro(async ({cenas, previa, refazer, documento}: {cenas?: string[]; previa?: boolean; refazer?: boolean; documento?: string}, sinal) => {
    const {alvo, doc} = videoDeCenasDe(projeto, documento);
    if (previa) {
      const p = previaDaNarracao(projeto, alvo, doc, {cenas, refazer}, servico);
      return {...p, ...(p.tem_chave ? {} : {aviso: servico ? `falta a chave: ${NOMES_PROVEDOR[p.provedor]}` : SEM_SERVICO}),
        cenas: resumoDasCenas(projeto, doc), nota: 'nada foi gerado: chame narrar sem previa para gerar'};
    }
    if (!servico) throw new ErroProjeto(SEM_SERVICO, 'patch');
    const r = await gerarNarracao(projeto, servico, {documento: alvo, cenas, refazer, sinal, autor, origem});
    if (!r.ok && !r.geradas.length) throw new ErroProjeto(r.erro ?? 'a narração não foi gerada', 'patch');
    const depois = videoDeCenasDe(projeto, alvo).doc;
    const passam = itensDaNarracao(depois).filter((i) => i.clipe && i.clipe.em + i.clipe.duracao_ms > i.t_out + 1).map((i) => i.n);
    return {...r, ...(r.geradas.length ? {proximo: [...(passam.length ? [`as falas das cenas ${passam.join(', ')} passam do fim da cena: chame ajustar_cenas_a_fala`] : []), LEGENDAS]} : {})};
  }));

  servidor.registerTool('ajustar_cenas_a_fala', {
    description: 'Ajusta a duração das cenas à narração gerada: cada cena com fala passa a durar folga + fala + margem (margem_ms; padrão o da configuração, 500 ms). As falas vão para o começo das cenas no tempo novo e o resto do som anda junto, como quando a pessoa muda a duração. apenas_alongar: só cresce as cenas curtas demais. Ação explícita: não roda sozinha depois de narrar. Vai para o diário: Reverter desfaz tudo de uma vez.',
    inputSchema: {
      cenas: z.array(z.string()).optional().describe('ids das cenas (ou o número); sem ele, todas as que têm fala gerada'),
      margem_ms: z.number().min(0).max(10000).optional(),
      apenas_alongar: z.boolean().optional(),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({cenas, margem_ms, apenas_alongar, documento}: {cenas?: string[]; margem_ms?: number; apenas_alongar?: boolean; documento?: string}) => {
    const {alvo, rel, doc, versao} = videoDeCenasDe(projeto, documento);
    const r = ajustarCenasAFala(doc, {cenas, margem_ms, apenas_alongar});
    if (!r.patch.length) {
      const temFala = itensDaNarracao(doc).some((i) => i.clipe);
      return {ok: true, documento: alvo, nada: temFala ? 'as cenas já duram a fala mais a margem' : 'nenhuma cena tem fala gerada: chame narrar antes', ...(r.avisos.length ? {avisos: r.avisos} : {})};
    }
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: r.patch, autor, origem,
      rotulo: `cenas ajustadas à fala (${r.mudancas.length} ${r.mudancas.length === 1 ? 'cena' : 'cenas'})`});
    return {ok: true, documento: alvo, versao: gravado.versao, mudancas: r.mudancas.map((m) => ({...m, texto: `cena ${m.n}: ${seg(m.antes_ms)} s → ${seg(m.depois_ms)} s`})),
      ...(r.avisos.length ? {avisos: r.avisos} : {}), nota: 'Reverter desfaz'};
  }));
};

export {PROVEDORES_NARRACAO};
