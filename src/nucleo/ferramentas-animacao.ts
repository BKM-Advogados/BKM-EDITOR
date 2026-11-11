// Ferramentas MCP para o módulo Animação (docs/animacao.md)
import {readFileSync} from "node:fs";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {ErroProjeto, type Projeto} from "./projeto";
import type {OperacaoPatch} from "./documentos";
import {documentoNovo} from "./criar-projeto";
import {
  ehDocAnimacao, FAIXAS_ANIMACAO, idLivreAnimacao, limitarAFaixa, novaCamadaAnimacao, TEMA_ANIMACAO_NEUTRO, textoFaixa, valorEm,
  type CamadaAnimacao, type Curva, type DocAnimacao, type PropriedadeAnimavel, type TipoCamadaAnimacao,
} from "./animacao";
import {COBERTURA_MIN_PADRAO, gradeDeImagem, MAX_LADO_GRADE, type EfeitoPixel} from "./animacao-pixel";
import {decodificarPng, ErroPng} from "./png";
// o ffmpeg mora com o processo principal (o mesmo do render); o MCP só existe no processo principal e no stdio
import {converterParaPng} from "./imagem-ffmpeg";

const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    const r = await f(a);
    return {content: [{type: "text" as const, text: typeof r === "string" ? r : JSON.stringify(r, null, 2)}]};
  } catch (e) {
    return {isError: true, content: [{type: "text" as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : (e as Error).message}]};
  }
};

/** Cor aceita na animação: "#rrggbb", "#rgb" ou uma referência do tema. */
const COR = z.string().regex(/^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|@(fundo|texto|destaque|suave))$/, 'cor "#rrggbb" ou @fundo, @texto, @destaque, @suave');

/** Lê o documento e confere que é uma animação (as ferramentas daqui gravariam campos estranhos em outro módulo). */
const docAnimacao = (projeto: Projeto, documento: string) => {
  const rel = projeto.arquivoDoDocumento(documento);
  const lido = projeto.lerJson<unknown>(rel);
  if (!ehDocAnimacao(lido.doc)) throw new ErroProjeto(`${documento} não é uma animação (use as ferramentas do módulo dele)`, "patch");
  return {rel, doc: lido.doc, versao: lido.versao};
};

/** Índice da camada pelo id; recusa id ausente e id repetido (editar só a primeira seria um erro silencioso). */
const indiceUnico = (doc: DocAnimacao, documento: string, id: string) => {
  const achados = doc.camadas.flatMap((c, i) => (c?.id === id ? [i] : []));
  if (!achados.length) throw new ErroProjeto(`camada ${id} não encontrada no documento ${documento}`, "nao_achado");
  if (achados.length > 1) throw new ErroProjeto(`o id ${id} está em ${achados.length} camadas (${achados.map((i) => `/camadas/${i}`).join(", ")}): dê um id único a cada uma com aplicar_patch`, "patch");
  return achados[0];
};

/** Imagem do projeto em RGBA. PNG que o decodificador lê vai direto; o resto (JPG, PNG entrelaçado, de 16 bits ou grande
 *  demais) passa pelo ffmpeg, que converte e reduz. Sem ffmpeg, o erro diz o que fazer. */
const lerImagem = async (abs: string, rel: string) => {
  const buffer = readFileSync(abs);
  try {
    return decodificarPng(buffer);
  } catch (e) {
    if (!(e instanceof ErroPng) || !e.convertivel) throw new ErroProjeto(`${rel}: ${e instanceof Error ? e.message : String(e)}`, "patch");
    let png: Buffer;
    try {
      png = await converterParaPng(abs);
    } catch (falha) {
      throw new ErroProjeto(`${rel}: ${e.message}; ${(falha as Error).message}`, "patch");
    }
    return decodificarPng(png);
  }
};

/** A grade volta inteira na resposta só até este tamanho; acima, a resposta passaria de dezenas de KB. */
const GRADE_NA_RESPOSTA = 32 * 32;

export const registrarFerramentasAnimacao = (
  servidor: McpServer,
  projeto: Projeto,
  autor: string,
  origem: string, // como nas outras ferramentas: "Claude 1", "app de fora"… (vai para o diário)
) => {
  servidor.registerTool("criar_animacao", {
    description: "Cria um documento novo de animação 2D com quadros-chave (animacao/<id>.json) e o põe no manifesto do projeto.",
    inputSchema: {
      titulo: z.string().optional(),
      largura: z.number().int().min(16).max(7680).optional(),
      altura: z.number().int().min(16).max(7680).optional(),
      fps: z.number().min(1).max(120).optional(),
      duracao_ms: z.number().min(100).max(3600000).optional(),
      fundo: COR.optional(),
    },
  }, seguro(({titulo, largura, altura, fps, duracao_ms, fundo}: {
    titulo?: string; largura?: number; altura?: number; fps?: number; duracao_ms?: number; fundo?: string;
  }) => {
    const tam = {
      largura: largura ?? 1920,
      altura: altura ?? 1080,
      fps: fps ?? 30,
    };
    const {entrada, conteudo} = documentoNovo(projeto.manifesto(), "animacao", {
      titulo,
      formato: tam,
      existe: (rel) => projeto.existe(rel),
    });
    const docAnim = conteudo as DocAnimacao;
    if (duracao_ms) docAnim.duracao_ms = duracao_ms;
    if (fundo) docAnim.fundo = fundo;
    projeto.adicionarDocumento(entrada, docAnim);
    return {ok: true, documento: entrada.id, caminho: entrada.caminho, titulo: entrada.titulo};
  }));

  servidor.registerTool("adicionar_camada_animacao", {
    description: "Adiciona uma camada (forma, texto, imagem ou pixel) ao documento de animação indicado.",
    inputSchema: {
      documento: z.string(),
      tipo: z.enum(["forma", "texto", "imagem", "pixel"]),
      nome: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      largura: z.number().positive().optional(),
      altura: z.number().positive().optional(),
      forma: z.enum(["retangulo", "elipse"]).optional(),
      cor: COR.optional(),
      raio: z.number().min(0).optional(),
      texto: z.string().optional(),
      fonte: z.string().optional(),
      tamanho: z.number().positive().optional(),
      peso: z.number().min(1).max(1000).optional(),
      alinhar: z.enum(["esquerda", "centro", "direita"]).optional(),
      src: z.string().optional(),
      ajuste: z.enum(["cobrir", "conter"]).optional(),
      tamanho_pixel: z.number().min(1).optional(),
      efeito: z.enum(["aleatorio", "decodificar", "varredura", "varredura-baixo", "meio", "chuva"]).optional(),
      semente: z.number().optional(),
    },
  }, seguro((o: {
    documento: string; tipo: TipoCamadaAnimacao; nome?: string; x?: number; y?: number; largura?: number;
    altura?: number; forma?: "retangulo" | "elipse"; cor?: string; raio?: number; texto?: string; fonte?: string;
    tamanho?: number; peso?: number; alinhar?: "esquerda" | "centro" | "direita"; src?: string;
    ajuste?: "cobrir" | "conter"; tamanho_pixel?: number; efeito?: EfeitoPixel; semente?: number;
  }) => {
    const {doc, versao} = docAnimacao(projeto, o.documento);
    const id = idLivreAnimacao(doc, o.tipo);
    const base = novaCamadaAnimacao(o.tipo, id);

    const camada: CamadaAnimacao = {
      ...base,
      ...(o.nome ? {nome: o.nome} : {}),
      ...(o.x !== undefined ? {x: o.x} : {}),
      ...(o.y !== undefined ? {y: o.y} : {}),
      ...(o.largura !== undefined ? {largura: o.largura} : {}),
      ...(o.altura !== undefined ? {altura: o.altura} : {}),
      ...(o.forma ? {forma: o.forma} : {}),
      ...(o.cor ? {cor: o.cor} : {}),
      ...(o.raio !== undefined ? {raio: o.raio} : {}),
      ...(o.texto ? {texto: o.texto} : {}),
      ...(o.fonte ? {fonte: o.fonte} : {}),
      ...(o.tamanho !== undefined ? {tamanho: o.tamanho} : {}),
      ...(o.peso !== undefined ? {peso: o.peso} : {}),
      ...(o.alinhar ? {alinhar: o.alinhar} : {}),
      ...(o.src ? {src: o.src} : {}),
      ...(o.ajuste ? {ajuste: o.ajuste} : {}),
      ...(o.tamanho_pixel !== undefined ? {tamanho_pixel: o.tamanho_pixel} : {}),
      ...(o.efeito ? {efeito: o.efeito} : {}),
      ...(o.semente !== undefined ? {semente: o.semente} : {}),
    };

    const patch: OperacaoPatch[] = [{op: "add", path: "/camadas/-", value: camada}];
    const r = projeto.aplicarPatch({documento: o.documento, versao_base: versao, patch, autor, origem, rotulo: `adicionar camada ${o.tipo}`});
    return {ok: true, camada_id: id, camada, versao: r.versao};
  }));

  servidor.registerTool("animar", {
    description: `Cria ou substitui a trilha de animação de uma propriedade em uma camada (com quadros-chave {t_ms, valor, curva}). "cor" pede cor ("#rrggbb" ou @fundo, @texto, @destaque, @suave); as outras, número (${Object.keys(FAIXAS_ANIMACAO).map((p) => `${p} ${textoFaixa(p)}`).join("; ")}; x, y e rotacao livres).`,
    inputSchema: {
      documento: z.string(),
      camada_id: z.string(),
      propriedade: z.enum(["x", "y", "escala", "rotacao", "opacidade", "cor", "tamanho", "tamanho_pixel", "progresso"]),
      quadros: z.array(z.object({
        t_ms: z.number().min(0),
        valor: z.union([z.number(), z.string()]),
        curva: z.enum(["linear", "suave", "entrada", "saida", "mola", "degrau"]).optional(),
      })).min(1),
    },
  }, seguro(({documento, camada_id, propriedade, quadros}: {
    documento: string; camada_id: string; propriedade: PropriedadeAnimavel;
    quadros: {t_ms: number; valor: number | string; curva?: Curva}[];
  }) => {
    const {doc, versao} = docAnimacao(projeto, documento);
    const idx = indiceUnico(doc, documento, camada_id);
    for (const q of quadros) {
      if (propriedade === "cor" ? !COR.safeParse(q.valor).success : typeof q.valor !== "number" || !Number.isFinite(q.valor)) {
        throw new ErroProjeto(`${propriedade} pede ${propriedade === "cor" ? 'cor ("#rrggbb" ou @fundo, @texto, @destaque, @suave)' : "número"} (veio ${JSON.stringify(q.valor)})`, "patch");
      }
      if (typeof q.valor === "number" && limitarAFaixa(propriedade, q.valor) !== q.valor) {
        throw new ErroProjeto(`${propriedade} vai ${textoFaixa(propriedade)} (veio ${q.valor})`, "patch");
      }
    }

    const ks = [...quadros].sort((a, b) => a.t_ms - b.t_ms);
    const c = doc.camadas[idx];
    const patch: OperacaoPatch[] = [];
    if (!c.trilhas) {
      patch.push({op: "add", path: `/camadas/${idx}/trilhas`, value: {[propriedade]: ks}});
    } else {
      patch.push({op: c.trilhas[propriedade] ? "replace" : "add", path: `/camadas/${idx}/trilhas/${propriedade}`, value: ks});
    }

    const r = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `animar ${propriedade} de ${camada_id}`});
    return {ok: true, versao: r.versao, propriedade, quadros: ks};
  }));

  servidor.registerTool("pixelizar_imagem", {
    description: `Converte uma imagem do projeto (em midia/: PNG, ou JPG e outros formatos que o ffmpeg do app converte) numa grade de pixel art para a camada pixel indicada. Sem "linhas", segue a proporção da imagem (até ${MAX_LADO_GRADE}). A grade volta inteira só até 32x32; acima disso, a resposta traz a paleta (veja a grade com ler_documento).`,
    inputSchema: {
      documento: z.string(),
      camada_id: z.string(),
      imagem_src: z.string().describe("caminho da imagem no projeto, ex: midia/logo.png ou midia/foto.jpg"),
      colunas: z.number().int().min(1).max(MAX_LADO_GRADE).optional(),
      linhas: z.number().int().min(1).max(MAX_LADO_GRADE).optional(),
      cores: z.number().int().min(2).max(62).optional(),
      usar_paleta_marca: z.boolean().optional(),
      cobertura_min: z.number().min(0).max(1).optional()
        .describe(`tinta mínima (fração da área) para a célula ser pintada; padrão ${COBERTURA_MIN_PADRAO}. Use menos (ex.: 0,1) para logo de linha fina`),
    },
  }, seguro(async ({documento, camada_id, imagem_src, colunas, linhas, cores, usar_paleta_marca, cobertura_min}: {
    documento: string; camada_id: string; imagem_src: string; colunas?: number; linhas?: number;
    cores?: number; usar_paleta_marca?: boolean; cobertura_min?: number;
  }) => {
    const {doc, versao} = docAnimacao(projeto, documento);
    const idx = indiceUnico(doc, documento, camada_id);
    if (doc.camadas[idx].tipo !== "pixel") throw new ErroProjeto(`${camada_id} é ${doc.camadas[idx].tipo}: pixelizar_imagem é da camada pixel`, "patch");
    const avisos: string[] = [];

    const dadosImg = await lerImagem(projeto.caminho(imagem_src), imagem_src);

    let paletaAlvo: string[] | undefined;
    if (usar_paleta_marca && doc.tema) {
      paletaAlvo = [doc.tema.fundo, doc.tema.texto, doc.tema.destaque, doc.tema.suave];
    } else if (usar_paleta_marca) {
      avisos.push("a animação não tem kit (tema): rode aplicar_marca antes; usei as cores da imagem");
    }

    const cols = colunas ?? 16;
    const proporcional = Math.max(1, Math.round(cols * (dadosImg.altura / dadosImg.largura)));
    const lins = linhas ?? Math.min(MAX_LADO_GRADE, proporcional);
    if (!linhas && proporcional > MAX_LADO_GRADE) avisos.push(`a proporção da imagem pedia ${proporcional} linhas: limitei a ${MAX_LADO_GRADE} (a imagem fica achatada; peça menos colunas)`);
    const grade = gradeDeImagem(dadosImg, {
      colunas: cols,
      linhas: lins,
      cores: cores ?? 8,
      paleta: paletaAlvo,
      cobertura_min: cobertura_min ?? COBERTURA_MIN_PADRAO,
    });

    const patch: OperacaoPatch[] = [{op: "add", path: `/camadas/${idx}/grade`, value: grade}];
    const r = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `pixelizar imagem em ${camada_id}`});
    const inteira = grade.colunas * grade.linhas <= GRADE_NA_RESPOSTA;
    if (!inteira) avisos.push(`grade de ${grade.colunas}x${grade.linhas} gravada; a resposta traz só a paleta (veja as células com ler_documento)`);
    return {ok: true, versao: r.versao, colunas: grade.colunas, linhas: grade.linhas, cores: grade.paleta.length, paleta: grade.paleta,
      ...(inteira ? {grade} : {}), ...(avisos.length ? {avisos} : {})};
  }));

  servidor.registerTool("efeito_pixel", {
    description: "Configura o efeito de revelação determinístico e semente de uma camada pixel, e opcionalmente anima o progresso de 0 a 1.",
    inputSchema: {
      documento: z.string(),
      camada_id: z.string(),
      efeito: z.enum(["aleatorio", "decodificar", "varredura", "varredura-baixo", "meio", "chuva"]),
      semente: z.number().optional(),
      animar_progresso: z.boolean().optional(),
      inicio_ms: z.number().min(0).optional(),
      duracao_ms: z.number().min(1).optional(),
    },
  }, seguro(({documento, camada_id, efeito, semente, animar_progresso, inicio_ms, duracao_ms}: {
    documento: string; camada_id: string; efeito: EfeitoPixel; semente?: number;
    animar_progresso?: boolean; inicio_ms?: number; duracao_ms?: number;
  }) => {
    const {doc, versao} = docAnimacao(projeto, documento);
    const idx = indiceUnico(doc, documento, camada_id);
    if (doc.camadas[idx].tipo !== "pixel") throw new ErroProjeto(`${camada_id} é ${doc.camadas[idx].tipo}: efeito_pixel é da camada pixel`, "patch");

    const patch: OperacaoPatch[] = [
      {op: "add", path: `/camadas/${idx}/efeito`, value: efeito},
      ...(semente !== undefined ? [{op: "add" as const, path: `/camadas/${idx}/semente`, value: semente}] : []),
    ];

    if (animar_progresso) {
      const ini = inicio_ms ?? 0;
      const dur = duracao_ms ?? 1500;
      const ks = [
        {t_ms: ini, valor: 0, curva: "linear" as const},
        {t_ms: ini + dur, valor: 1, curva: "suave" as const},
      ];
      if (!doc.camadas[idx].trilhas) {
        patch.push({op: "add", path: `/camadas/${idx}/trilhas`, value: {progresso: ks}});
      } else {
        patch.push({op: doc.camadas[idx].trilhas?.progresso ? "replace" : "add", path: `/camadas/${idx}/trilhas/progresso`, value: ks});
      }
    }

    const r = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `efeito pixel ${efeito} em ${camada_id}`});
    return {ok: true, versao: r.versao, efeito, semente: semente ?? doc.camadas[idx].semente ?? 1};
  }));

  servidor.registerTool("ver_animacao", {
    description: "Mostra o resumo do documento de animação e os valores calculados de todas as camadas no instante tempo_ms.",
    inputSchema: {
      documento: z.string(),
      tempo_ms: z.number().min(0).optional(),
    },
  }, seguro(({documento, tempo_ms = 0}: {documento: string; tempo_ms?: number}) => {
    const {doc, versao} = docAnimacao(projeto, documento);
    const tema = {...TEMA_ANIMACAO_NEUTRO, ...(doc.tema ?? {})};

    const camadasCalculadas = doc.camadas.map((c) => ({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      visivel: c.visivel !== false,
      travada: c.travada === true,
      x: valorEm(c, "x", tempo_ms),
      y: valorEm(c, "y", tempo_ms),
      escala: valorEm(c, "escala", tempo_ms),
      rotacao: valorEm(c, "rotacao", tempo_ms),
      opacidade: valorEm(c, "opacidade", tempo_ms),
      cor: valorEm(c, "cor", tempo_ms, tema),
      ...(c.tipo === "texto" ? {texto: c.texto, tamanho: valorEm(c, "tamanho", tempo_ms)} : {}),
      ...(c.tipo === "forma" ? {forma: c.forma ?? "retangulo", raio: c.raio} : {}),
      ...(c.tipo === "pixel" ? {
        progresso: valorEm(c, "progresso", tempo_ms),
        tamanho_pixel: valorEm(c, "tamanho_pixel", tempo_ms),
        efeito: c.efeito,
        semente: c.semente,
        tem_grade: Boolean(c.grade),
      } : {}),
      trilhas_animadas: Object.keys(c.trilhas ?? {}),
    }));

    return {
      documento,
      versao,
      largura: doc.largura,
      altura: doc.altura,
      fps: doc.fps,
      duracao_ms: doc.duracao_ms,
      fundo: doc.fundo,
      tempo_ms,
      total_camadas: doc.camadas.length,
      camadas: camadasCalculadas,
    };
  }));
};
