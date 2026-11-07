import {createRoot} from 'react-dom/client';
// fontes empacotadas: o app abre igual em qualquer PC, sem internet ('Inter Variable' e 'JetBrains Mono')
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import {App} from './App';
import './estilo.css';
// acabamento da imagem (rodada 2, B2): atende a ferramenta remover_fundo do Claude em qualquer área
import './modulos/imagem/pedidosRemoverFundo';

createRoot(document.getElementById('raiz')!).render(<App />);
