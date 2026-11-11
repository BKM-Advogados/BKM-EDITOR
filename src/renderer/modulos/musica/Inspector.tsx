// Propriedades da Música, pelo que está selecionado: o clipe (tempo em batidas, ganho, fades, corte), o canal (kit e
// peças), a faixa do mixer (volume, pan, EQ, compressor, envio ao reverb) ou, sem seleção, o documento (BPM, compasso,
// swing, master e a ligação com o vídeo). Tudo por patch, com diário e Ctrl+Z.
import React, {useMemo} from 'react';
import {AudioWaveform, Download, Drum, FileMusic, Music, Piano, Plus, Repeat, Scissors, SlidersVertical, Trash2} from 'lucide-react';
import {NOME_PECA, NOME_PRESET, PECAS, posicaoEmCompasso, PRESETS, PRESETS_FAIXA, resolverMusica, TEMPOS_DELAY, type CanalMusica, type DocMusica, type PresetFaixa,
  type PresetSintetizador, type TempoDelay} from '../../../nucleo/musica';
import type {FormatoMusica} from '../../../nucleo/musica-projeto';
import {LICENCAS, licencasDaMusica, NOME_LICENCA, textoDoCredito, type ClasseLicenca} from '../../../nucleo/musica-licencas';
import type {IdLicenca, LicencaSom, PecaBateria} from '../../../nucleo/musica';
import {acordeDe, NOMES} from '../../../nucleo/musica-teoria';
import {ESTILOS_GERADOS, type TipoGerado} from '../../../nucleo/musica-acoes';
import {BotaoMenu} from '../../componentes/Menu';
import {KITS} from '../../../nucleo/musica-som';
import {CabecalhoInspector, CampoDeslizante, CampoInterruptor, CampoLeitura, CampoNumero, CampoSelecao, CampoTexto, numeroBr, Secao} from '../../componentes/Campos';
import {avisar, loja, mensagemDe, useLoja} from '../../estado/loja';
import {musica, selecionarMusica, transicaoAberta, useMusica} from './estado';
import {arranjar, campo, campoEmObjeto, campoFaixa, dividirNaCabeca, encaixar, exportarMusica, gerar, importarMidiDe, licencaDoSom, novaBateria, novoAudio, novoSintetizador,
  pontosDeAutomacao, presetFaixa, progressao, sidechainDaFaixa} from './acoes';
import {useDocMusica} from './Monitor';
import {SeletorDocumento} from '../../componentes/SeletorDocumento';

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
          <div style={{padding: '0 8px 6px', display: 'flex', gap: 6}}>
            <button className="bt" onClick={() => void arranjar({acao: 'repetir', clipe: c.id, vezes: 1})} title="Uma cópia logo depois (o padrão continua)"><Repeat size={14} />Repetir</button>
            <button className="bt" onClick={() => void arranjar({acao: 'repetir', clipe: c.id, vezes: 3})}>Repetir 3×</button>
          </div>
        </Secao>
        <Secao titulo="Volume" chave="musica:clipe:volume">
          <CampoDeslizante rotulo="Ganho" min={-24} max={12} passo={0.5} valor={c.ganho_db ?? 0} padrao={0} formatar={(v) => `${numeroBr(v, 1)} dB`}
            aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, ganho_db: v})} />
          <CampoNumero rotulo="Fade de entrada" unidade="bat" valor={c.fade_in ?? 0} padrao={0} aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, fade_in: Math.max(0, v)})} />
          <CampoNumero rotulo="Fade de saída" unidade="bat" valor={c.fade_out ?? 0} padrao={0} aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, fade_out: Math.max(0, v)})} />
          <CampoInterruptor rotulo="Mudo" valor={Boolean(c.mudo)} aoMudar={(v) => void arranjar({acao: 'ajustar', clipe: c.id, mudo: v})} />
        </Secao>
        {c.audio && <LicencaDoAudio doc={doc} arquivo={c.audio} />}
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
      <CabecalhoInspector icone={iconeDoCanal(c, 18)} familia="midia" nome={c.nome} sub={`Canal de ${c.tipo === 'bateria' ? 'bateria' : c.tipo === 'sintetizador' ? 'sintetizador' : 'áudio'} · faixa ${c.faixa_mixer ?? c.id}`} dica={base} />
      <div className="insp-corpo">
        <Secao titulo="Canal" chave="musica:canal">
          <CampoTexto rotulo="Nome" valor={c.nome} aoMudar={(v) => void campo(`${base}/nome`, v || c.id, 'nome do canal')} />
          {c.tipo === 'bateria' && <CampoSelecao rotulo="Kit" valor={c.kit ?? 'eletronico'} opcoes={KITS.map((k) => [k.id, k.nome] as [string, string])}
            aoMudar={(v) => void campo(`${base}/kit`, v, `kit ${v}`)} />}
          {c.tipo === 'sintetizador' && <CampoSelecao rotulo="Som" valor={c.preset ?? 'pluck'} opcoes={PRESETS.map((x) => [x, NOME_PRESET[x]] as [PresetSintetizador, string])}
            aoMudar={(v) => void campo(`${base}/preset`, v, `som ${NOME_PRESET[v]}`)} />}
          <CampoInterruptor rotulo="Mudo" valor={Boolean(c.mudo)} aoMudar={(v) => void campo(`${base}/mudo`, v || undefined, 'mudo')} />
          <CampoInterruptor rotulo="Solo" valor={Boolean(c.solo)} aoMudar={(v) => void campo(`${base}/solo`, v || undefined, 'solo')} />
          <div style={{padding: '2px 8px 6px'}}><button className="bt" onClick={() => (selecionarMusica({tipo: 'faixa', id: c.faixa_mixer ?? c.id}), musica.definir({aba: 'mixer'}))}>
            <SlidersVertical size={14} />Faixa do mixer</button></div>
        </Secao>
        {c.tipo === 'sintetizador' && (
          <Secao titulo="Macros" chave="musica:macros">
            {([['brilho', 'Brilho', 0.5, 'abre o filtro'], ['ataque', 'Ataque', 0, 'entrada mais lenta'], ['soltura', 'Soltura', 0.3, 'cauda mais longa'],
              ['cor', 'Cor', 0.3, 'mistura e desafina os osciladores']] as const).map(([k, rotulo, padrao, dica]) => (
              <CampoDeslizante key={k} rotulo={rotulo} min={0} max={1} passo={0.05} valor={c.macros?.[k] ?? padrao} padrao={padrao} formatar={(v) => `${Math.round(v * 100)}%`}
                aoMudar={(v) => void campoEmObjeto(`${base}/macros`, k, v, `${rotulo.toLowerCase()} de ${c.nome} (${dica})`)} />
            ))}
          </Secao>
        )}
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
          <CampoDeslizante rotulo="Delay" min={0} max={1} passo={0.05} valor={f.delay} padrao={0} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoFaixa(f.id, 'delay', v || undefined, `delay de ${f.nome}`)} />
          <CampoInterruptor rotulo="Mudo" valor={f.mudo} aoMudar={(v) => void campoFaixa(f.id, 'mudo', v || undefined, 'mudo')} />
          <CampoInterruptor rotulo="Solo" valor={f.solo} aoMudar={(v) => void campoFaixa(f.id, 'solo', v || undefined, 'solo')} />
          {/* seleção nativa: o menu flutuante seria cortado na borda do painel; o preset escreve EQ, compressor e envios */}
          <CampoSelecao rotulo="Preset" valor="" opcoes={[['', 'escolher…'], ...(Object.keys(PRESETS_FAIXA) as PresetFaixa[]).map((k) => [k, PRESETS_FAIXA[k].nome] as [string, string])]}
            aoMudar={(v) => v && void presetFaixa(f.id, v as PresetFaixa)} />
        </Secao>
        <Secao titulo="EQ (três bandas)" chave="musica:eq">
          {eq('graves_db', 'Graves (200 Hz)')}
          {eq('medios_db', 'Médios (1 kHz)')}
          {eq('agudos_db', 'Agudos (5 kHz)')}
        </Secao>
        <Secao titulo="Sidechain" chave="musica:sidechain" fechadaDePadrao={!f.sidechain}>
          <CampoSelecao rotulo="Abaixa com" valor={f.sidechain?.de ?? ''}
            opcoes={[['', 'nada'], ...doc.canais.filter((k) => k.tipo !== 'audio' && (k.faixa_mixer || k.id) !== f.id).map((k) => [k.id, k.nome] as [string, string])]}
            aoMudar={(v) => void sidechainDaFaixa(f.id, v ? {...(docSc(doc, id) ?? {}), de: v} : undefined)} />
          {f.sidechain && doc.canais.find((k) => k.id === f.sidechain!.de)?.tipo === 'bateria' && (
            <CampoSelecao rotulo="Peça" valor={f.sidechain.peca} opcoes={PECAS.map((p) => [p, NOME_PECA[p]] as [string, string])} padrao="bumbo"
              aoMudar={(v) => void sidechainDaFaixa(f.id, {...docSc(doc, id)!, peca: v as PecaBateria})} />
          )}
          {f.sidechain && (
            <>
              <CampoDeslizante rotulo="Quanto" min={0} max={24} passo={0.5} valor={f.sidechain.quanto_db} padrao={6} formatar={(v) => `−${numeroBr(v, 1)} dB`}
                aoMudar={(v) => void sidechainDaFaixa(f.id, {...docSc(doc, id)!, quanto_db: v})} />
              <CampoNumero rotulo="Volta em" unidade="ms" valor={f.sidechain.soltura_ms} padrao={180} aoMudar={(v) => void sidechainDaFaixa(f.id, {...docSc(doc, id)!, soltura_ms: v})} />
            </>
          )}
        </Secao>
        <AutomacaoVolume doc={doc} alvo={f.id} fader={f.volume_db} />
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
const docSc = (doc: DocMusica, id: string) => doc.mixer.faixas.find((f) => f.id === id)?.sidechain;

/** Automação de volume por pontos (item 22): a curva toma o lugar do fader; "Ponto na cabeça" põe um ponto com o valor
 *  que a curva (ou o fader) tem ali. */
const AutomacaoVolume: React.FC<{doc: DocMusica; alvo: string; fader: number}> = ({doc, alvo, fader}) => {
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const cabeca = useMusica((e) => e.cabeca_s);
  const pontos = (doc.automacoes ?? []).find((a) => a.alvo === alvo)?.pontos ?? [];
  const valorEm = (b: number) => {
    if (!pontos.length) return fader;
    const o = [...pontos].sort((x, y) => x.em - y.em);
    if (b <= o[0].em) return o[0].db;
    const k = o.findIndex((p, i) => i === o.length - 1 || o[i + 1].em > b);
    const a = o[k], z = o[k + 1];
    return z ? a.db + ((z.db - a.db) * (b - a.em)) / Math.max(1e-9, z.em - a.em) : a.db;
  };
  const total = Math.max(m.duracao_batidas, ...pontos.map((p) => p.em), 1);
  const y = (db: number) => 4 + (1 - (Math.max(-40, Math.min(6, db)) + 40) / 46) * 32;
  const cab = cabeca / m.seg_por_batida;
  return (
    <Secao titulo="Automação de volume" chave={`musica:auto:${alvo === 'master' ? 'master' : 'faixa'}`} fechadaDePadrao={!pontos.length}>
      {pontos.length > 0 && (
        <svg className="auto-curva" viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" aria-label="curva de volume">
          <polyline points={[[0, valorEm(0)], ...pontos.map((p) => [p.em, p.db] as [number, number]), [total, valorEm(total)]].map(([b, db]) => `${b},${y(db)}`).join(' ')}
            fill="none" vectorEffect="non-scaling-stroke" />
          <line x1={cab} x2={cab} y1={0} y2={40} vectorEffect="non-scaling-stroke" className="cab" />
        </svg>
      )}
      {pontos.map((p, i) => (
        <CampoNumero key={`${i}:${p.em}`} rotulo={posicaoEmCompasso(p.em, m.compasso)} unidade="dB" valor={p.db}
          aoMudar={(v) => void pontosDeAutomacao(alvo, pontos.map((q, j) => (j === i ? {...q, db: v} : q)))} />
      ))}
      <div style={{padding: '2px 8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap'}}>
        <button className="bt" title="Um ponto na posição da cabeça, com o volume que se ouve ali"
          onClick={() => void pontosDeAutomacao(alvo, [...pontos.filter((p) => Math.abs(p.em - cab) > 1e-3), {em: cab, db: Math.round(valorEm(cab) * 10) / 10}])}>
          <Plus size={14} />Ponto na cabeça</button>
        {pontos.length > 0 && <button className="bt" onClick={() => void pontosDeAutomacao(alvo, pontos.length > 1 ? pontos.filter((p) => Math.abs(p.em - cab) > 1e-3).length < pontos.length
          ? pontos.filter((p) => Math.abs(p.em - cab) > 1e-3) : pontos.slice(0, -1) : null)} title="O ponto na cabeça, ou o último">Tirar ponto</button>}
        {pontos.length > 0 && <button className="bt" onClick={() => void pontosDeAutomacao(alvo, null)}>Tirar a automação</button>}
      </div>
    </Secao>
  );
};

/** A licença de um áudio de fora (item 24): o que a pessoa diz aqui vai para /licencas e sai nos créditos. */
const LicencaDoAudio: React.FC<{doc: DocMusica; arquivo: string}> = ({doc, arquivo}) => {
  const atual: LicencaSom = (doc.licencas ?? []).find((x) => x.arquivo === arquivo) ?? {arquivo, licenca: 'nao_sei'};
  const mudar = (parcial: Partial<LicencaSom>) => void licencaDoSom({...atual, ...parcial, arquivo});
  return (
    <Secao titulo="Licença do áudio" chave="musica:licenca" fechadaDePadrao={atual.licenca !== 'nao_sei'}>
      <CampoSelecao rotulo="Licença" valor={atual.licenca} opcoes={LICENCAS.map((x) => [x, NOME_LICENCA[x]] as [string, string])} padrao="nao_sei"
        aoMudar={(v) => mudar({licenca: v as IdLicenca})} />
      {atual.licenca === 'nao_sei' && <CampoLeitura rotulo="Publicar">diga a licença antes de publicar</CampoLeitura>}
      {(atual.licenca === 'CC-BY-4.0' || atual.credito) && (
        <>
          <CampoTexto rotulo="Título" valor={atual.titulo ?? ''} aoMudar={(v) => mudar({titulo: v || undefined})} />
          <CampoTexto rotulo="Autor" valor={atual.autor ?? ''} aoMudar={(v) => mudar({autor: v || undefined})} />
          <CampoTexto rotulo="Endereço" valor={atual.link ?? ''} aoMudar={(v) => mudar({link: v || undefined})} />
          <CampoTexto rotulo="Crédito exigido" valor={atual.credito ?? ''} dica="O texto que a licença pede, literal; vazio, o crédito é montado dos campos acima"
            aoMudar={(v) => mudar({credito: v || undefined})} />
          <CampoLeitura rotulo="Sai assim">{textoDoCredito(atual)}</CampoLeitura>
        </>
      )}
    </Secao>
  );
};

const CLASSE: Record<ClasseLicenca, string> = {livre: 'livre', credito: 'pede crédito', declarado: 'declarado pela pessoa', sem_licenca: 'sem licença'};

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
  const [viradas, setViradas] = React.useState(true);
  const licencas = useMemo(() => licencasDaMusica(doc), [doc]);
  const [formato, setFormato] = React.useState<FormatoMusica>('wav');
  const [stems, setStems] = React.useState(false);
  const [exportando, setExportando] = React.useState(false);
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
        <Secao titulo="Seções" chave="musica:secoes">
          {(doc.secoes ?? []).map((s) => (
            <CampoTexto key={s.id} rotulo={`${posicaoEmCompasso(s.em, m.compasso)} · ${Math.round(s.dur / m.batidas_por_compasso)} comp.`} valor={s.nome}
              dica="Arraste a seção no arranjo para mover com os clipes dela" aoMudar={(v) => void arranjar({acao: 'secao', secao: s.id, nome: v || s.id})} />
          ))}
          <div style={{padding: '2px 8px 6px'}}>
            <button className="bt" title="Quatro compassos a partir do compasso da cabeça"
              onClick={() => void arranjar({acao: 'secao', nome: `Seção ${(doc.secoes?.length ?? 0) + 1}`,
                em: Math.floor(musica.get().cabeca_s / m.seg_por_batida / m.batidas_por_compasso) * m.batidas_por_compasso, dur: 4 * m.batidas_por_compasso})}>
              <Plus size={14} />Seção na cabeça</button>
          </div>
        </Secao>
        <Secao titulo="Tom e acordes" chave="musica:acordes">
          <CampoSelecao rotulo="Tom" valor={doc.tom ?? 'C'} opcoes={NOMES.map((n) => [n, n] as [string, string])} padrao="C" aoMudar={(v) => void campo('/tom', v, `tom ${v}`)} />
          <CampoSelecao rotulo="Escala" valor={doc.escala ?? 'maior'} opcoes={[['maior', 'maior'], ['menor', 'menor']]} padrao="maior"
            aoMudar={(v) => void campo('/escala', v, `escala ${v}`)} />
          <CampoTexto rotulo="Acordes" valor={(doc.acordes ?? []).map((a) => a.acorde).join(' ')}
            dica="Um por compasso, a partir do começo: graus (I vi IV V, V7, ii7) ou cifras (C Am F G, F/C)"
            invalido={(v) => v.split(/[\s,|]+/).filter(Boolean).find((s) => !acordeDe(s, doc.tom, doc.escala)) ? 'há acorde que não entendo' : null}
            aoMudar={(v) => void (v.trim() ? progressao(v) : campo('/acordes', undefined, 'tira os acordes'))} />
          {doc.acordes?.length ? <CampoLeitura rotulo="Soam">{doc.acordes.map((a) => acordeDe(a.acorde, doc.tom, doc.escala)?.nome ?? '?').join(' · ')}</CampoLeitura> : null}
          <div style={{padding: '2px 8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap'}}>
            {(['baixo', 'arpejo', 'acordes'] as TipoGerado[]).map((t) => (
              <BotaoMenu key={t} titulo={`Gerar ${t} dos acordes`} className="bt" rotulo={`Gerar ${t}`} icone={<Piano size={14} />} acima
                itens={ESTILOS_GERADOS[t].map((e) => ({rotulo: e.replace('_', ' e '), acao: () => void gerar(t, e)}))} />
            ))}
          </div>
        </Secao>
        <Secao titulo="Master" chave="musica:master">
          <CampoDeslizante rotulo="Volume" min={-40} max={12} passo={0.5} valor={m.master.volume_db} padrao={0} formatar={(v) => `${numeroBr(v, 1)} dB`}
            aoMudar={(v) => void campo('/mixer/master/volume_db', v, 'volume do master')} />
          <CampoDeslizante rotulo="Sala do reverb" min={0} max={1} passo={0.05} valor={m.master.reverb.tamanho} padrao={0.6} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/reverb', 'tamanho', v, 'sala do reverb')} />
          <CampoDeslizante rotulo="Abafar o reverb" min={0} max={1} passo={0.05} valor={m.master.reverb.amortecimento} padrao={0.4} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/reverb', 'amortecimento', v, 'amortecimento do reverb')} />
          <CampoInterruptor rotulo="Limitador" valor={m.master.limitador.ativo} texto={`segura o pico em ${numeroBr(m.master.limitador.teto_db, 1)} dB`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/limitador', 'ativo', v, v ? 'liga o limitador' : 'desliga o limitador')} />
          {m.master.limitador.ativo && (
            <CampoDeslizante rotulo="Teto" min={-12} max={0} passo={0.1} valor={m.master.limitador.teto_db} padrao={-1} formatar={(v) => `${numeroBr(v, 1)} dB`}
              aoMudar={(v) => void campoEmObjeto('/mixer/master/limitador', 'teto_db', v, 'teto do limitador')} />
          )}
        </Secao>
        <AutomacaoVolume doc={doc} alvo="master" fader={m.master.volume_db} />
        <Secao titulo="Delay (retorno 2)" chave="musica:delay" fechadaDePadrao={!m.faixas.some((x) => x.delay > 0)}>
          <CampoSelecao rotulo="Tempo" valor={m.master.delay.tempo} padrao="1/8."
            opcoes={(Object.keys(TEMPOS_DELAY) as TempoDelay[]).map((t) => [t, `${t} (${numeroBr(TEMPOS_DELAY[t], 2)} batida)`] as [string, string])}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/delay', 'tempo', v, `delay em ${v}`)} />
          <CampoDeslizante rotulo="Repetições" min={0} max={0.9} passo={0.05} valor={m.master.delay.realimentacao} padrao={0.35} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/delay', 'realimentacao', v, 'repetições do delay')} />
          <CampoDeslizante rotulo="Brilho" min={0} max={1} passo={0.05} valor={m.master.delay.brilho} padrao={0.5} formatar={(v) => `${Math.round(v * 100)}%`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/delay', 'brilho', v, 'brilho do delay')} />
          <CampoInterruptor rotulo="Pingue-pongue" valor={m.master.delay.pingue_pongue} texto="cada repetição troca de lado"
            aoMudar={(v) => void campoEmObjeto('/mixer/master/delay', 'pingue_pongue', v, 'pingue-pongue do delay')} />
          <CampoDeslizante rotulo="Volume" min={-40} max={12} passo={0.5} valor={m.master.delay.volume_db} padrao={0} formatar={(v) => `${numeroBr(v, 1)} dB`}
            aoMudar={(v) => void campoEmObjeto('/mixer/master/delay', 'volume_db', v, 'volume do delay')} />
          {!m.faixas.some((x) => x.delay > 0) && <CampoLeitura rotulo="Envio">nenhuma faixa manda para o delay: suba o "Delay" numa faixa</CampoLeitura>}
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
          {doc.video && (
            <>
              <CampoInterruptor rotulo="Viradas" valor={viradas} aoMudar={setViradas} texto="uma virada de bateria antes de cada corte" />
              <div style={{padding: '2px 8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap'}}>
                <button className="bt" title="Compassos inteiros até o último quadro (o BPM muda até 8%)" onClick={() => void encaixar('duracao')}>Fechar no fim do vídeo</button>
                <button className="bt" title="Uma seção por cena, no compasso mais perto de cada corte" onClick={() => void encaixar('cortes', viradas)}>Seções nas cenas</button>
                <button className="bt principal" title="Os dois" onClick={() => void encaixar('tudo', viradas)}>Encaixar tudo</button>
              </div>
            </>
          )}
        </Secao>
        <Secao titulo="Licenças e créditos" chave="musica:licencas" fechadaDePadrao={licencas.pode_publicar && !licencas.creditos.length}>
          {licencas.sons.map((x) => (
            <CampoLeitura key={`${x.tipo}:${x.id}`} rotulo={x.nome} dica={x.canais.join(', ')}>
              <span className={`selo-licenca ${x.classe}`}>{CLASSE[x.classe]}</span> {NOME_LICENCA[x.licenca]}</CampoLeitura>
          ))}
          {!licencas.sons.length && <CampoLeitura rotulo="Sons">nenhum som tocando</CampoLeitura>}
          <CampoLeitura rotulo="Publicar">{licencas.pode_publicar ? 'pode' : 'falta dizer a licença (no inspetor do clipe)'}</CampoLeitura>
          {licencas.creditos.length > 0 && <CampoLeitura rotulo="Créditos">{licencas.creditos.join(' · ')}</CampoLeitura>}
        </Secao>
        <Secao titulo="Exportar" chave="musica:exportar">
          <CampoSelecao rotulo="Formato" valor={formato} opcoes={[['wav', 'WAV (24 bits)'], ['m4a', 'M4A (AAC)'], ['opus', 'Opus'], ['mid', 'MIDI (só as notas)']]}
            aoMudar={(v) => setFormato(v as FormatoMusica)} />
          {formato !== 'mid' && <CampoInterruptor rotulo="Stems" valor={stems} aoMudar={setStems} texto="um WAV por faixa e por retorno" />}
          {formato !== 'mid' && <CampoLeitura rotulo="Loudness">{numeroBr(doc.alvo_lufs ?? -14, 1)} LUFS, pico até {numeroBr(doc.pico_dbtp ?? -1, 1)} dBTP</CampoLeitura>}
          <div style={{padding: '2px 8px 6px'}}>
            <button className="bt principal" disabled={exportando} onClick={() => (setExportando(true), void exportarMusica({formato, stems: formato !== 'mid' && stems}).finally(() => setExportando(false)))}>
              <Download size={14} />{exportando ? 'Exportando…' : 'Exportar em saidas/'}</button>
          </div>
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
  // com mais de uma música no projeto, o seletor do topo troca a aberta (sem ele, a segunda escondia a primeira)
  const seletor = <SeletorDocumento modulo="musica" aoTrocar={() => selecionarMusica(null)} />;
  if (!doc) return <div className="lista-musica">{seletor}<div className="vazio">sem música aberta</div></div>;
  return (
    <div className="lista-musica">
      {seletor}
      <div className="itens">
        <div className={`item${!s ? ' sel' : ''}`} onClick={() => selecionarMusica(null)}><Music size={14} /><span className="nome">Música inteira</span></div>
        {doc.canais.map((c) => (
          <React.Fragment key={c.id}>
            <div className={`item${s?.tipo === 'canal' && s.id === c.id ? ' sel' : ''}`} onClick={() => selecionarMusica({tipo: 'canal', id: c.id})}>
              {iconeDoCanal(c, 14)}<span className="nome">{c.nome}</span>
              <span className="ler" style={{fontSize: "var(--tam-1)"}}>{doc.arranjo.clipes.filter((x) => x.canal === c.id).length}</span>
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
  const midi = React.useRef<HTMLInputElement>(null);
  return (
    <div className="rodape-lista">
      <input ref={midi} type="file" accept=".mid,.midi,audio/midi" hidden
        onChange={(e) => {
          const a = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (a) void importarMidiDe(a);
        }} />
      <button className="bt" onClick={() => void novaBateria()} title="Canal de bateria com o estilo básico, já no arranjo"><Drum size={14} />+ Bateria</button>
      <BotaoMenu titulo="Canal de sintetizador, já no arranjo" className="bt" rotulo="+ Instrumento" icone={<Piano size={14} />} acima
        itens={PRESETS.map((x) => ({rotulo: NOME_PRESET[x], acao: () => void novoSintetizador(x)}))} />
      <button className="bt" disabled={carregando} onClick={() => (setCarregando(true), void novoAudio().finally(() => setCarregando(false)))} title="Um arquivo de áudio num canal novo">
        <AudioWaveform size={14} />+ Áudio…</button>
      <button className="bt" onClick={() => midi.current?.click()} title="Um canal por trilha do .mid, com o padrão e o clipe"><FileMusic size={14} />+ MIDI…</button>
    </div>
  );
};

export const iconeDoCanal = (c: Pick<CanalMusica, 'tipo'>, tamanho: number) =>
  c.tipo === 'bateria' ? <Drum size={tamanho} /> : c.tipo === 'sintetizador' ? <Piano size={tamanho} /> : <AudioWaveform size={tamanho} />;
