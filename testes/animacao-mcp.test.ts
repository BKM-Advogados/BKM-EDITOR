// Testes de integração das ferramentas MCP de Animação
import {execSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {png8} from "./apoio/png-teste";

const RAIZ = path.join(__dirname, "..");
let pasta = "";
let cliente: Client;

const chamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const t = r.content[0].text;
  let dado: unknown = t;
  try {
    dado = JSON.parse(t);
  } catch {
    /* texto simples */
  }
  return {erro: Boolean(r.isError), dado: dado as any};
};

beforeAll(async () => {
  execSync("npm run mcp:build", {cwd: RAIZ, stdio: "ignore"});
  pasta = mkdtempSync(path.join(tmpdir(), "estudio-anim-mcp-"));
  cpSync(path.join(RAIZ, "testes", "fixtures", "projeto"), pasta, {recursive: true, filter: (f) => !f.endsWith(".mp4")});
  cliente = new Client({name: "teste-animacao", version: "0"});
  const env = Object.fromEntries(
    Object.entries({...process.env, ESTUDIO_MARCAS: path.join(pasta, ".marcas-teste")}).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
  await cliente.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(RAIZ, "dist-mcp", "nucleo.cjs"), "--projeto", pasta],
      env,
    })
  );
}, 60_000);

afterAll(async () => {
  await cliente?.close();
  rmSync(pasta, {recursive: true, force: true});
});

describe("Ferramentas MCP de Animação", () => {
  let docId = "";

  it("criar_animacao cria documento e adiciona ao manifesto", async () => {
    const {erro, dado} = await chamar("criar_animacao", {
      titulo: "Minha Animação",
      largura: 1920,
      altura: 1080,
      fps: 30,
      duracao_ms: 3000,
      fundo: "#111418",
    });
    expect(erro).toBe(false);
    expect(dado.ok).toBe(true);
    expect(dado.documento).toBeDefined();
    docId = dado.documento;
  });

  it("adicionar_camada_animacao cria forma, texto e pixel", async () => {
    const r1 = await chamar("adicionar_camada_animacao", {
      documento: docId,
      tipo: "forma",
      nome: "Quadrado",
      x: 100,
      y: 100,
      largura: 200,
      altura: 200,
      forma: "retangulo",
      cor: "#70B8FF",
    });
    expect(r1.erro).toBe(false);
    expect(r1.dado.camada_id).toBeDefined();

    const r2 = await chamar("adicionar_camada_animacao", {
      documento: docId,
      tipo: "texto",
      nome: "Título",
      texto: "Olá Estúdio",
      tamanho: 48,
      cor: "#FFFFFF",
    });
    expect(r2.erro).toBe(false);

    const r3 = await chamar("adicionar_camada_animacao", {
      documento: docId,
      tipo: "pixel",
      nome: "Arte Pixel",
      tamanho_pixel: 10,
    });
    expect(r3.erro).toBe(false);
    expect(r3.dado.camada_id).toBeDefined();
  });

  it("animar adiciona trilha com curvas de interpolação", async () => {
    const {dado: ver} = await chamar("ver_animacao", {documento: docId, tempo_ms: 0});
    const forma = ver.camadas.find((c: any) => c.nome === "Quadrado");
    expect(forma).toBeDefined();

    const r = await chamar("animar", {
      documento: docId,
      camada_id: forma.id,
      propriedade: "x",
      quadros: [
        {t_ms: 0, valor: 100, curva: "suave"},
        {t_ms: 1000, valor: 500, curva: "mola"},
      ],
    });
    expect(r.erro).toBe(false);
    expect(r.dado.ok).toBe(true);
  });

  it("pixelizar_imagem converte PNG do projeto em grade de pixel", async () => {
    const {dado: ver} = await chamar("ver_animacao", {documento: docId, tempo_ms: 0});
    const pixel = ver.camadas.find((c: any) => c.tipo === "pixel");
    expect(pixel).toBeDefined();

    const r = await chamar("pixelizar_imagem", {
      documento: docId,
      camada_id: pixel.id,
      imagem_src: "midia/logo.png",
      colunas: 16,
      linhas: 16,
      cores: 4,
    });
    expect(r.erro).toBe(false);
    expect(r.dado.colunas).toBe(16);
    expect(r.dado.grade.celulas).toHaveLength(256);
  });

  it("efeito_pixel define revelação e anima progresso", async () => {
    const {dado: ver} = await chamar("ver_animacao", {documento: docId, tempo_ms: 0});
    const pixel = ver.camadas.find((c: any) => c.tipo === "pixel");
    expect(pixel).toBeDefined();

    const r = await chamar("efeito_pixel", {
      documento: docId,
      camada_id: pixel.id,
      efeito: "decodificar",
      semente: 123,
      animar_progresso: true,
      inicio_ms: 0,
      duracao_ms: 2000,
    });
    expect(r.erro).toBe(false);
    expect(r.dado.efeito).toBe("decodificar");
  });

  it("ver_animacao avalia valores no tempo solicitado", async () => {
    const {erro, dado} = await chamar("ver_animacao", {documento: docId, tempo_ms: 500});
    expect(erro).toBe(false);
    expect(dado.tempo_ms).toBe(500);
    expect(dado.camadas.length).toBeGreaterThanOrEqual(3);
    const forma = dado.camadas.find((c: any) => c.nome === "Quadrado");
    expect(forma.x).toBeGreaterThan(100);
    expect(forma.x).toBeLessThan(500);
  });
});

describe("Validação das ferramentas de Animação (M3, M5, M6, M7, M17)", () => {
  let docId = "";
  let pixelId = "";
  const lerDoc = (rel: string) => readFileSync(path.join(pasta, rel), "utf-8");
  const caminhoDoc = () => `animacao/${docId}.json`;

  beforeAll(async () => {
    const r = await chamar("criar_animacao", {titulo: "Validação"});
    docId = r.dado.documento;
    pixelId = (await chamar("adicionar_camada_animacao", {documento: docId, tipo: "pixel"})).dado.camada_id;
    mkdirSync(path.join(pasta, "midia"), {recursive: true});
    writeFileSync(path.join(pasta, "midia", "alta.png"), png8(10, 100, 2, (_x, y) => (y < 50 ? [255, 0, 0] : [0, 0, 255])));
    writeFileSync(path.join(pasta, "midia", "grande.png"), png8(64, 64, 2, (x) => (x < 32 ? [0, 0, 0] : [255, 255, 255])));
  });

  it("M3: as cinco ferramentas recusam documento que não é animação, sem mexer no arquivo", async () => {
    const antes = lerDoc("imagem/capa.json");
    for (const documento of ["capa", "carrossel"]) {
      const chamadas: [string, Record<string, unknown>][] = [
        ["adicionar_camada_animacao", {documento, tipo: "pixel"}],
        ["animar", {documento, camada_id: "x", propriedade: "x", quadros: [{t_ms: 0, valor: 1}]}],
        ["pixelizar_imagem", {documento, camada_id: "x", imagem_src: "midia/logo.png"}],
        ["efeito_pixel", {documento, camada_id: "x", efeito: "chuva"}],
        ["ver_animacao", {documento}],
      ];
      for (const [nome, args] of chamadas) {
        const r = await chamar(nome, args);
        expect(r.erro, `${nome} em ${documento}`).toBe(true);
        expect(String(r.dado)).toMatch(/patch: .*não é uma animação/);
      }
    }
    expect(lerDoc("imagem/capa.json")).toBe(antes);
  });

  it("M5: tipo e faixa por propriedade no animar; cor e tamanhos no esquema", async () => {
    const antes = lerDoc(caminhoDoc());
    const casos: [string, unknown[]][] = [
      ["x", ["abc", 500]],
      ["cor", [7, "#FF0000"]],
      ["opacidade", [-3, 40]],
      ["progresso", [0, 2]],
      ["tamanho_pixel", [0, 8]],
      ["cor", ["banana", "#FF0000"]],
    ];
    for (const [propriedade, valores] of casos) {
      const r = await chamar("animar", {documento: docId, camada_id: "forma-1", propriedade,
        quadros: valores.map((valor, i) => ({t_ms: i * 1000, valor}))});
      expect(r.erro, `${propriedade} ${JSON.stringify(valores)}`).toBe(true);
    }
    expect((await chamar("adicionar_camada_animacao", {documento: docId, tipo: "pixel", tamanho_pixel: 0})).erro).toBe(true);
    expect((await chamar("adicionar_camada_animacao", {documento: docId, tipo: "forma", largura: -50})).erro).toBe(true);
    expect((await chamar("adicionar_camada_animacao", {documento: docId, tipo: "forma", cor: "banana"})).erro).toBe(true);
    expect((await chamar("criar_animacao", {fundo: "banana"})).erro).toBe(true);
    expect(lerDoc(caminhoDoc())).toBe(antes);
    // entrada de fora do quadro e cor do tema seguem valendo
    expect((await chamar("animar", {documento: docId, camada_id: "forma-1", propriedade: "x", quadros: [{t_ms: 0, valor: -200}, {t_ms: 500, valor: 100}]})).erro).toBe(false);
    expect((await chamar("animar", {documento: docId, camada_id: "forma-1", propriedade: "cor", quadros: [{t_ms: 0, valor: "@destaque"}, {t_ms: 500, valor: "#f00"}]})).erro).toBe(false);
  });

  it("M6: efeito_pixel só em camada pixel, tempos válidos e a semente devolvida é a gravada", async () => {
    const forma = await chamar("efeito_pixel", {documento: docId, camada_id: "forma-1", efeito: "chuva"});
    expect(forma.erro).toBe(true);
    expect(String(forma.dado)).toMatch(/é forma/);
    expect((await chamar("efeito_pixel", {documento: docId, camada_id: pixelId, efeito: "chuva", animar_progresso: true, duracao_ms: -2000})).erro).toBe(true);
    expect((await chamar("efeito_pixel", {documento: docId, camada_id: pixelId, efeito: "chuva", animar_progresso: true, inicio_ms: -500})).erro).toBe(true);
    await chamar("efeito_pixel", {documento: docId, camada_id: pixelId, efeito: "meio", semente: 77});
    const r = await chamar("efeito_pixel", {documento: docId, camada_id: pixelId, efeito: "chuva"});
    expect(r.dado.semente).toBe(77);
  });

  it("M7: pixelizar só em camada pixel, linhas até o teto, paleta sem cor repetida e resposta enxuta", async () => {
    const forma = await chamar("pixelizar_imagem", {documento: docId, camada_id: "forma-1", imagem_src: "midia/logo.png"});
    expect(forma.erro).toBe(true);
    expect(String(forma.dado)).toMatch(/é forma/);

    const alta = await chamar("pixelizar_imagem", {documento: docId, camada_id: pixelId, imagem_src: "midia/alta.png", colunas: 128, cores: 8});
    expect(alta.erro).toBe(false);
    expect(alta.dado.linhas).toBeLessThanOrEqual(128);
    expect(alta.dado.cores).toBe(2);
    expect(new Set(alta.dado.paleta).size).toBe(alta.dado.paleta.length);
    expect(alta.dado.grade).toBeUndefined();
    expect(JSON.stringify(alta.dado).length).toBeLessThan(20_000);
    expect(alta.dado.avisos.join(" ")).toMatch(/limitei a 128/);

    const semKit = await chamar("pixelizar_imagem", {documento: docId, camada_id: pixelId, imagem_src: "midia/grande.png", colunas: 8, linhas: 8, usar_paleta_marca: true});
    expect(semKit.erro).toBe(false);
    expect(semKit.dado.grade.celulas).toHaveLength(64);
    expect(semKit.dado.avisos.join(" ")).toMatch(/não tem kit/);
  });

  it("M8: pixelizar_imagem aceita JPG pelo ffmpeg do app e recusa o que não é imagem com erro claro", async () => {
    const r = await chamar("pixelizar_imagem", {documento: docId, camada_id: pixelId, imagem_src: "midia/foto.jpg", colunas: 12, cores: 4});
    expect(r.erro, String(r.dado)).toBe(false);
    expect(r.dado.colunas).toBe(12);
    expect(r.dado.linhas).toBe(Math.round(12 * 760 / 1080));
    writeFileSync(path.join(pasta, "midia", "nada.png"), "isto não é uma imagem");
    const ruim = await chamar("pixelizar_imagem", {documento: docId, camada_id: pixelId, imagem_src: "midia/nada.png"});
    expect(ruim.erro).toBe(true);
    expect(String(ruim.dado)).toMatch(/midia\/nada\.png: arquivo não é um PNG; o ffmpeg não conseguiu ler a imagem/);
  });

  it("M17: id de camada repetido é recusado", async () => {
    const doc = JSON.parse(lerDoc(caminhoDoc()));
    const r0 = await chamar("ler_documento", {documento: docId});
    const versao = r0.dado.versao;
    const copia = {...doc.camadas[0]};
    const p = await chamar("aplicar_patch", {documento: docId, versao_base: versao, patch: [{op: "add", path: "/camadas/-", value: copia}]});
    expect(p.erro).toBe(false);
    const r = await chamar("animar", {documento: docId, camada_id: copia.id, propriedade: "x", quadros: [{t_ms: 0, valor: 1}]});
    expect(r.erro).toBe(true);
    expect(String(r.dado)).toMatch(/está em 2 camadas/);
  });
});
