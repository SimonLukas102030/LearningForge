import re, json, sys

files = [
    'Fächer/Englisch/Klasse-9/Conditionals/meta.json',
    'Fächer/Englisch/Klasse-9/Reported-Speech/meta.json',
    'Fächer/Musik/Klasse-9/Songwriting-Form/meta.json',
]

for path in files:
    with open(path, encoding='utf-8') as f:
        content = f.read()
    # Replace ASCII " that closes a typographic „ opening with U+201C
    def fix(m):
        return m.group(1) + m.group(2) + '“'
    fixed = re.sub('(„)([^„“”]*?)"', fix, content)
    try:
        json.loads(fixed)
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(fixed)
        print(f'FIXED: {path.split("/")[-2]}')
    except json.JSONDecodeError as e:
        print(f'STILL BROKEN {path.split("/")[-2]} @{e.pos}: {repr(fixed[max(0,e.pos-60):e.pos+60])}')
