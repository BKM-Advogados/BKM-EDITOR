// O CLAUDE.md que a 0.3.0 escrevia nos projetos (claude-md-030-video.md e claude-md-030-imagem.md), como está no disco
// de quem criou um projeto naquela versão. Duas palavras desse texto não ficam escritas no repositório: o id do kit de
// fábrica que saiu e o nome interno antigo da observação da fonte. Na fixture elas são marcadores, e aqui voltam
// montadas em pedaços, para o teste ver o texto antigo exatamente como era.
import {readFileSync} from 'node:fs';
import path from 'node:path';

export const PALAVRAS_DO_TEXTO_030: Record<string, string> = {
  '{{kit-antigo}}': ['b', 'k', 'm'].join(''),
  '{{nome-interno}}': ['vix', 'sys'].join(''),
};

export const texto030 = (modulo: 'video' | 'imagem') =>
  Object.entries(PALAVRAS_DO_TEXTO_030).reduce((t, [marcador, palavra]) => t.replaceAll(marcador, palavra),
    readFileSync(path.join(__dirname, `claude-md-030-${modulo}.md`), 'utf-8'));
