# ホーム画面のアイコンを描く（音めがねの線：暗い地に、高さの変わる明るい線と「いま」の縦線）。
# 使い方：python3 tools/make_icons.py  → icons/ に 180・192・512 の PNG を書き出す。
from PIL import Image, ImageDraw

BG, LINE, FUTURE, NOW = (23, 25, 29), (236, 235, 228), (118, 123, 131), (180, 183, 188)
S = 1024  # 大きく描いてから縮める（線のふちをなめらかに）


def draw():
    im = Image.new('RGB', (S, S), BG)
    d = ImageDraw.Draw(im)
    w = 64
    # 音ごとの短い線（左が歌い終えた所で明るく、右がこの先で暗め）。高さは「ふるさと」の歌い出しの形に寄せた
    notes = [(150, 260, 620), (360, 470, 620), (500, 600, 540), (630, 760, 460), (790, 900, 380)]
    now_x = 470
    for x0, x1, y in notes:
        for a, b, c in [(x0, min(x1, now_x), LINE), (max(x0, now_x), x1, FUTURE)]:
            if b > a:
                d.line([(a, y), (b, y)], fill=c, width=w)
                for x in (a, b):
                    if (x == x0) or (x == x1):
                        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=c)
    d.line([(now_x, 200), (now_x, 824)], fill=NOW, width=28)
    return im


big = draw()
for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192), ('icon-512.png', 512)]:
    big.resize((size, size), Image.LANCZOS).save(f'icons/{name}')
    print('書き出しました：icons/' + name)
