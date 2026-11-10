import {readFileSync} from 'node:fs';
import {lerDocMusica} from '../src/nucleo/musica';
// simplificando: lê o documento e a entrega
import {entregaDaMusica} from '../src/nucleo/musica-entrega';
import {medirAmostras} from '../src/nucleo/loudness';
const doc = JSON.parse(readFileSync('testes/saida/projetos/Musica Teste/saidas/../musica/musica.json', 'utf-8')) as never;
const r = entregaDaMusica(doc as never, {}, {stems: true});
console.log('medida.antes_lufs', r.medida.antes_lufs, 'ganho_db', r.medida.ganho_db, 'lufs', r.medida.lufs);
// soma dos stems (float) e mede
const soma = r.stems!.map(s => s.canais).reduce((acc, c) => c.map((ch, ci) => new Float32Array(ch.length).map((_, i) => (acc[ci][i] ?? 0) + ch[i])), null as unknown as Float32Array[]);
const mSoma = medirAmostras(soma, r.taxa, {pico: true});
const mMistura = medirAmostras(r.mistura, r.taxa, {pico: true});
console.log('stems somados: lufs', mSoma.integrado_lufs, 'pico', mSoma.pico_dbtp);
console.log('mistura (final): lufs', mMistura.integrado_lufs, 'pico', mMistura.pico_dbtp);
console.log('n stems', r.stems!.length, r.stems!.map(s => s.nome));
