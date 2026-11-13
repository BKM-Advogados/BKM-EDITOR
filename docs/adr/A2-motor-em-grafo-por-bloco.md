# A2. Motor em grafo de processadores por bloco

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

O motor atual processa buffers inteiros: não há tempo real, PDC, automação geral nem memória limitada (24 faixas de 5 min passam de 5 GB). Opções: (1) manter o render do buffer inteiro e acrescentar render progressivo por trechos, barato mas sem tempo real, PDC nem automação geral; (2) grafo de processadores por bloco.

## Decisão

Opção 2: grafo de processadores por bloco, com interface `processar(entradas, saídas, n)`, estado explícito e latência declarada. O mesmo grafo roda em laço offline (worker, main, stdio) e dentro de um AudioWorklet. O motor atual fica como oráculo de teste durante a migração.

## Consequências

- Une EM-01, MD1, INT-01, SEQ-18, EM-11 e MD2 num item só (M-01 e M-06 do roadmap).
- Documentos antigos têm que soar igual (mesmo PCM): os testes `testes/musica*.test.ts` comparam o grafo novo com o motor antigo.
- Exige estado explícito em todo processador (nada de globais), o que também serve ao freeze e ao cache.
- A migração é grande (complexidade GG) e pede o esquema versionado da M-02 antes.
