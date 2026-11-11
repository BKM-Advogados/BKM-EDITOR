// A mídia do projeto no disco (frente Casca, rodada 3): lista midia/, lê duração e dimensões do cabeçalho, junta as marcas das
// tomadas e diz quais documentos usam cada arquivo. Serve ao painel de mídia (IPC em src/main/ipc-midia.ts) e à ferramenta
// `listar_midia` (src/nucleo/mcp-midia.ts). As regras de agrupar, buscar e marcar são de midia.ts, que não toca o disco.
import {closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync} from 'node:fs';
import path from 'node:path';
import jsonpatch from 'fast-json-patch';
import type {OperacaoPatch} from './documentos';
import {
  ARQUIVO_MARCAS_MIDIA, classificarDerivado, comMarca, lerMarcasDeMidia, marcasVazias, montarIndice, pastasDaMidia, tipoDaMidia,
  type ArquivoBruto, type EstadoDaTomada, type IndiceDaMidia, type MarcaDeMidia, type MarcasDeMidia,
} from './midia';
import {dimensoesDaImagem, duracaoDeMp4, duracaoDeWav} from './midia-cabecalho';
import {ErroProjeto, serializar, versaoDe, type Projeto} from './projeto';

const PASTA = 'midia';
const PROFUNDIDADE = 4;
const BYTES_DO_CABECALHO = 64 * 1024;
const COM_DIMENSOES = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const COM_MP4 = ['mp4', 'mov', 'm4v', 'm4a'];

type Cabecalho = {duracao_ms?: number; largura?: number; altura?: number};

// o cabeçalho de um arquivo não muda enquanto tamanho e data não mudam: lido uma vez por sessão
const cabecalhos = new Map<string, Cabecalho>();

const lerCabecalho = (abs: string, rel: string, tamanho: number): Cabecalho => {
  const ext = rel.includes('.') ? rel.slice(rel.lastIndexOf('.') + 1).toLowerCase() : '';
  const fd = openSync(abs, 'r');
  try {
    const ler = (posicao: number, n: number) => {
      const buf = Buffer.alloc(Math.min(n, Math.max(0, tamanho - posicao)));
      const lidos = buf.length ? readSync(fd, buf, 0, buf.length, posicao) : 0;
      return new Uint8Array(buf.buffer, buf.byteOffset, lidos);
    };
    if (COM_DIMENSOES.includes(ext)) {
      const d = dimensoesDaImagem(ler(0, BYTES_DO_CABECALHO));
      return d ? {largura: d.largura, altura: d.altura} : {};
    }
    if (ext === 'wav') {
      const ms = duracaoDeWav(ler(0, 4096), tamanho);
      return ms === null ? {} : {duracao_ms: ms};
    }
    if (COM_MP4.includes(ext)) {
      const ms = duracaoDeMp4(ler, tamanho);
      return ms === null ? {} : {duracao_ms: ms};
    }
    return {};
  } finally {
    closeSync(fd);
  }
};

/** Os arquivos de midia/ (até 4 níveis de pasta) com tamanho, data e o que o cabeçalho diz. A duração de áudio sem cabeçalho
 *  legível vem do envelope medido ao lado, quando há. */
export const listarMidiaBruta = (raiz: string): ArquivoBruto[] => {
  const saida: ArquivoBruto[] = [];
  const andar = (rel: string, nivel: number) => {
    let itens;
    try {
      itens = readdirSync(path.join(raiz, rel), {withFileTypes: true});
    } catch {
      return;
    }
    for (const item of itens) {
      const relItem = `${rel}/${item.name}`;
      if (item.isDirectory()) {
        if (nivel < PROFUNDIDADE) andar(relItem, nivel + 1);
        continue;
      }
      if (!item.isFile() || relItem.endsWith('.tmp')) continue;
      try {
        const abs = path.join(raiz, relItem);
        const st = statSync(abs);
        const chave = `${abs}|${st.size}|${st.mtimeMs}`;
        let c = cabecalhos.get(chave);
        if (!c) {
          try {
            c = lerCabecalho(abs, relItem, st.size);
          } catch {
            c = {};
          }
          if (cabecalhos.size >= 5000) cabecalhos.delete(cabecalhos.keys().next().value!);
          cabecalhos.set(chave, c);
        }
        saida.push({rel: relItem, tamanho: st.size, modificado_ms: Math.round(st.mtimeMs), ...c});
      } catch {
        /* sumiu entre a lista e a medida */
      }
    }
  };
  if (existsSync(path.join(raiz, PASTA))) andar(PASTA, 1);
  // áudio que o cabeçalho não diz (MP3, OGG): a duração do envelope medido
  const nomes = new Set(saida.map((a) => a.rel));
  for (const a of saida) {
    if (a.duracao_ms !== undefined || tipoDaMidia(a.rel) !== 'audio' || !nomes.has(`${a.rel}.envelope.json`)) continue;
    try {
      const env = JSON.parse(readFileSync(path.join(raiz, `${a.rel}.envelope.json`), 'utf-8')) as {duracao_ms?: unknown};
      if (typeof env.duracao_ms === 'number' && env.duracao_ms > 0) a.duracao_ms = Math.round(env.duracao_ms);
    } catch {
      /* envelope quebrado: a interface mede de novo */
    }
  }
  return saida;
};

// ---------- marcas das tomadas ----------
export const lerMarcasDoProjeto = (p: Projeto): MarcasDeMidia => {
  try {
    return p.existe(ARQUIVO_MARCAS_MIDIA) ? lerMarcasDeMidia(JSON.parse(p.lerTexto(ARQUIVO_MARCAS_MIDIA))) : marcasVazias();
  } catch {
    return marcasVazias(); // marcas.json quebrado não esconde a mídia
  }
};

export const indiceDaMidia = (p: Projeto): IndiceDaMidia => {
  const entradas = montarIndice(listarMidiaBruta(p.raiz), lerMarcasDoProjeto(p));
  return {entradas, pastas: pastasDaMidia(entradas), total: entradas.length, tamanho_total: entradas.reduce((s, e) => s + e.tamanho + e.derivados.reduce((t, d) => t + d.tamanho, 0), 0)};
};

/** Marca ou desmarca uma tomada (estado `boa` ou `descartada`, e uma nota). Grava midia/marcas.json e registra no diário com o
 *  patch e o inverso, como a pesquisa: quem mudou e o que aparece no Histórico. Recusa arquivo que não está em midia/. */
export const marcarMidia = (
  p: Projeto,
  caminho: string,
  mudanca: {estado?: EstadoDaTomada | null; nota?: string},
  quem: {autor: string; origem: string},
): {seq: number; documento: string; caminho: string; marca: MarcaDeMidia | null} => p.comTrava(() => {
  const rel = path.posix.normalize(caminho.replace(/\\/g, '/'));
  if (!rel.startsWith(`${PASTA}/`) || rel === ARQUIVO_MARCAS_MIDIA) throw new ErroProjeto(`só se marca arquivo de ${PASTA}/: ${caminho}`, 'caminho');
  const entradas = indiceDaMidia(p).entradas;
  if (!entradas.some((e) => e.caminho === rel)) {
    if (!p.existe(rel)) throw new ErroProjeto(`arquivo não achado em ${PASTA}/: ${caminho}`, 'nao_achado');
    const dono = classificarDerivado(rel);
    throw new ErroProjeto(`${rel} é um arquivo gerado${dono ? ` a partir de ${dono.origem}` : ''}: marque o original`, 'caminho');
  }
  const textoAntes = p.existe(ARQUIVO_MARCAS_MIDIA) ? p.lerTexto(ARQUIVO_MARCAS_MIDIA) : serializar(marcasVazias());
  const antes = lerMarcasDoProjeto(p);
  const depois = comMarca(antes, rel, mudanca);
  const texto = serializar(depois);
  p.gravarTexto(ARQUIVO_MARCAS_MIDIA, texto);
  const seq = p.ultimaSeq() + 1;
  const marca = depois.marcas[rel] ?? null;
  const rotulo = mudanca.estado === 'boa' ? `tomada boa: ${rel}` : mudanca.estado === 'descartada' ? `tomada descartada: ${rel}` : mudanca.estado === null ? `sem marca: ${rel}` : `nota em ${rel}`;
  p.registrar({
    seq,
    em: new Date().toISOString(),
    documento: ARQUIVO_MARCAS_MIDIA,
    autor: quem.autor,
    origem: quem.origem,
    rotulo,
    versao_antes: versaoDe(textoAntes),
    versao_depois: versaoDe(texto),
    patch: jsonpatch.compare(antes, depois) as OperacaoPatch[],
    inverso: jsonpatch.compare(depois, antes) as OperacaoPatch[],
  });
  return {seq, documento: ARQUIVO_MARCAS_MIDIA, caminho: rel, marca};
});

// ---------- onde cada arquivo é usado ----------
/** Ids dos documentos do manifesto cujo JSON cita o caminho como valor (entre aspas), por arquivo pedido. */
export const documentosQueUsam = (p: Projeto, caminhos: string[]): Record<string, string[]> => {
  const saida: Record<string, string[]> = {};
  let documentos: {id: string; caminho: string}[] = [];
  try {
    documentos = p.manifesto().documentos;
  } catch {
    return saida;
  }
  for (const d of documentos) {
    let texto = '';
    try {
      texto = p.lerTexto(d.caminho);
    } catch {
      continue;
    }
    for (const c of caminhos) if (texto.includes(`"${c}"`)) (saida[c] ??= []).push(d.id);
  }
  return saida;
};
