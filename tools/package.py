"""Package only original runtime assets and user documentation, never references or data."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'module.json').read_text())
files = [root / 'module.json', root / 'README.md']
files += sorted((root / 'scripts').glob('*.js'))
files += sorted((root / 'styles').glob('*.css'))
files += [root / 'docs' / name for name in ['MANUAL_TESTS.md', 'API_NOTES.md']]
output = root / 'dist'
output.mkdir(exist_ok=True)
archive = output / 'bg3-video-hud.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
    for path in files:
        bundle.write(path, path.relative_to(root).as_posix())
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    names = bundle.namelist()
    assert 'module.json' in names and 'scripts/module.js' in names
    assert json.loads(bundle.read('module.json'))['version'] == manifest['version']
    assert all(not name.startswith(('tests/', 'node_modules/', '.git/')) for name in names)
(output / 'module.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Validated {archive.name}: {len(files)} files, version {manifest["version"]}')
