#!/usr/bin/env bash
# Instala (ou atualiza) o Estúdio neste Linux para o usuário atual, sem root: empacota com o Electron Forge, copia para
# ~/.local/opt/Estudio, põe o ícone no tema hicolor e cria o atalho em ~/.local/share/applications, que é onde o
# lançador do Omarchy (e o do GNOME/KDE) procura os aplicativos. Rodar de novo atualiza a cópia instalada.
#   bash scripts/instalar-linux.sh            empacota e instala
#   bash scripts/instalar-linux.sh --sem-pacote   só reinstala o que já está em out/pacote/Estudio-linux-x64
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
pacote="$raiz/out/pacote/Estudio-linux-x64"
destino="$HOME/.local/opt/Estudio"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icones="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"

if [[ "${1:-}" != "--sem-pacote" ]]; then
  # herdada de terminais de agentes, essa variável faz o Electron rodar como Node puro
  (cd "$raiz" && env -u ELECTRON_RUN_AS_NODE npm run package)
fi
[[ -x "$pacote/Estudio" ]] || { echo "Pacote não encontrado em $pacote" >&2; exit 1; }

# troca a cópia inteira de uma vez: um Estúdio aberto continua com a versão antiga até ser fechado
mkdir -p "$(dirname "$destino")"
rm -rf "$destino.novo"
cp -a "$pacote" "$destino.novo"
rm -rf "$destino"
mv "$destino.novo" "$destino"

for tam in 256 512; do
  mkdir -p "$icones/${tam}x${tam}/apps"
  if command -v magick >/dev/null; then
    magick "$raiz/build/icone.png" -resize "${tam}x${tam}" "$icones/${tam}x${tam}/apps/estudio.png"
  else
    cp "$raiz/build/icone.png" "$icones/${tam}x${tam}/apps/estudio.png"
  fi
done

mkdir -p "$apps"
cat > "$apps/estudio.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Estúdio
GenericName=Editor de vídeo, imagem e 3D
Comment=Vídeo, imagem, 3D, efeitos, som e música, com o Claude
Exec=env -u ELECTRON_RUN_AS_NODE $destino/Estudio %U
Icon=estudio
Terminal=false
Categories=AudioVideo;Video;
Keywords=estudio;studio;video;imagem;3d;remotion;carrossel;
StartupWMClass=estudio
StartupNotify=true
EOF

command -v update-desktop-database >/dev/null && update-desktop-database "$apps" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -f -t "$icones" >/dev/null 2>&1 || true
echo "Estúdio instalado em $destino (atalho: $apps/estudio.desktop)"
