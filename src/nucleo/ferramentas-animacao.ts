// Ferramentas MCP para o módulo Animação (docs/animacao.md)
import {readFileSync} from "node:fs";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {ErroProjeto, type Projeto} from "./projeto";
import type {OperacaoPatch} from "./documentos";
import {documentoNovo} from "./criar-projeto";
import {
  idLivreAnimacao, novaCamadaAnimacao, TEMA_ANIMACAO_NEUTRO, valorEm, type CamadaAnimacao, type Curva,
  type DocAnimacao, type PropriedadeAnimavel, type TipoCamadaAnimacao,
} from "./animacao";
import {gradeDeImagem, type EfeitoPixel} from "./animacao-pixel";
import {decodificarPng} from "./png";

const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    const r = await f(a);
    return {content: [{type: "text" as const, text: typeof r === "string" ? r : JSON.stringify(r, null, 2)}]};
  } catch (e) {
    return {isError: true, content: [{type: "text" as const, text: e instanceof ErroProjeto ? e.message : (e as Error).message}]};
  }
};

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
      fundo: z.string().optional(),
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
      largura: z.number().optional(),
      altura: z.number().optional(),
      forma: z.enum(["retangulo", "elipse"]).optional(),
      cor: z.string().optional(),
      raio: z.number().optional(),
      texto: z.string().optional(),
      fonte: z.string().optional(),
      tamanho: z.number().optional(),
      peso: z.number().optional(),
      alinhar: z.enum(["esquerda", "centro", "direita"]).optional(),
      src: z.string().optional(),
      ajuste: z.enum(["cobrir", "conter"]).optional(),
      tamanho_pixel: z.number().optional(),
      efeito: z.enum(["aleatorio", "decodificar", "varredura", "varredura-baixo", "meio", "chuva"]).optional(),
      semente: z.number().optional(),
    },
  }, seguro((o: {
    documento: string; tipo: TipoCamadaAnimacao; nome?: string; x?: number; y?: number; largura?: number;
    altura?: number; forma?: "retangulo" | "elipse"; cor?: string; raio?: number; texto?: string; fonte?: string;
    tamanho?: number; peso?: number; alinhar?: "esquerda" | "centro" | "direita"; src?: string;
    ajuste?: "cobrir" | "conter"; tamanho_pixel?: number; efeito?: EfeitoPixel; semente?: number;
  }) => {
    const rel = projeto.arquivoDoDocumento(o.documento);
    const {doc, versao} = projeto.lerJson<DocAnimacao>(rel);
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
    description: "Cria ou substitui a trilha de animação de uma propriedade em uma camada (com quadros-chave {t_ms, valor, curva}).",
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
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc, versao} = projeto.lerJson<DocAnimacao>(rel);
    const idx = doc.camadas.findIndex((c) => c.id === camada_id);
    if (idx < 0) throw new ErroProjeto(`camada ${camada_id} não encontrada no documento ${documento}`, "nao_achado");

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
    description: "Converte uma imagem do projeto (em midia/) numa grade de pixel art para a camada pixel indicada.",
    inputSchema: {
      documento: z.string(),
      camada_id: z.string(),
      imagem_src: z.string().describe("caminho da imagem no projeto, ex: midia/foto.png"),
      colunas: z.number().int().min(1).max(128).optional(),
      linhas: z.number().int().min(1).max(128).optional(),
      cores: z.number().int().min(2).max(62).optional(),
      usar_paleta_marca: z.boolean().optional(),
    },
  }, seguro(({documento, camada_id, imagem_src, colunas, linhas, cores, usar_paleta_marca}: {
    documento: string; camada_id: string; imagem_src: string; colunas?: number; linhas?: number;
    cores?: number; usar_paleta_marca?: boolean;
  }) => {
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc, versao} = projeto.lerJson<DocAnimacao>(rel);
    const idx = doc.camadas.findIndex((c) => c.id === camada_id);
    if (idx < 0) throw new ErroProjeto(`camada ${camada_id} não encontrada no documento ${documento}`, "nao_achado");

    const abs = projeto.caminho(imagem_src);
    const buffer = readFileSync(abs);
    const dadosImg = decodificarPng(buffer);

    let paletaAlvo: string[] | undefined;
    if (usar_paleta_marca && doc.tema) {
      paletaAlvo = [doc.tema.fundo, doc.tema.texto, doc.tema.destaque, doc.tema.suave];
    }

    const cols = colunas ?? 16;
    const lins = linhas ?? Math.max(1, Math.round(cols * (dadosImg.altura / dadosImg.largura)));
    const grade = gradeDeImagem(dadosImg, {
      colunas: cols,
      linhas: lins,
      cores: cores ?? 8,
      paleta: paletaAlvo,
    });

    const patch: OperacaoPatch[] = [{op: "add", path: `/camadas/${idx}/grade`, value: grade}];
    const r = projeto.aplicarPatch({documento, versao_base: versao, patch, autor, origem, rotulo: `pixelizar imagem em ${camada_id}`});
    return {ok: true, versao: r.versao, colunas: grade.colunas, linhas: grade.linhas, cores: grade.paleta.length, grade};
  }));

  servidor.registerTool("efeito_pixel", {
    description: "Configura o efeito de revelação determinístico e semente de uma camada pixel, e opcionalmente anima o progresso de 0 a 1.",
    inputSchema: {
      documento: z.string(),
      camada_id: z.string(),
      efeito: z.enum(["aleatorio", "decodificar", "varredura", "varredura-baixo", "meio", "chuva"]),
      semente: z.number().optional(),
      animar_progresso: z.boolean().optional(),
      inicio_ms: z.number().optional(),
      duracao_ms: z.number().optional(),
    },
  }, seguro(({documento, camada_id, efeito, semente, animar_progresso, inicio_ms, duracao_ms}: {
    documento: string; camada_id: string; efeito: EfeitoPixel; semente?: number;
    animar_progresso?: boolean; inicio_ms?: number; duracao_ms?: number;
  }) => {
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc, versao} = projeto.lerJson<DocAnimacao>(rel);
    const idx = doc.camadas.findIndex((c) => c.id === camada_id);
    if (idx < 0) throw new ErroProjeto(`camada ${camada_id} não encontrada no documento ${documento}`, "nao_achado");

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
    return {ok: true, versao: r.versao, efeito, semente: semente ?? 1};
  }));

  servidor.registerTool("ver_animacao", {
    description: "Mostra o resumo do documento de animação e os valores calculados de todas as camadas no instante tempo_ms.",
    inputSchema: {
      documento: z.string(),
      tempo_ms: z.number().min(0).optional(),
    },
  }, seguro(({documento, tempo_ms = 0}: {documento: string; tempo_ms?: number}) => {
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc, versao} = projeto.lerJson<DocAnimacao>(rel);
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
