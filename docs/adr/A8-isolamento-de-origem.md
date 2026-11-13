# A8. Isolamento de origem (SharedArrayBuffer)

Status: aprovado em 12/11/2026 pelo dono. Origem: `docs/musica-daw.md`, seção 2.

## Contexto

O worklet com parâmetros sem bloqueio e o multicore pedem SharedArrayBuffer, logo COOP/COEP. Isso pode quebrar o servidor de mídia, o Player do Remotion e as fontes.

## Decisão

Testar na M0 se o servidor de mídia, o Player do Remotion e as fontes funcionam com `credentialless` ou CORP. Se quebrar, a M5 usa MessagePort e o multicore (M-09) fica adiado.

## Consequências

- A M0 entrega o resultado do teste e atualiza este ADR.
- Sem isolamento, o worklet troca parâmetros por MessagePort (latência de parâmetro maior, sem bloqueio de áudio).
- O multicore (pool de workers, soma em ordem fixa) só entra com isolamento ativo.
