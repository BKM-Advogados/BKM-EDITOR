// Testes de integração das ferramentas MCP de Animação
import {execSync} from "node:child_process";
import {cpSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";

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
  cpSync(path.join(RAIZ, "exemplos", "exemplo"), pasta, {recursive: true, filter: (f) => !f.endsWith(".mp4")});
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
      imagem_src: "midia/logo-exemplo.png",
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
