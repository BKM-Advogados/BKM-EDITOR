// Catálogo de provedores (o "padrão Cline"): a pessoa escolhe numa lista, põe a chave ou o endereço, e conversa. Três
// vias: o Claude Code da pessoa (claude -p, pela conta dela), o laço próprio no formato de chat da OpenAI (quase todo
// provedor e todo modelo local falam esse formato) e os agentes ACP que a pessoa já tem instalados (Gemini CLI, Qwen
// Code, opencode, goose, Antigravity). O modelo padrão só vem preenchido onde foi conferido na fonte em 07/11/2026
// (docs/ia.md); nos outros, a lista vem do próprio endereço (GET /models) quando a chave é testada.

export type Via = 'claude-cli' | 'openai' | 'acp';

export type Provedor = {
  id: string;
  nome: string;
  via: Via;
  base?: string; // via openai: endereço até o /v1
  chave: 'exigida' | 'opcional' | 'nenhuma';
  modelo?: string; // padrão conferido; vazio = escolher da lista do endereço
  servidor: string; // onde o provedor processa, como informação igual para todos
  paginaChave?: string; // onde a pessoa pega a chave (abre no navegador, com confirmação)
  cabecalhos?: Record<string, string>;
  // via acp: o executável e os argumentos que ligam o modo ACP
  exe?: string;
  args?: string[];
  experimental?: boolean;
  local?: boolean; // roda neste PC: sem chave, endereço editável
};

export const PROVEDORES: Provedor[] = [
  {id: 'claude', nome: 'Claude (sua conta)', via: 'claude-cli', chave: 'nenhuma', servidor: 'EUA (Anthropic)'},
  {id: 'deepseek', nome: 'DeepSeek', via: 'openai', base: 'https://api.deepseek.com', chave: 'exigida', modelo: 'deepseek-flash', servidor: 'China',
    paginaChave: 'https://platform.deepseek.com/api_keys'},
  {id: 'gemini', nome: 'Gemini (chave)', via: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', chave: 'exigida',
    modelo: 'gemini-3.6-flash', servidor: 'EUA (Google)', paginaChave: 'https://aistudio.google.com/apikey'},
  {id: 'openai', nome: 'OpenAI', via: 'openai', base: 'https://api.openai.com/v1', chave: 'exigida', servidor: 'EUA', paginaChave: 'https://platform.openai.com/api-keys'},
  // pela camada compatível com OpenAI da Anthropic ("stable", sem cache de prompt; a doc diz que não é para produção de
  // longo prazo). Modelos conferidos na lista da doc em 08/11/2026; a chave é testada no /v1/models nativo
  {id: 'anthropic', nome: 'Anthropic (chave)', via: 'openai', base: 'https://api.anthropic.com/v1', chave: 'exigida', servidor: 'EUA',
    modelo: 'claude-sonnet-5-5', paginaChave: 'https://platform.claude.com/settings/keys'},
  {id: 'openrouter', nome: 'OpenRouter', via: 'openai', base: 'https://openrouter.ai/api/v1', chave: 'exigida', servidor: 'EUA (repassa ao provedor do modelo)',
    paginaChave: 'https://openrouter.ai/keys', cabecalhos: {'HTTP-Referer': 'https://estudio.local', 'X-Title': 'Estudio'}},
  {id: 'mistral', nome: 'Mistral', via: 'openai', base: 'https://api.mistral.ai/v1', chave: 'exigida', servidor: 'França (UE)', paginaChave: 'https://console.mistral.ai/api-keys'},
  {id: 'xai', nome: 'xAI (Grok)', via: 'openai', base: 'https://api.x.ai/v1', chave: 'exigida', servidor: 'EUA', paginaChave: 'https://console.x.ai'},
  {id: 'groq', nome: 'Groq', via: 'openai', base: 'https://api.groq.com/openai/v1', chave: 'exigida', servidor: 'EUA', paginaChave: 'https://console.groq.com/keys'},
  {id: 'ollama', nome: 'Ollama (neste PC)', via: 'openai', base: 'http://127.0.0.1:11434/v1', chave: 'nenhuma', servidor: 'neste PC', local: true},
  {id: 'lmstudio', nome: 'LM Studio (neste PC)', via: 'openai', base: 'http://127.0.0.1:1234/v1', chave: 'nenhuma', servidor: 'neste PC', local: true},
  {id: 'compativel', nome: 'Outro endereço compatível com OpenAI', via: 'openai', chave: 'opcional', servidor: 'o do endereço'},
  // agentes que a pessoa já tem instalados: aparecem só quando o executável é achado
  {id: 'gemini-cli', nome: 'Gemini CLI', via: 'acp', exe: 'gemini', args: ['--experimental-acp'], chave: 'opcional', servidor: 'EUA (Google)'},
  {id: 'qwen', nome: 'Qwen Code', via: 'acp', exe: 'qwen', args: ['--acp'], chave: 'opcional', servidor: 'o do provedor configurado nele'},
  {id: 'opencode', nome: 'opencode', via: 'acp', exe: 'opencode', args: ['acp'], chave: 'opcional', servidor: 'o do provedor configurado nele'},
  {id: 'goose', nome: 'goose', via: 'acp', exe: 'goose', args: ['acp'], chave: 'opcional', servidor: 'o do provedor configurado nele'},
  {id: 'antigravity', nome: 'Gemini pela conta Google (Antigravity)', via: 'acp', exe: 'agy', args: ['acp', '--process-per-session'], chave: 'nenhuma',
    servidor: 'EUA (Google)', experimental: true},
];

export const provedor = (id: string) => PROVEDORES.find((p) => p.id === id);
