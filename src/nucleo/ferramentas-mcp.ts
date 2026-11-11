// Ferramentas do MCP "estudio", as mesmas por stdio (mcp/nucleo.ts, fora do app) e por HTTP (o app, uma conexão
// por aba do Claude). O autor e a origem vão para o diário, para a pessoa ver quem mudou o quê. As ferramentas da
// pesquisa (ler_fonte e as seguintes, docs/pesquisa.md) só medem e informam: nada se aprova, nada se recusa, nada da
// fonte é apagado. A rede do ler_fonte vem de quem registra: net.fetch do Electron no app (src/main/mcp-http.ts),
// fetch do Node no MCP por stdio e nos testes, as duas montadas por criarRede.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {readFileSync} from 'node:fs';
import {registrarCortesFala, type EmendadorMcp} from './mcp-fala'; // frente Fala: cortes pela fala
import {legendasNoTrecho} from './legendas-exportacao'; // frente Fala
import {z} from 'zod';
import {ErroProjeto, valorEm, type Projeto} from './projeto';
import type {DocImagem, Modulo, OperacaoPatch} from './documentos';
import {documentoNovo} from './criar-projeto';
import {registrarFerramentasAnimacao} from './ferramentas-animacao';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO, formatoDoVideo} from './formatos';
import {MARCAS_INICIAIS} from './marca';
import {registrarMarca} from './mcp-marca';
import {PastaMarcas} from './pasta-marcas';
import {ehDocCenas, resolverCenas, type DocCenas} from './cenas';
import {problemasDosEfeitos} from './efeitos';
import {arquivoDaFala, arquivoDasPalavras, clipesDeVoz, comTexto, CPS_MAX, cpsDe, deslocamentoDaLegenda, legendasDeArquivo, legendasDeOutraTomada, limitesDoArrasto, nomeLivreDaLegenda, palavrasDuvidosas, termosDoDicionario, textoDeLegenda, type PalavraLegenda, recusaDoDestinoNoProjeto, legendasDoDocumento, nomeDoArquivoDeLegenda, paraSrt, paraVtt, type EstadoDaFala, type IdEstiloLegenda} from './legendas';
import {CATALOGO_FONTES} from './catalogo-fontes';
import {
  acharTrecho, caminhoTextoFonte, conferirDigitos, decodificarComAviso, entorno, estadoDoFato, hashTexto, limparHtml, nivelDe, numerosDe, paginar, proximoId,
  sinaisDeVigencia, tituloDoHtml, TAMANHO_PAGINA, type Fato, type Fonte,
} from './pesquisa';
import {checarTexto, REGRAS_CONTEUDO, terminaComUltimaFrase, type Aviso} from './regras';
import {registrarMidia} from './mcp-midia'; // frente Casca
import {acharCamada, baseCamadas, caminhosDoId, paginaDoCaminho, paginasDe, temPaginas} from './carrossel';
import {MODELO_FUNDO, patchSemFundo, patchVoltarAoOriginal, removedorDeFundo} from './remover-fundo';
import {registrarExportar} from './mcp-exportar';
import {instalarPortao, type Portao} from './portao'; // frente IA: portão de permissão e seq em todo resultado
import {registrarIa} from './mcp-ia'; // frente IA: desfazer, reverter, guia, comentários
import {registrarImagem} from './mcp-imagem';
import {instalarMostrarCriado, registrarTela} from './mcp-tela';
import {medidasDoVideo, registrarSom} from './mcp-som'; // frente Som (rodada 3)
import {registrarMusica} from './mcp-musica'; // frente Música
import {musicaDoModelo, type ModeloMusica} from './musica-modelos'; // frente Música (item 27)
import type {DocMusica} from './musica'; // frente Música (item 27)
import {ARQUIVO_TRANSICOES, lerRegistro, transicaoEmCurso} from './transicoes'; // frente Música

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

// ---------- rede do ler_fonte ----------
// Segue redirecionamentos, desiste em 40 s, não passa de 20 MB e se apresenta com um User-Agent próprio, para o site
// saber quem está lendo. Nada aqui é síncrono.

/** O que o ler_fonte recebe: status, endereço depois dos redirecionamentos, Content-Type e os bytes crus. */
export type Rede = (url: string) => Promise<{status: number; url_final: string; content_type?: string; bytes: Uint8Array}>;

export const USER_AGENT = 'Mozilla/5.0 (compatible; Estudio-BKM/0.2; +https://bkmadvogados.com.br)';
export const TEMPO_REDE_MS = 40_000;
export const LIMITE_REDE_BYTES = 20 * 1024 * 1024;

/** A busca de quem chama: fetch do Node ou net.fetch do Electron (mesma assinatura). */
export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

const megas = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

export const criarRede = (buscar: Buscar = (url, init) => fetch(url, init), opcoes: {tempo_ms?: number; limite_bytes?: number} = {}): Rede => {
  const tempo = opcoes.tempo_ms ?? TEMPO_REDE_MS;
  const limite = opcoes.limite_bytes ?? LIMITE_REDE_BYTES;
  return async (url) => {
    let endereco: URL;
    try {
      endereco = new URL(url);
    } catch {
      throw new Error(`endereço inválido: ${url}`);
    }
    if (endereco.protocol !== 'http:' && endereco.protocol !== 'https:') throw new Error(`só endereços http ou https: ${url}`);
    const parar = new AbortController();
    const relogio = setTimeout(() => parar.abort(), tempo);
    try {
      const r = await buscar(endereco.href, {
        redirect: 'follow',
        signal: parar.signal,
        headers: {'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'pt-BR,pt;q=0.9'},
      });
      const declarado = Number(r.headers.get('content-length'));
      if (declarado > limite) throw new Error(`a página tem ${megas(declarado)}, acima do limite de ${megas(limite)}`);
      // lido em pedaços: o limite vale também para quem não declara o tamanho
      const partes: Uint8Array[] = [];
      let total = 0;
      if (r.body) {
        const leitor = r.body.getReader();
        for (;;) {
          const {done, value} = await leitor.read();
          if (done) break;
          total += value.byteLength;
          if (total > limite) {
            await leitor.cancel();
            throw new Error(`a página passa do limite de ${megas(limite)}`);
          }
          partes.push(value);
        }
      }
      const bytes = new Uint8Array(total);
      let pos = 0;
      for (const p of partes) {
        bytes.set(p, pos);
        pos += p.byteLength;
      }
      return {status: r.status, url_final: r.url || endereco.href, content_type: r.headers.get('content-type') ?? undefined, bytes};
    } catch (e) {
      if (parar.signal.aborted) throw new Error(`a página não respondeu em ${Math.round(tempo / 1000)} s: ${url}`);
      const causa = (e as {cause?: {message?: string}}).cause?.message;
      throw new Error(`não deu para baixar ${url}: ${(e as Error).message}${causa ? ` (${causa})` : ''}`);
    } finally {
      clearTimeout(relogio);
    }
  };
};

// ---------- ferramentas ----------

/** Acima disto, ler_documento sem caminho resume as grades de pixel: a resposta passaria do limite de saída do cliente. */
export const TETO_LEITURA = 200_000;

/** Cópia do documento com cada `grade.celulas` trocado por um resumo (quantas células e o caminho para ler). */
const resumirGrades = (doc: unknown) => {
  let grades = 0;
  let exemplo = '';
  const andar = (x: unknown, onde: string): unknown => {
    if (Array.isArray(x)) return x.map((v, i) => andar(v, `${onde}/${i}`));
    if (!x || typeof x !== 'object') return x;
    const o = x as Record<string, unknown>;
    const fora: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const g = v as {celulas?: unknown} | null;
      if (k === 'grade' && g && typeof g === 'object' && (typeof g.celulas === 'string' || Array.isArray(g.celulas))) {
        grades++;
        exemplo ||= `${onde}/grade/celulas`;
        fora[k] = {...g, celulas: `<${(g.celulas as string | unknown[]).length} células: leia com caminho ${onde}/grade/celulas>`};
      } else fora[k] = andar(v, `${onde}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }
    return fora;
  };
  return {doc: andar(doc, ''), grades, exemplo};
};

export const registrarFerramentas = (servidor: McpServer, projeto: Projeto, autor: string, origem: string, rede?: Rede, transcritor?: TranscritorMcp, portao?: Portao) => {
  // frente IA: tudo o que for registrado daqui em diante passa pelo portão (permissão e mudanças do diário no resultado)
  instalarPortao(servidor, {projeto, origem, portao});
  // documento criado pelo Claude: a tela da pessoa vai até ele por padrão ("mostrar: false" não leva), em mcp-tela.ts
  instalarMostrarCriado(servidor, projeto, autor);
  // frente Animação: depois do portão, como as outras
  registrarFerramentasAnimacao(servidor, projeto, autor, origem);
  servidor.registerTool('projeto_info', {
    description: 'Nome do projeto, documentos (id, módulo, caminho), quantos comentários estão abertos e quantas fontes e fatos a pesquisa tem.',
    inputSchema: {},
  }, seguro(() => {
    let pesquisa: {fontes: number | string; fatos: number | string};
    try {
      const p = projeto.pesquisa();
      pesquisa = {fontes: p.fontes.length, fatos: p.fatos.length};
    } catch (e) {
      // pesquisa.json quebrado não esconde o resto do projeto
      pesquisa = {fontes: `ilegível: ${(e as Error).message}`, fatos: 'ilegível'};
    }
    return {
      pasta: projeto.raiz,
      ...projeto.manifesto(),
      comentarios_abertos: projeto.comentarios().filter((c) => c.estado === 'aberto').length,
      ...pesquisa,
    };
  }));

  servidor.registerTool('estado_do_editor', {
    description: 'O que a pessoa está vendo agora no app: área (video, imagem, 3d, efeitos, musica, animacao), documento, objeto selecionado (caminho JSON Pointer), tempo do vídeo e a transição em curso (levar_para).',
    inputSchema: {},
  }, seguro(() => {
    const e = projeto.estado();
    if (!e) return 'o app ainda não gravou estado (projeto fechado ou recém-aberto)';
    // frente Música: a ida e volta em curso (levar_para), para a IA saber que a pessoa está dentro dela
    const t = projeto.existe(ARQUIVO_TRANSICOES) ? transicaoEmCurso(lerRegistro(projeto.lerJson<unknown>(ARQUIVO_TRANSICOES).doc)) : undefined;
    const transicao = t ? {transicao: {id: t.id, intencao: t.intencao, de: `${t.origem.documento}${t.origem.caminho}`, para: t.destino.documento}} : {};
    if (!e.documento || !e.selecao) return {...e, ...transicao};
    const {doc} = projeto.lerJson(projeto.arquivoDoDocumento(e.documento));
    return {...e, objeto_selecionado: valorEm(doc, e.selecao), ...transicao};
  }));

  servidor.registerTool('ler_documento', {
    description: `Lê um documento (pelo id do manifesto ou caminho). Devolve o JSON e a versão, que vai em versao_base no aplicar_patch. No vídeo de cenas traz também os avisos do resolvedor e o som medido (nível e ducking de cada clipe). Com "caminho", devolve só aquele trecho (e a versão do documento inteiro). Documento acima de ${Math.round(TETO_LEITURA / 1000)} KB vem com as células das grades de pixel resumidas e um "aviso": leia a grade pelo caminho.`,
    inputSchema: {documento: z.string(), caminho: z.string().optional().describe('JSON Pointer, ex.: /cenas/2/blocos/1')},
  }, seguro(({documento, caminho}: {documento: string; caminho?: string}) => {
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc, versao} = projeto.lerJson(rel);
    if (caminho) return {documento: rel, versao, conteudo: valorEm(doc, caminho)};
    const resumo = JSON.stringify(doc).length > TETO_LEITURA ? resumirGrades(doc) : undefined;
    const grande = resumo?.grades ? resumo : undefined;
    return {documento: rel, versao, conteudo: grande?.doc ?? doc, ...medidasDoVideo(projeto, doc), // frente Som: avisos e som medido (som-D11)
      ...(grande ? {aviso: `documento grande: as células de ${grande.grades} grade(s) de pixel vieram resumidas; leia uma pelo caminho (ex.: ${grande.exemplo}) e não grave o resumo de volta`} : {})};
  }));

  servidor.registerTool('aplicar_patch', {
    description: 'Muda um documento com JSON Patch (RFC 6902), de forma atômica. Passe a versao_base lida em ler_documento e um "test" no valor que vai trocar; se o documento mudou por baixo, nada é gravado e você deve ler de novo. A tela do app atualiza sozinha.',
    inputSchema: {
      documento: z.string(),
      versao_base: z.string().min(1, 'passe a versao devolvida por ler_documento'),
      patch: z.array(z.object({op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']), path: z.string(), value: z.any().optional(), from: z.string().optional()})),
      rotulo: z.string().optional().describe('o que a mudança faz, em poucas palavras'),
    },
  }, seguro(({documento, versao_base, patch, rotulo}: {documento: string; versao_base: string; patch: OperacaoPatch[]; rotulo?: string}) => {
    const r = projeto.aplicarPatch({documento, versao_base, patch, autor: autor, origem, rotulo});
    // video-D14: no vídeo de cenas, os avisos do resolvedor voltam junto (cena curta demais, bloco fora da cena…)
    let avisos: string[] = [];
    try {
      const {doc} = projeto.lerJson<unknown>(projeto.arquivoDoDocumento(documento));
      if (ehDocCenas(doc)) avisos = resolverCenas(doc as DocCenas).avisos;
      // fora das cenas (imagem, roteiro antigo), o efeito com tipo ou campo errado também volta como aviso
      else if (doc && typeof doc === 'object' && 'efeitos' in doc) avisos = problemasDosEfeitos((doc as {efeitos: unknown}).efeitos).map((p) => `Efeitos: ${p}`);
    } catch {
      /* sem avisos: o patch já foi gravado */
    }
    return {ok: true, versao: r.versao, seq: r.entrada.seq, ...(avisos.length ? {avisos} : {})};
  }));

  servidor.registerTool('criar_documento', {
    description: `Cria um documento novo no projeto (vídeo de cenas, imagem, cena 3D, música com "modelo" ou animação) e o põe no manifesto. Formatos de vídeo: ${FORMATOS_VIDEO.map((f) => `${f.id} (${f.proporcao}, ${f.largura}x${f.altura})`).join(', ')}. De imagem: ${FORMATOS_IMAGEM.map((f) => `${f.id} (${f.largura}x${f.altura})`).join(', ')}. Ou largura e altura livres.`,
    inputSchema: {
      modulo: z.enum(['video', 'imagem', '3d', 'musica', 'animacao']),
      titulo: z.string().optional(),
      formato: z.string().optional().describe('id do formato da lista'),
      largura: z.number().int().min(16).max(7680).optional(),
      altura: z.number().int().min(16).max(7680).optional(),
      fps: z.number().min(1).max(120).optional(),
      modelo: z.enum(['vazio', 'batida', 'trilha_video', 'efeito_sonoro']).optional().describe('música: modelo com som gerado'), // frente Música (item 27)
    },
  }, seguro(({modulo, titulo, formato, largura, altura, fps, modelo}: {modulo: Modulo; titulo?: string; formato?: string; largura?: number; altura?: number; fps?: number;
    modelo?: ModeloMusica}) => {
    const preset = (modulo === 'imagem' ? FORMATOS_IMAGEM : FORMATOS_VIDEO).find((f) => f.id === formato);
    if (formato && !preset) throw new ErroProjeto(`formato desconhecido: ${formato}`, 'nao_achado');
    if ((largura === undefined) !== (altura === undefined)) throw new ErroProjeto('passe largura e altura juntas (ou um formato da lista)', 'patch');
    const tam = largura && altura ? {largura, altura} : preset ? {largura: preset.largura, altura: preset.altura} : undefined;
    const {entrada, conteudo} = documentoNovo(projeto.manifesto(), modulo, {titulo, formato: tam ? {...tam, fps: fps ?? 30} : undefined, existe: (rel) => projeto.existe(rel)});
    projeto.adicionarDocumento(entrada, modulo === 'musica' && modelo ? musicaDoModelo(modelo, conteudo as DocMusica) : conteudo); // frente Música: modelo
    return {ok: true, ...entrada};
  }));

  servidor.registerTool('renomear_projeto', {
    description: 'Muda o nome do projeto (aparece na barra do app e na lista de recentes). A pasta não muda.',
    inputSchema: {nome: z.string().min(1).max(120)},
  }, seguro(({nome}: {nome: string}) => ({ok: true, nome: projeto.renomear(nome).nome})));

  servidor.registerTool('listar_comentarios', {
    description: 'Comentários da pessoa. Por padrão só os abertos.',
    inputSchema: {estado: z.enum(['aberto', 'resolvido', 'todos']).optional(), documento: z.string().optional()},
  }, seguro(({estado = 'aberto', documento}: {estado?: 'aberto' | 'resolvido' | 'todos'; documento?: string}) =>
    projeto.comentarios()
      .filter((c) => estado === 'todos' || c.estado === estado)
      .filter((c) => !documento || c.documento === documento)
      .map((c) => ({id: c.id, documento: c.documento, estado: c.estado, texto: c.texto, objeto: c.alvo.objeto, tempo_ms: c.alvo.tempo_ms, respostas: c.respostas.length}))));

  servidor.registerTool('ler_comentario', {
    description: 'Um comentário com o alvo resolvido: o trecho do documento comentado (objeto), a versão do documento e as respostas.',
    inputSchema: {id: z.string()},
  }, seguro(({id}: {id: string}) => {
    const c = projeto.comentarios().find((x) => x.id === id);
    if (!c) throw new ErroProjeto(`comentário não achado: ${id}`, 'nao_achado');
    const rel = projeto.arquivoDoDocumento(c.documento);
    const {doc, versao} = projeto.lerJson(rel);
    const objeto = c.alvo.objeto ? valorEm(doc, c.alvo.objeto) : undefined;
    return {...c, arquivo: rel, versao, objeto_atual: objeto ?? (c.alvo.objeto ? 'o caminho não existe mais: procure pelo objeto_id ou pelo contexto' : undefined)};
  }));

  servidor.registerTool('responder_comentario', {
    description: 'Responde a um comentário (aparece para a pessoa no painel de comentários).',
    inputSchema: {id: z.string(), texto: z.string()},
  }, seguro(({id, texto: t}: {id: string; texto: string}) => projeto.responder(id, autor, t)));

  servidor.registerTool('resolver_comentario', {
    description: 'Marca um comentário como resolvido, com uma nota do que foi feito.',
    inputSchema: {id: z.string(), nota: z.string().optional()},
  }, seguro(({id, nota}: {id: string; nota?: string}) => projeto.resolver(id, autor, nota)));

  servidor.registerTool('listar_mudancas', {
    description: 'Diário de mudanças: quem mudou (pessoa ou agente), o rótulo e o patch, com o número (seq) que reverter usa. Sem "desde", só as últimas 50.',
    inputSchema: {desde: z.number().optional(), autor: z.string().optional(), documento: z.string().optional(),
      limite: z.number().int().min(1).max(500).optional().describe('máximo de entradas; padrão 50')},
  }, seguro(({desde = 0, autor, documento, limite = 50}: {desde?: number; autor?: string; documento?: string; limite?: number}) => {
    // transversal-D14: sem limite, um projeto com milhares de mudanças mandava megabytes de diário à IA
    const doc = documento ? projeto.arquivoDoDocumento(documento) : undefined;
    const lista = projeto.diario(desde, {tolerante: true}).filter((e) => (!autor || e.autor === autor) && (!doc || e.documento === doc));
    return lista.slice(-limite).map(({inverso: _i, ...e}) => e);
  }));

  registrarPesquisa(servidor, projeto, autor, origem, rede);

  // kits de marca (src/nucleo/marca.ts): a pasta vem das preferências do app ou de ESTUDIO_MARCAS
  const marcas = new PastaMarcas();
  let ids = MARCAS_INICIAIS.map((m) => m.id);
  try {
    ids = [...new Set([...ids, ...marcas.listar().map((m) => m.id)])];
  } catch {
    /* pasta ilegível agora: a lista de fábrica serve */
  }
  servidor.registerTool('aplicar_marca', {
    description: `Aplica um kit de marca a um documento. No vídeo de cenas troca o "tema" inteiro (cores, fonte, logo copiado para midia/, assinatura e fontes próprias copiadas para fontes/); na imagem passa cada cor e fonte para o mesmo papel no kit novo (o que a pessoa escolheu à mão fica) e guarda o kit em "marca" (veja ver_marca); na animação troca o "tema", que resolve @fundo, @texto, @destaque e @suave (e pixelizar_imagem {usar_paleta_marca} usa essas cores). 3D e música não recebem kit. Kits: ${ids.join(', ')} (a pessoa cria outros no app, em menu → Marca…). Sem "documento", vai no que a pessoa está vendo.`,
    inputSchema: {id: z.string().describe('id do kit, ex.: bkm'), documento: z.string().optional().describe('id do documento no manifesto')},
  }, seguro(({id, documento}: {id: string; documento?: string}) => {
    const alvo = documento ?? projeto.estado()?.documento ?? projeto.manifesto().documentos[0]?.id;
    if (!alvo) throw new ErroProjeto('o projeto não tem documento para receber o kit', 'nao_achado');
    return {ok: true, documento: alvo, ...marcas.aplicar(projeto, id, alvo, {autor, origem})};
  }));

  registrarFala(servidor, projeto, autor, origem, transcritor); // frente Fala: transcrever e legendas
  registrarCortesFala(servidor, projeto, autor, origem, transcritor?.emendar && ((p, x) => transcritor.emendar!(p, x))); // frente Fala: cortes pela fala
  registrarAcabamento(servidor, projeto, autor, origem); // acabamento da imagem (rodada 2, B2)
  registrarMarca(servidor, projeto, autor, origem); // cor e fonte do kit na imagem (rodada 3, Marca)
  registrarExportar(servidor, projeto, autor, origem); // marca d'água e contraste (rodada 3, frente C)
  registrarMidia(servidor, projeto, autor, origem); // frente Casca (rodada 3): listar_midia e marcar_midia, em mcp-midia.ts
  registrarIa(servidor, projeto, autor, origem, portao); // frente IA (rodada 3): desfazer, reverter, guia, comentários
  registrarImagem(servidor, projeto, autor, origem); // seleção e layout da imagem (rodada 3, B2): src/nucleo/mcp-imagem.ts
  registrarSom(servidor, projeto, autor, origem); // frente Som (rodada 3): dividir, copiar e crossfade de clipe de áudio
  registrarMusica(servidor, projeto, autor, origem); // frente Música: música e ida e volta entre módulos (docs/musica.md)
  registrarTela(servidor, projeto, autor); // mostrar_documento: leva a tela da pessoa a um documento (mcp-tela.ts)
};

// ---------- pesquisa: fontes e fatos (src/nucleo/pesquisa.ts, docs/pesquisa.md) ----------

const CARACTERES_NA_LEITURA = 3000; // o ler_fonte devolve o começo do texto; o resto vem por texto_da_fonte

const doisDigitos = (n: number) => String(n).padStart(2, '0');
/** "06/11/2026 14:32", na hora local: o carimbo de cada linha da observação. */
const carimbo = (d = new Date()) => `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
/** A observação só cresce: cada anotação é uma linha nova com data e autor. */
const acrescentar = (atual: string | undefined, texto: string, autor: string) => {
  const linha = `${carimbo()} · ${autor}: ${texto.trim()}`;
  return atual ? `${atual}\n${linha}` : linha;
};

const fonteDe = (projeto: Projeto, id: string): Fonte => {
  const f = projeto.pesquisa().fontes.find((x) => x.id === id);
  if (!f) throw new ErroProjeto(`fonte não achada: ${id} (leia a url com ler_fonte primeiro)`, 'nao_achado');
  return f;
};

const ehPdf = (bytes: Uint8Array, contentType: string | undefined) =>
  (contentType ?? '').toLowerCase().includes('pdf') || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

/** HTML vira texto limpo; texto puro fica como veio. PDF ainda não se lê (quem chama confere antes, com ehPdf). */
const textoDaResposta = (bytes: Uint8Array, contentType: string | undefined) => {
  const tipo = (contentType ?? '').toLowerCase();
  const {texto: bruto, aviso: avisoCharset} = decodificarComAviso(bytes, contentType);
  const ehHtml = tipo.includes('html') || tipo.includes('xml') || (!tipo.startsWith('text/plain') && /^\s*</.test(bruto));
  return {bruto, ehHtml, avisoCharset, texto: ehHtml ? limparHtml(bruto) : bruto.replace(/\r\n?/g, '\n')};
};

// Página de bloqueio que chega com HTTP 200 (o F5 do Planalto, o filtro de um tribunal): vira fonte normal, porque a
// pesquisa só mostra, mas o retorno do ler_fonte avisa para o Claude conferir o texto antes de citar.
const BLOQUEIO = /request rejected|requested url was rejected|acesso negado|access denied|captcha/i;
const avisoDoTexto = (texto: string): string | undefined => {
  const tamanho = texto.trim().length;
  if (BLOQUEIO.test(texto.slice(0, 3000))) return 'o texto parece uma página de bloqueio do site ("Request Rejected", "Acesso Negado"): confira em texto_da_fonte antes de registrar fatos';
  if (tamanho < 500) return `o texto tem só ${tamanho} caracteres: pode ser página de bloqueio ou montada por JavaScript; confira antes de registrar fatos`;
  return undefined;
};

// Campos que aparecem na tela, em qualquer documento (roteiro do carrossel, imagem): o checar_texto olha só eles. No
// roteiro do carrossel narrado as linhas do gancho ficam em cenas[].linhas[].t e as etiquetas em cenas[].tag e rotulo_partes.
const CAMPOS_DE_TEXTO = new Set(['texto', 'itens', 'rotulo', 'titulo', 'legenda', 'fala', 'falas', 'linhas', 'prefixo', 'sufixo', 't', 'tag', 'rotulo_partes']);
const textosDoJson = (x: unknown, onde = '', campo = ''): {onde: string; texto: string}[] => {
  if (typeof x === 'string') return CAMPOS_DE_TEXTO.has(campo) && x.trim() ? [{onde, texto: x}] : [];
  if (Array.isArray(x)) return x.flatMap((v, i) => textosDoJson(v, `${onde}/${i}`, campo));
  if (x && typeof x === 'object') return Object.entries(x).flatMap(([k, v]) => textosDoJson(v, `${onde}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, k));
  return [];
};

/** A narração do roteiro do carrossel narrado: o documento aponta para a transcrição palavra por palavra ("palavras":
 *  "video/palavras.json", com {w} por palavra). Sem o arquivo, não há narração para olhar. */
const narracaoDe = (projeto: Projeto, doc: unknown): string | undefined => {
  const rel = (doc as {palavras?: unknown} | null)?.palavras;
  if (typeof rel !== 'string' || !rel.endsWith('.json')) return undefined;
  try {
    const lido = projeto.lerJson<unknown>(rel).doc;
    const palavras = Array.isArray(lido) ? lido : (lido as {palavras?: unknown} | null)?.palavras; // a transcrição da versão 2 (legendas.ts)
    if (!Array.isArray(palavras)) return undefined;
    const texto = palavras.map((p: {w?: unknown}) => (typeof p?.w === 'string' ? p.w : '')).filter(Boolean).join(' ');
    return texto || undefined;
  } catch {
    return undefined;
  }
};

/** O texto que um bloco de cenas mostra, com o número animado ("40%"). */
const textoDoBloco = (b: DocCenas['cenas'][number]['blocos'][number]) => [
  b.texto, ...(b.itens ?? []), b.tipo === 'numero' && b.ate !== undefined ? `${b.prefixo ?? ''}${b.ate}${b.sufixo ?? ''}` : '', b.rotulo,
].filter(Boolean).join('\n');

const registrarPesquisa = (servidor: McpServer, projeto: Projeto, autor: string, origem: string, rede: Rede | undefined) => {
  servidor.registerTool('ler_fonte', {
    description: 'Baixa uma página (lei, súmula, decisão, notícia de tribunal) e a guarda na pesquisa do projeto: texto limpo em pesquisa/fontes/<id>.txt, sha256, nível pelo catálogo de fontes e marcas de vigência ("(Revogado", "Redação dada pela"…). Devolve a fonte, os 3.000 primeiros caracteres e quantas páginas de 6.000 há (o resto vem por texto_da_fonte), e um "aviso" quando o texto parece página de bloqueio. A mesma url de novo atualiza a fonte com o mesmo id; se o texto mudou, os fatos dela são procurados de novo no texto novo ("fatos_reconferidos") e o texto antigo fica guardado ao lado ("texto_anterior"). "observacao" é a observação de quem baixou: texto livre que fica junto da fonte. Nada do texto é cortado nem anonimizado.',
    inputSchema: {
      url: z.string().url(),
      observacao: z.string().optional().describe('observação de quem baixou sobre a fonte'),
      titulo: z.string().optional().describe('sem ele, vale o <title> da página'),
    },
  }, seguro(async ({url, observacao, titulo}: {url: string; observacao?: string; titulo?: string}) => {
    if (!rede) throw new ErroProjeto('este MCP não tem acesso à rede: abra o projeto no Estúdio ou use o MCP por stdio (mcp/nucleo.ts)', 'patch');
    const r = await rede(url);
    // página de erro não vira fonte: o Claude vê o começo da resposta ("Acesso Negado!") e procura outro caminho
    if (r.status >= 400) {
      const comeco = ehPdf(r.bytes, r.content_type) ? '(um PDF)' : textoDaResposta(r.bytes, r.content_type).texto.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new ErroProjeto(`o site respondeu HTTP ${r.status} e nada foi gravado. Começo da resposta: ${comeco}`, 'nao_achado');
    }
    if (ehPdf(r.bytes, r.content_type)) {
      throw new ErroProjeto('esta url é um PDF, e o Estúdio ainda não lê PDF: procure a versão em HTML da mesma norma ou decisão', 'patch');
    }
    const {bruto, ehHtml, avisoCharset, texto} = textoDaResposta(r.bytes, r.content_type);
    const sha256 = hashTexto(texto);
    const {nivel, catalogo} = nivelDe(r.url_final || url);
    const orgao = CATALOGO_FONTES.find((c) => c.id === catalogo)?.orgao;
    const nome = titulo?.trim() || (ehHtml ? tituloDoHtml(bruto) : undefined);
    const fonte = projeto.alterarPesquisa((p) => {
      const existente = p.fontes.find((f) => f.url === url);
      const id = existente?.id ?? proximoId(p, 'fonte');
      const obs = observacao?.trim() ? acrescentar(existente?.observacao, observacao, autor) : existente?.observacao;
      const nova: Fonte = {
        id,
        url,
        ...(r.url_final && r.url_final !== url ? {url_final: r.url_final} : {}),
        ...(nome ? {titulo: nome} : {}),
        ...(orgao ? {orgao} : {}),
        nivel,
        ...(catalogo ? {catalogo} : {}),
        acessado_em: new Date().toISOString(),
        http: r.status,
        bytes: r.bytes.byteLength,
        sha256,
        arquivo: caminhoTextoFonte(id),
        sinais_vigencia: sinaisDeVigencia(texto),
        ...(obs ? {observacao: obs} : {}),
        autor: existente?.autor ?? autor,
      };
      // texto novo não apaga o antigo: os fatos foram conferidos nele, então ele fica ao lado, com o sha256 no nome
      const textoAnterior = existente && existente.sha256 !== sha256 ? projeto.guardarVersaoTextoFonte(id, existente.sha256) : undefined;
      projeto.gravarTextoFonte(id, texto);
      if (existente) p.fontes[p.fontes.indexOf(existente)] = nova;
      else p.fontes.push(nova);
      // o texto mudou: inicio e fim dos fatos desta fonte apontavam para o texto antigo; procura de novo cada trecho
      // (achado, lugar, vigência em volta e estado). A afirmação, o trecho e os dígitos ficam como estavam.
      const reconferidos: string[] = [];
      if (existente && existente.sha256 !== sha256) {
        for (const fato of p.fatos) {
          if (fato.fonte_id !== id) continue;
          const achou = acharTrecho(texto, fato.trecho);
          fato.achado = achou.achado;
          if (achou.inicio !== undefined) { fato.inicio = achou.inicio; fato.fim = achou.fim; } else { delete fato.inicio; delete fato.fim; }
          fato.vigencia = achou.inicio !== undefined ? sinaisDeVigencia(entorno(texto, achou.inicio, achou.fim ?? achou.inicio)) : [];
          fato.estado = estadoDoFato(fato.achado, fato.digitos.faltando);
          reconferidos.push(fato.id);
        }
      }
      return {fonte: nova, reconferidos, textoAnterior};
    }, {autor, origem, rotulo: `fonte lida: ${new URL(url).hostname}`});
    const aviso = [avisoCharset, avisoDoTexto(texto)].filter(Boolean).join('; ');
    return {
      ...fonte.fonte,
      caracteres: texto.length,
      paginas: paginar(texto).paginas,
      ...(fonte.reconferidos.length ? {fatos_reconferidos: fonte.reconferidos} : {}),
      ...(fonte.textoAnterior ? {texto_anterior: fonte.textoAnterior} : {}),
      ...(aviso ? {aviso} : {}),
      texto: texto.slice(0, CARACTERES_NA_LEITURA),
    };
  }));

  servidor.registerTool('anotar_fonte', {
    description: 'Acrescenta uma linha à observação de quem baixou de uma fonte, com data e autor. Nunca apaga o que já estava.',
    inputSchema: {fonte_id: z.string(), observacao: z.string().min(1)},
  }, seguro(({fonte_id, observacao}: {fonte_id: string; observacao: string}) => {
    fonteDe(projeto, fonte_id);
    return projeto.alterarPesquisa((p) => {
      const f = p.fontes.find((x) => x.id === fonte_id)!;
      f.observacao = acrescentar(f.observacao, observacao, autor);
      return {ok: true, id: f.id, observacao: f.observacao};
    }, {autor, origem, rotulo: `observação na fonte ${fonte_id}`});
  }));

  servidor.registerTool('registrar_fato', {
    description: 'Registra um fato tirado de uma fonte já lida: a afirmação (como vai no vídeo) e o trecho LITERAL copiado do texto da fonte. O app procura o trecho no texto gravado (exato, parecido ou não encontrado), confere se cada número da afirmação aparece no trecho e anota as marcas de vigência em volta dele. Fica "trecho_confere" quando o trecho é exato e todos os números da afirmação estão nele: prova que o trecho existe na fonte e que os números batem, não que ele sustenta a afirmação. Nunca recusa: o que não confere (trecho fora do texto, número faltando, fonte que não está na pesquisa) fica "a_revisar" para a pessoa ver. Os números do localizador ("art. 477, § 6º") não precisam estar no trecho. Cite o id devolvido (F1, F2…) em "refs" do bloco do vídeo.',
    inputSchema: {
      // vazia não vira fato (é a única recusa além do pesquisa.json ilegível): a mensagem diz o que falta
      afirmacao: z.string().min(1, 'afirmacao vazia: diga o que o trecho sustenta'),
      fonte_id: z.string(),
      // sem min(1): trecho vazio também entra, como não encontrado (nunca recusa)
      trecho: z.string().describe('copiado tal e qual do texto da fonte'),
      localizador: z.string().optional().describe('ex.: CLT, art. 477, § 6º'),
      nota: z.string().optional(),
    },
  }, seguro(({afirmacao, fonte_id, trecho, localizador, nota}: {afirmacao: string; fonte_id: string; trecho: string; localizador?: string; nota?: string}) => {
    // nunca recusa: fonte que não está na pesquisa, ou sem o texto na pasta (pasta clonada: pesquisa/fontes/ fica fora
    // do git), e o fato entra do mesmo jeito, como não encontrado e com um aviso. Só o pesquisa.json ilegível impede
    // gravar, porque gravar por cima apagaria a pesquisa (docs/pesquisa.md).
    const temFonte = projeto.pesquisa().fontes.some((f) => f.id === fonte_id);
    let texto: string | undefined;
    try {
      texto = temFonte ? projeto.lerTextoFonte(fonte_id) : undefined;
    } catch {
      texto = undefined;
    }
    const achou = texto !== undefined ? acharTrecho(texto, trecho) : {achado: 'nao' as const, inicio: undefined, fim: undefined};
    const digitos = conferirDigitos(afirmacao, trecho, localizador);
    const vigencia = texto !== undefined && achou.inicio !== undefined ? sinaisDeVigencia(entorno(texto, achou.inicio, achou.fim ?? achou.inicio)) : [];
    const fato = projeto.alterarPesquisa((p) => {
      const novo: Fato = {
        id: proximoId(p, 'fato'),
        afirmacao,
        fonte_id,
        ...(localizador?.trim() ? {localizador: localizador.trim()} : {}),
        trecho,
        ...(achou.inicio !== undefined ? {inicio: achou.inicio, fim: achou.fim} : {}),
        achado: achou.achado,
        digitos,
        vigencia,
        estado: estadoDoFato(achou.achado, digitos.faltando),
        ...(nota?.trim() ? {nota: nota.trim()} : {}),
        criado_em: new Date().toISOString(),
        autor,
      };
      p.fatos.push(novo);
      return novo;
    }, {autor, origem, rotulo: `fato registrado (fonte ${fonte_id})`});
    if (!temFonte) return {...fato, aviso: `a fonte ${fonte_id} não está na pesquisa: leia a url com ler_fonte e registre o fato de novo com o id certo`};
    return texto === undefined ? {...fato, aviso: `o texto da fonte ${fonte_id} não está nesta pasta; leia a url de novo com ler_fonte para conferir o trecho`} : fato;
  }));

  servidor.registerTool('listar_pesquisa', {
    description: 'Fontes (sem o texto) e fatos da pesquisa do projeto, com o que o app conferiu em cada fato (achado, dígitos faltando, vigência, estado). Com "fonte_id", só aquela fonte e os fatos dela (pesquisa grande pesa menos no contexto).',
    inputSchema: {fonte_id: z.string().optional().describe('ex.: f1; sem ele, tudo')},
  }, seguro(({fonte_id}: {fonte_id?: string}) => {
    const p = projeto.pesquisa();
    if (!fonte_id) return {fontes: p.fontes, fatos: p.fatos};
    return {fontes: p.fontes.filter((f) => f.id === fonte_id), fatos: p.fatos.filter((f) => f.fonte_id === fonte_id)};
  }));

  servidor.registerTool('texto_da_fonte', {
    description: `Texto limpo de uma fonte lida, em páginas de ${TAMANHO_PAGINA} caracteres (pagina começa em 1), ou o recorte inicio..fim (índices de caractere, os mesmos de inicio/fim dos fatos).`,
    inputSchema: {
      fonte_id: z.string(),
      pagina: z.number().int().min(1).optional(),
      inicio: z.number().int().min(0).optional(),
      fim: z.number().int().min(0).optional(),
    },
  }, seguro(({fonte_id, pagina, inicio, fim}: {fonte_id: string; pagina?: number; inicio?: number; fim?: number}) => {
    fonteDe(projeto, fonte_id);
    const texto = projeto.lerTextoFonte(fonte_id);
    if (inicio !== undefined || fim !== undefined) {
      const de = Math.min(inicio ?? 0, texto.length);
      const ate = Math.min(Math.max(fim ?? texto.length, de), texto.length);
      return {fonte_id, inicio: de, fim: ate, caracteres: texto.length, texto: texto.slice(de, ate)};
    }
    return {fonte_id, caracteres: texto.length, ...paginar(texto, pagina ?? 1)};
  }));

  servidor.registerTool('checar_texto', {
    description: 'Avisos das regras de conteúdo sobre o texto do vídeo: termos que o Provimento 205/2021 da OAB veda ou pede cuidado, nomes de empresa e de pessoa, e números que não estão em nenhum fato da pesquisa. Passe "texto" ou um "documento" (todos os textos dele, inclusive a narração do roteiro do carrossel narrado e as legendas do vídeo de cenas); no vídeo de cenas vem também a lista dos blocos com número e sem refs, e no documento, se o último texto (ou a narração) termina com a frase de fecho das regras. Só informa: nada é bloqueado.',
    inputSchema: {documento: z.string().optional().describe('id do documento no manifesto'), texto: z.string().optional()},
  }, seguro(({documento, texto: t}: {documento?: string; texto?: string}) => {
    if (!documento && t === undefined) throw new ErroProjeto('passe "texto" ou "documento"', 'patch');
    const fatos = projeto.pesquisa().fatos;
    const avisos: Aviso[] = t !== undefined ? checarTexto(t, REGRAS_CONTEUDO, {onde: 'texto', fatos}).avisos : [];
    if (!documento) return {avisos};
    const {doc} = projeto.lerJson<unknown>(projeto.arquivoDoDocumento(documento));
    // a frase de fecho ("Ficou com alguma dúvida? Procure um advogado trabalhista.") vem no fim da narração ou, sem ela,
    // no último texto do documento
    // No vídeo de cenas a fala também vai à tela pelas legendas: o fecho vale se o último bloco OU a última legenda o traz
    // (transversal-N5).
    const fecho = (ultimo: string | undefined, ...outros: (string | undefined)[]) =>
      ({frase: REGRAS_CONTEUDO.texto.ultima_frase, termina: [ultimo, ...outros].some((x) => Boolean(x) && terminaComUltimaFrase(x!))});
    if (ehDocCenas(doc)) {
      const blocos_sem_refs: string[] = [];
      let ultimo: string | undefined;
      for (const cena of doc.cenas) {
        for (const b of cena.blocos) {
          const tb = textoDoBloco(b);
          if (!tb) continue;
          ultimo = tb;
          avisos.push(...checarTexto(tb, REGRAS_CONTEUDO, {onde: b.id, fatos}).avisos);
          // os refs da cena valem para os blocos dela
          if (numerosDe(tb).length && !b.refs?.length && !cena.refs?.length) blocos_sem_refs.push(b.id);
        }
      }
      // legendas queimadas na tela (frente Fala): cada segmento passa pelas mesmas regras, com "legenda <id>" em `onde`
      const segmentos = (doc.legendas?.segmentos ?? []).filter((s) => typeof s?.texto === 'string' && s.texto.trim());
      for (const s of segmentos) avisos.push(...checarTexto(s.texto, REGRAS_CONTEUDO, {onde: `legenda ${s.id}`, fatos}).avisos);
      const ultimaLegenda = segmentos.reduce<(typeof segmentos)[number] | undefined>((a, s) => (!a || s.sai >= a.sai ? s : a), undefined)?.texto;
      return {documento, avisos, blocos_sem_refs, ultima_frase: fecho(ultimo, ultimaLegenda)};
    }
    const textos = textosDoJson(doc);
    for (const {onde, texto: tx} of textos) avisos.push(...checarTexto(tx, REGRAS_CONTEUDO, {onde, fatos}).avisos);
    const narracao = narracaoDe(projeto, doc);
    if (narracao) avisos.push(...checarTexto(narracao, REGRAS_CONTEUDO, {onde: 'narração', fatos}).avisos);
    return {documento, avisos, ultima_frase: fecho(narracao ?? textos[textos.length - 1]?.texto)};
  }));
};

// ---------- frente Fala: transcrição local e legendas (src/nucleo/legendas.ts, src/main/transcricao.ts, docs/legendas.md) ----------

/** O que o MCP precisa do transcritor do processo principal (src/main/transcricao.ts): sem ele, a ferramenta avisa. */
export type TranscritorMcp = {
  /** `sinal`: o do pedido do MCP; aborta quando a conversa é interrompida (Esc) ou a conexão cai. */
  transcrever: (projeto: Projeto, pedido: {arquivo: string; modelo?: 'base' | 'small'; vocabulario?: string; destino?: string; pela_ia?: boolean; termos?: string[]},
    andamento?: (p: unknown) => void, sinal?: AbortSignal) => Promise<{ok: boolean; palavras?: string; n?: number; duracao_s?: number; texto?: string; mensagem?: string; cancelado?: boolean}>;
  /** A transcrição do arquivo ainda é do áudio como ele está (o carimbo do palavras.json)? Sem isto, vale a existência. */
  conferir?: (projeto: Projeto, arquivo: string) => EstadoDaFala;
  /** Cortes pela fala: grava a narração emendada (src/main/cortes-fala.ts). */
  emendar?: EmendadorMcp;
};

const LIMITE_TEXTO_TRANSCRITO = 4000;

const docCenasDe = (projeto: Projeto, documento?: string) => {
  const alvo = documento ?? projeto.estado()?.documento ?? projeto.manifesto().documentos.find((d) => d.modulo === 'video')?.id;
  if (!alvo) throw new ErroProjeto('o projeto não tem vídeo de cenas', 'nao_achado');
  const rel = projeto.arquivoDoDocumento(alvo);
  const lido = projeto.lerJson<unknown>(rel);
  if (!ehDocCenas(lido.doc)) throw new ErroProjeto(`${alvo} não é um vídeo de cenas: para o carrossel narrado, transcreva o "arquivo" da narração`, 'patch');
  return {alvo, rel, doc: lido.doc, versao: lido.versao};
};

/** Como `seguro`, passando o sinal do pedido (o SDK aborta quando o cliente cancela ou a conexão fecha). */
const seguroComSinal = <A,>(f: (a: A, sinal?: AbortSignal) => unknown) => async (a: A, extra?: {signal?: AbortSignal}) => {
  try {
    return texto(await f(a, extra?.signal));
  } catch (e) {
    return erro(e);
  }
};

const registrarFala = (servidor: McpServer, projeto: Projeto, autor: string, origem: string, transcritor: TranscritorMcp | undefined) => {
  servidor.registerTool('transcrever', {
    description: 'Transcreve a fala no próprio PC (whisper.cpp, nada sai da máquina) e grava <arquivo>.palavras.json com o tempo de cada palavra ({w, s, e, p} em ms do arquivo), o formato que o carrossel narrado e as legendas leem. Dois usos: (1) "arquivo" (qualquer áudio ou vídeo do projeto, como a narração de um roteiro ou uma gravação para a pesquisa): devolve o texto; com "destino", grava em outro caminho (ex.: video/palavras.json do roteiro). (2) Vídeo de cenas: "clipe" ou "faixa" (ids de audio.faixas), ou nada para todas as faixas de voz; transcreve a fala que ainda não tem transcrição ou cuja tomada mudou depois dela (a do clipe de voz limpa é a do original) e, com legendas (padrão), gera as legendas dos clipes que ainda não têm (segmentos por pausa, pontuação e largura, com o falante pelo nome do clipe ou da faixa). Clipe que já tem legendas fica como está: para refazer, pergunte à pessoa e use refazer_legendas. Na primeira vez baixa o modelo (small, 190 MB) e, no Windows x64, o whisper.cpp (9 MB) para ~/Estudio/modelos/whisper; no Linux o whisper-cli precisa estar compilado (na pasta bin/ dela ou no PATH), e o erro diz como. Leva perto de metade da duração do áudio.',
    inputSchema: {
      arquivo: z.string().optional().describe('caminho no projeto, ex.: midia/narracao.wav ou midia/video-exemplo.mp4'),
      destino: z.string().optional().describe('só com "arquivo": onde gravar a lista de palavras, um .json próprio como video/palavras.json (padrão: <arquivo>.palavras.json). Nunca o manifesto, um documento, comentarios.json, a pesquisa ou .estudio/'),
      documento: z.string().optional().describe('id do vídeo de cenas (padrão: o que a pessoa está vendo)'),
      clipe: z.string().optional().describe('id do clipe de voz'),
      faixa: z.string().optional().describe('id da faixa'),
      legendas: z.boolean().optional().describe('no vídeo de cenas, gerar as legendas (padrão: sim)'),
      estilo: z.enum(['classica', 'caixa', 'karaoke', 'faixa', 'discreta']).optional().describe('predefinição das legendas'),
      refazer: z.boolean().optional().describe('transcrever de novo mesmo que a transcrição seja do áudio como ele está'),
      refazer_legendas: z.boolean().optional().describe('refazer também as legendas dos clipes que já têm: as palavras corrigidas à mão que ainda caem no tempo da fala ficam; divisões, junções e tempos ajustados voltam ao automático. Pergunte à pessoa antes'),
      modelo: z.enum(['small', 'base']).optional().describe('small (padrão) erra menos; base é duas vezes mais rápido'),
      vocabulario: z.string().optional().describe('frase com termos que vão aparecer (nomes, siglas); o padrão puxa o vocabulário do direito do trabalho'),
    },
  }, seguroComSinal(async (a: {arquivo?: string; destino?: string; documento?: string; clipe?: string; faixa?: string; legendas?: boolean; estilo?: IdEstiloLegenda;
    refazer?: boolean; refazer_legendas?: boolean; modelo?: 'small' | 'base'; vocabulario?: string}, sinal?: AbortSignal) => {
    if (!transcritor) throw new ErroProjeto('este MCP não tem o transcritor: abra o projeto no Estúdio ou use o MCP por stdio (mcp/nucleo.ts)', 'patch');
    // pela_ia: a tela mostra o andamento e o Cancelar dizendo que foi a IA que pediu (transversal-N4)
    const pedido = (arquivo: string, destino?: string) => ({arquivo, destino, modelo: a.modelo, vocabulario: a.vocabulario, pela_ia: true});
    if (a.arquivo) {
      // grava por cima, fora do diário: nunca no manifesto, num documento, nos comentários, na pesquisa ou em .estudio/
      const recusa = a.destino === undefined ? null : recusaDoDestinoNoProjeto(projeto, a.destino);
      if (recusa) throw new ErroProjeto(recusa, 'caminho');
      const r = await transcritor.transcrever(projeto, pedido(a.arquivo, a.destino), undefined, sinal);
      if (!r.ok) throw new ErroProjeto(r.mensagem ?? 'a transcrição não terminou', 'patch');
      const t = r.texto ?? '';
      return {...r, texto: t.slice(0, LIMITE_TEXTO_TRANSCRITO), ...(t.length > LIMITE_TEXTO_TRANSCRITO ? {texto_cortado: true} : {})};
    }
    const {alvo, doc} = docCenasDe(projeto, a.documento);
    const clipes = clipesDeVoz(doc, {clipe: a.clipe, faixa: a.faixa});
    if (!clipes.length) {
      throw new ErroProjeto(a.clipe || a.faixa ? `clipe ou faixa não achado: ${a.clipe ?? a.faixa}` : 'o vídeo não tem clipe de narração: use "+ Áudio → Narração…" no app ou passe "arquivo"', 'nao_achado');
    }
    const transcritos: {arquivo: string; palavras?: string; n?: number; duracao_s?: number; ja_tinha?: boolean; audio_mudou?: boolean}[] = [];
    const estados: Record<string, EstadoDaFala> = {};
    // a fala do clipe de voz limpa é a do original (mesmos tempos): limpar a voz não pede outra transcrição
    for (const arquivo of [...new Set(clipes.map((c) => arquivoDaFala(c.clipe)))]) {
      const estado = estados[arquivo] = transcritor.conferir ? transcritor.conferir(projeto, arquivo) : projeto.existe(arquivoDasPalavras(arquivo)) ? 'em_dia' : 'falta';
      if (!a.refazer && estado === 'em_dia') {
        transcritos.push({arquivo, palavras: arquivoDasPalavras(arquivo), ja_tinha: true});
        continue;
      }
      const termos = termosDoDicionario(doc.legendas); // o dicionário do vídeo entra no vocabulário do whisper
      const r = await transcritor.transcrever(projeto, {...pedido(arquivo), ...(termos.length ? {termos} : {})}, undefined, sinal);
      if (!r.ok) throw new ErroProjeto(r.mensagem ?? `a transcrição de ${arquivo} não terminou`, 'patch');
      transcritos.push({arquivo, palavras: r.palavras, n: r.n, duracao_s: r.duracao_s, ...(estado === 'velha' ? {audio_mudou: true} : {})});
    }
    if (a.legendas === false) return {documento: alvo, transcritos};
    // o documento pode ter mudado enquanto o whisper rodava: lê de novo e grava com a versão nova
    const atual = docCenasDe(projeto, alvo);
    const f = formatoDoVideo(atual.doc);
    const r = legendasDoDocumento(atual.doc, (c) => projeto.lerJson<unknown>(c).doc, {largura: f.largura, altura: f.altura, clipe: a.clipe, faixa: a.faixa,
      estilo: a.estilo ? {...(atual.doc.legendas?.estilo ?? {}), predefinicao: a.estilo} : undefined, refazer: a.refazer_legendas === true});
    // clipe com legendas da tomada antiga: não refaz sem a pessoa decidir
    const outra = new Set(legendasDeOutraTomada(atual.doc));
    const desatualizadas = r.mantidos.filter((id) => outra.has(id) || clipes.some((c) => c.clipe.id === id && estados[arquivoDaFala(c.clipe)] === 'velha'));
    const mantidos = r.mantidos.length ? {ja_tinham_legendas: r.mantidos, ...(desatualizadas.length ? {legendas_de_audio_antigo: desatualizadas} : {}),
      nota: 'clipes que já tinham legendas ficaram como estavam; para refazer, pergunte à pessoa e chame de novo com refazer_legendas: true (as palavras corrigidas à mão no mesmo tempo ficam)'} : {};
    if (!r.clipes) return {documento: alvo, transcritos, legendas: atual.doc.legendas?.segmentos?.length ?? 0, geradas: 0, ...mantidos, ...(r.faltam.length ? {sem_transcricao: r.faltam} : {})};
    const gravado = projeto.aplicarPatch({documento: atual.rel, versao_base: atual.versao, patch: [{op: 'add', path: '/legendas', value: r.legendas}], autor, origem,
      rotulo: `legendas da fala (${r.geradas})`});
    return {documento: alvo, versao: gravado.versao, transcritos, legendas: r.legendas.segmentos.length, geradas: r.geradas, estilo: r.legendas.estilo?.predefinicao,
      ...(r.corrigidas ? {corrigidas_a_mao_mantidas: r.corrigidas} : {}), ...(r.dicionario ? {trocas_do_dicionario: r.dicionario} : {}), ...mantidos, ...(r.faltam.length ? {sem_transcricao: r.faltam} : {}),
      primeiras: r.legendas.segmentos.slice(0, 5).map((s) => ({id: s.id, em: s.em, sai: s.sai, texto: s.texto, falante: s.falante}))};
  }));

  // as legendas nos tempos da tela: o documento guarda o tempo de quando a legenda nasceu, e o app soma o quanto o clipe
  // de voz andou depois (origens); ler e corrigir por aqui evita o Claude escrever o tempo da tela no campo guardado
  const naTela = (doc: DocCenas) => resolverCenas(doc).props.legendas_cenas?.segmentos ?? [];
  // cps: caracteres por segundo; acima de 17 a legenda é rápida para ler (a régua da casa)
  // duvidosas: as palavras em que o whisper teve pouca certeza (p < 0,6), para conferir
  const resumo = (s: {id: string; em: number; sai: number; texto: string; falante?: string; palavras?: PalavraLegenda[]}) => ({id: s.id, em: s.em, sai: s.sai,
    texto: s.texto, cps: cpsDe(s), ...(s.falante ? {falante: s.falante} : {}), ...(palavrasDuvidosas(s.palavras).length ? {duvidosas: palavrasDuvidosas(s.palavras)} : {})});

  servidor.registerTool('ler_legendas', {
    description: 'As legendas do vídeo de cenas como aparecem na tela: id, em e sai em ms do vídeo (já com o clipe de voz no lugar em que está agora), texto, falante, cps (caracteres por segundo; acima de 17 é rápida para ler) e duvidosas (palavras em que o whisper teve pouca certeza: confira). "de" e "ate" (ms) pegam só as de um trecho. Para corrigir, use editar_legenda com esses tempos.',
    inputSchema: {documento: z.string().optional(), de: z.number().optional().describe('ms do vídeo'), ate: z.number().optional().describe('ms do vídeo')},
  }, seguro(({documento, de, ate}: {documento?: string; de?: number; ate?: number}) => {
    const {alvo, doc} = docCenasDe(projeto, documento);
    const todas = naTela(doc);
    const lista = todas.filter((s) => (de === undefined || s.sai > de) && (ate === undefined || s.em < ate));
    const rapidas = lista.filter((s) => cpsDe(s) > CPS_MAX).map((s) => s.id);
    return {documento: alvo, total: todas.length, legendas: lista.slice(0, 300).map(resumo), ...(lista.length > 300 ? {cortado: true} : {}),
      ...(rapidas.length ? {rapidas_para_ler: rapidas, nota: `acima de ${CPS_MAX} caracteres por segundo: estique o sai no vão, divida ou encurte o texto`} : {})};
  }));

  servidor.registerTool('editar_legenda', {
    description: 'Corrige uma legenda do vídeo de cenas pelo id: o texto (cada palavra fica com o tempo da que estava no lugar, como na lista do app) e/ou quando ela entra e sai, em ms do vídeo como aparece na tela (ler_legendas). Use no lugar de aplicar_patch em /legendas/segmentos: o tempo guardado lá é o de quando a legenda nasceu. Devolve a legenda como fica na tela.',
    inputSchema: {
      documento: z.string().optional(),
      id: z.string().describe('id da legenda (leg-1, leg-2…)'),
      texto: z.string().optional().describe('o texto corrigido; "\\n" quebra a linha'),
      em: z.number().optional().describe('ms do vídeo em que entra, como na tela'),
      sai: z.number().optional().describe('ms do vídeo em que sai, como na tela'),
    },
  }, seguro(({documento, id, texto, em, sai}: {documento?: string; id: string; texto?: string; em?: number; sai?: number}) => {
    const {alvo, rel, doc, versao} = docCenasDe(projeto, documento);
    const segs = Array.isArray(doc.legendas?.segmentos) ? doc.legendas.segmentos : [];
    const i = segs.findIndex((s) => s?.id === id);
    if (i < 0) throw new ErroProjeto(`legenda não achada: ${id} (ler_legendas lista os ids)`, 'nao_achado');
    if (texto === undefined && em === undefined && sai === undefined) throw new ErroProjeto('diga o texto, o em ou o sai novos', 'patch');
    let s = segs[i];
    if (texto !== undefined) {
      if (!texto.trim()) throw new ErroProjeto('texto vazio: para tirar a legenda, use aplicar_patch com remove em /legendas/segmentos/N', 'patch');
      s = comTexto(s, texto);
    }
    if (em !== undefined || sai !== undefined) {
      const desloc = deslocamentoDaLegenda(s, doc.legendas?.origens, (doc.audio?.faixas ?? []).flatMap((f) => f.clipes ?? []));
      const novoEm = em !== undefined ? Math.round(em - desloc) : s.em;
      const novoSai = sai !== undefined ? Math.round(sai - desloc) : s.sai;
      if (novoEm + desloc < 0 || novoSai - novoEm < 200) throw new ErroProjeto('a legenda entra em 0 ms ou depois e dura pelo menos 200 ms', 'patch');
      // entrar e sair o mesmo tanto mais cedo ou mais tarde leva as palavras junto; mudar só uma ponta apara
      const d = novoEm - s.em;
      const junto = d !== 0 && novoSai - s.sai === d && Array.isArray(s.palavras);
      const lim = junto ? limitesDoArrasto(doc, s) : null;
      if (lim && (d < lim.min || d > lim.max)) {
        throw new ErroProjeto(`a legenda sairia do trecho que o clipe de voz toca e sumiria: dá para andar de ${lim.min} a ${lim.max} ms; para o texto aparecer antes ou depois da voz, mude só o em ou só o sai`, 'patch');
      }
      s = {...s, em: novoEm, sai: novoSai, ...(junto ? {palavras: s.palavras!.map((p) => ({...p, s: p.s + d, e: p.e + d}))} : {})};
    }
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, autor, origem, rotulo: `legenda ${id}`,
      patch: [{op: 'test', path: `/legendas/segmentos/${i}/id`, value: id}, {op: 'replace', path: `/legendas/segmentos/${i}`, value: s}]});
    const agora = naTela(projeto.lerJson<DocCenas>(rel).doc).find((x) => x.id === id);
    return {ok: true, documento: alvo, versao: gravado.versao, legenda: agora ? resumo(agora) : null};
  }));

  servidor.registerTool('exportar_legendas', {
    description: 'Grava as legendas do vídeo de cenas em saidas/<nome>.srt, .vtt e/ou .pt_BR.srt (srt_pt_br: o nome que o Facebook pede), nos tempos de saída (já com o clipe de voz no lugar em que está). Com trecho, só as legendas dele, contadas do zero (para acompanhar o vídeo exportado com o mesmo trecho). O VTT leva o falante na marca de voz (<v Nome>). Não grava por cima: se o nome existe, sai "<nome> (2).srt", a menos que sobrescrever seja true.',
    inputSchema: {
      documento: z.string().optional(),
      formatos: z.array(z.enum(['srt', 'vtt', 'srt_pt_br'])).optional().describe('padrão: srt e vtt'),
      trecho: z.object({de_ms: z.number(), ate_ms: z.number()}).optional().describe('ms do vídeo; as legendas saem contadas do começo do trecho'),
      nome: z.string().optional().describe('nome do arquivo sem extensão (padrão: o título do vídeo)'),
      falantes_no_srt: z.boolean().optional().describe('"Nome: " antes do texto no SRT'),
      sobrescrever: z.boolean().optional().describe('true: grava por cima do arquivo de mesmo nome (pergunte à pessoa antes)'),
    },
  }, seguro(({documento, formatos, nome, falantes_no_srt, sobrescrever, trecho}: {documento?: string; formatos?: ('srt' | 'vtt' | 'srt_pt_br')[]; nome?: string;
    falantes_no_srt?: boolean; sobrescrever?: boolean; trecho?: {de_ms: number; ate_ms: number}}) => {
    const {alvo, doc} = docCenasDe(projeto, documento);
    if (trecho && !(trecho.ate_ms > trecho.de_ms && trecho.de_ms >= 0)) throw new ErroProjeto('o trecho vai de de_ms até ate_ms, maior', 'patch');
    const todas = resolverCenas(doc).props.legendas_cenas?.segmentos ?? [];
    if (!todas.length) throw new ErroProjeto('o vídeo não tem legendas: gere com transcrever ou importe com importar_legendas', 'nao_achado');
    const segs = legendasNoTrecho(todas, trecho);
    if (!segs.length) throw new ErroProjeto(`nenhuma legenda cai no trecho de ${trecho!.de_ms} a ${trecho!.ate_ms} ms`, 'nao_achado');
    const titulo = nome?.trim() || projeto.manifesto().documentos.find((d) => d.id === alvo)?.titulo || alvo;
    const lista: ('srt' | 'vtt' | 'srt_pt_br')[] = formatos?.length ? formatos : ['srt', 'vtt'];
    const arquivos = lista.map((f) => {
      const base = f === 'srt_pt_br' ? nomeDoArquivoDeLegenda(titulo, 'srt').replace(/\.srt$/, '.pt_BR.srt') : nomeDoArquivoDeLegenda(titulo, f);
      const rel = `saidas/${sobrescrever ? base : nomeLivreDaLegenda(base, (n) => projeto.existe(`saidas/${n}`))}`;
      projeto.gravarTexto(rel, f === 'vtt' ? paraVtt(segs) : paraSrt(segs, {falantes: falantes_no_srt}));
      return rel;
    });
    return {ok: true, documento: alvo, legendas: segs.length, arquivos};
  }));

  servidor.registerTool('importar_legendas', {
    description: 'Lê um SRT ou VTT do projeto e põe no vídeo de cenas como legendas (troca as que havia). O tempo de cada palavra é estimado pelo tamanho dela; o falante vem da marca de voz do VTT.',
    inputSchema: {arquivo: z.string().describe('caminho no projeto, ex.: midia/legendas.srt'), documento: z.string().optional(),
      estilo: z.enum(['classica', 'caixa', 'karaoke', 'faixa', 'discreta']).optional()},
  }, seguro(({arquivo, documento, estilo}: {arquivo: string; documento?: string; estilo?: IdEstiloLegenda}) => {
    if (!projeto.existe(arquivo)) throw new ErroProjeto(`o arquivo não está no projeto: ${arquivo}`, 'nao_achado');
    const {alvo, rel, doc, versao} = docCenasDe(projeto, documento);
    // pelos bytes: o SRT em ANSI (Windows-1252) chega com os acentos certos (video-N6)
    const {texto, codificacao} = textoDeLegenda(readFileSync(projeto.caminho(arquivo)));
    const {legendas, avisos} = legendasDeArquivo(texto, arquivo, estilo ? {...(doc.legendas?.estilo ?? {}), predefinicao: estilo} : doc.legendas?.estilo);
    if (!legendas.segmentos.length) throw new ErroProjeto(`nenhuma legenda lida de ${arquivo}: ${avisos.join('; ')}`, 'patch');
    const {origens: _o, ...antes} = doc.legendas ?? {segmentos: []};
    const gravado = projeto.aplicarPatch({documento: rel, versao_base: versao, patch: [{op: 'add', path: '/legendas', value: {...antes, ...legendas}}],
      autor, origem, rotulo: `legendas importadas de ${arquivo.split('/').pop()}`});
    return {ok: true, documento: alvo, versao: gravado.versao, legendas: legendas.segmentos.length, ...(codificacao !== 'utf-8' ? {codificacao} : {}),
      ...(avisos.length ? {avisos} : {})};
  }));
};

// ---------- acabamento da imagem: remover fundo (src/nucleo/remover-fundo.ts, docs/imagem.md) ----------
// Sombra, contorno, degradê e máscara o Claude faz por aplicar_patch (são campos da camada); remover fundo precisa do
// modelo, que roda na janela do app: o processo principal registra quem executa (src/main/remover-fundo.ts).

const registrarAcabamento = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('remover_fundo', {
    description: `Tira o fundo de uma camada de imagem com o modelo local ${MODELO_FUNDO.nome}, ${MODELO_FUNDO.licenca}: feito para pessoa (cabelo, ombros), não para logo ou objeto. Grava midia/<arquivo>.<código>.sem-fundo.png sem tocar no original (nem no recorte de outra foto) e troca o src da camada, guardando o original em src_original; com voltar: true, a camada volta ao original. Na primeira vez baixa o modelo (${Math.round(MODELO_FUNDO.bytes / 1024 / 1024)} MB) e leva alguns segundos a mais. Só com o app do Estúdio aberto.`,
    inputSchema: {
      documento: z.string().describe('id do documento de imagem'),
      camada: z.string().describe('id da camada (ex.: foto-1, em qualquer página; id repetido em página duplicada pede o caminho) ou caminho (/camadas/2, /paginas/1/camadas/0)'),
      voltar: z.boolean().optional().describe('true: volta ao arquivo original'),
    },
  }, seguro(async ({documento, camada, voltar}: {documento: string; camada: string; voltar?: boolean}) => {
    const rel = projeto.arquivoDoDocumento(documento);
    const lido = projeto.lerJson<DocImagem>(rel);
    // por id, só se ele for de uma camada só: página duplicada repete os ids, e aí quem diz qual é o caminho
    const mesmos = camada.startsWith('/') ? [] : caminhosDoId(lido.doc, camada);
    if (mesmos.length > 1) throw new ErroProjeto(`o id ${camada} está em ${mesmos.length} camadas (${mesmos.join(', ')}): passe o caminho da que é para recortar`, 'patch');
    const achada = acharCamada(lido.doc, camada);
    if (!achada) throw new ErroProjeto(`camada não achada: ${camada}`, 'nao_achado');
    if (achada.c.tipo !== 'imagem' || !achada.c.src) throw new ErroProjeto(`${camada} não é uma camada de imagem com arquivo`, 'patch');
    if (voltar) {
      const patch = patchVoltarAoOriginal(achada.c, achada.caminho);
      if (!patch.length) throw new ErroProjeto(`${achada.c.id} não guardou o original: já está nele`, 'patch');
      const r = projeto.aplicarPatch({documento, versao_base: lido.versao, patch, autor, origem, rotulo: `${achada.c.id} volta ao original`});
      return {ok: true, camada: achada.caminho, src: achada.c.src_original, versao: r.versao};
    }
    const executar = removedorDeFundo();
    if (!executar) throw new Error('remover fundo só funciona com o app do Estúdio aberto: o modelo roda na janela dele');
    const original = achada.c.src_original ?? achada.c.src;
    const {caminho: novo, ms} = await executar(original);
    // o modelo leva segundos (minutos, se baixa): a camada é lida de novo na mesma página, achada pelo id dela, no mesmo
    // lugar da pilha, e tem de ter o mesmo id; se algo mudou nesse meio-tempo, nada é gravado no documento. O id da
    // camada sozinho não basta (página duplicada repete os ids), nem o caminho (página duplicada e reordenada no meio:
    // o caminho cairia na gêmea, imagem-N6)
    const agora = projeto.lerJson<DocImagem>(rel);
    const paginaAntes = temPaginas(lido.doc) ? paginasDe(lido.doc)[paginaDoCaminho(lido.doc, achada.caminho)]?.id : undefined;
    const p = paginaAntes ? paginasDe(agora.doc).findIndex((pg) => pg.id === paginaAntes) : paginaDoCaminho(agora.doc, achada.caminho);
    const indice = /(\d+)$/.exec(achada.caminho)?.[1];
    const depois = p >= 0 && indice !== undefined ? acharCamada(agora.doc, `${baseCamadas(agora.doc, p)}/${indice}`) : null;
    if (!depois || depois.c.id !== achada.c.id) {
      throw new ErroProjeto(`a camada ${achada.c.id} saiu de ${achada.caminho} enquanto o fundo era removido (${depois ? `agora ali está ${depois.c.id}` : 'o caminho não existe mais'}); `
        + `o documento não mudou e o recorte ficou em ${novo}: chame de novo com o caminho atual`, 'conflito');
    }
    const r = projeto.aplicarPatch({documento, versao_base: agora.versao, patch: patchSemFundo(depois.c, depois.caminho, novo), autor, origem, rotulo: `fundo removido de ${achada.c.id}`});
    return {ok: true, camada: depois.caminho, src: novo, src_original: original, modelo: MODELO_FUNDO.id, tempo_modelo_ms: ms, versao: r.versao};
  }));
};
