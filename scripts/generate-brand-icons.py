"""Export approved brand master without changing its artwork. Requires Pillow."""
from pathlib import Path
import subprocess
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / 'resources/brand/picoddy-icon.png'


def main():
    source = Image.open(MASTER).convert('RGBA')
    if source.width != source.height or source.width < 1024:
        raise ValueError('The brand master must be square and at least 1024px.')
    if source.getextrema()[3] != (0, 255):
        raise ValueError('The brand master must include transparent outside edges.')

    def export(path, size):
        source.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / path)

    for public in ('frontend/public', 'cloud/web/public'):
        for filename, size in (('assistant-avatar.png', 256), ('icon.png', 1024),
                               ('icon-128.png', 128), ('icon-512.png', 512)):
            export(f'{public}/{filename}', size)
    export('website/assets/picoddy-icon.png', 256)
    export('resources/app-icon.png', 1024)
    source.save(ROOT / 'resources/app-icon.ico', format='ICO',
                sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])

    iconset = ROOT / 'resources/app-icon.iconset'
    iconset.mkdir(exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        export(f'resources/app-icon.iconset/icon_{size}x{size}.png', size)
        export(f'resources/app-icon.iconset/icon_{size}x{size}@2x.png', size * 2)
    if sys.platform == 'darwin':
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o',
                        str(ROOT / 'resources/app-icon.icns')], check=True)
    else:
        source.save(ROOT / 'resources/app-icon.icns', format='ICNS')
    print('Exported desktop, cloud, website, ICO and ICNS icons from', MASTER)


if __name__ == '__main__':
    main()
