// Prepara o projeto de teste do roteiro da Música (docs/musica.md): um vídeo de cenas com 3 cenas, narração e uma
// música, mais os arquivos de áudio sintéticos. Grava direto no disco em testes/saida/projetos/Roteiro Musica.
// Uso: npx tsx scripts/preparar-roteiro.ts
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {codificarWav, musicaSintetica, narracaoSintetica} from './audio-sintetico';

const TAXA = 48000;
const raiz = path.resolve('testes/saida/projetos/Roteiro Musica');
mkdirSync(path.join(raiz, 'midia'), {recursive: true});
mkdirSync(path.join(raiz, 'video'), {recursive: true});

const narracao = narracaoSintetica(12, TAXA);
const musica = musicaSintetica(12, TAXA);
writeFileSync(path.join(raiz, 'midia/narracao.wav'), Buffer.from(codificarWav([narracao, narracao], TAXA)));
writeFileSync(path.join(raiz, 'midia/musica.wav'), Buffer.from(codificarWav([musica, musica], TAXA)));

const estudo = {
  formato: 1,
  nome: 'Roteiro Musica',
  documentos: [
    {id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo'},
  ],
};
writeFileSync(path.join(raiz, 'estudio.json'), JSON.stringify(estudo, null, 2) + '\n');

const cena = (id: string, texto: string, dur: number) => ({
  id,
  duracao_ms: dur,
  blocos: [{id: `${id}-titulo`, tipo: 'titulo', em: 0, x: 0.1, largura: 0.8, alinhar: 'centro', y: 0.4, texto}],
});

const video = {
  tipo: 'cenas',
  formato: {largura: 1080, altura: 1920, fps: 30},
  tema: {fundo: '#111418', texto: '#F2F2F2', destaque: '#70B8FF', suave: '#A3ABB5', fonte: 'Inter'},
  cenas: [
    cena('cena-1', 'Cena um', 4000),
    cena('cena-2', 'Cena dois', 4000),
    cena('cena-3', 'Cena três', 4000),
  ],
  audio: {
    faixas: [
      {id: 'narracao', nome: 'Narração', papel: 'voz', volume: 1, clipes: [{id: 'n1', arquivo: 'midia/narracao.wav', em: 0, duracao_ms: 12000}]},
      {id: 'musica', nome: 'Música', papel: 'musica', volume: 0.6, ducking: {ativo: true, alvo_lu: 20}, clipes: [{id: 'm1', arquivo: 'midia/musica.wav', em: 0, duracao_ms: 12000}]},
    ],
  },
  efeitos: [],
};
writeFileSync(path.join(raiz, 'video/video.json'), JSON.stringify(video, null, 2) + '\n');

console.log('projeto pronto em', raiz);
console.log('narracao.wav e musica.wav em midia/');
