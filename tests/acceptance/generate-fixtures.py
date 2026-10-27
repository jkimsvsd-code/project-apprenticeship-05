"""Original synthetic fixtures. Requires fonttools and Pillow only to regenerate."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from PIL import Image
import json, hashlib, os

os.environ['SOURCE_DATE_EPOCH'] = '1700000000'
root = Path(__file__).parent / 'fixtures'
root.mkdir(parents=True, exist_ok=True)
for name, color in [('red.png', '#ff0000'), ('blue.png', '#0000ff'), ('green.png', '#00ff00')]:
    Image.new('RGB', (8, 8), color).save(root / name)
glyphs = ['.notdef', 'space', 'A', 'ga']
for ttf in [True, False]:
    family = 'TaskFiveTTF' if ttf else 'TaskFiveOTF'
    fb = FontBuilder(1000, isTTF=ttf)
    fb.setupGlyphOrder(glyphs)
    fb.setupCharacterMap({32: 'space', 65: 'A', 0xAC00: 'ga'})
    shapes = {}
    for name in glyphs:
        pen = TTGlyphPen(None) if ttf else T2CharStringPen(600, None)
        if name != 'space':
            pen.moveTo((50, 0)); pen.lineTo((550, 0)); pen.lineTo((300, 700)); pen.closePath()
        shapes[name] = pen.glyph() if ttf else pen.getCharString()
    if ttf:
        fb.setupGlyf(shapes)
    else:
        fb.setupCFF(family, {'FullName': family, 'FamilyName': family, 'Weight': 'Regular'}, shapes, {})
    fb.setupHorizontalMetrics({g: (600, 0) for g in glyphs})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': family, 'styleName': 'Regular', 'uniqueFontIdentifier': family,
                      'fullName': family, 'psName': family, 'version': 'Version 1.0',
                      'copyright': 'Original synthetic test fixture. CC0-1.0.'})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    fb.setupPost()
    fb.setupMaxp()
    fb.font['head'].created = fb.font['head'].modified = 3782844800
    fb.save(root / ('sample.ttf' if ttf else 'sample.otf'))
(root / 'invalid.ttf').write_bytes(b'This is not a font.\n')
ratios = ['1:1','4:5','3:4','2:3','9:16','4:3','3:2','16:9']
doc = {'kind':'jjal-document','schemaVersion':1,'id':'fixture-current','title':'미저장 카드',
       'createdAt':'2026-10-01T00:00:00Z','updatedAt':'2026-10-01T00:00:00Z',
       'activeRatio':'1:1','assets':[],
       'panels':[{'id':'panel-1','elementIds':['line-1'],
                  'background':{'color':'#ff0000','imageAssetId':None,'fit':'cover'}}],
       'elements':[{'id':'line-1','kind':'text','text':'AAA 가','locked':False,'hidden':False,
                    'style':{'font':{'kind':'builtin','family':'Noto Sans KR'},'fontSize':42,
                             'color':'#000000','align':'center','lineHeight':1.5,'bold':False}}],
       'layouts':[{'ratio':r,'panels':[{'panelId':'panel-1','rect':{'x':0,'y':0,'width':1,'height':1},
                    'elements':[{'elementId':'line-1','transform':{'x':.1,'y':.1,'width':.8,'height':.8,
                    'rotation':0,'flipX':False,'flipY':False,'opacity':1}}]}]} for r in ratios]}
(root/'document.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n')
templates = [{'kind':'jjal-template','schemaVersion':1,'id':f't-{i:04d}','name':f'템플릿 {i}',
              'createdAt':doc['createdAt'],'updatedAt':doc['updatedAt'],'document':doc} for i in range(101)]
(root/'templates-101.json').write_text(json.dumps(templates,ensure_ascii=False,indent=2)+'\n')
manifest = {p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
            for p in sorted(root.iterdir()) if p.name!='fixture-manifest.json'}
(root/'fixture-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
