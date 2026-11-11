// Área Imagem (ux/pesquisa-ux-visual.md, item 22): a barra da seleção tem grupos com nome em vez de 12 ícones soltos, e
// exportar tem um caminho só (o diálogo), com o PNG rápido de uma página dentro dele.
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const ler = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', ...p), 'utf8');

describe('área Imagem', () => {
  it('a barra da seleção agrupa por nome', () => {
    const barra = ler('modulos', 'imagem', 'BarraSelecao.tsx');
    for (const nome of ['nome="Alinhar"', 'nome="Distribuir"', 'nome="Grupo"', "'Travar'", 'Caber']) expect(barra).toContain(nome);
    expect(barra).not.toMatch(/className="bti"/);
  });
  it('um caminho só para exportar', () => {
    const monitor = ler('modulos', 'imagem', 'MonitorImagem.tsx');
    const paginas = ler('modulos', 'imagem', 'PaginasImagem.tsx');
    const dialogo = ler('componentes', 'DialogoExportar.tsx');
    expect(monitor).toContain('abrirDialogoExportar(documento)');
    expect(monitor).not.toMatch(/exportarPng\(|exportarPagina\(/);
    expect(paginas).not.toMatch(/exportarCarrossel\(/);
    expect(dialogo).toContain('exportarPagina(documento, paginaAberta)');
  });
});
