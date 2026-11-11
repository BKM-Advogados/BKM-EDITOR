// Ordem e nomes das áreas (ux/pesquisa-ux-visual.md, item 25): Vídeo, Imagem, Animação, Música, Efeitos e 3D, com as
// teclas 1 a 6 nessa ordem; Exportar é a única ação azul da barra; a mudança de atalho está nas notas do README.
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const raiz = path.join(__dirname, '..');
const casca = fs.readFileSync(path.join(raiz, 'src', 'renderer', 'casca', 'Casca.tsx'), 'utf8');

describe('áreas', () => {
  it('na ordem de uso, com as teclas 1 a 6', () => {
    const bloco = casca.slice(casca.indexOf('export const AREAS'), casca.indexOf('];', casca.indexOf('export const AREAS')));
    const ids = [...bloco.matchAll(/id: '([^']+)'.*?atalho: '(\d)'/g)].map((m) => `${m[2]}:${m[1]}`);
    expect(ids).toEqual(['1:video', '2:imagem', '3:animacao', '4:musica', '5:efeitos', '6:3d']);
  });
  it('Exportar é a única ação principal (azul) da barra; Comentar e Desfazer são ícones com nome', () => {
    const barra = casca.slice(casca.indexOf('<div className="acoes">'), casca.indexOf('</header>'));
    expect(barra.match(/bt principal/g)).toHaveLength(1);
    expect(barra).toMatch(/className="bt principal exportar"/);
    expect(barra).toContain('aria-label="Comentar na tela"');
  });
  it('a mudança de atalho está nas notas da versão', () => {
    const readme = fs.readFileSync(path.join(raiz, 'README.md'), 'utf8');
    expect(readme).toMatch(/Atalhos das áreas mudaram/);
    expect(readme).toMatch(/1 Vídeo, 2 Imagem, 3 Animação, 4 Música, 5 Efeitos,\s+6 3D/);
  });
});
