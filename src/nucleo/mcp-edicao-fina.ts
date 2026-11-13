// Edição fina pelo MCP (frente 4): o que antes o agente só fazia montando um aplicar_patch grande e frágil à mão. Cada
// ferramenta faz o mesmo que o botão da tela, com a mesma conta do núcleo, e grava UM passo no diário (autor e origem do
// agente, com Reverter e desfazer): a lâmina e a cópia de cena (cenas-dividir.ts, cenas.ts), as legendas
// (legendas-edicao.ts), as páginas do carrossel (carrossel.ts), as entradas e saídas prontas da animação
// (animacao-preajustes.ts) e a pilha de efeitos (efeitos.ts). Todas livres: só mexem no documento do projeto.
// Esquemas sem z.any() nem união solta, para valerem no Claude, no Gemini, no DeepSeek e no OpenAI.
// Chamado por uma linha no fim de registrarFerramentas (ferramentas-mcp.ts).
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {ehDocAnimacao, type DocAnimacao} from './animacao';
import {DURACAO_PREAJUSTE_MS, PREAJUSTES, preajusteDe, trilhasComPreajuste} from './animacao-preajustes';
import {paginasDe, patchDuplicarPagina, patchExcluirPagina, patchMoverPagina, patchNovaPagina, patchRenomearPagina, type ResultadoPaginas} from './carrossel';
import {comIdsNovos, ehDocCenas, resolverCenas, type CenaCenas, type DocCenas} from './cenas';
import {dividirCena, PEDACO_MIN_MS} from './cenas-dividir';
import type {DocImagem, Modulo, OperacaoPatch} from './documentos';
import {EFEITOS, efeitosDoPreajuste, idsEmUso, lerEfeitos, novoEfeito, patchAdicionarEfeitos, patchRemoverEfeito, PREAJUSTES_EFEITOS, problemasDosEfeitos, type Efeito, type TipoEfeito} from './efeitos';
import {deslocamentoDaLegenda, PREDEFINICOES_LEGENDA, type IdEstiloLegenda} from './legendas';
import {
  estiloComPredefinicao, legendasComPredefinicao, legendasComSubstituicao, patchDasLegendas, patchDividirLegenda, patchExcluirLegenda, patchJuntarLegendas, patchNovaLegenda,
  recusouLegenda,
} from './legendas-edicao';
import {ErroProjeto, type Projeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    return texto(await f(a));
  } catch (e) {
    return erro(e);
  }
};

const NOME_MODULO: Record<Modulo, string> = {video: 'vídeo', imagem: 'imagem', '3d': 'cena 3D', musica: 'música', animacao: 'animação'};

/** O documento pedido, ou o que a pessoa está vendo (se for de um dos módulos), ou o primeiro do projeto desses módulos. */
const alvoDe = (projeto: Projeto, documento: string | undefined, modulos: Modulo[]) => {
  const docs = projeto.manifesto().documentos;
  const vendo = projeto.estado()?.documento;
  const alvo = documento ?? (docs.find((d) => d.id === vendo && modulos.includes(d.modulo))?.id) ?? docs.find((d) => modulos.includes(d.modulo))?.id;
  if (!alvo) throw new ErroProjeto(`o projeto não tem ${modulos.map((m) => NOME_MODULO[m]).join(' nem ')}`, 'nao_achado');
  const entrada = docs.find((d) => d.id === alvo || d.caminho === alvo);
  if (entrada && !modulos.includes(entrada.modulo)) throw new ErroProjeto(`${alvo} é ${NOME_MODULO[entrada.modulo]}: esta ferramenta é de ${modulos.map((m) => NOME_MODULO[m]).join(' ou ')}`, 'patch');
  const rel = projeto.arquivoDoDocumento(alvo);
  const lido = projeto.lerJson<unknown>(rel);
  return {alvo, rel, doc: lido.doc, versao: lido.versao};
};

const videoDe = (projeto: Projeto, documento?: string) => {
  const r = alvoDe(projeto, documento, ['video']);
  if (!ehDocCenas(r.doc)) throw new ErroProjeto(`${r.alvo} não é um vídeo de cenas (o carrossel narrado segue a narração: edite o roteiro)`, 'patch');
  return {...r, doc: r.doc as DocCenas};
};

const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 2});

/** Página pelo id ou pelo número (1 = a primeira). */
const indiceDaPagina = (doc: DocImagem, pagina: string | undefined, padrao: number) => {
  const paginas = paginasDe(doc);
  if (pagina === undefined) return padrao;
  const p = pagina.trim();
  const i = /^\d+$/.test(p) ? Number(p) - 1 : paginas.findIndex((x) => x.id === p);
  if (i < 0 || i >= paginas.length) throw new ErroProjeto(`página não achada: ${pagina} (o documento tem ${paginas.length}: ${paginas.map((x, k) => `${k + 1} ${x.id}`).join(', ')})`, 'nao_achado');
  return i;
};

export const registrarEdicaoFina = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  const gravar = (rel: string, versao: string, patch: OperacaoPatch[], rotulo: string) =>
    projeto.aplicarPatch({documento: rel, versao_base: versao, patch, autor, origem, rotulo});

  // ---------- vídeo de cenas: lâmina e cópia de cena ----------

  servidor.registerTool('dividir_cena', {
    description: `A lâmina (Ctrl+K) do vídeo de cenas: divide uma cena em duas no tempo em_ms do vídeo (o de ver_cenas e da linha do tempo). Os blocos que começam depois do corte vão para a segunda cena, com ids novos; o bloco que atravessa o corte fica nas duas e continua sem entrar de novo. Cada pedaço fica com pelo menos ${PEDACO_MIN_MS} ms. Sem "cena", a cena em que em_ms cai; sem em_ms, onde está a cabeça da pessoa.`,
    inputSchema: {
      em_ms: z.number().min(0).optional().describe('tempo do vídeo em ms em que a cena se divide'),
      cena: z.string().optional().describe('id da cena (cenas[i].id); confere que em_ms cai nela'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({em_ms, cena, documento}: {em_ms?: number; cena?: string; documento?: string}) => {
    const {alvo, rel, doc, versao} = videoDe(projeto, documento);
    const t = em_ms ?? projeto.estado()?.tempo_ms;
    if (t === undefined) throw new ErroProjeto('diga em_ms (o tempo do vídeo em que a cena se divide): o app não gravou onde está a cabeça', 'patch');
    const cenasP = resolverCenas(doc).props.cenas;
    const aqui = cena ? cenasP.find((c) => c.id === cena) : cenasP.find((c) => t >= c.t_in && t < c.t_out);
    if (!aqui) throw new ErroProjeto(cena ? `cena não achada: ${cena}` : `nenhuma cena em ${seg(t)} s (o vídeo tem ${seg(cenasP.at(-1)?.t_out ?? 0)} s)`, 'nao_achado');
    if (t < aqui.t_in || t >= aqui.t_out) throw new ErroProjeto(`${seg(t)} s fica fora da cena ${aqui.id}, que vai de ${seg(aqui.t_in)} a ${seg(aqui.t_out)} s`, 'patch');
    const divisao = dividirCena(doc, aqui.id, t - aqui.t_in);
    if (!divisao) throw new ErroProjeto(`o corte precisa ficar a pelo menos ${PEDACO_MIN_MS} ms das pontas da cena ${aqui.id} (${seg(aqui.t_in)} a ${seg(aqui.t_out)} s)`, 'patch');
    const gravado = gravar(rel, versao, divisao.patch, `dividir cena ${divisao.indice + 1} em ${seg(t)} s`);
    return {ok: true, documento: alvo, versao: gravado.versao, seq: gravado.entrada.seq,
      primeira: {id: divisao.primeira.id, duracao_ms: divisao.primeira.duracao_ms, blocos: (divisao.primeira.blocos ?? []).map((b) => b.id)},
      segunda: {id: divisao.segunda.id, caminho: `/cenas/${divisao.indice + 1}`, duracao_ms: divisao.segunda.duracao_ms, blocos: (divisao.segunda.blocos ?? []).map((b) => b.id)}};
  }));

  servidor.registerTool('duplicar_cena', {
    description: 'Duplica uma cena do vídeo de cenas logo depois dela, com ids novos para a cena e os blocos (como Duplicar na tela).',
    inputSchema: {
      cena: z.string().describe('id da cena (cenas[i].id)'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({cena, documento}: {cena: string; documento?: string}) => {
    const {alvo, rel, doc, versao} = videoDe(projeto, documento);
    const i = doc.cenas.findIndex((c) => c?.id === cena);
    if (i < 0) throw new ErroProjeto(`cena não achada: ${cena}`, 'nao_achado');
    const copia = comIdsNovos<CenaCenas>(doc.cenas[i], doc, 'cena');
    const gravado = gravar(rel, versao, [{op: 'test', path: `/cenas/${i}/id`, value: cena}, {op: 'add', path: `/cenas/${i + 1}`, value: copia}], `duplicar cena ${i + 1}`);
    return {ok: true, documento: alvo, versao: gravado.versao, seq: gravado.entrada.seq, copia: {id: copia.id, caminho: `/cenas/${i + 1}`, blocos: (copia.blocos ?? []).map((b) => b.id)}};
  }));

  // ---------- legendas ----------

  servidor.registerTool('editar_legendas', {
    description: 'Edita as legendas do vídeo de cenas como os botões do painel Legendas, numa mudança só: "dividir" a legenda id em em_ms (ms do vídeo como em ler_legendas; sem em_ms, no meio do texto); "juntar" a legenda id com a seguinte; "excluir" a legenda id; "criar" uma legenda em em_ms com texto (e duracao_ms; padrão 2 s ou até a próxima); "substituir" procurar por trocar_por em todas (sem diferença de acentos; guardar põe a troca no dicionário do vídeo, que vale nas legendas geradas depois); "estilo" troca a predefinição e quebra as legendas de novo para ela. Para corrigir texto ou tempo de uma legenda, use editar_legenda.',
    inputSchema: {
      op: z.enum(['dividir', 'juntar', 'excluir', 'criar', 'substituir', 'estilo']),
      id: z.string().optional().describe('dividir, juntar, excluir: id da legenda (ler_legendas)'),
      em_ms: z.number().min(0).optional().describe('dividir e criar: ms do vídeo, como na tela'),
      texto: z.string().max(500).optional().describe('criar: o texto ("\\n" quebra a linha)'),
      duracao_ms: z.number().min(200).max(60000).optional().describe('criar: quanto a legenda fica na tela'),
      procurar: z.string().min(1).optional().describe('substituir: o que procurar'),
      trocar_por: z.string().optional().describe('substituir: o texto novo (vazio apaga)'),
      palavra_inteira: z.boolean().optional().describe('substituir: só a palavra inteira (padrão: sim)'),
      caixa: z.boolean().optional().describe('substituir: diferenciar maiúsculas (padrão: não)'),
      guardar: z.boolean().optional().describe('substituir: guardar a troca no dicionário do vídeo'),
      predefinicao: z.enum(['classica', 'caixa', 'karaoke', 'faixa', 'discreta']).optional().describe('estilo: a predefinição nova'),
      documento: z.string().optional().describe('id do vídeo; sem ele, o que a pessoa está vendo'),
    },
  }, seguro((a: {op: 'dividir' | 'juntar' | 'excluir' | 'criar' | 'substituir' | 'estilo'; id?: string; em_ms?: number; texto?: string; duracao_ms?: number;
    procurar?: string; trocar_por?: string; palavra_inteira?: boolean; caixa?: boolean; guardar?: boolean; predefinicao?: IdEstiloLegenda; documento?: string}) => {
    const {alvo, rel, doc, versao} = videoDe(projeto, a.documento);
    const precisaId = () => {
      if (!a.id) throw new ErroProjeto(`"${a.op}" pede o id da legenda (ler_legendas)`, 'patch');
      return a.id;
    };
    const naTela = (ids: string[]) => {
      const segs = resolverCenas(projeto.lerJson<DocCenas>(rel).doc).props.legendas_cenas?.segmentos ?? [];
      return ids.map((id) => segs.find((s) => s.id === id)).filter((s) => s).map((s) => ({id: s!.id, em: s!.em, sai: s!.sai, texto: s!.texto}));
    };
    const fim = (gravado: {versao: string; entrada: {seq: number}}, resto: Record<string, unknown>) => ({ok: true, documento: alvo, versao: gravado.versao, seq: gravado.entrada.seq, ...resto});
    const recusar = (r: {erro: string}): never => {
      throw new ErroProjeto(r.erro.startsWith('legenda não achada') ? `${r.erro} (ler_legendas lista os ids)` : r.erro, r.erro.startsWith('legenda não achada') ? 'nao_achado' : 'patch');
    };

    if (a.op === 'dividir') {
      const id = precisaId();
      const s = (doc.legendas?.segmentos ?? []).find((x) => x?.id === id);
      // o tempo da tela vira o guardado: a legenda de um clipe de voz anda com ele
      const desloc = s ? deslocamentoDaLegenda(s, doc.legendas?.origens, (doc.audio?.faixas ?? []).flatMap((f) => f.clipes ?? [])) : 0;
      const r = patchDividirLegenda(doc, id, a.em_ms === undefined ? undefined : a.em_ms - desloc);
      if (recusouLegenda(r)) return recusar(r);
      return fim(gravar(rel, versao, r.patch, `dividir legenda ${id}`), {legendas: naTela(r.partes.map((p) => p.id))});
    }
    if (a.op === 'juntar') {
      const id = precisaId();
      const r = patchJuntarLegendas(doc, id);
      if (recusouLegenda(r)) return recusar(r);
      return fim(gravar(rel, versao, r.patch, `juntar legendas ${id} e ${r.removida}`), {removida: r.removida, legendas: naTela([id])});
    }
    if (a.op === 'excluir') {
      const id = precisaId();
      const r = patchExcluirLegenda(doc, id);
      if (recusouLegenda(r)) return recusar(r);
      return fim(gravar(rel, versao, r.patch, `excluir legenda ${id}`), {excluida: id});
    }
    if (a.op === 'criar') {
      if (a.em_ms === undefined) throw new ErroProjeto('"criar" pede em_ms (ms do vídeo em que a legenda entra)', 'patch');
      const r = patchNovaLegenda(doc, a.em_ms, {texto: a.texto, duracao_ms: a.duracao_ms});
      return fim(gravar(rel, versao, r.patch, `nova legenda ${r.legenda.id}`), {legendas: naTela([r.legenda.id])});
    }
    if (a.op === 'substituir') {
      if (!a.procurar || a.trocar_por === undefined) throw new ErroProjeto('"substituir" pede procurar e trocar_por', 'patch');
      if (!doc.legendas) throw new ErroProjeto('o vídeo não tem legendas: gere com transcrever ou importe com importar_legendas', 'nao_achado');
      const r = legendasComSubstituicao(doc.legendas, a.procurar, a.trocar_por, {palavra_inteira: a.palavra_inteira ?? true, caixa: a.caixa, guardar: a.guardar});
      if (!r.trocas && !a.guardar) throw new ErroProjeto(`"${a.procurar}" não aparece nas legendas`, 'nao_achado');
      return fim(gravar(rel, versao, patchDasLegendas(doc, r.legendas), `substituir "${a.procurar}" por "${a.trocar_por}" (${r.trocas})${a.guardar ? ' e guardar no dicionário' : ''}`),
        {trocas: r.trocas, ...(a.guardar ? {no_dicionario: true} : {})});
    }
    // estilo
    if (!a.predefinicao) throw new ErroProjeto(`"estilo" pede a predefinicao (${Object.keys(PREDEFINICOES_LEGENDA).join(', ')})`, 'patch');
    const legendas = legendasComPredefinicao(doc, estiloComPredefinicao(doc.legendas?.estilo, a.predefinicao));
    if (!legendas) throw new ErroProjeto('o vídeo não tem legendas: gere com transcrever ou importe com importar_legendas', 'nao_achado');
    return fim(gravar(rel, versao, patchDasLegendas(doc, legendas), `estilo das legendas: ${a.predefinicao}`), {estilo: legendas.estilo, total: legendas.segmentos.length});
  }));

  // ---------- páginas do carrossel ----------

  servidor.registerTool('editar_paginas', {
    description: 'Páginas do carrossel de imagem, como a barra de páginas da tela: "nova" (vazia, depois de "pagina" ou no fim, com "nome"), "duplicar" a página, "mover" a página para a posição "para", "excluir" a página (a última não sai) e "renomear" a página para "nome". "pagina" é o id (paginas[i].id) ou o número, 1 = a primeira. Os números de página das camadas acompanham. Numa imagem de prancheta só, a primeira mudança a passa a ter páginas.',
    inputSchema: {
      op: z.enum(['nova', 'duplicar', 'mover', 'excluir', 'renomear']),
      pagina: z.string().optional().describe('id ou número da página (1 = a primeira); nova: depois de qual'),
      para: z.number().int().min(1).optional().describe('mover: a posição nova (1 = a primeira)'),
      nome: z.string().max(80).optional().describe('nova e renomear: o nome da página'),
      documento: z.string().optional().describe('id da imagem; sem ele, a que a pessoa está vendo'),
    },
  }, seguro(({op, pagina, para, nome, documento}: {op: 'nova' | 'duplicar' | 'mover' | 'excluir' | 'renomear'; pagina?: string; para?: number; nome?: string; documento?: string}) => {
    const {alvo, rel, doc: bruto, versao} = alvoDe(projeto, documento, ['imagem']);
    const doc = bruto as DocImagem;
    const paginas = paginasDe(doc);
    let r: ResultadoPaginas | null;
    let rotulo: string;
    if (op === 'nova') {
      const depois = pagina === undefined ? undefined : indiceDaPagina(doc, pagina, 0);
      r = patchNovaPagina(doc, depois, nome?.trim() || undefined);
      rotulo = `nova página (${paginas.length + 1} páginas)`;
    } else {
      if (pagina === undefined) throw new ErroProjeto(`"${op}" pede a pagina (id ou número)`, 'patch');
      const i = indiceDaPagina(doc, pagina, 0);
      if (op === 'duplicar') {
        r = patchDuplicarPagina(doc, i);
        rotulo = `duplicar página ${paginas[i].nome}`;
      } else if (op === 'mover') {
        if (para === undefined) throw new ErroProjeto('"mover" pede para (a posição nova, 1 = a primeira)', 'patch');
        if (para > paginas.length) throw new ErroProjeto(`a posição vai de 1 a ${paginas.length}`, 'patch');
        r = patchMoverPagina(doc, i, para - 1);
        rotulo = `página ${paginas[i].nome} para a posição ${para}`;
      } else if (op === 'excluir') {
        r = patchExcluirPagina(doc, i);
        if (!r) throw new ErroProjeto('a última página não sai: o documento precisa de pelo menos uma', 'patch');
        rotulo = `excluir página ${paginas[i].nome}`;
      } else {
        if (!nome?.trim()) throw new ErroProjeto('"renomear" pede o nome', 'patch');
        r = patchRenomearPagina(doc, i, nome);
        rotulo = `página ${i + 1} chama-se ${nome.trim()}`;
      }
    }
    if (!r.patch.length) return {ok: true, documento: alvo, versao, nada_mudou: true, paginas: r.paginas.map((p, k) => ({n: k + 1, id: p.id, nome: p.nome}))};
    const gravado = gravar(rel, versao, r.patch, rotulo);
    return {ok: true, documento: alvo, versao: gravado.versao, seq: gravado.entrada.seq, pagina: {n: r.indice + 1, id: r.paginas[r.indice]?.id},
      paginas: r.paginas.map((p, k) => ({n: k + 1, id: p.id, nome: p.nome}))};
  }));

  // ---------- animação: entradas e saídas prontas ----------

  const ids = PREAJUSTES.map((p) => p.id) as [string, ...string[]];
  const animarPronto = (tipo: 'entrada' | 'saida') => seguro(({camada, preajuste, duracao_ms, em_ms, documento}: {camada: string; preajuste: string; duracao_ms?: number;
    em_ms?: number; documento?: string}) => {
    const {alvo, rel, doc: bruto, versao} = alvoDe(projeto, documento, ['animacao']);
    if (!ehDocAnimacao(bruto)) throw new ErroProjeto(`${alvo} não é uma animação`, 'patch');
    const doc: DocAnimacao = bruto;
    const achados = doc.camadas.flatMap((c, i) => (c?.id === camada ? [i] : []));
    if (!achados.length) throw new ErroProjeto(`camada ${camada} não encontrada no documento ${alvo}`, 'nao_achado');
    if (achados.length > 1) throw new ErroProjeto(`o id ${camada} está em ${achados.length} camadas: dê um id único a cada uma com aplicar_patch`, 'patch');
    const i = achados[0];
    const p = preajusteDe(preajuste)!;
    const dur = Math.min(duracao_ms ?? DURACAO_PREAJUSTE_MS, doc.duracao_ms);
    // sem em_ms: a entrada começa no início e a saída termina no fim da animação
    const t = em_ms ?? (tipo === 'entrada' ? 0 : doc.duracao_ms);
    const trilhas = trilhasComPreajuste(doc.camadas[i], p, tipo, t, doc.duracao_ms, dur);
    const gravado = gravar(rel, versao, [{op: 'test', path: `/camadas/${i}/id`, value: camada}, {op: 'add', path: `/camadas/${i}/trilhas`, value: trilhas}],
      `${tipo === 'entrada' ? 'entrada' : 'saída'}: ${p.nome.toLowerCase()} em ${camada}`);
    // o trecho, com a mesma conta de trilhasComPreajuste
    const de_ms = Math.max(0, Math.round(tipo === 'entrada' ? t : Math.min(t, doc.duracao_ms - dur)));
    return {ok: true, documento: alvo, versao: gravado.versao, seq: gravado.entrada.seq, camada, preajuste: p.id, propriedades: Object.keys(p.de),
      de_ms, ate_ms: Math.min(doc.duracao_ms, de_ms + dur)};
  });
  const esquemaPronto = (tipo: 'entrada' | 'saida') => ({
    camada: z.string().describe('id da camada'),
    preajuste: z.enum(ids).describe(`${PREAJUSTES.map((p) => p.id).join(', ')}`),
    duracao_ms: z.number().min(50).max(60000).optional().describe(`duração da ${tipo === 'entrada' ? 'entrada' : 'saída'} (padrão ${DURACAO_PREAJUSTE_MS} ms)`),
    em_ms: z.number().min(0).optional().describe(tipo === 'entrada' ? 'quando a entrada começa (padrão 0)' : 'quando a saída começa (padrão: termina no fim da animação)'),
    documento: z.string().optional().describe('id da animação; sem ele, a que a pessoa está vendo'),
  });
  servidor.registerTool('animar_entrada', {
    description: 'Entrada pronta numa camada da animação, como os botões de Entrada do inspetor: surgir (opacidade), subir e descer (opacidade e 80 px em y), crescer (opacidade e escala) ou girar (opacidade, rotação e escala). Escreve os quadros-chave que terminam no valor que a camada tem; os que já havia nessas propriedades dentro do trecho saem. Para quadros-chave sob medida, use animar.',
    inputSchema: esquemaPronto('entrada'),
  }, animarPronto('entrada'));
  servidor.registerTool('animar_saida', {
    description: 'Saída pronta numa camada da animação, como os botões de Saída do inspetor: surgir (some), subir, descer, crescer ou girar, partindo do valor que a camada tem. Os quadros-chave que já havia nessas propriedades dentro do trecho saem. Para quadros-chave sob medida, use animar.',
    inputSchema: esquemaPronto('saida'),
  }, animarPronto('saida'));

  // ---------- pilha de efeitos (vídeo e imagem) ----------

  const tipos = EFEITOS.map((d) => d.tipo) as [TipoEfeito, ...TipoEfeito[]];
  const preajustesEfeito = PREAJUSTES_EFEITOS.map((p) => p.id) as [string, ...string[]];
  servidor.registerTool('adicionar_efeito', {
    description: `Põe um efeito no fim da pilha de efeitos de um vídeo ou de uma imagem (a área Efeitos): um "tipo" (${EFEITOS.map((d) => `${d.tipo} ${d.min} a ${d.max}, padrão ${d.padrao}`).join('; ')}), com "valor" e, no tom, "cor"; ou um "preajuste" de vários de uma vez (${PREAJUSTES_EFEITOS.map((p) => `${p.id}: ${p.efeitos.map((e) => e.tipo).join(' + ')}`).join('; ')}). O valor fora da faixa fica na ponta dela.`,
    inputSchema: {
      tipo: z.enum(tipos).optional(),
      preajuste: z.enum(preajustesEfeito).optional(),
      valor: z.number().optional().describe('só com tipo; padrão: o do tipo'),
      cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'cor "#rrggbb"').optional().describe('só no tom'),
      documento: z.string().optional().describe('id do vídeo ou da imagem; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({tipo, preajuste, valor, cor, documento}: {tipo?: TipoEfeito; preajuste?: string; valor?: number; cor?: string; documento?: string}) => {
    if (!tipo === !preajuste) throw new ErroProjeto('passe tipo ou preajuste (um dos dois)', 'patch');
    if (preajuste && (valor !== undefined || cor !== undefined)) throw new ErroProjeto('valor e cor valem só com tipo', 'patch');
    if (cor && tipo !== 'tom') throw new ErroProjeto('cor vale só no efeito tom', 'patch');
    const {alvo, rel, doc, versao} = alvoDe(projeto, documento, ['video', 'imagem']);
    const pilha = (doc as {efeitos?: unknown}).efeitos;
    let novos: Efeito[];
    if (preajuste) novos = efeitosDoPreajuste(PREAJUSTES_EFEITOS.find((p) => p.id === preajuste)!.efeitos, pilha);
    else {
      const e = novoEfeito(tipo!, idsEmUso(pilha));
      // passa pela leitura validada: valor fora da faixa fica na ponta, como a pilha desenharia
      novos = [lerEfeitos([{...e, ...(valor !== undefined ? {valor} : {}), ...(cor ? {cor} : {})}])[0].efeito!];
    }
    const {patch, primeiro} = patchAdicionarEfeitos(doc as {efeitos?: unknown}, novos);
    const gravado = gravar(rel, versao, patch, preajuste ? `efeitos ${PREAJUSTES_EFEITOS.find((p) => p.id === preajuste)!.nome}` : `efeito ${tipo}`);
    const problemas = problemasDosEfeitos(projeto.lerJson<{efeitos?: unknown}>(rel).doc.efeitos);
    return {ok: true, documento: alvo, versao: gravado.versao, seq: gravado.entrada.seq,
      adicionados: novos.map((e, k) => ({...e, caminho: `/efeitos/${primeiro + k}`})), ...(problemas.length ? {avisos: problemas.map((p) => `Efeitos: ${p}`)} : {})};
  }));

  servidor.registerTool('remover_efeito', {
    description: 'Tira um efeito da pilha de efeitos de um vídeo ou de uma imagem, pelo id (o de ler_documento em /efeitos). Para só desligar, use aplicar_patch com "ativo": false.',
    inputSchema: {
      id: z.string().describe('id do efeito, ex.: vinheta-1'),
      documento: z.string().optional().describe('id do vídeo ou da imagem; sem ele, o que a pessoa está vendo'),
    },
  }, seguro(({id, documento}: {id: string; documento?: string}) => {
    const {alvo, rel, doc, versao} = alvoDe(projeto, documento, ['video', 'imagem']);
    const pilha = (doc as {efeitos?: unknown}).efeitos;
    const usados = idsEmUso(pilha);
    const i = usados.findIndex((x) => x.id === id);
    if (i < 0) throw new ErroProjeto(`efeito não achado: ${id} (a pilha tem ${usados.map((x) => x.id).join(', ') || 'nenhum'})`, 'nao_achado');
    const gravado = gravar(rel, versao, patchRemoverEfeito(pilha, i), `remover efeito ${id}`);
    return {ok: true, documento: alvo, versao: gravado.versao, seq: gravado.entrada.seq, removido: id, restam: usados.filter((_, k) => k !== i).map((x) => x.id)};
  }));
};
