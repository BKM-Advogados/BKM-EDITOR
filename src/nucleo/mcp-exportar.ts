// Ferramentas do MCP da exportação (frente C, docs/exportacao.md): marca_dagua lê e muda a marca d'água de um destino e
// medir_contraste_marca confere, num quadro de verdade, se ela lê (3:1) sobre o fundo onde cai. Registradas por uma linha no fim de
// registrarFerramentas (src/nucleo/ferramentas-mcp.ts). Sem z.any nem união solta: o Gemini e o modo strict do DeepSeek recusam.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {medidorDeContraste, textoDoContraste} from './contraste';
import {configPadraoMarca, OPACIDADE_MARCA, TAMANHO_MARCA, CANTOS_MARCA, type ConfigMarcaDagua} from './exportacao';
import {FORMATOS_VIDEO} from './formatos';
import {gravarPrefsExportacaoNoDiario, lerPrefsExportacao} from './prefs-exportacao';
import {ErroProjeto, type Projeto} from './projeto';

// as mesmas três linhas de ferramentas-mcp.ts: o resultado em texto e o erro com o código do projeto
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

const DESTINOS: [string, ...string[]] = ['reels', ...FORMATOS_VIDEO.map((f) => f.id).filter((id) => id !== 'reels'), 'personalizado'];
const CANTOS = CANTOS_MARCA.map((c) => c.id) as [string, ...string[]];
const br = (n: number) => String(n).replace('.', ',');

const campos = {
  ligada: z.boolean().optional().describe('true liga a marca neste destino; false desliga'),
  conteudo: z.enum(['logo', 'assinatura']).optional().describe('logo ou assinatura (o texto do @ do kit)'),
  canto: z.enum(CANTOS).optional().describe('sup-esq, sup-dir, inf-esq ou inf-dir'),
  tamanho: z.number().min(TAMANHO_MARCA.min).max(TAMANHO_MARCA.max).optional().describe(`altura da marca, fração do lado menor do quadro (${br(TAMANHO_MARCA.min)} a ${br(TAMANHO_MARCA.max)}; padrão ${br(TAMANHO_MARCA.padrao)})`),
  opacidade: z.number().min(OPACIDADE_MARCA.min).max(OPACIDADE_MARCA.max).optional().describe(`de ${br(OPACIDADE_MARCA.min)} a ${br(OPACIDADE_MARCA.max)} (padrão ${br(OPACIDADE_MARCA.padrao)})`),
  placa: z.enum(['escura', 'clara', 'nenhuma']).optional().describe('placa atrás da marca para dar contraste com o fundo; "nenhuma" tira a placa'),
};
type Mudanca = {ligada?: boolean; conteudo?: 'logo' | 'assinatura'; canto?: string; tamanho?: number; opacidade?: number; placa?: 'escura' | 'clara' | 'nenhuma'};

/** A config com a mudança por cima: campo ausente fica como estava; placa "nenhuma" tira a placa. */
const comMudanca = (base: ConfigMarcaDagua, m: Mudanca): ConfigMarcaDagua => {
  const {placa: _placa, ...resto} = base;
  const nova = {...resto, ...(m.ligada !== undefined ? {ligada: m.ligada} : {}), ...(m.conteudo ? {conteudo: m.conteudo} : {}), ...(m.canto ? {canto: m.canto as ConfigMarcaDagua['canto']} : {}),
    ...(m.tamanho !== undefined ? {tamanho: m.tamanho} : {}), ...(m.opacidade !== undefined ? {opacidade: m.opacidade} : {})} satisfies ConfigMarcaDagua;
  const placa = m.placa === undefined ? base.placa : m.placa === 'nenhuma' ? undefined : m.placa;
  return placa ? {...nova, placa} : nova;
};
const algumaMudanca = (m: Mudanca) => Object.values(m).some((v) => v !== undefined);

const presetDoDestino = (id: string) => FORMATOS_VIDEO.find((f) => f.id === id);
const baseDoDestino = (projeto: Projeto, destino: string) =>
  lerPrefsExportacao(projeto).marca_dagua?.[destino] ?? configPadraoMarca(presetDoDestino(destino) ?? FORMATOS_VIDEO[0]);

export const registrarExportar = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('marca_dagua', {
    description: 'Lê ou muda a marca d\'água de um destino do vídeo (logo ou assinatura do kit, canto, tamanho, opacidade e placa atrás). Fica em .estudio/exportacao.json, entra no Histórico e vale na próxima exportação; o diálogo de exportar mostra a mesma escolha. Sem nenhum campo de mudança, só mostra o que está gravado (ou o padrão, desligada). Destinos: ' + DESTINOS.join(', ') + '. Sem logo nem assinatura no kit, a exportação sai sem marca.',
    inputSchema: {destino: z.enum(DESTINOS).describe('id do destino: reels (9:16), feed (4:5), quadrado (1:1), youtube (16:9) ou personalizado'), ...campos},
  }, seguro(({destino, ...mudar}: {destino: string} & Mudanca) => {
    const gravada = lerPrefsExportacao(projeto).marca_dagua?.[destino];
    const antes = gravada ?? configPadraoMarca(presetDoDestino(destino) ?? FORMATOS_VIDEO[0]);
    if (!algumaMudanca(mudar)) return {destino, gravada: Boolean(gravada), marca: antes};
    const nova = comMudanca(antes, mudar);
    const depois = gravarPrefsExportacaoNoDiario(projeto, {marca_dagua: {[destino]: nova}}, {autor, origem, rotulo: `marca d'água de ${destino}`});
    const marca = depois.marca_dagua?.[destino] ?? nova;
    return {
      destino, gravada: true, marca, antes,
      ...(marca.ligada ? {proximo_passo: `medir_contraste_marca confere o contraste de 3:1 num quadro (só com o app aberto)`} : {}),
    };
  }));

  servidor.registerTool('medir_contraste_marca', {
    description: 'Mede o contraste da marca d\'água com o fundo onde ela cai, em três quadros do vídeo (25%, 50% e 75%): renderiza o destino sem a marca e com ela e lê os pixels. O mínimo é 3:1 e o pior quadro manda. Mede a marca gravada para o destino (marca_dagua); os campos opcionais testam outra escolha sem gravar. Só com o app do Estúdio aberto; leva alguns segundos por quadro. Não grava nada.',
    inputSchema: {
      documento: z.string().describe('id do documento de vídeo (cenas ou carrossel narrado)'),
      destino: z.enum(['reels', 'feed', 'quadrado', 'youtube']).describe('id do destino'),
      ...campos,
    },
  }, seguro(async ({documento, destino, ...teste}: {documento: string; destino: string} & Mudanca) => {
    const medir = medidorDeContraste();
    if (!medir) throw new Error('medir o contraste só funciona com o app do Estúdio aberto: os quadros são renderizados por ele');
    projeto.arquivoDoDocumento(documento); // erro claro se o documento não existe
    const preset = presetDoDestino(destino);
    if (!preset) throw new ErroProjeto(`destino desconhecido: ${destino}`, 'nao_achado');
    const config = {...comMudanca(baseDoDestino(projeto, destino), teste), ligada: true};
    const r = await medir(documento, {destino: {id: preset.id, largura: preset.largura, altura: preset.altura}, config});
    if (!r.ok) throw new Error(r.mensagem);
    const aviso = algumaMudanca(teste) ? '\n(Medida com a escolha pedida, que não foi gravada.)' : '';
    return textoDoContraste(r.avaliacao, destino, config.placa) + aviso;
  }));
};
