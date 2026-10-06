#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reconstruction fidèle du logo Ousman CHEKPO (l'attachement PNG n'ayant pas
atteint le sandbox) : fond bleu royal, anneau blanc ouvert à droite, croissant
d'éclipse sombre interne, typogramme deux lignes. Sert de source pixel pour
nicholson_logo_chekpo.py (le logo est utilisé tel quel, jamais redessiné)."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 1200
BG = (22, 71, 196)          # bleu royal du fichier client
WHITE = (250, 252, 255)
NAVY = (13, 22, 52)         # trait d'éclipse

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# ── symbole : anneau ouvert (gap à 3 h) ──
cx, cy = 505, 600
R_out, thick = 150, 47
r_mid = R_out - thick / 2
d.arc([cx - r_mid, cy - r_mid, cx + r_mid, cy + r_mid],
      start=16, end=344, fill=WHITE, width=thick)

# ── croissant d'éclipse : arc sombre le long du bord interne (bas + gauche + haut-gauche) ──
r_e = R_out - thick - 4
d.arc([cx - r_e, cy - r_e, cx + r_e, cy + r_e],
      start=45, end=300, fill=NAVY, width=9)

# ── typogramme ──
F1 = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
f1 = ImageFont.truetype(F1, 182)
f2 = ImageFont.truetype(F1, 118)

d.text((700, 470), "Ousman", font=f1, fill=WHITE)

# CHEKPO lettré
x = 704
for ch in "CHEKPO":
    d.text((x, 706), ch, font=f2, fill=WHITE)
    b = d.textbbox((0, 0), ch, font=f2)
    x += (b[2] - b[0]) + 14

img.save("assets/logo_ousman_chekpo.png")
print("logo saved")
