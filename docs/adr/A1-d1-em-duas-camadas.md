# A1. D1 revisada em duas camadas

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

A D1 diz que a música usa só Web Audio e TypeScript, sem módulo nativo nem VST. Isso garante que o render é igual na janela, no worker, no processo principal e no MCP stdio, e mantém a ligação viva com o vídeo. Mantida estrita, nunca haverá VST/CLAP, ASIO nem latência profissional para monitorar guitarra no Windows. Abandonada, o produto perde a garantia central. Opções avaliadas: (1) manter estrita, (2) duas camadas, (3) abandonar.

## Decisão

Opção 2, decidida agora como princípio e implementada só na onda M8. Até lá, tudo dentro da D1.

- **Camada canônica:** o render de vídeo, a exportação e o MCP continuam só TypeScript/WASM.
- **Periferia nativa:** código nativo (plugins, E/S de áudio) só em processo separado, nunca no render canônico. A saída de um plugin nativo é congelada em WAV (freeze) para voltar a ser reproduzível.

## Consequências

- Abre o caminho de mercado (VST3/CLAP, ASIO) sem perder a ligação viva com o vídeo.
- Um projeto com plugin nativo só renderiza no MCP stdio se estiver congelado.
- Assinatura, notarização e sandbox no Mac entram no custo da M8.
- `docs/musica.md` cita a D1 nesta forma na seção "Por que um motor próprio".
- A A5 (opção 4) depende desta decisão.
