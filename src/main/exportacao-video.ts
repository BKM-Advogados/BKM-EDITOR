// A exportação do vídeo (vídeo de cenas, carrossel narrado e animação) num módulo só, sem Electron: o diálogo de exportar
// (pelo IPC do main.ts) e as ferramentas exportar_video do MCP (src/nucleo/mcp-exportacao-final.ts) passam por aqui, no app,
// no MCP da IDE e no do Claude Desktop com o app fechado (mcp/nucleo.ts e mcp/desktop.ts, pelo exportacaoStdio). Antes
// morava dentro do handler do IPC, preso ao app (app.getAppPath, a barra de tarefas e o atualizador); quem cria o exportador
// injeta isso agora: `preparar` (navegador e composições, o mesmo prepararRender), `comMidia` (o endereço que serve a pasta
// do projeto: o servidor de mídia do app, ou um aberto só durante a exportação no MCP por stdio), `aoAndamento` (a interface
// e a barra de tarefas) e `aoTerminar` (a barra volta e um reinício para atualizar que esperava segue).
// Sem opções, sai o MP4 H.264 no formato do documento. Com elas, um arquivo por destino: o vídeo de cenas é relativo ao
// quadro, então basta trocar largura e altura nas props; o carrossel narrado e a animação têm tamanho fixo e só aceitam
// escala. Uma exportação por vez (a trava vale para a tela e para o MCP juntos).
import {closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {Progresso, ResultadoExportacao} from '../compartilhado/api';
import {
  argumentosDoRender, destinoDoFormato, encostarTrecho, estimarExportacao, fontesDaMarcaDagua, legendasDasProps, marcaDaguaDoDestino, nomesDosArquivos, trechoValido, type OpcoesExportarVideo,
} from '../nucleo/exportacao';
import {FORMATO_PADRAO, type Formato} from '../nucleo/formatos';
import {legendasNoDestino, type LegendasP} from '../nucleo/legendas';
import {arquivosDeLegendaDoVideo, planoDasLegendas} from '../nucleo/legendas-exportacao';
import {dimensoesDaImagem} from '../nucleo/midia-cabecalho';
import type {Projeto} from '../nucleo/projeto';
import {arquivoLivre} from './exportar-paginas';
import {discoCheio, encerrarRender, faltaEspaco, renderizarVideo, type Preparado} from './exportar';
import {propsDoVideo} from './sessao-projeto';

/** O andamento de um arquivo da exportação: o do Remotion, com o nome do arquivo, a posição dele e a fração geral (0 a 1). */
export type AndamentoExportacao = Progresso & {geral?: number};

export type DepsExportador = {
  /** Navegador de render pronto e composições empacotadas (prepararRender com a raiz do app). */
  preparar: (aviso: (p: Progresso) => void) => Promise<Preparado>;
  /** Roda `f` com o endereço que serve a pasta do projeto (base_midia das props). */
  comMidia: <T>(raiz: string, f: (base: string) => Promise<T>) => Promise<T>;
  /** Cada andamento, de qualquer exportação (no app: a interface e a barra de tarefas). */
  aoAndamento?: (p: AndamentoExportacao) => void;
  /** Ao fim de cada exportação que começou, com ou sem arquivo. */
  aoTerminar?: () => void;
};

export type ExportadorVideo = {
  /** Exporta para saidas/; `aviso` recebe o andamento só desta exportação (o MCP manda ao cliente). */
  exportar: (projeto: Projeto, documento: string, opcoes?: Partial<OpcoesExportarVideo>, aviso?: (p: AndamentoExportacao) => void) => Promise<ResultadoExportacao>;
  /** Para a exportação em andamento (o arquivo pela metade sai de saidas/); sem exportação, nada. */
  cancelar: () => void;
  ocupado: () => boolean;
};

export const tituloDoDocumento = (p: Projeto, id: string) => p.manifesto().documentos.find((d) => d.id === id)?.titulo ?? id;

/** Largura ÷ altura do logo pelo cabeçalho do arquivo (PNG, JPEG, GIF, WebP), para quem não mediu na tela (o MCP). */
const proporcaoDoLogo = (raiz: string, logo: string | undefined) => {
  if (!logo || /^[a-z]+:/i.test(logo)) return undefined;
  const arquivo = path.resolve(raiz, logo);
  if (!existsSync(arquivo)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(arquivo, 'r');
    const b = Buffer.alloc(64 * 1024);
    const n = readSync(fd, b, 0, b.length, 0);
    const d = dimensoesDaImagem(b.subarray(0, n));
    return d && d.largura > 0 && d.altura > 0 ? d.largura / d.altura : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

export const criarExportadorVideo = (deps: DepsExportador): ExportadorVideo => {
  // a exportação em andamento: o cancelar troca de "só marca" para o sinal do Remotion assim que ele existe
  let ativa: {cancelar: () => void; cancelada: boolean} | null = null;

  const exportar: ExportadorVideo['exportar'] = async (p, documento, opcoes, avisoDaChamada) => {
    if (ativa) return {ok: false, mensagem: 'já há uma exportação em andamento'};
    const esta = {cancelada: false, cancelar: () => void (esta.cancelada = true)};
    ativa = esta;
    const emitir = (x: AndamentoExportacao) => {
      deps.aoAndamento?.(x);
      avisoDaChamada?.(x);
    };
    let comecou = false;
    try {
      return await deps.comMidia(p.raiz, async (base): Promise<ResultadoExportacao> => {
        const montado = propsDoVideo(p, documento, base);
        if ('erro' in montado) return {ok: false, mensagem: montado.erro};
        comecou = true;
        const props = montado.props;
        const formato: Formato = {largura: Number(props.largura) || FORMATO_PADRAO.largura, altura: Number(props.altura) || FORMATO_PADRAO.altura, fps: Number(props.fps) || FORMATO_PADRAO.fps};
        // a animação, como o carrossel, tem tamanho fixo (camadas em pixels): o diálogo só oferece o tamanho dela e a escala vai no `scale` do render
        const fixo = props.composicao !== 'VideoCenas';
        const o: OpcoesExportarVideo = {codec: 'h264', qualidade: 'alta', escala: 1, ...opcoes,
          destinos: fixo || !opcoes?.destinos?.length ? [destinoDoFormato(formato)] : opcoes.destinos};
        const pasta = p.pastaDeSaidas(); // saidas/ por link para outro disco grava lá (a exceção, em Projeto.pastaDeSaidas)
        mkdirSync(pasta, {recursive: true});
        // o diálogo só manda trecho válido; o MCP pode mandar qualquer um, e trecho fora do vídeo não vira o vídeo inteiro calado
        const duracaoMs = Number(props.duracao_ms) || 0;
        if (o.trecho && !trechoValido(encostarTrecho(o.trecho, duracaoMs), duracaoMs)) {
          return {ok: false, mensagem: `trecho inválido: de ${o.trecho.de_ms} a ${o.trecho.ate_ms} ms, num vídeo de ${duracaoMs} ms (pelo menos 100 ms, dentro do vídeo)`};
        }
        if (o.trecho) o.trecho = encostarTrecho(o.trecho, duracaoMs);
        const planos = nomesDosArquivos(o.nome?.trim() || tituloDoDocumento(p, documento), o.destinos, formato);
        const comAudio = fixo || Boolean(['audio', 'trilha', 'narracao', 'sons'].some((k) => (Array.isArray(props[k]) ? (props[k] as unknown[]).length > 0 : Boolean(props[k]))));
        const {makeCancelSignal} = await import('@remotion/renderer');
        const {cancelSignal, cancel} = makeCancelSignal();
        esta.cancelar = () => {
          esta.cancelada = true;
          cancel();
        };
        if (esta.cancelada) cancel();
        const arquivos: string[] = [];
        const avisos: string[] = [];
        let parcial: string | undefined;
        // o andamento de cada arquivo leva o nome dele; `geral` é a fração da exportação inteira (a barra de tarefas)
        const avisoDe = (indice: number, arquivo: string) => (x: Progresso) =>
          emitir({...x, arquivo, indice: indice + 1, total: planos.length,
            ...(x.tipo === 'progresso' && x.progresso !== undefined ? {geral: (indice + x.progresso / 100) / planos.length} : {})});
        const fontesMarca = fontesDaMarcaDagua(props);
        const proporcaoLogo = o.proporcao_logo ?? proporcaoDoLogo(p.raiz, fontesMarca.logo);
        let preparado: Preparado | null = null;
        try {
          if (esta.cancelada) throw new Error('cancelado');
          const semEspaco = await faltaEspaco(pasta, estimarExportacao(o, formato, Number(props.duracao_ms) || 0, comAudio).porDestino.map((d) => d.bytes), comAudio);
          if (semEspaco) throw new Error(semEspaco);
          const pronto = await deps.preparar(avisoDe(0, ''));
          preparado = pronto;
          for (const [i, plano] of planos.entries()) {
            const args = argumentosDoRender(o, plano.destino, formato, Number(props.duracao_ms) || 0);
            const destino = arquivoLivre(pasta, plano.nome, args.ext);
            parcial = destino;
            // legendas na área segura e na quebra do destino, não do documento (frente Fala; a área fica em legendas_cenas.area)
            // queimar, só o SRT ou os dois, por destino (frente Fala); no 16:9 com o SRT junto, acima das legendas do YouTube
            const planoLeg = planoDasLegendas(o.legendas?.[plano.destino.id], args);
            const legendas = !fixo && props.legendas_cenas ? legendasNoDestino(props.legendas_cenas as LegendasP, args.largura, args.altura, formato,
              {legendas_youtube: planoLeg.legendas_youtube}) : undefined;
            const propsDestino = {...(fixo ? props : {...props, largura: args.largura, altura: args.altura}),
              ...(legendas ? {legendas_cenas: planoLeg.queimar ? legendas : {...legendas, oculto: true}} : {})};
            // marca d'água do destino, se ligada: posicionada no tamanho do destino, em frações (vale com qualquer escala), fora
            // da legenda que vai neste render (a das props do destino, já recalculada acima)
            const marca = marcaDaguaDoDestino(o.marca_dagua?.[plano.destino.id], plano.destino, fontesMarca, proporcaoLogo, legendasDasProps(propsDestino), o.proporcao_texto);
            await renderizarVideo(pronto, {
              props: {...propsDestino, ...(marca ? {marca_dagua: marca} : {})},
              arquivo: destino, codec: args.codec, videoBitrate: args.videoBitrate, escala: fixo ? args.escala : 1, quadros: args.frameRange, cancelSignal, avisos,
            }, avisoDe(i, path.basename(destino)));
            arquivos.push(destino);
            parcial = undefined;
            // o SRT ao lado do vídeo, com o mesmo nome (e o .pt_BR.srt do Facebook e o .vtt), sem gravar por cima (frente Fala)
            if (planoLeg.srt && legendas && !legendas.oculto) {
              for (const a of arquivosDeLegendaDoVideo(path.basename(destino, `.${args.ext}`), legendas.segmentos, args.frameRange ? o.trecho : null, (n) => existsSync(path.join(pasta, n)))) {
                writeFileSync(path.join(pasta, a.nome), a.texto, 'utf-8');
                arquivos.push(path.join(pasta, a.nome));
              }
            }
          }
          emitir({tipo: 'status', mensagem: `Exportado: ${arquivos.map((a) => path.relative(p.raiz, a)).join(', ')}${avisos.length ? `. Atenção: ${avisos.join('; ')}` : ''}`});
          return {ok: true, arquivo: arquivos[0], arquivos, pasta, ...(avisos.length ? {avisos} : {})};
        } catch (e) {
          const mensagem = discoCheio((e as Error).message) ? 'o disco encheu durante a exportação; libere espaço e tente de novo' : (e as Error).message;
          const cancelado = esta.cancelada || /cancel/i.test(mensagem);
          if (parcial) rmSync(parcial, {force: true}); // o arquivo pela metade não fica em saidas/
          emitir({tipo: 'status', mensagem: cancelado ? 'Exportação cancelada' : `Falhou: ${mensagem}`});
          return {ok: false, cancelado, mensagem: cancelado ? 'Exportação cancelada' : mensagem, arquivos, pasta, ...(avisos.length ? {avisos} : {})};
        } finally {
          await encerrarRender(preparado); // o Chrome que serviu a todos os destinos
        }
      });
    } finally {
      ativa = null;
      if (comecou) deps.aoTerminar?.();
    }
  };

  return {
    exportar,
    cancelar: () => ativa?.cancelar(),
    ocupado: () => ativa !== null,
  };
};
