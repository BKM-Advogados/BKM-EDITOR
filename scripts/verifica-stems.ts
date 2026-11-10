import {readFileSync} from 'node:fs';
import {entregaDaMusica} from '../src/nucleo/musica-entrega';
import {medirAmostras} from '../src/nucleo/loudness';
import type {DocMusica} from '../src/nucleo/musica';

const doc = JSON.parse(readFileSync('testes/saida/projetos/Musica Teste/musica/musica.json', 'utf-8')) as DocMusica;
const r = entregaDaMusica(doc, {}, {stems: true});
console.log('medida: antes_lufs', r.medida.antes_lufs, '| ganho_db', r.medida.ganho_db, '| lufs', r.medida.lufs, '| limitador_db', r.medida.limitador_db);

// soma dos stems (float) e mede
const soma = r.stems!.reduce<Float32Array[]>((acc, s) => {
  if (!acc.length) return s.canais.map((ch) => Float32Array.from(ch));
  return s.canais.map((ch, ci) => new Float32Array(ch.length).map((_, i) => acc[ci][i] + ch[i]));
}, []);
const mSoma = medirAmostras(soma, r.taxa, {pico: true});
const mMistura = medirAmostras(r.mistura, r.taxa, {pico: true});
console.log('stems somados: lufs', mSoma.integrado_lufs, '| pico_dbtp', mSoma.pico_dbtp);
console.log('mistura final: lufs', mMistura.integrado_lufs, '| pico_dbtp', mMistura.pico_dbtp);
console.log('n stems:', r.stems!.length, '→', r.stems!.map((s) => s.nome).join(', '));
