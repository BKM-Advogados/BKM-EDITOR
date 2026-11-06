// Painel Marca (menu → Marca…): os kits da pasta marcas/, para aplicar ao documento ativo, criar, duplicar e editar
// (nome, cores, fontes, logo, assinatura, notas) e para importar logo e fontes de arquivo. É também onde se escolhe a
// fonte do tema do vídeo ativo. Um diálogo sobre a casca, como as Preferências; cada edição grava o marca.json na hora.
import React, {useEffect, useState} from 'react';
import {Check, Copy, FolderSearch, ImagePlus, Plus, Type} from 'lucide-react';
import type {MarcaInfo, Preferencias} from '../../compartilhado/api';
import {fonte, listarFontes, registrarFontesDeArquivo} from '../../composicoes/fontes';
import {ehDocCenas} from '../../nucleo/cenas';
import {marcaDoDocumento, type Marca} from '../../nucleo/marca';
import {avisar, carregarDoc, mensagemDe, trocar, useLoja} from '../estado/loja';
import {CampoCor, CampoSelecao, CampoTexto} from '../componentes/Campos';
import {pedirTexto} from '../componentes/Dialogo';
import './painel-marca.css';

const PRINCIPAIS = ['fundo', 'texto', 'destaque', 'suave'];
const ROTULO: Record<string, string> = {fundo: 'Fundo', texto: 'Texto', destaque: 'Destaque', suave: 'Texto suave'};
const rotuloCor = (k: string) => ROTULO[k] ?? k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** As fontes de arquivo de um kit entram no carregador pelo endereço do kit, para a amostra e o seletor. */
const registrarFontesDoKit = (k: MarcaInfo) =>
  registrarFontesDeArquivo(k.fontes.arquivos.map((f) => ({familia: f.familia, peso: f.peso, estilo: f.estilo,
    url: /^[a-z][a-z0-9+.-]*:/i.test(f.arquivo) ? f.arquivo : `${k.url}/${f.arquivo.split('/').map(encodeURIComponent).join('/')}`})));

const opcoesDeFonte = (extras: string[] = []): [string, string][] => {
  const lista = listarFontes().map((f): [string, string] => [f.nome, f.origem === 'arquivo' ? `${f.nome} · arquivo` : f.nome]);
  for (const e of extras) if (!lista.some(([v]) => v === e)) lista.push([e, `${e} · arquivo`]);
  return lista;
};

export const PainelMarca: React.FC<{aoFechar: () => void}> = ({aoFechar}) => {
  const [kits, setKits] = useState<MarcaInfo[] | null>(null);
  const [idSel, setIdSel] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferencias | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const area = useLoja((e) => e.area);
  const ativo = useLoja((e) => e.ativo);
  const alvoEfeitos = useLoja((e) => e.alvoEfeitos);
  const info = useLoja((e) => e.info);
  const idDoc = area === 'efeitos' ? alvoEfeitos : area === '3d' ? undefined : (ativo as Record<string, string | undefined>)[area];
  const doc = useLoja((e) => (idDoc ? e.docs[idDoc]?.doc : undefined)) as unknown;
  const entrada = info?.manifesto.documentos.find((d) => d.id === idDoc);
  const recebe = Boolean(entrada && entrada.modulo !== '3d');
  const kitDoDoc = marcaDoDocumento(doc);

  const trocarKit = (k: MarcaInfo) => {
    registrarFontesDoKit(k);
    setKits((ks) => (ks ?? []).some((x) => x.id === k.id) ? ks!.map((x) => (x.id === k.id ? k : x)) : [...(ks ?? []), k]);
    setIdSel(k.id);
  };
  useEffect(() => {
    void window.estudio.marcas.listar().then((l) => {
      l.forEach(registrarFontesDoKit);
      setKits(l);
      setIdSel((s) => (s && l.some((k) => k.id === s) ? s : kitDoDoc && l.some((k) => k.id === kitDoDoc) ? kitDoDoc : l[0]?.id ?? null));
    }).catch((e: Error) => {
      avisar(mensagemDe(e), 'erro');
      setKits([]);
    });
    void window.estudio.preferencias().then(setPrefs);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = kits?.find((k) => k.id === idSel) ?? null;
  const tentar = async (f: () => Promise<void>) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      await f();
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const gravar = (m: Marca) => tentar(async () => trocarKit(await window.estudio.marcas.gravar(m)));
  const novo = () => tentar(async () => {
    const n = await pedirTexto({titulo: 'Novo kit de marca', rotulo: 'Nome do escritório ou da marca', botao: 'Criar', texto: 'Nasce com as cores do tema neutro; edite ao lado.'});
    if (n) trocarKit(await window.estudio.marcas.criar(n));
  });
  const duplicar = () => tentar(async () => {
    if (!sel) return;
    const n = await pedirTexto({titulo: 'Duplicar kit', rotulo: 'Nome da cópia', valor: `${sel.nome} (cópia)`, botao: 'Duplicar'});
    if (n) trocarKit(await window.estudio.marcas.duplicar(sel.id, n));
  });
  const importarLogo = () => tentar(async () => {
    const k = sel && (await window.estudio.marcas.importarLogo(sel.id));
    if (k) trocarKit(k);
  });
  const importarFonte = () => tentar(async () => {
    const k = sel && (await window.estudio.marcas.importarFonte(sel.id));
    if (k) {
      trocarKit(k);
      avisar(`${k.fontes.arquivos.length} fonte(s) no kit. Escolha-a em "Fonte do título" ou "do texto" para o kit usá-la.`, 'ok');
    }
  });
  const aplicar = () => tentar(async () => {
    if (!sel || !idDoc || !entrada) return;
    const r = await window.estudio.marcas.aplicar(sel.id, idDoc);
    await carregarDoc(idDoc);
    avisar(`Kit ${r.nome} aplicado a ${entrada.titulo}${r.copiados.length ? ` (${r.copiados.length} arquivo(s) copiado(s) para o projeto)` : ''}`, 'ok');
  });
  const trocarPasta = () => tentar(async () => {
    const pasta = await window.estudio.escolherPasta('Pasta dos kits de marca');
    if (!pasta) return;
    setPrefs(await window.estudio.gravarPreferencias({pasta_marcas: pasta}));
    const l = await window.estudio.marcas.listar();
    l.forEach(registrarFontesDoKit);
    setKits(l);
    setIdSel(l[0]?.id ?? null);
  });

  const temaFonte = ehDocCenas(doc) ? doc.tema?.fonte ?? 'Inter' : null;
  const familiasDoDoc = ehDocCenas(doc) ? ((doc.tema as {fontes_arquivos?: {familia: string}[]} | undefined)?.fontes_arquivos ?? []).map((f) => f.familia) : [];
  const familiasDoKit = sel?.fontes.arquivos.map((f) => f.familia) ?? [];

  return (
    <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && aoFechar()} onKeyDown={(e) => e.key === 'Escape' && aoFechar()}>
      <div className="dialogo marca-dialogo" role="dialog" aria-label="Marca">
        <div className="dialogo-titulo">Marca</div>
        {!kits ? <div className="vazio">carregando os kits…</div> : (
          <div className="marca-corpo">
            <aside className="marca-lista" aria-label="Kits de marca">
              {kits.map((k) => (
                <button key={k.id} className={`marca-item${k.id === idSel ? ' marcado' : ''}`} onClick={() => setIdSel(k.id)} title={k.pasta} aria-pressed={k.id === idSel}>
                  <span className="marca-cores" aria-hidden="true">{PRINCIPAIS.map((c) => <i key={c} style={{background: k.cores[c]}} />)}</span>
                  <span className="marca-nome" style={{fontFamily: fonte(k.fontes.titulo)}}>{k.nome}</span>
                  {k.id === kitDoDoc && <Check size={13} aria-label="kit deste documento" />}
                </button>
              ))}
              {kits.length === 0 && <div className="vazio">Nenhum kit nesta pasta.</div>}
              <div className="marca-lista-acoes">
                <button className="bt mini" disabled={ocupado} onClick={() => void novo()}><Plus size={13} />Novo</button>
                <button className="bt mini" disabled={ocupado || !sel} onClick={() => void duplicar()}><Copy size={13} />Duplicar</button>
              </div>
            </aside>
            <section className="marca-detalhe">
              {!sel ? <div className="vazio">Escolha um kit ao lado ou crie um novo.</div> : (
                <>
                  <div className="marca-cab">
                    <span className="marca-logo">{sel.logo ? <img src={`${sel.url}/${encodeURIComponent(sel.logo)}`} alt={`Logo ${sel.nome}`} /> : <span className="marca-sem-logo">sem logo</span>}</span>
                    <div className="marca-amostra" style={{fontFamily: fonte(sel.fontes.titulo), color: sel.cores.texto, background: sel.cores.fundo, padding: '10px 14px', borderRadius: 6}}>
                      {sel.nome}
                      <small style={{fontFamily: fonte(sel.fontes.texto), color: sel.cores.suave}}>
                        {sel.fontes.titulo}{sel.fontes.texto !== sel.fontes.titulo ? ` + ${sel.fontes.texto}` : ''} · <span style={{color: sel.cores.destaque}}>destaque</span>
                      </small>
                    </div>
                    <button className="bt mini" disabled={ocupado} onClick={() => void importarLogo()}><ImagePlus size={13} />{sel.logo ? 'Trocar logo…' : 'Importar logo…'}</button>
                  </div>
                  <div className="marca-campos">
                    <CampoTexto rotulo="Nome" valor={sel.nome} aoMudar={(v) => void gravar({...sel, nome: v})} />
                    <CampoTexto rotulo="Assinatura" valor={sel.assinatura ?? ''} aoMudar={(v) => void gravar({...sel, assinatura: v || undefined})} dica="O que vai no rodapé: @ do Instagram, site ou o nome por extenso" />
                    {[...PRINCIPAIS, ...Object.keys(sel.cores).filter((k) => !PRINCIPAIS.includes(k))].map((k) => (
                      <CampoCor key={k} rotulo={rotuloCor(k)} valor={sel.cores[k]} aoMudar={(v) => void gravar({...sel, cores: {...sel.cores, [k]: v}})} />
                    ))}
                    <CampoSelecao rotulo="Fonte do título" valor={sel.fontes.titulo} opcoes={opcoesDeFonte(familiasDoKit)} aoMudar={(v) => void gravar({...sel, fontes: {...sel.fontes, titulo: v}})} />
                    <CampoSelecao rotulo="Fonte do texto" valor={sel.fontes.texto} opcoes={opcoesDeFonte(familiasDoKit)} aoMudar={(v) => void gravar({...sel, fontes: {...sel.fontes, texto: v}})} />
                    <CampoTexto rotulo="Notas" valor={sel.notas ?? ''} multilinha aoMudar={(v) => void gravar({...sel, notas: v || undefined})} />
                  </div>
                  <div className="marca-fontes">
                    <div className="marca-rotulo">Fontes próprias (arquivo)</div>
                    {sel.fontes.arquivos.length ? (
                      <ul>
                        {sel.fontes.arquivos.map((f) => (
                          <li key={f.arquivo}>
                            <span style={{fontFamily: fonte(f.familia), fontWeight: f.peso ?? 400, fontStyle: f.estilo ?? 'normal'}}>{f.familia}</span>
                            <span className="marca-meta">{f.peso ?? 400}{f.estilo === 'italic' ? ' itálico' : ''} · {f.arquivo.replace(/^.*\//, '')}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <div className="marca-meta" style={{margin: '4px 0 8px'}}>Nenhuma. As fontes do Google (Inter, Archivo, IBM Plex) baixam na primeira vez e precisam de internet.</div>}
                    <button className="bt mini" disabled={ocupado} onClick={() => void importarFonte()}><Type size={13} />Importar fonte (.ttf, .otf, .woff, .woff2)…</button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
        <div className="marca-rodape">
          <div className="marca-doc">
            {!entrada ? <span>Nenhum documento ativo nesta área.</span> : !recebe ? <span>A cena 3D não recebe kit de marca.</span> : (
              <span>Documento ativo: <b>{entrada.titulo}</b>{kitDoDoc && <> · kit <b>{kits?.find((k) => k.id === kitDoDoc)?.nome ?? kitDoDoc}</b></>}</span>
            )}
            {temaFonte !== null && idDoc && (
              <CampoSelecao rotulo="Fonte deste vídeo" valor={temaFonte} opcoes={opcoesDeFonte(familiasDoDoc)} aoMudar={(v) => void trocar(idDoc, '/tema/fonte', v, 'fonte do tema')} />
            )}
          </div>
          {prefs && (
            <div className="marca-pasta">
              <span title={prefs.pasta_marcas}>Pasta dos kits: {prefs.pasta_marcas}</span>
              <button className="bt mini" disabled={ocupado} onClick={() => void trocarPasta()}>Trocar…</button>
              <button className="bt mini fantasma" onClick={() => window.estudio.mostrarNaPasta(prefs.pasta_marcas)} title="Abrir a pasta dos kits"><FolderSearch size={13} /></button>
            </div>
          )}
        </div>
        <div className="dialogo-botoes">
          <button className="bt fantasma" onClick={aoFechar}>Fechar</button>
          <button className="bt principal" disabled={ocupado || !sel || !recebe} onClick={() => void aplicar()}
            title={recebe ? 'Troca o tema do documento ativo pelas cores e fontes deste kit (vai para o histórico; Ctrl+Z desfaz)' : 'Abra um vídeo ou uma imagem para aplicar'}>
            Aplicar ao documento ativo
          </button>
        </div>
      </div>
    </div>
  );
};
