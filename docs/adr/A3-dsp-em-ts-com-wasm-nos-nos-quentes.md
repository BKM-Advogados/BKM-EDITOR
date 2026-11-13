# A3. DSP em TypeScript, com WASM nos nós quentes

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

Math.sin, exp e tanh dependem da versão do V8, e o custo de amp com oversampling 8x e convolução em 4 a 8 guitarras não foi medido. Opções: (1) tudo em TS, build simples mas determinismo e custo incertos; (2) tudo em Rust para WASM, determinismo sem V8 e desempenho, mas reescrita total e o build ganha `cargo` e `wasm-pack`; (3) TS no geral e WASM nos nós quentes.

## Decisão

Opção 3, com um portão de medição na onda M0: amp, convolução, reamostragem, stretch e NAM viram WASM só se o benchmark pedir. O teste é 5 min, 4 guitarras, amp 8x, IR de 200 ms e um alvo de RTF.

- Matemática transcendental própria (aproximações ou tabelas), igual em TS e em WASM.
- Sem relaxed-SIMD, que não é determinístico entre máquinas.

## Consequências

- O build só ganha toolchain de WASM se o portão da M0 mandar.
- O resultado da medição entra neste ADR ou em um que o substitua.
- Funções transcendentais próprias entram no contrato de determinismo da A4.
- Os testes de hash (A4) valem para a versão TS e para a WASM do mesmo nó.
