// Como rodar o ffmpeg do compositor do Remotion: o nome do executável e o ambiente que ele precisa. Todo spawn do ffmpeg
// do app (som, música, loudness, limpeza de voz, transcrição, imagem do pixelizar) e dos testes passa por aqui.
// Sem Electron: vale no app, no MCP por stdio (dist-mcp/) e no vitest.

export const executavelDoFfmpeg = (plataforma: NodeJS.Platform = process.platform) => (plataforma === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

/** As bibliotecas do ffmpeg ficam ao lado dele, e no Mac ele as pede pelo nome curto ("libavcodec.dylib", sem @rpath):
 *  sem a pasta no DYLD_LIBRARY_PATH (Mac) ou no LD_LIBRARY_PATH (Linux) o carregador aborta o ffmpeg (SIGABRT) antes
 *  de ele começar. Com o app assinado no Mac, o DYLD_LIBRARY_PATH só vale porque o ffmpeg leva o entitlement
 *  allow-dyld-environment-variables (build/entitlements.filhos.plist). */
export const ambienteDoFfmpeg = (pasta: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({...base, LD_LIBRARY_PATH: pasta, DYLD_LIBRARY_PATH: pasta});

/** Opções de spawn/execFile para o ffmpeg da `pasta`: roda de dentro dela (o Mac também procura as bibliotecas na pasta
 *  atual, como o Remotion faz) e com o ambiente acima. */
export const opcoesDoFfmpeg = (pasta: string) => ({cwd: pasta, env: ambienteDoFfmpeg(pasta), windowsHide: true});
