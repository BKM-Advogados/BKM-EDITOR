// O que o forge.config.ts passa ao @electron/packager para o Mac: id e categoria do app, o Info.plist (o texto do pedido
// de microfone e as pastas arrastadas no ícone) e, só quando as variáveis da Apple estão no ambiente, a assinatura com
// hardened runtime e a notarização. Sem elas o .app sai sem assinatura (docs/portes.md ensina o "abrir mesmo assim").
// Só dados e decisões: o vitest confere sem precisar de um Mac.
import path from 'node:path';

export const ID_DO_APP = 'br.com.bkmadvogados.estudio';

/** whisper-cli compilado à parte (o CI compila o whisper.cpp no Mac): o empacotamento o copia para resources/whisper. */
export const WHISPER_EMBUTIDO_ENV = 'ESTUDIO_WHISPER_EMBUTIDO';

/** Chaves somadas ao Info.plist do Estudio.app. */
export const INFO_PLIST = {
  // sem este texto o macOS derruba o app quando a gravação de narração pede o microfone
  NSMicrophoneUsageDescription: 'O Estúdio usa o microfone para gravar a narração dos seus vídeos. Nada sai do seu Mac.',
  // a pasta de um projeto arrastada para o ícone do Dock abre no Estúdio (main.ts, evento open-file)
  CFBundleDocumentTypes: [{CFBundleTypeName: 'Pasta de projeto do Estúdio', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate',
    LSItemContentTypes: ['public.folder']}],
  NSHumanReadableCopyright: 'BKM Advogados',
};

export const opcoesDoMac = () => ({
  appBundleId: ID_DO_APP,
  appCategoryType: 'public.app-category.video',
  appCopyright: 'BKM Advogados',
  darwinDarkModeSupport: true,
  extendInfo: INFO_PLIST,
});

const PASTA_BUILD = path.join(__dirname);
export const ENTITLEMENTS_APP = path.join(PASTA_BUILD, 'entitlements.mac.plist');
export const ENTITLEMENTS_FILHOS = path.join(PASTA_BUILD, 'entitlements.filhos.plist');

/** Binários de fora do Electron que o app roda como processo filho: o compositor do Remotion (ffmpeg, ffprobe,
 *  remotion), o navegador de render e o whisper-cli. O ffmpeg do Remotion acha as bibliotecas pelo nome curto
 *  ("libavcodec.dylib", sem @rpath), pela pasta atual e pelo DYLD_LIBRARY_PATH: com hardened runtime eles precisam
 *  das variáveis DYLD e de carregar bibliotecas sem a validação (entitlements.filhos.plist). */
export const ehBinarioFilho = (arquivo: string) =>
  /[\\/]node_modules[\\/]@remotion[\\/]compositor-darwin-|[\\/]remotion-browser[\\/]|[\\/]Resources[\\/]whisper[\\/]/.test(arquivo);

export const entitlementsDoArquivo = (arquivo: string) => (ehBinarioFilho(arquivo) ? ENTITLEMENTS_FILHOS : ENTITLEMENTS_APP);

type Ambiente = Record<string, string | undefined>;

/** Assinatura, só quando o empacotamento roda num Mac (o codesign é da Apple):
 *  - com ESTUDIO_MAC_IDENTIDADE (ex.: "Developer ID Application: BKM Advogados (ABCDE12345)"): o certificado do keychain,
 *    com hardened runtime e os entitlements de cada arquivo;
 *  - sem ela: assinatura ad hoc ("-"), sem hardened runtime. O packager troca o Info.plist e renomeia os auxiliares do
 *    Electron depois da assinatura ad hoc que vem do Electron; assinar de novo deixa o bundle inteiro coerente (o Apple
 *    Silicon não roda binário com assinatura inválida). ESTUDIO_MAC_ADHOC=0 desliga.
 *  Fora do Mac, nada: o .app sai como o packager deixa (docs/portes.md ensina a assinar ad hoc no Mac de quem usa). */
export const assinaturaDoMac = (env: Ambiente, plataforma: string = process.platform) => {
  if (plataforma !== 'darwin') return {};
  const identidade = env.ESTUDIO_MAC_IDENTIDADE?.trim();
  if (identidade) {
    return {
      osxSign: {
        identity: identidade,
        optionsForFile: (arquivo: string) => ({hardenedRuntime: true, entitlements: entitlementsDoArquivo(arquivo)}),
      },
    };
  }
  if (env.ESTUDIO_MAC_ADHOC === '0') return {};
  return {
    osxSign: {
      identity: '-',
      identityValidation: false,
      optionsForFile: () => ({hardenedRuntime: false, timestamp: 'none'}),
    },
  };
};

/** Se a assinatura é de verdade (Developer ID), a única que a Apple notariza. */
const assinaturaDeVerdade = (env: Ambiente, plataforma: string) => plataforma === 'darwin' && Boolean(env.ESTUDIO_MAC_IDENTIDADE?.trim());

/** Notarização pela Apple depois de assinar: pela chave da API do App Store Connect (preferida no CI) ou pelo Apple ID
 *  com senha de app. Sem assinatura não há notarização. */
export const notarizacaoDoMac = (env: Ambiente, plataforma: string = process.platform) => {
  if (!assinaturaDeVerdade(env, plataforma)) return {};
  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
    return {osxNotarize: {appleApiKey: env.APPLE_API_KEY, appleApiKeyId: env.APPLE_API_KEY_ID, appleApiIssuer: env.APPLE_API_ISSUER}};
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return {osxNotarize: {appleId: env.APPLE_ID, appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD, teamId: env.APPLE_TEAM_ID}};
  }
  return {};
};
