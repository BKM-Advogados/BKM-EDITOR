// Endereço de um arquivo empacotado pelo Vite (import x from 'pacote/arquivo?url'): o worker do remover fundo usa para
// achar o .wasm do onnxruntime-web, no servidor de desenvolvimento e no app empacotado.
declare module '*?url' {
  const url: string;
  export default url;
}
