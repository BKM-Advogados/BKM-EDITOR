// O nome de uma ferramenta como cada agente manda (mcp__estudio__aplicar_patch no Claude Code, estudio__aplicar_patch
// ou estudio_aplicar_patch em outros CLIs, "aplicar_patch (estudio MCP Server)" no título do ACP, aplicar_patch no laço
// próprio) vira um nome só, para o cartão da conversa ser igual com qualquer provedor. As ferramentas internas dos
// agentes também ganham um nome comum.

export type NomeFerramenta = {servidor: 'estudio' | 'interno' | 'outro'; nome: string};

const INTERNAS: Record<string, string> = {
  Bash: 'shell', PowerShell: 'shell', run_shell_command: 'shell', shell: 'shell', execute: 'shell',
  Read: 'ler_arquivo', read_file: 'ler_arquivo', read_many_files: 'ler_arquivo',
  Edit: 'editar_arquivo', MultiEdit: 'editar_arquivo', NotebookEdit: 'editar_arquivo', replace: 'editar_arquivo', edit: 'editar_arquivo',
  Write: 'escrever_arquivo', write_file: 'escrever_arquivo',
  Glob: 'procurar', Grep: 'procurar', glob: 'procurar', search_file_content: 'procurar', grep: 'procurar',
  WebFetch: 'abrir_pagina', web_fetch: 'abrir_pagina', WebSearch: 'buscar_web', google_web_search: 'buscar_web', web_search: 'buscar_web',
  TodoWrite: 'lista_de_tarefas', todo_write: 'lista_de_tarefas', Task: 'subagente', Agent: 'subagente', Skill: 'skill',
};

export const normalizarFerramenta = (bruto: string, conhecidas?: ReadonlySet<string>): NomeFerramenta => {
  const n = bruto.trim();
  const prefixo = /^(?:mcp__estudio__|estudio__|estudio_|estudio[:.]\s*)(.+)$/.exec(n);
  if (prefixo) return {servidor: 'estudio', nome: prefixo[1]};
  const titulo = /^(\w+)\s*\(estudio[^)]*\)$/i.exec(n);
  if (titulo) return {servidor: 'estudio', nome: titulo[1]};
  if (conhecidas?.has(n)) return {servidor: 'estudio', nome: n};
  if (INTERNAS[n]) return {servidor: 'interno', nome: INTERNAS[n]};
  const outroMcp = /^mcp__([^_]+)__(.+)$/.exec(n);
  if (outroMcp) return {servidor: 'outro', nome: outroMcp[2]};
  return {servidor: 'outro', nome: n};
};

/** As ferramentas do MCP estudio, para reconhecer o nome sem prefixo que o laço próprio manda. */
export const FERRAMENTAS_ESTUDIO: ReadonlySet<string> = new Set([
  'projeto_info', 'estado_do_editor', 'ler_documento', 'aplicar_patch', 'criar_documento', 'renomear_projeto', 'listar_comentarios', 'ler_comentario',
  'responder_comentario', 'resolver_comentario', 'listar_mudancas', 'aplicar_marca', 'ler_fonte', 'anotar_fonte', 'registrar_fato', 'listar_pesquisa',
  'texto_da_fonte', 'checar_texto', 'transcrever', 'exportar_legendas', 'importar_legendas', 'remover_fundo', 'ler_legendas', 'editar_legenda',
  'desfazer', 'reverter', 'guia_do_projeto', 'criar_comentario', 'reabrir_comentario', // frente IA, rodada 3
]);

/** Corta o texto do resultado para a tela sem perder as mudanças do diário que o portão põe no fim (Ver e Reverter). */
export const cortarResultado = (texto: string, max = 4000) => {
  if (texto.length <= max) return texto;
  const i = texto.lastIndexOf('{"estudio_mudancas":');
  const mudancas = i >= 0 ? texto.slice(i) : '';
  return `${texto.slice(0, Math.max(0, max - mudancas.length))}…${mudancas ? `\n${mudancas}` : ''}`;
};
