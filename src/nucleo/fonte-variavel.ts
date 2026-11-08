// Fonte variável: um arquivo só que serve a todos os pesos (eixo wght). Registrada no navegador com um peso só ("400"),
// ela fica presa nele e o título em 700 sai em negrito sintético; a faixa dela ("100 900") resolve. Aqui se lê, sem
// abrir os glifos, se o arquivo tem a tabela fvar e qual a faixa do eixo de peso. Só dados (sem disco): quem chama
// passa os bytes. TTF, OTF e WOFF; o WOFF2 comprime a lista de tabelas e só se reconhece pelo nome do arquivo.

export type EixoDePeso = {variavel: boolean; min?: number; max?: number};

const u16 = (d: DataView, o: number) => (o + 2 <= d.byteLength ? d.getUint16(o) : 0);
const u32 = (d: DataView, o: number) => (o + 4 <= d.byteLength ? d.getUint32(o) : 0);
const tag = (d: DataView, o: number) => (o + 4 <= d.byteLength ? String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3)) : '');

/** "Roboto-VariableFont_wght.ttf" e "Inter[opsz,wght].ttf": o que o nome do arquivo conta (único jeito no WOFF2). */
export const nomeDeFonteVariavel = (nome: string) => /variable|\[[^\]]*wght[^\]]*\]/i.test(nome);

/** Lê a tabela fvar. `inflar` descomprime uma tabela do WOFF (zlib); sem ele, WOFF comprimido fica só "variável". */
export const lerEixoDePeso = (bytes: Uint8Array, inflar?: (b: Uint8Array) => Uint8Array): EixoDePeso => {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const assinatura = tag(d, 0);
  let tabela: Uint8Array | null = null;
  let tem = false;
  if (assinatura === 'wOFF') {
    for (let i = 0, n = u16(d, 12); i < n; i++) {
      const e = 44 + i * 20;
      if (tag(d, e) !== 'fvar') continue;
      tem = true;
      const inicio = u32(d, e + 4);
      const comprimido = u32(d, e + 8);
      const original = u32(d, e + 12);
      const cru = bytes.subarray(inicio, inicio + comprimido);
      if (comprimido === original) tabela = cru;
      else if (inflar) {
        try {
          tabela = inflar(cru);
        } catch {
          tabela = null;
        }
      }
    }
  } else if (assinatura === '\0\x01\0\0' || assinatura === 'OTTO' || assinatura === 'true') {
    for (let i = 0, n = u16(d, 4); i < n; i++) {
      const e = 12 + i * 16;
      if (tag(d, e) !== 'fvar') continue;
      tem = true;
      const inicio = u32(d, e + 8);
      tabela = bytes.subarray(inicio, inicio + u32(d, e + 12));
    }
  }
  if (!tem) return {variavel: false};
  if (!tabela) return {variavel: true};
  const f = new DataView(tabela.buffer, tabela.byteOffset, tabela.byteLength);
  const eixos = u16(f, 8);
  const tamanho = u16(f, 10) || 20;
  for (let i = 0; i < eixos; i++) {
    const o = u16(f, 4) + i * tamanho;
    if (tag(f, o) !== 'wght') continue;
    const fixo = (p: number) => f.getInt32(o + p) / 65536;
    return {variavel: true, min: Math.round(fixo(4)), max: Math.round(fixo(12))};
  }
  return {variavel: true}; // variável em outro eixo (largura, inclinação): o peso não varia
};
