import {existsSync} from "node:fs";
import {cp, mkdir} from "node:fs/promises";
import path from "node:path";
import {ensureBrowser} from "@remotion/renderer";
import {MakerZIP} from "@electron-forge/maker-zip";
import {VitePlugin} from "@electron-forge/plugin-vite";
import {getCompositorPackage} from "./src/nucleo/compositor-package";
import {getPackagedBrowserPaths} from "./src/main/packaged-browser";
import {empacotarComposicoes, PASTA_PACOTE} from "./src/main/exportar";
import {baixarNavegadorAlvo, entraNoPacote} from "./src/main/navegador-alvo";
import {assinaturaDoMac, notarizacaoDoMac, opcoesDoMac, WHISPER_EMBUTIDO_ENV} from "./build/mac";

const DARWIN_COMPOSITOR_PACKAGES = [
  "@remotion/compositor-darwin-x64",
  "@remotion/compositor-darwin-arm64",
];
const PACKAGE_BROWSER_ENV_VAR = "REMOTION_ELECTRON_PACKAGE_BROWSER";
// o navegador de render vai junto por padrão: a exportação de vídeo funciona em qualquer PC, sem internet nem download
// no primeiro uso (REMOTION_ELECTRON_PACKAGE_BROWSER=false gera um pacote menor, que baixa na primeira exportação)
const shouldPackageBrowser = process.env[PACKAGE_BROWSER_ENV_VAR] !== "false";

const DARWIN_UNIVERSAL_ARCH_FILES =
  "Contents/Resources/app.asar.unpacked/node_modules/@remotion/compositor-darwin-*/**";

// O node-pty dos terminais é nativo e fica fora do pacote do Vite, como o compositor do Remotion. No Mac universal vão os
// dois (arm64 e x64); o padrão do Estúdio é um pacote por arquitetura (docs/portes.md).
const PTY_PACKAGES = (platform: string, arch: string) =>
  ["@lydell/node-pty", ...(arch === "universal" ? ["arm64", "x64"] : [arch]).map((a) => `@lydell/node-pty-${platform}-${a}`)];

function getCompositorPackagesForPackaging({
  arch,
  platform,
}: {
  arch: string;
  platform: string;
}): string[] {
  // Mac de uma arquitetura só leva o compositor dela (o outro são 20 MB à toa); o universal leva os dois
  if (platform === "darwin" && arch === "universal") {
    return [...DARWIN_COMPOSITOR_PACKAGES, ...PTY_PACKAGES(platform, arch)];
  }

  return [getCompositorPackage({arch, platform}), ...PTY_PACKAGES(platform, arch)];
}

function isMissingPackageError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND"
  );
}

function shouldAllowMissingCompositorPackage({
  arch,
  compositorPackage,
  platform,
}: {
  arch: string;
  compositorPackage: string;
  platform: string;
}): boolean {
  if (platform !== "darwin" || arch === "universal") {
    return false;
  }

  return compositorPackage.startsWith("@remotion/") && compositorPackage !== getCompositorPackage({arch, platform});
}

function resolveInstalledCompositorPackageDirectory({
  allowMissing,
  compositorPackage,
}: {
  allowMissing: boolean;
  compositorPackage: string;
}): string | null {
  // o @lydell/node-pty fecha o package.json no "exports"; a pasta em node_modules resolve sem passar por ele
  const direto = path.join(process.cwd(), "node_modules", compositorPackage);
  if (existsSync(path.join(direto, "package.json"))) {
    return direto;
  }

  try {
    const compositorPackageJson = require.resolve(`${compositorPackage}/package.json`, {
      paths: [process.cwd()],
    });

    return path.dirname(compositorPackageJson);
  } catch (error: unknown) {
    if (allowMissing && isMissingPackageError(error)) {
      return null;
    }

    throw error;
  }
}

async function stageCompositorPackages({
  arch,
  buildPath,
  platform,
}: {
  arch: string;
  buildPath: string;
  platform: string;
}): Promise<void> {
  const compositorPackages = getCompositorPackagesForPackaging({
    arch,
    platform,
  });

  for (const compositorPackage of compositorPackages) {
    const compositorSource = resolveInstalledCompositorPackageDirectory({
      allowMissing: shouldAllowMissingCompositorPackage({
        arch,
        compositorPackage,
        platform,
      }),
      compositorPackage,
    });

    if (!compositorSource) {
      continue;
    }

    const compositorDestination = path.join(
      buildPath,
      "node_modules",
      compositorPackage,
    );

    await mkdir(path.dirname(compositorDestination), {recursive: true});
    await cp(compositorSource, compositorDestination, {recursive: true});
  }
}

export async function stageBrowser({
  arch,
  buildPath,
  platform,
}: {
  arch: string;
  buildPath: string;
  platform: string;
}): Promise<void> {
  const browserPaths = getPackagedBrowserPaths({
    arch,
    buildPath,
    platform,
    projectRoot: process.cwd(),
  });

  if (!browserPaths) {
    return;
  }

  // o ensureBrowser só baixa o navegador do sistema em que roda: empacotando outro sistema (Windows ou Mac a partir do
  // Linux), baixa o do alvo do mesmo endereço que o Remotion usaria lá (src/main/navegador-alvo.ts)
  if (platform === process.platform && arch === process.arch) {
    await ensureBrowser();
  } else {
    await baixarNavegadorAlvo({platform, arch, raiz: process.cwd(), avisar: (t) => console.log(t)});
  }
  if (!existsSync(browserPaths.downloadedBrowserFolder)) {
    // sem o navegador o app ainda exporta, mas baixa o navegador na primeira exportação (precisa de internet)
    console.warn(`navegador de render de ${platform}-${arch} não encontrado: o pacote sai sem ele`);
    return;
  }

  if (!browserPaths.packagedBrowserCopyDestination) {
    return;
  }

  await mkdir(path.dirname(browserPaths.packagedBrowserCopyDestination), {
    recursive: true,
  });

  await cp(
    browserPaths.downloadedBrowserFolder,
    browserPaths.packagedBrowserCopyDestination,
    {recursive: true, filter: (origem) => entraNoPacote(browserPaths.downloadedBrowserFolder, origem)},
  );
}

/** whisper-cli compilado à parte (o CI compila o whisper.cpp no Mac): vai para resources/whisper/ do app. */
async function stageWhisper({buildPath}: {buildPath: string}): Promise<void> {
  const origem = process.env[WHISPER_EMBUTIDO_ENV];
  if (!origem) {
    return;
  }

  if (!existsSync(origem)) {
    throw new Error(`${WHISPER_EMBUTIDO_ENV} aponta para ${origem}, que não existe`);
  }

  // buildPath é a pasta do app (resources/app); o whisper vai ao lado, em resources/whisper
  const destino = path.join(path.dirname(buildPath), "whisper");
  await mkdir(destino, {recursive: true});
  await cp(origem, path.join(destino, path.basename(origem)));
}

const config = {
  // out/pacote e não out/: o antivírus deste PC (GravityZone) travou o out/Estudio-win32-x64/Estudio.exe antigo, e o
  // Forge não consegue apagá-lo para empacotar de novo
  outDir: "out/pacote",
  packagerConfig: {
    name: "Estudio",
    executableName: "Estudio",
    icon: "build/icone",
    win32metadata: {CompanyName: "BKM Advogados", FileDescription: "Estúdio", ProductName: "Estúdio"},
    // Mac: id, categoria, Info.plist (microfone, pastas arrastadas no ícone) e, só com as variáveis da Apple no
    // ambiente, assinatura e notarização (build/mac.ts, docs/portes.md)
    ...opcoesDoMac(),
    ...assinaturaDoMac(process.env),
    ...notarizacaoDoMac(process.env),
    asar: {
      unpackDir: shouldPackageBrowser
        ? "{node_modules/@remotion/compositor-*,node_modules/@lydell/**,remotion-browser}"
        : "{node_modules/@remotion/compositor-*,node_modules/@lydell/**}",
    },
    // o servidor MCP (rodado pelo Claude com o próprio Electron em modo Node) e, quando o repositório traz, a pasta
    // exemplos/ com o projeto do "Ver um pronto" (src/nucleo/exemplo.ts); sem ela o app não oferece o exemplo
    extraResource: ["dist-mcp", ...(existsSync("exemplos") ? ["exemplos"] : [])],
    osxUniversal: {
      // These compositor binaries are already architecture-specific and should not be
      // merged with lipo during universal packaging.
      x64ArchFiles: DARWIN_UNIVERSAL_ARCH_FILES,
    },
  },
  // nada para recompilar: o node-pty vem pré-compilado (N-API) e o compositor do Remotion é binário pronto
  rebuildConfig: {onlyModules: []},
  // o .zip é a versão portátil (descompactar e abrir o Estudio.exe, o Estudio.app ou o Estudio do Linux); o instalador
  // do Windows (NSIS) e o DMG do Mac são do electron-builder.yml, e no Linux quem instala é scripts/instalar-linux.sh
  // (deb/rpm não servem ao Arch)
  makers: [new MakerZIP({}, ["win32", "linux", "darwin"])],
  hooks: {
    packageAfterCopy: async (
      _forgeConfig: unknown,
      buildPath: string,
      _electronVersion: string,
      platform: string,
      arch: string,
    ) => {
      await empacotarComposicoes(process.cwd(), path.join(buildPath, PASTA_PACOTE));

      // Set REMOTION_ELECTRON_PACKAGE_BROWSER=true to package Chrome Headless
      // Shell into the app. This increases the final app size significantly, but
      // packaged renders can run completely offline.
      // IMPORTANT: This is not supported for macOS universal builds.
      // `ensureBrowser()` only downloads a browser for the current architecture,
      // so the other packaged architecture would not get an offline browser.
      // For universal builds, prefer calling `ensureBrowser()` at runtime instead.
      if (shouldPackageBrowser) {
        await stageBrowser({
          arch,
          buildPath,
          platform,
        });
      }

      // Electron Forge's Vite packaging does not materialize this optional runtime binary
      // into the packaged app automatically, so stage the required compositor packages explicitly.
      await stageCompositorPackages({
        arch,
        buildPath,
        platform,
      });

      await stageWhisper({buildPath});
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
