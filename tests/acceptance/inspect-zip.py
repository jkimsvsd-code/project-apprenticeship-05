import sys, json, zipfile, hashlib
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None, 'CRC mismatch'
    names=z.namelist()
    assert len(names)==len(set(names)), 'duplicate archive paths'
    for name in names:
        assert name.startswith('jjal-export/') and '\\' not in name and '..' not in name.split('/')
    files={n[len('jjal-export/'):]:z.read(n) for n in names if not n.endswith('/')}
    m=json.loads(files['manifest.json'])
    assert m['kind']=='jjal-archive' and m['schemaVersion']==1
    assert set(x['path'] for x in m['files'])==set(files)-{'manifest.json'}
    for f in m['files']:
        b=files[f['path']]
        assert len(b)==f['byteLength'] and hashlib.sha256(b).hexdigest()==f['sha256']
    assert sum(map(len,files.values()))<=100000000
    texts={n:json.loads(b) for n,b in files.items() if n.endswith('.json')}
    print(json.dumps({'manifest':m,'names':list(files),'json':texts,
         'hashes':{n:hashlib.sha256(b).hexdigest() for n,b in files.items()},
         'sizes':{n:len(b) for n,b in files.items()}},ensure_ascii=False))
