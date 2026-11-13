# A5. Plugins: formato próprio de módulo em WASM

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

Opções: (1) nenhum; (2) Web Audio Modules 2.0, que supõe AudioWorklet e não roda no Node do MCP; (3) formato próprio de módulo em WASM; (4) VST3/CLAP nativos, que precisam da A1, opção 2.

## Decisão

Opção 3 agora (N-07) e opção 4 depois, em ADR próprio (N-08), começando por CLAP. O WAM fica só como referência de API.

O módulo WASM expõe `init(taxa)`, `processar(bloco)`, parâmetros declarados e estado em JSON, com manifesto de licença e hash. Roda nos 4 ambientes (janela, worker, main, stdio).

## Consequências

- Plugins de terceiros em WASM rodam no render canônico, sem quebrar a D1.
- Exige sandbox de módulos (hash, sem rede/fs, tetos de memória e CPU), item M-15.
- VST3/CLAP ficam para a M8 e só em processo separado, com freeze (A1).
- O manifesto de licença obedece à política da A6.
