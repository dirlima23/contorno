"""Create the portable download after npm run build; no external dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
with ZipFile(root / 'contorno-offline.zip', 'w', ZIP_DEFLATED) as archive:
    for name in ['index.html', 'README.md', 'THIRD_PARTY_NOTICES.txt']:
        archive.write(root / name, name)
with ZipFile(root / 'contorno-offline.zip') as archive:
    assert archive.testzip() is None
    assert archive.read('index.html') == (root / 'index.html').read_bytes()
print('contorno-offline.zip criado e verificado.')
