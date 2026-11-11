// A narração de verdade dos scripts de medida da fala (transcrição, detector de voz, limpeza, som e legendas). O repositório
// não traz gravação de voz: aponte uma em ESTUDIO_VOZ_TESTE (vídeo ou áudio, pt-BR, ~1 min) e, para medir palavras e
// tempos, a transcrição conferida à mão dela em ESTUDIO_PALAVRAS_TESTE (palavras.json: [{w, s, e}] em ms). Sem as duas,
// vale a narração do projeto de exemplo (src/nucleo/exemplo.ts) quando ele está em exemplos/ e o roteiro do vídeo aponta
// a fonte e as palavras.
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {EXEMPLO} from '../src/nucleo/exemplo.ts';

const lerJson = (arq) => JSON.parse(readFileSync(arq, 'utf-8'));
const palavrasDe = (arq) => {
  const x = lerJson(arq);
  return Array.isArray(x) ? x : x.palavras;
};

/** {voz, palavras} (palavras null quando não há referência); `exigirPalavras` encerra o script sem elas. */
export const vozDeTeste = (raiz, {exigirPalavras = false} = {}) => {
  let voz = process.env.ESTUDIO_VOZ_TESTE;
  let palavras = process.env.ESTUDIO_PALAVRAS_TESTE;
  if (!voz) {
    const pasta = path.join(raiz, 'exemplos', EXEMPLO.pasta);
    const roteiro = path.join(pasta, 'video', 'roteiro.json');
    if (existsSync(roteiro)) {
      const r = lerJson(roteiro);
      if (typeof r.fonte === 'string') voz = path.join(pasta, r.fonte);
      if (!palavras && typeof r.palavras === 'string') palavras = path.join(pasta, r.palavras);
    }
  }
  if (!voz || !existsSync(voz) || (exigirPalavras && (!palavras || !existsSync(palavras)))) {
    console.error(`Este script precisa de uma narração de verdade: ESTUDIO_VOZ_TESTE=<vídeo ou áudio>${exigirPalavras
      ? ' e ESTUDIO_PALAVRAS_TESTE=<palavras.json conferido>' : ''} (ou o projeto de exemplo em exemplos/${EXEMPLO.pasta}).`);
    process.exit(2);
  }
  return {voz: path.resolve(voz), palavras: palavras && existsSync(palavras) ? palavrasDe(palavras) : null};
};
