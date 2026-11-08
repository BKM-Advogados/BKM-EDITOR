// Propriedades da Música, pelo que está selecionado: o clipe (tempo em batidas, ganho, fades, corte), o canal (kit e
// peças), a faixa do mixer (volume, pan, EQ, compressor, envio ao reverb) ou, sem seleção, o documento (BPM, compasso,
// swing, master e a ligação com o vídeo). Tudo por patch, com diário e Ctrl+Z.
import React, {useMemo} from 'react';
import {AudioWaveform, Drum, Music, Scissors, SlidersVertical, Trash2} from 'lucide-react';
import {NOME_PECA, PECAS, resolverMusica, type DocMusica} from '../../../nucleo/musica';
import {KITS} from '../../../nucleo/musica-som';
import {CabecalhoInspector, CampoDeslizante, CampoInterruptor, CampoLeitura, CampoNumero, CampoSelecao, CampoTexto, numeroBr, Secao} from '../../componentes/Campos';
import {avisar, loja, mensagemDe, useLoja} from '../../estado/loja';
import {musica, selecionarMusica, transicaoAberta, useMusica} from './estado';
import {arranjar, campo, campoEmObjeto, campoFaixa, dividirNaCabeca, novaBateria, novoAudio} from './acoes';
import {useDocMusica} from './Monitor';

const InspectorClipe: React.FC<{doc: DocMusica; id: string}> = ({doc, id}) => {
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const c = doc.arranjo.clipes.find((x) => x.id === id);
  const cp = m.clipes.find((x) => x.id === id);
  if (!c || !cp) return <div className="vazio">clipe não achado</div>;
  const canal = doc.canais.find((k) => k.id === c.canal);
  const nome = c.audio ? c.audio.split('/').pop()! : doc.padroes.find((p) => p.id === c.padrao)?.nome ?? c.padrao ?? c.id;
  return (
    <div className="painel">
      <CabecalhoInspector icone={c.audio ? <AudioWaveform /> : <Drum />} familia="midia" nome={nome} sub={`Clipe ${c.id} · ${canal?.nome ?? c.canal}`} dica={`/arranjo/clipes/${cp.indice}`} />
      <div className="insp-corpo">
        <Secao titulo="Tempo (em batidas)" chave="musica:clipe:tempo">
          <CampoNumero rotulo="Começa em" unidade="bat" valor={c.em} aoMudar={(v) => void arranjar({acao: 'mover', clipe: c.id, em: v})}
            dica={`${numeroBr(cp.em_s, 2)} s da música`} />
          <CampoNumero rotulo="Duração" unidade="bat" valor={c.dur} aoMudar={(v) => void arranjar({acao: 'aparar', clipe: c.id, dur: v})} dica={`${numeroBr(cp.dur_s, 2)} s`} />
          {c.audio && <CampoNumero rotulo="Corte no arquivo" unidade="s" valor={c.corte_s ?? 0} padrao={0} aoMudar={(v) => void campo(`/arranjo/clipes/${cp.indice}/corte_s`, Math.max(0, v), 'corte')} />}
          {c.padrao && <CampoNumero rotulo="Começa no padrão" unidade="bat" valor={c.inicio ?? 0} padrao={0}
            aoMudar={(v) => void campo(`/arranjo/clipes/${cp.indice}/inicio`, v > 0 ? v : undefined, 'início no padrão')} />}
          <div style={{padding: '2px 8px 6px', display: 'flex', gap: 6}}>
            <button className="bt" onClick={() => void dividirNaCabeca()} title="S"><Scissors size={14} />Dividir na cabeça</button>
            <button className="bt" onClick={() => void arranjar({acao: 'apagar', clipe: c.id}).then((e) => e && selecionarMusica(null))} title="Delete"><Trash2 size={14} />Apagar</button>
          </div>
        </Secao>
        <Secao titulo="Volume" chave="musica:clipe:volume">
          <CampoDeslizante rotulo="Ganho" min={-24} max={12} passo={0.5} valor={c.ganho_db ?? 0} padrao={0} formatar={(v) => `${numeroBr(v, 1)} dB`}
            aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, ganho_db: v})} />
          <CampoNumero rotulo="Fade de entrada" unidade="bat" valor={c.fade_in ?? 0} padrao={0} aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, fade_in: Math.max(0, v)})} />
          <CampoNumero rotulo="Fade de saída" unidade="bat" valor={c.fade_out ?? 0} padrao={0} aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, fade_out: Math.max(0, v)})} />
          <CampoInterruptor rotulo="Mudo" valor={Boolean(c.mudo)} aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, mudo: v})} />
        </Secao>
        {c.origem && <div className="vazio">Este áudio veio do clipe {c.origem.clipe} do vídeo. Os fades, o volume e o ducking continuam lá.</div>}
      </div>
    </div>
  );
};

const InspectorCanal: React.FC<{doc: DocMusica; id: string}> = ({doc, id}) => {
  const i = doc.canais.findIndex((k) => k.id === id);
  const c = doc.canais[i];
  if (!c) return <div className="vazio">canal não achado</div>;
  const base = `/canais/${i}`;
  return (
    <div className="painel">
      <CabecalhoInspector icone={c.tipo === 'bateria' ? <Drum /> : <AudioWaveform />} familia="midia" nome={c.nome} sub={`Canal de ${c.tipo === 'bateria' ? 'bateria' : 'áudio'} · faixa ${c.faixa_mixer ?? c.id}`} dica={base} />
      <div className="insp-corpo">
        <Secao titulo="Canal" chave="musica:canal">
          <CampoTexto rotulo="Nome" valor={c.nome} aoMudar={(v) => void campo(`${base}/nome`, v || c.id, 'nome do canal')} />
          {c.tipo === 'bateria' && <CampoSelecao rotulo="Kit" valor={c.kit ?? 'eletronico'} opcoes={KITS.map((k) => [k.id, k.nome] as [string, string])}
            aoMudar={(v) => void campo(`${base}/kit`, v, `kit ${v}`)} />}
          <CampoInterruptor rotulo="Mudo" valor={Boolean(c.mudo)} aoMudar={(v) => void campo(`${base}/mudo`, v || undefined, 'mudo')} />
          <CampoInterruptor rotulo="Solo" valor={Boolean(c.solo)} aoMudar={(v) => void campo(`${base}/solo`, v || undefined, 'solo')} />
          <div style={{padding: '2px 8px 6px'}}><button className="bt" onClick={() => (selecionarMusica({tipo: 'faixa', id: c.faixa_mixer ?? c.id}), musica.definir({aba: 'mixer'}))}>
            <SlidersVertical size={14} />Faixa do mixer</button></div>
        </Secao>
        {c.tipo === 'bateria' && (
          <Secao titulo="Peças" chave="musica:pecas" fechadaDePadrao>
            {PECAS.map((p) => {
              const aj = c.pecas?.[p] ?? {};
              return (
                <React.Fragment key={p}>
                  <CampoDeslizante rotulo={NOME_PECA[p]} min={-24} max={6} passo={0.5} valor={aj.volume_db ?? 0} padrao={0} formatar={(v) => `${numeroBr(v, 1)} dB`}
                    aoMudar={(v) => void campoEmObjeto(`${base}/pecas`, p, v === 0 && !aj.afinacao && !aj.pan ? undefined : {...aj, volume_db: v}, `volume de ${NOME_PECA[p]}`)} />
                  <CampoDeslizante rotulo={`${NOME_PECA[p]}: afinação`} min={-12} max={12} passo={1} valor={aj.afinacao ?? 0} padrao={0} formatar={(v) => `${v > 0 ? '+' : ''}${v} st`}
                    aoMudar={(v) => void campoEmObjeto(`${base}/pecas`, p, {...aj, afinacao: v || undefined}, `afinação de ${NOME_PECA[p]}`)} />
                </React.Fragment>
              );
            })}
          </Secao>
        )}
      </div>
    </div>
  );
};

const InspectorFaixa: React.FC<{doc: DocMusica; id: string}> = ({doc, id}) => {
  const f = useMemo(() => resolverMusica(doc).musica.faixas.find((x) => x.id === id), [doc, id]);
  if (!f) return <div className="vazio">faixa não achada</div>;
  const eq = (k: 'graves_db' | 'medios_db' | 'agudos_db', rotulo: string) => (
    <CampoDeslizante rotulo={rotulo} min={-18} max={18} passo={0.5} valor={f.eq[k]} padrao={0} formatar={(v) => `${v > 0 ? '+' : ''}${numeroBr(v, 1)} dB`}
      aoMudar={(v) => void campoFaixa(f.id, 'eq', {...docEq(doc, id), [k]: v || undefined}, `EQ ${rotulo.toLowerCase()} de ${f.nome}`)} />
  );
  const comp = (k: string, valor: unknown, rotulo: string) => void campoFaixa(f.id, 'compressor', {...docComp(doc, id), [k]: valor}, `${rotulo} do compressor de ${f.nome}`);
  return (
    <div className="painel">
      <CabecalhoInspector icone={<SlidersVertical />} familia="efeito" nome={f.nome} sub="Faixa do mixer" dica={f.id} />
      <div className="insp-corpo">
        <Secao titulo="Faixa" chave="musica:faixa">
          <CampoDeslizante rotulo="Volume" min={-40} max={12} passo={0.5} valor={f.volume_db} padrao={0} formatar={(v) => `${numeroBr(v, 1)} dB`}
            aoMudar={(v) => void campoFaixa(f.id, 'volume_db', v, `volume de ${f.nome}`)} />
          <CampoDeslizante rotulo="Pan" min={-1} max={1} passo={0.05} valor={f.pan} padrao={0} formatar={(v) => (v === 0 ? 'centro' : v < 0 ? `${Math.round(-v * 100)} E` : `${Math.round(v * 100)} D`)}
            aoMudar={(v) => void campoFaixa(f.id, 'pan', v, `pan de ${f.nome}`)} />
          <CampoDeslizante rotulo="Reverb" min={0} max={1} passo={0.05} valor={f.reverb} padrao={0} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoFaixa(f.id, 'reverb', v || undefined, `reverb de ${f.nome}`)} />
          <CampoInterruptor rotulo="Mudo" valor={f.mudo} aoMudar={(v) => void campoFaixa(f.id, 'mudo', v || undefined, 'mudo')} />
          <CampoInterruptor rotulo="Solo" valor={f.solo} aoMudar={(v) => void campoFaixa(f.id, 'solo', v || undefined, 'solo')} />
        </Secao>
        <Secao titulo="EQ (três bandas)" chave="musica:eq">
          {eq('graves_db', 'Graves (200 Hz)')}
          {eq('medios_db', 'Médios (1 kHz)')}
          {eq('agudos_db', 'Agudos (5 kHz)')}
        </Secao>
        <Secao titulo="Compressor" chave="musica:comp" fechadaDePadrao={!f.compressor.ativo}>
          <CampoInterruptor rotulo="Ligado" valor={f.compressor.ativo} aoMudar={(v) => comp('ativo', v || undefined, 'ligar')} />
          <CampoDeslizante rotulo="Limiar" min={-60} max={0} passo={1} valor={f.compressor.limiar_db} padrao={-18} formatar={(v) => `${v} dB`} aoMudar={(v) => comp('limiar_db', v, 'limiar')} />
          <CampoDeslizante rotulo="Razão" min={1} max={20} passo={0.5} valor={f.compressor.razao} padrao={3} formatar={(v) => `${numeroBr(v, 1)}:1`} aoMudar={(v) => comp('razao', v, 'razão')} />
          <CampoNumero rotulo="Ataque" unidade="ms" valor={f.compressor.ataque_ms} padrao={10} aoMudar={(v) => comp('ataque_ms', v, 'ataque')} />
          <CampoNumero rotulo="Soltura" unidade="ms" valor={f.compressor.soltura_ms} padrao={120} aoMudar={(v) => comp('soltura_ms', v, 'soltura')} />
          <CampoDeslizante rotulo="Compensação" min={0} max={24} passo={0.5} valor={f.compressor.ganho_db} padrao={0} formatar={(v) => `+${numeroBr(v, 1)} dB`} aoMudar={(v) => comp('ganho_db', v || undefined, 'compensação')} />
        </Secao>
      </div>
    </div>
  );
};
const docEq = (doc: DocMusica, id: string) => doc.mixer.faixas.find((f) => f.id === id)?.eq ?? {};
const docComp = (doc: DocMusica, id: string) => doc.mixer.faixas.find((f) => f.id === id)?.compressor ?? {};

const InspectorDocumento: React.FC<{doc: DocMusica; id: string}> = ({doc, id}) => {
  const titulo = useLoja((e) => e.info?.manifesto.documentos.find((d) => d.id === id)?.titulo ?? id);
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const aberta = useMusica((e) => transicaoAberta(e));
  const ligacoes = useLoja((e) => (e.info?.manifesto.documentos ?? []).filter((d) => d.modulo === 'video').flatMap((d) => {
    const v = e.docs[d.id]?.doc as {audio?: {faixas?: {clipes?: {id: string; musica?: string}[]}[]}} | undefined;
    return (v?.audio?.faixas ?? []).flatMap((f) => (f.clipes ?? []).filter((c) => c.musica === id).map((c) => `${d.id}/${c.id}`));
  }));
  const porNoVideo = async () => {
    try {
      const r = await window.estudio.musica.porNoVideo({musica: id});
      avisar(`Música no vídeo (${r.caminho.split('@').pop()})`, 'ok');
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };
  return (
    <div className="painel">
      <CabecalhoInspector icone={<Music />} familia="midia" nome={titulo} sub={`Música · ${numeroBr(m.duracao_s, 1)} s · ${m.canais.length} ${m.canais.length === 1 ? 'canal' : 'canais'}`} dica={id} />
      <div className="insp-corpo">
        <Secao titulo="Música" chave="musica:doc">
          <CampoTexto rotulo="Título" valor={titulo} aoMudar={(v) => void window.estudio.renomearDocumento(id, v).then(() => window.estudio.projetoAtual()).then((i) => i && loja.definir({info: i}))} />
          <CampoNumero rotulo="BPM" valor={doc.bpm} padrao={120} aoMudar={(v) => void campo('/bpm', Math.min(300, Math.max(20, v)), `BPM ${v}`)} />
          <CampoSelecao rotulo="Compasso" valor={`${m.compasso[0]}/${m.compasso[1]}`} opcoes={[['4/4', '4/4'], ['3/4', '3/4'], ['2/4', '2/4'], ['6/8', '6/8']]}
            aoMudar={(v) => void campo('/compasso', v.split('/').map(Number), `compasso ${v}`)} />
          <CampoDeslizante rotulo="Swing" min={0} max={1} passo={0.05} valor={m.swing} padrao={0} formatar={(v) => `${Math.round(v * 100)}%`} aoMudar={(v) => void campo('/swing', v, 'swing')} />
          <CampoNumero rotulo="Semente" valor={m.semente} padrao={1} dica="O ruído das peças sai desta semente: o mesmo número dá o mesmo som" aoMudar={(v) => void campo('/semente', Math.round(v), 'semente')} />
        </Secao>
        <Secao titulo="Master" chave="musica:master">
          <CampoDeslizante rotulo="Volume" min={-40} max={12} passo={0.5} valor={m.master.volume_db} padrao={0} formatar={(v) => `${numeroBr(v, 1)} dB`}
            aoMudar={(v) => void campo('/mixer/master/volume_db', v, 'volume do master')} />
          <CampoDeslizante rotulo="Sala do reverb" min={0} max={1} passo={0.05} valor={m.master.reverb.tamanho} padrao={0.6} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/reverb', 'tamanho', v, 'sala do reverb')} />
          <CampoDeslizante rotulo="Abafar o reverb" min={0} max={1} passo={0.05} valor={m.master.reverb.amortecimento} padrao={0.4} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/reverb', 'amortecimento', v, 'amortecimento do reverb')} />
        </Secao>
        <Secao titulo="Vídeo" chave="musica:video">
          {doc.video ? (
            <>
              <CampoLeitura rotulo="Vídeo">{doc.video.documento}</CampoLeitura>
              <CampoNumero rotulo="Começa no vídeo" unidade="s" valor={(doc.video.em_ms ?? 0) / 1000} aoMudar={(v) => void campo('/video/em_ms', Math.max(0, Math.round(v * 1000)), 'começo no vídeo')} />
              <CampoInterruptor rotulo="Voz guia" valor={doc.video.voz_guia !== false} aoMudar={(v) => void campo('/video/voz_guia', v, 'voz guia')} texto="a voz do vídeo toca aqui, fora da música" />
            </>
          ) : <CampoLeitura rotulo="Vídeo">sem vídeo ligado</CampoLeitura>}
          <CampoLeitura rotulo="Toca em">{ligacoes.length ? ligacoes.join(', ') : 'nenhum clipe'}</CampoLeitura>
          {!aberta && <div style={{padding: '2px 8px 6px'}}><button className="bt" onClick={() => void porNoVideo()}>Pôr no vídeo</button></div>}
        </Secao>
      </div>
    </div>
  );
};

export const InspectorMusica: React.FC = () => {
  const {id, doc} = useDocMusica();
  const s = useMusica((e) => e.selecao);
  if (!doc || !id) return <div className="vazio">sem música aberta</div>;
  if (s?.tipo === 'clipe') return <InspectorClipe doc={doc} id={s.id} />;
  if (s?.tipo === 'canal') return <InspectorCanal doc={doc} id={s.id} />;
  if (s?.tipo === 'faixa') return <InspectorFaixa doc={doc} id={s.id} />;
  if (s?.tipo === 'padrao') {
    const p = doc.padroes.find((x) => x.id === s.id);
    if (p) return <InspectorCanal doc={doc} id={p.canal} />;
  }
  return <InspectorDocumento doc={doc} id={id} />;
};

export const ListaMusica: React.FC = () => {
  const {doc} = useDocMusica();
  const s = useMusica((e) => e.selecao);
  if (!doc) return <div className="vazio">sem música aberta</div>;
  return (
    <div className="lista-musica">
      <div className="itens">
        <div className={`item${!s ? ' sel' : ''}`} onClick={() => selecionarMusica(null)}><Music size={14} /><span className="nome">Música inteira</span></div>
        {doc.canais.map((c) => (
          <React.Fragment key={c.id}>
            <div className={`item${s?.tipo === 'canal' && s.id === c.id ? ' sel' : ''}`} onClick={() => selecionarMusica({tipo: 'canal', id: c.id})}>
              {c.tipo === 'bateria' ? <Drum size={14} /> : <AudioWaveform size={14} />}<span className="nome">{c.nome}</span>
              <span className="ler" style={{fontSize: 10}}>{doc.arranjo.clipes.filter((x) => x.canal === c.id).length}</span>
            </div>
            {doc.padroes.filter((p) => p.canal === c.id).map((p) => (
              <div key={p.id} className={`item sub${s?.tipo === 'padrao' && s.id === p.id ? ' sel' : ''}`}
                onClick={() => (selecionarMusica({tipo: 'padrao', id: p.id}), musica.definir({aba: 'passos'}))}>
                <span className="nome">{p.nome ?? p.id} · {p.notas.length} notas</span>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <ListaRodape />
    </div>
  );
};

const ListaRodape: React.FC = () => {
  const [carregando, setCarregando] = React.useState(false);
  return (
    <div className="rodape-lista">
      <button className="bt" onClick={() => void novaBateria()} title="Canal de bateria com o estilo básico, já no arranjo"><Drum size={14} />+ Bateria</button>
      <button className="bt" disabled={carregando} onClick={() => (setCarregando(true), void novoAudio().finally(() => setCarregando(false)))} title="Um arquivo de áudio num canal novo">
        <AudioWaveform size={14} />+ Áudio…</button>
    </div>
  );
};
