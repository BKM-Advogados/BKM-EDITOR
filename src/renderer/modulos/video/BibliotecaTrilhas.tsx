// Biblioteca de trilhas: a pasta de músicas e efeitos da pessoa (Preferências › pasta de trilhas, padrão Estudio\trilhas),
// listada num popover com filtro. Clicar numa trilha copia para midia/ (uma vez só) e põe na faixa de música. Dá para trocar
// a pasta e abri-la no Explorador por aqui mesmo. A trilha com ficha (biblioteca-musicas.ts) mostra a licença conferida e o
// autor; a de ficha recusada (NC, ND, sem crédito) não pode ser escolhida; a sem ficha é da pessoa.
import React, {useEffect, useState} from 'react';
import {FolderOpen, FolderSearch, Music, RefreshCw} from 'lucide-react';
import type {Trilha} from '../../../compartilhado/api';
import {avisar, mensagemDe} from '../../estado/loja';
import {LICENCAS_LIVRES} from '../../../nucleo/biblioteca-musicas';
import {usarFora} from '../../componentes/Menu';
import {adicionarDaBiblioteca} from './acoes-audio';

export const BibliotecaTrilhas: React.FC<{documento: string; aoFechar: () => void}> = ({documento, aoFechar}) => {
  const caixa = usarFora(true, aoFechar);
  const [lista, setLista] = useState<{pasta: string; trilhas: Trilha[]} | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const carregar = () => {
    setErro(null);
    window.estudio.audio.listarTrilhas().then(setLista).catch((e) => setErro(mensagemDe(e)));
  };
  useEffect(carregar, []);
  const trocarPasta = async () => {
    const p = await window.estudio.escolherPasta('Pasta das trilhas (músicas e efeitos)');
    if (!p) return;
    await window.estudio.gravarPreferencias({pasta_trilhas: p});
    carregar();
  };
  const escolher = async (t: Trilha) => {
    setOcupado(t.caminho);
    try {
      await adicionarDaBiblioteca(documento, t.caminho);
      aoFechar();
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    } finally {
      setOcupado(null);
    }
  };
  const f = filtro.trim().toLowerCase();
  const vistas = (lista?.trilhas ?? []).filter((t) => !f || `${t.pasta}/${t.nome} ${t.ficha?.autor ?? ''} ${t.ficha?.humor ?? ''} ${t.ficha?.genero ?? ''}`.toLowerCase().includes(f));
  return (
    <div ref={caixa} className="flutuante biblioteca" role="dialog" aria-label="Biblioteca de trilhas">
      <div className="topo">
        <Music className="i14" />
        <input className="campo" autoFocus placeholder="Filtrar trilhas…" value={filtro} onChange={(e) => setFiltro(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && aoFechar()} />
        <button aria-label="Reler a pasta" className="bti" title="Reler a pasta" onClick={carregar}><RefreshCw /></button>
      </div>
      <div className="corpo">
        {erro && <div className="vazio" style={{color: 'var(--erro)'}}>{erro}</div>}
        {!erro && !lista && <div className="vazio">Lendo a pasta…</div>}
        {lista && !lista.trilhas.length && <div className="vazio">A pasta está vazia. Ponha mp3, wav, m4a, ogg ou aac em<br /><code>{lista.pasta}</code></div>}
        {lista && lista.trilhas.length > 0 && !vistas.length && <div className="vazio">Nada com "{filtro}".</div>}
        {vistas.map((t) => (
          <button key={t.caminho} className="trilha-item" disabled={ocupado !== null || Boolean(t.recusa)}
            title={t.recusa ? `Ficha recusada: ${t.recusa}` : t.ficha ? `${t.ficha.titulo} · ${t.ficha.autor} · licença conferida em ${t.ficha.conferido_em}
${t.ficha.url_pagina}` : t.caminho}
            onClick={() => void escolher(t)}>
            <span className="nome">{t.ficha?.titulo ?? t.nome}</span>
            {t.ficha && <span className="meta" style={{color: 'var(--trilha-audio)'}}>{LICENCAS_LIVRES[t.ficha.licenca].nome}</span>}
            {t.recusa && <span className="meta" style={{color: 'var(--erro)'}}>licença recusada</span>}
            <span className="meta">{t.ficha?.autor ?? (t.pasta ? `${t.pasta} · ` : '')}{t.ficha ? ' · ' : ''}{t.tamanho_kb >= 1024 ? `${(t.tamanho_kb / 1024).toFixed(1)} MB` : `${t.tamanho_kb} KB`}</span>
            {ocupado === t.caminho && <span className="meta">medindo…</span>}
          </button>
        ))}
      </div>
      <div className="rodape">
        <span className="meta" title={lista?.pasta}>{lista ? lista.pasta.split(/[\\/]/).slice(-2).join('/') : ''}</span>
        <span className="espaco" />
        <button className="bt fantasma mini" onClick={() => lista && window.estudio.mostrarNaPasta(lista.pasta)} disabled={!lista} title="Abrir a pasta no gerenciador de arquivos"><FolderOpen size={13} />Abrir</button>
        <button className="bt fantasma mini" onClick={() => void trocarPasta()} title="Escolher outra pasta de trilhas"><FolderSearch size={13} />Trocar pasta…</button>
      </div>
    </div>
  );
};
