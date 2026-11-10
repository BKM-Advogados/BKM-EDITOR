// Uma API falsa no formato da OpenAI (o que DeepSeek, Gemini, OpenRouter, Mistral, xAI, Groq, Ollama e LM Studio
// também falam): GET /v1/models e POST /v1/chat/completions, com e sem stream, com chamada de ferramentas. Quem decide o
// que o "modelo" responde é um roteiro: uma resposta por chamada, na ordem. Serve aos testes do laço próprio e à prova
// de um agente real (Qwen Code, opencode) apontado para cá, sem chave nem conta.
import http from 'node:http';
import type {AddressInfo} from 'node:net';

export type ChamadaFalsa = {nome: string; args: Record<string, unknown> | ((pedido: PedidoFalso) => Record<string, unknown>)};
export type RespostaFalsa = {
  texto?: string;
  raciocinio?: string; // vai em reasoning_content, como o DeepSeek
  ferramentas?: ChamadaFalsa[];
  uso?: {entrada: number; saida: number; cache?: number};
  erro?: {status: number; mensagem: string};
};
export type PedidoFalso = {
  modelo: string;
  mensagens: Array<Record<string, any>>;
  ferramentas: string[];
  stream: boolean;
  autorizacao?: string;
  corpo: Record<string, any>;
};

/** O resultado da última ferramenta que o agente devolveu ao "modelo", já como texto. */
export const ultimoResultado = (p: PedidoFalso) => {
  const m = [...p.mensagens].reverse().find((x) => x.role === 'tool');
  const c = m?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x.text ?? '').join('') : '';
};

export const criarApiFalsa = async (o: {roteiro: RespostaFalsa[]; modelos?: string[]; chave?: string; prefixo?: string}) => {
  const pedidos: PedidoFalso[] = [];
  const fila = [...o.roteiro];
  const prefixo = o.prefixo ?? '/v1';
  const modelos = o.modelos ?? ['falso-1'];
  let n = 0;

  const servidor = http.createServer(async (req, res) => {
    const url = req.url ?? '';
    const autorizacao = req.headers.authorization;
    if (o.chave && autorizacao !== `Bearer ${o.chave}`) {
      res.writeHead(401, {'Content-Type': 'application/json'}).end(JSON.stringify({error: {message: 'Invalid API key', type: 'authentication_error'}}));
      return;
    }
    if (req.method === 'GET' && url.startsWith(`${prefixo}/models`)) {
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({object: 'list', data: modelos.map((id) => ({id, object: 'model', owned_by: 'falso'}))}));
      return;
    }
    if (req.method !== 'POST' || !url.startsWith(`${prefixo}/chat/completions`)) {
      res.writeHead(404).end();
      return;
    }
    let texto = '';
    for await (const pedaco of req) texto += pedaco;
    const corpo = JSON.parse(texto || '{}');
    const pedido: PedidoFalso = {modelo: corpo.model, mensagens: corpo.messages ?? [], ferramentas: (corpo.tools ?? []).map((t: any) => t.function?.name),
      stream: Boolean(corpo.stream), autorizacao, corpo};
    pedidos.push(pedido);
    const r = fila.shift() ?? {texto: 'Pronto.'};
    if (r.erro) {
      res.writeHead(r.erro.status, {'Content-Type': 'application/json'}).end(JSON.stringify({error: {message: r.erro.mensagem}}));
      return;
    }
    // o nome que o agente deu à ferramenta pode ter prefixo (mcp__estudio__, estudio__, estudio_): casa pelo fim
    const nomeReal = (base: string) => pedido.ferramentas.find((f) => f === base || f?.endsWith(`__${base}`) || f?.endsWith(`_${base}`)) ?? base;
    const chamadas = (r.ferramentas ?? []).map((f, i) => ({
      index: i, id: `call_${++n}`, type: 'function' as const,
      function: {name: nomeReal(f.nome), arguments: JSON.stringify(typeof f.args === 'function' ? f.args(pedido) : f.args)},
    }));
    const uso = r.uso ? {prompt_tokens: r.uso.entrada, completion_tokens: r.uso.saida, total_tokens: r.uso.entrada + r.uso.saida,
      prompt_cache_hit_tokens: r.uso.cache ?? 0, prompt_cache_miss_tokens: r.uso.entrada - (r.uso.cache ?? 0),
      prompt_tokens_details: {cached_tokens: r.uso.cache ?? 0}} : undefined;
    const fim = chamadas.length ? 'tool_calls' : 'stop';
    const id = `cmpl_${n}`;
    if (!pedido.stream) {
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({id, object: 'chat.completion', model: corpo.model,
        choices: [{index: 0, finish_reason: fim, message: {role: 'assistant', content: r.texto ?? null, ...(r.raciocinio ? {reasoning_content: r.raciocinio} : {}),
          ...(chamadas.length ? {tool_calls: chamadas.map(({index: _i, ...c}) => c)} : {})}}], ...(uso ? {usage: uso} : {})}));
      return;
    }
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive'});
    const enviar = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) =>
      res.write(`data: ${JSON.stringify({id, object: 'chat.completion.chunk', model: corpo.model, choices: [{index: 0, delta, finish_reason: finish}], ...extra})}\n\n`);
    enviar({role: 'assistant', content: ''});
    if (r.raciocinio) enviar({reasoning_content: r.raciocinio});
    if (r.texto) for (const pedaco of r.texto.match(/.{1,12}/gs) ?? []) enviar({content: pedaco});
    for (const c of chamadas) {
      enviar({tool_calls: [{index: c.index, id: c.id, type: 'function', function: {name: c.function.name, arguments: ''}}]});
      const a = c.function.arguments;
      for (let i = 0; i < a.length; i += 20) enviar({tool_calls: [{index: c.index, function: {arguments: a.slice(i, i + 20)}}]});
    }
    enviar({}, fim);
    if (uso && corpo.stream_options?.include_usage) res.write(`data: ${JSON.stringify({id, object: 'chat.completion.chunk', model: corpo.model, choices: [], usage: uso})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}${prefixo}`;
  return {url, pedidos, restantes: () => fila.length, fechar: () => new Promise<void>((ok) => servidor.close(() => ok()))};
};
