// Id repetido no vídeo de cenas: não quebra o vídeo, mas volta como aviso do resolvedor (e, por ele, na resposta do
// aplicar_patch), para quem escreveu trocar. Achado dos testes do MCP de 12/11/2026: o patch entrava calado.
import {describe, expect, it} from 'vitest';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';

const FORMATO = {largura: 1080, altura: 1920, fps: 30};
const repetidos = (doc: DocCenas) => resolverCenas(doc).avisos.filter((a) => a.includes('se repete'));

describe('ids repetidos no vídeo de cenas', () => {
  it('o documento novo não tem aviso de id', () => {
    expect(repetidos(novoDocCenas(FORMATO))).toEqual([]);
  });

  it('bloco com o id de outro bloco avisa os dois lugares', () => {
    const doc = novoDocCenas(FORMATO);
    const original = doc.cenas[0].blocos[0];
    doc.cenas[0].blocos.push({...structuredClone(original), texto: 'cópia'});
    const avisos = repetidos(doc);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain(`"${original.id}"`);
    expect(avisos[0]).toContain('/cenas/0/blocos/0, /cenas/0/blocos/1');
  });

  it('cena com o id de outra cena também avisa, e o vídeo continua resolvendo', () => {
    const doc = novoDocCenas(FORMATO);
    doc.cenas.push({...structuredClone(doc.cenas[0]), blocos: []});
    const r = resolverCenas(doc);
    expect(r.props.cenas).toHaveLength(2);
    expect(r.avisos.some((a) => a.includes(`"${doc.cenas[0].id}"`) && a.includes('/cenas/0, /cenas/1'))).toBe(true);
  });
});
