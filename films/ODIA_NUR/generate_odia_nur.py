#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 NICHOLSON — STUDIO MOTION | ODIA : "NŪR / LA LUMIÈRE STRUCTURÉE"
================================================================================
 Film-manifeste 16:9 cinématique — 26 s — 1080p — 30 fps
 Direction artistique : géométrie islamique générative (girih / zellige),
 lumière or sur vide charbon, aucune figure humaine, AUCUNE musique.
 Ambiance sonore : sound design 100 % synthétisé (vent, grains de sable,
 sub-drop, whoosh) + voix off pure. Zéro instrument, zéro mélodie.

 Ce script est AUTONOME et PORTABLE : il rend la vidéo image par image
 (numpy + Pillow), pipe les frames à ffmpeg, synthétise le sound design
 en numpy pur (aucun sample), puis mixe le tout avec les voix off
 déposées dans ./vo/ (vo1.mp3 ... vo5.mp3 — générées par TTS ou
 ré-enregistrables par un comédien : même timing, même sens).

 Dépendances : python3, numpy, Pillow, ffmpeg
   (si ffmpeg n'est pas dans le PATH, le binaire d'imageio-ffmpeg est
    utilisé automatiquement : pip install imageio-ffmpeg)

 Usage :
   python3 generate_odia_nur.py                 # rendu complet 1080p
   python3 generate_odia_nur.py --res 1280      # préviz rapide 720p
   python3 generate_odia_nur.py --frames-only   # séquence PNG (compositing AE/Nuke)
================================================================================
"""

import argparse
import math
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --------------------------------------------------------------------------
# CONFIG CRÉATIVE — tout le film se pilote ici
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
VO_DIR = ROOT / "vo"

FPS = 30
DUR = 26.0                       # secondes
W_FULL, H_FULL = 1920, 1080      # résolution maître (mise à l'échelle via --res)

# Palette — or sur vide charbon, accents émeraude (aucune chair, aucun visage)
BG_EDGE = (6, 9, 11)
BG_CORE = (13, 19, 21)
GOLD = (233, 186, 84)
GOLD_HI = (250, 224, 150)
EMERALD = (34, 118, 98)
IVORY = (245, 240, 231)

# Timeline (secondes) — découpage chirurgical
T_BEAM = 2.6                     # apparition du faisceau
T_ROSETTE = (4.0, 10.0)          # scène 2 — le tracé
T_TESS = (10.0, 16.5)            # scène 3 — la tessellation
T_SHATTER = (16.5, 20.5)         # scène 4 — l'implosion
T_MARK = (20.5, 26.0)            # scène 5 — la signature
VO_DELAYS = [0.8, 4.7, 10.7, 21.0, 22.8]   # placement voix off (s)

N_PARTICLES = 4200               # particules de lumière
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_FALLBACK = "DejaVuSans-Bold.ttf"

# --------------------------------------------------------------------------
# OUTILS
# --------------------------------------------------------------------------

def ease_in_out(t):
    t = float(np.clip(t, 0.0, 1.0))
    return t * t * (3 - 2 * t)


def ease_in_out_arr(x):
    """Version vectorisée pour les masques numpy."""
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def ease_out_expo(t):
    t = float(np.clip(t, 0.0, 1.0))
    return 1.0 if t >= 1.0 else 1.0 - 2 ** (-10 * t)


def ease_in_cubic(t):
    t = float(np.clip(t, 0.0, 1.0))
    return t ** 3


def seg(t, a, b):
    """Progression normalisée de t entre a et b."""
    return float(np.clip((t - a) / max(b - a, 1e-6), 0.0, 1.0))


def ffmpeg_exe():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit("ffmpeg introuvable. Installez ffmpeg ou: pip install imageio-ffmpeg")


def radial_sprite(radius, color, gamma=2.2):
    """Sprite lumineux radial (glow additif)."""
    d = int(radius * 2)
    yy, xx = np.mgrid[0:d, 0:d]
    r = np.sqrt((xx - radius) ** 2 + (yy - radius) ** 2) / radius
    a = np.clip(1.0 - r, 0.0, 1.0) ** gamma
    arr = np.zeros((d, d, 3), np.float32)
    for c in range(3):
        arr[..., c] = a * color[c]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


# --------------------------------------------------------------------------
# GÉOMÉTRIE — rosace girih à 8 branches (étoile double + connecteurs)
# --------------------------------------------------------------------------

def rosette_segments():
    """Khatam classique : étoile à 8 branches + octogone + étoile interne
    alignée + rayons. Segments unitaires, ordre de tracé 'stylo lumineux'."""
    segs = []
    A0 = -math.pi / 2
    outer_pts, inner_pts = [], []
    for k in range(8):
        a_out = A0 + k * math.pi / 4
        a_in = a_out + math.pi / 8
        outer_pts.append((math.cos(a_out), math.sin(a_out)))
        inner_pts.append((0.45 * math.cos(a_in), 0.45 * math.sin(a_in)))
    # contour de l'étoile extérieure (16 segments)
    for k in range(8):
        segs.append((outer_pts[k], inner_pts[k]))
        segs.append((inner_pts[k], outer_pts[(k + 1) % 8]))
    # octogone reliant les pointes internes (8)
    for k in range(8):
        segs.append((inner_pts[k], inner_pts[(k + 1) % 8]))
    # rayons : pointes internes -> étoiles internes alignées (8)
    iout = [(0.32 * math.cos(A0 + k * math.pi / 4),
             0.32 * math.sin(A0 + k * math.pi / 4)) for k in range(8)]
    iin = [(0.15 * math.cos(A0 + math.pi / 8 + k * math.pi / 4),
            0.15 * math.sin(A0 + math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    for k in range(8):
        segs.append((iout[k], outer_pts[k]))
    # étoile interne (16)
    for k in range(8):
        segs.append((iout[k], iin[k]))
        segs.append((iin[k], iout[(k + 1) % 8]))
    return segs


def draw_rosette(layer_draw, cx, cy, radius, progress, rot, color, width):
    """Trace la rosace avec progression 0..1 (style stylo lumineux)."""
    segs = ROSETTE_SEGS
    total = len(segs)
    adv = progress * total
    ca, sa = math.cos(rot), math.sin(rot)
    pen = None
    for i, (p0, p1) in enumerate(segs):
        if i >= adv:
            break
        frac = float(np.clip(adv - i, 0.0, 1.0))
        q = (p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac)
        f = lambda p: (cx + (p[0] * ca - p[1] * sa) * radius,
                       cy + (p[0] * sa + p[1] * ca) * radius)
        layer_draw.line([f(p0), f(q)], fill=color, width=width)
        pen = f(q)
    return pen  # position du stylo lumineux


# --------------------------------------------------------------------------
# Tesselles (zellige) — tuile statique pré-rendue avec glow
# --------------------------------------------------------------------------

def build_tessellation(W, H, scale=1.0):
    """Couche tessellation plein cadre (RGB float32) + masque alpha."""
    cell = int(250 * scale)
    spr_size = int(cell * 1.05)
    spr = Image.new("RGB", (spr_size, spr_size), (0, 0, 0))
    d = ImageDraw.Draw(spr)
    r_in = spr_size * 0.46
    # rosace de tuile (tracé complet, fin)
    ca, sa = 1.0, 0.0
    for p0, p1 in ROSETTE_SEGS:
        f = lambda p: (spr_size / 2 + p[0] * r_in, spr_size / 2 + p[1] * r_in)
        d.line([f(p0), f(p1)], fill=GOLD, width=max(2, int(2.4 * scale)))
    # losange émeraude de liaison (tuile 'croix' du zellige)
    dsz = int(cell * 0.5)
    dspr = Image.new("RGB", (dsz, dsz), (0, 0, 0))
    dd = ImageDraw.Draw(dspr)
    rr = cell * 0.11
    dia = [(dsz / 2, dsz / 2 - rr), (dsz / 2 + rr, dsz / 2),
           (dsz / 2, dsz / 2 + rr), (dsz / 2 - rr, dsz / 2)]
    dd.polygon(dia, outline=EMERALD)

    # trame centrée : une rosace exactement au centre de l'écran
    layer = Image.new("RGB", (W, H), (0, 0, 0))
    kx0 = -(W // cell) // 2 - 2
    kx1 = (W // cell) // 2 + 3
    ky0 = -(H // cell) // 2 - 2
    ky1 = (H // cell) // 2 + 3
    for ky in range(ky0, ky1):
        cyk = H / 2 + ky * cell
        for kx in range(kx0, kx1):
            cxk = W / 2 + kx * cell
            layer.paste(spr, (int(cxk - spr_size / 2), int(cyk - spr_size / 2)))
            layer.paste(dspr, (int(cxk + cell / 2 - dsz / 2),
                               int(cyk + cell / 2 - dsz / 2)))

    crisp = np.asarray(layer, dtype=np.float32)
    glow_big = layer.filter(ImageFilter.GaussianBlur(14 * scale))
    glow_small = layer.filter(ImageFilter.GaussianBlur(4 * scale))
    rgb = np.clip(crisp + 0.55 * np.asarray(glow_small, np.float32)
                  + 0.30 * np.asarray(glow_big, np.float32), 0, 255)
    alpha = np.asarray(layer.convert("L"), np.float32) / 255.0
    return rgb, alpha


# --------------------------------------------------------------------------
# MASQUES — texte signature & échantillonnage de points (particules)
# --------------------------------------------------------------------------

def build_wordmark(W, H, scale=1.0):
    """Couche texte ODIA + filet + tagline, et masque d'échantillonnage."""
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    size = int(H * 0.215 * scale)
    try:
        font = ImageFont.truetype(FONT, size)
        font_tl = ImageFont.truetype(FONT, int(H * 0.030 * scale))
    except OSError:
        font = ImageFont.truetype(FONT_FALLBACK, size)
        font_tl = font

    # lettrage espacé (tracking cinéma)
    letters = list("ODIA")
    tracking = size * 0.16
    widths = []
    for ch in letters:
        b = d.textbbox((0, 0), ch, font=font)
        widths.append(b[2] - b[0])
    total_w = sum(widths) + tracking * (len(letters) - 1)
    x = (W - total_w) / 2
    y = H * 0.42
    for ch, wdt in zip(letters, widths):
        d.text((x, y), ch, font=font, fill=IVORY)
        x += wdt + tracking
    cx = W / 2
    base = y + size * 1.02

    # filet or + losange central + tagline
    d.line([(cx - 240 * scale, base + 34 * scale), (cx + 240 * scale, base + 34 * scale)],
           fill=GOLD, width=max(2, int(2 * scale)))
    rr = 7 * scale
    d.polygon([(cx, base + 34 * scale - rr), (cx + rr, base + 34 * scale),
               (cx, base + 34 * scale + rr), (cx - rr, base + 34 * scale)], fill=GOLD)
    tl = "LA  LUMIÈRE  STRUCTURÉE"
    btl = d.textbbox((0, 0), tl, font=font_tl)
    d.text((cx - (btl[2] - btl[0]) / 2, base + 62 * scale), tl, font=font_tl, fill=GOLD)

    crisp = np.asarray(img, np.float32)
    glow = np.asarray(img.filter(ImageFilter.GaussianBlur(16 * scale)), np.float32)
    rgb = np.clip(crisp + 0.45 * glow, 0, 255)
    alpha = np.asarray(img.convert("L"), np.float32) / 255.0
    return rgb, alpha


def sample_points(mask, n, rng):
    ys, xs = np.nonzero(mask > 0.4)
    if len(xs) == 0:
        return np.zeros((n, 2), np.float32)
    idx = rng.integers(len(xs), size=n)
    return np.stack([xs[idx], ys[idx]], axis=1).astype(np.float32)


# --------------------------------------------------------------------------
# SYNTHÈSE SONORE — 100 % numpy, aucun sample, aucun instrument
# --------------------------------------------------------------------------

def _fft_filter(x, sr, lo, hi):
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / sr)
    m = np.clip((f - lo) / max(hi * 0.15, 1), 0, 1) * np.clip((hi - f) / max(hi * 0.15, 1), 0, 1)
    m = np.clip(m, 0, 1)
    return np.fft.irfft(X * m, n)


def _pink(n, rng):
    w = rng.standard_normal(n)
    X = np.fft.rfft(w)
    f = np.maximum(np.fft.rfftfreq(n, 1.0), 1e-6)
    X /= np.sqrt(f) ** 0.85
    return np.fft.irfft(X, n)


def synth_sounddesign(path, dur=DUR, sr=48000, scale=1.0):
    rng = np.random.default_rng(7)
    n = int(dur * sr)
    t = np.arange(n) / sr
    stereo = np.zeros((2, n), np.float32)

    # 1) Vent profond — texture continue, lente respiration
    wind = _fft_filter(_pink(n, rng), sr, 35, 300)
    lfo = 0.55 + 0.45 * np.sin(2 * math.pi * 0.05 * t + 0.8)
    wind *= lfo * 0.11
    wind_r = np.roll(wind, int(0.012 * sr))
    stereo[0] += wind
    stereo[1] += wind_r

    # 2) Grains de sable — scintillement de la tessellation (scène 3)
    for _ in range(70):
        tt = rng.uniform(10.2, 16.3)
        ln = int(rng.uniform(0.05, 0.18) * sr)
        g = _fft_filter(rng.standard_normal(ln), sr, 2600, 7200)
        env = np.hanning(ln)
        g *= env * rng.uniform(0.015, 0.05)
        i0 = int(tt * sr)
        pan = rng.uniform(0.2, 0.8)
        stereo[0, i0:i0 + ln] += g * (1 - pan)
        stereo[1, i0:i0 + ln] += g * pan

    # 3) Riser d'air avant l'implosion (bruit filtré montant — SFX, pas musique)
    rl = int(0.9 * sr)
    rz = rng.standard_normal(rl)
    riser = np.zeros(rl)
    for k in range(8):
        f0, f1 = 200 + k * 260, 700 + k * 420
        seg_x = _fft_filter(rz, sr, f0, f1)
        riser += seg_x * (k / 8)
    riser *= np.linspace(0, 1, rl) ** 2 * 0.09
    stereo[:, int(15.7 * sr):int(16.6 * sr)] += riser

    # 4) Sub-drop de l'implosion — pression d'air grave (effet salaam, pas une note)
    dl = int(1.5 * sr)
    tt2 = np.arange(dl) / sr
    f_inst = 52 * np.exp(-tt2 * 1.4) + 27
    phase = 2 * math.pi * np.cumsum(f_inst) / sr
    drop = np.sin(phase) * np.exp(-tt2 * 2.6) * 0.5
    drop = np.tanh(drop * 1.6)
    i0 = int(16.5 * sr)
    stereo[0, i0:i0 + dl] += drop
    stereo[1, i0:i0 + dl] += drop

    # 5) Whoosh retombée (fin d'implosion -> signature)
    wl = int(0.7 * sr)
    wz = rng.standard_normal(wl)
    whoosh = _fft_filter(wz, sr, 250, 1800) * np.hanning(wl) * 0.10
    i0 = int(20.15 * sr)
    stereo[0, i0:i0 + wl] += whoosh * 0.8
    stereo[1, i0:i0 + wl] += whoosh

    # 6) Souffle d'air à l'apparition du mot-signature
    pl = int(0.25 * sr)
    puff = _fft_filter(rng.standard_normal(pl), sr, 120, 900) * np.hanning(pl) * 0.075
    i0 = int(21.55 * sr)
    stereo[:, i0:i0 + pl] += puff

    # fades de tête et de queue
    fi = int(0.6 * sr)
    stereo[:, :fi] *= np.linspace(0, 1, fi)
    fo = int(1.6 * sr)
    stereo[:, -fo:] *= np.linspace(1, 0, fo)

    peak = np.abs(stereo).max()
    stereo *= (0.85 / max(peak, 1e-6))
    pcm = (stereo.T * 32767).astype("<i2").tobytes()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    print(f"[audio] sound design -> {path}")


# --------------------------------------------------------------------------
# RENDU IMAGE PAR IMAGE
# --------------------------------------------------------------------------

class Film:
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.scale = W / W_FULL
        s = self.scale
        self.rng = np.random.default_rng(42)
        cx, cy = W / 2, H / 2

        # fond : vignette radiale charbon
        yy, xx = np.mgrid[0:H, 0:W]
        rr = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / math.hypot(cx, cy)
        bg = np.zeros((H, W, 3), np.float32)
        for c in range(3):
            bg[..., c] = BG_CORE[c] * (1 - rr * 0.72) + BG_EDGE[c] * rr * 0.72
        self.bg = bg

        # barre cinémascope douces
        bar = int(H * 0.075)
        self.bar_mask = np.ones((H, W), np.float32)
        self.bar_mask[:bar] = np.linspace(0, 1, bar)[:, None]
        self.bar_mask[-bar:] = np.linspace(1, 0, bar)[:, None]

        # couches statiques
        self.tess_rgb, self.tess_alpha = build_tessellation(W, H, s)
        self.mark_rgb, self.mark_alpha = build_wordmark(W, H, s)
        mark_img = Image.fromarray(np.clip(self.mark_rgb, 0, 255).astype(np.uint8))
        self.mark_halo = np.asarray(
            mark_img.filter(ImageFilter.GaussianBlur(26 * s)), np.float32)
        self.dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2).astype(np.float32)
        self.maxd = math.hypot(cx, cy)

        # particules : domicile (tessellation) -> cible (mot-signature)
        self.home = sample_points(self.tess_alpha, N_PARTICLES, self.rng)
        self.target = sample_points(self.mark_alpha, N_PARTICLES, self.rng)
        jitter = self.rng.normal(0, 2.2 * s, self.home.shape)
        self.center = np.array([cx, cy], np.float32) + jitter
        self.psize = self.rng.choice([1, 2, 2, 3], N_PARTICLES)
        self.pcol = self.rng.random(N_PARTICLES)
        # couleurs particules précalculées (majorité or, pointes or clair, émeraude)
        self.pcol_arr = np.empty((N_PARTICLES, 3), np.float32)
        self.pcol_arr[:] = GOLD
        hi = self.pcol >= 0.82
        self.pcol_arr[hi] = GOLD_HI
        em = self.pcol >= 0.93
        self.pcol_arr[em] = EMERALD
        self.pcol_arr *= 0.85

        # sprites
        self.pen = radial_sprite(int(26 * s), GOLD_HI)
        self.dust = None
        self._dust_init()

    def _dust_init(self):
        s = self.scale
        n = 70
        self.dust_pos = np.stack([
            self.rng.uniform(0, self.W, n),
            self.rng.uniform(0, self.H, n)], axis=1).astype(np.float32)
        self.dust_vel = np.stack([
            self.rng.normal(0, 6 * s, n),
            self.rng.uniform(-9 * s, -3 * s, n)], axis=1).astype(np.float32)
        self.dust_a = self.rng.uniform(0.05, 0.22, n)

    # ------------------------------------------------------------------
    def _add_layer(self, canvas, img, gain=1.0):
        if gain == 0:
            return
        arr = np.asarray(img, np.float32) * gain
        np.add(canvas, arr, out=canvas)

    def _paste_add(self, canvas, img, x, y, gain=1.0):
        """Additionne un petit sprite à une position donnée (glow localisé)."""
        if gain <= 0:
            return
        arr = np.asarray(img, np.float32) * gain
        ih, iw = arr.shape[:2]
        x0, y0 = int(x - iw / 2), int(y - ih / 2)
        x1, y1 = x0 + iw, y0 + ih
        cx0, cy0 = max(x0, 0), max(y0, 0)
        cx1, cy1 = min(x1, canvas.shape[1]), min(y1, canvas.shape[0])
        if cx0 >= cx1 or cy0 >= cy1:
            return
        canvas[cy0:cy1, cx0:cx1] += arr[cy0 - y0:cy1 - y0, cx0 - x0:cx1 - x0]

    def _glow_layer(self, canvas, layer, g_small=0.6, g_big=0.35, r_small=None, r_big=None):
        s = self.scale
        r_small = r_small or 5 * s
        r_big = r_big or 18 * s
        if g_big:
            self._add_layer(canvas, layer.filter(ImageFilter.GaussianBlur(r_big)), g_big)
        if g_small:
            self._add_layer(canvas, layer.filter(ImageFilter.GaussianBlur(r_small)), g_small)
        self._add_layer(canvas, layer, 1.0)

    def _particles(self, canvas, pts, alpha, tint_spread=True):
        """Splatting de particules vectorisé (numpy pur, pas de boucle Python)."""
        if alpha <= 0.003:
            return
        W, H = self.W, self.H
        px = pts[:, 0].astype(np.int32)
        py = pts[:, 1].astype(np.int32)
        ok = (px >= 0) & (px < W - 2) & (py >= 0) & (py < H - 2)
        px, py = px[ok], py[ok]
        cols = (self.pcol_arr[ok] * alpha)
        buf = np.zeros((H, W, 3), np.float32)
        np.add.at(buf, (py, px), cols)
        # épaissir les particules de taille 2 et 3 par décalages vectorisés
        big2 = self.psize[ok] >= 2
        if big2.any():
            np.add.at(buf, (py[big2], px[big2] + 1), cols[big2] * 0.85)
            np.add.at(buf, (py[big2] + 1, px[big2]), cols[big2] * 0.85)
        big3 = self.psize[ok] >= 3
        if big3.any():
            np.add.at(buf, (py[big3] + 1, px[big3] + 1), cols[big3] * 0.8)
        img = Image.fromarray(np.clip(buf, 0, 255).astype(np.uint8), "RGB")
        self._glow_layer(canvas, img, g_small=0.5 * alpha, g_big=0.35 * alpha,
                         r_small=3 * self.scale, r_big=10 * self.scale)

    # ------------------------------------------------------------------
    def frame(self, t, fidx):
        W, H, s = self.W, self.H, self.scale
        cx, cy = W / 2, H / 2
        canvas = self.bg.copy()

        # ---------- poussières de lumière (présence continue) ----------
        self.dust_pos += self.dust_vel
        self.dust_pos[:, 0] %= W
        self.dust_pos[:, 1] %= H
        dimg = Image.new("RGB", (W, H), (0, 0, 0))
        dd = ImageDraw.Draw(dimg)
        for i in range(len(self.dust_pos)):
            x, y = self.dust_pos[i]
            a = self.dust_a[i] * (0.6 + 0.4 * math.sin(t * 1.3 + i))
            c = tuple(int(v * a) for v in GOLD)
            dd.rectangle([x, y, x + 2 * s, y + 2 * s], fill=c)
        self._add_layer(canvas, dimg.filter(ImageFilter.GaussianBlur(1.5 * s)), 1.0)

        # ---------- SCÈNE 1 : le souffle (0 → 4 s) ----------
        if t < T_ROSETTE[0] + 0.4:
            p = seg(t, 0.0, T_ROSETTE[0])
            breath = 0.75 + 0.25 * math.sin(t * 2.1)
            r0 = int((14 + 26 * ease_in_out(p)) * s * breath)
            spr = radial_sprite(r0, GOLD_HI, 1.8)
            a = ease_in_out(seg(t, 0.3, 1.6)) * (1 - ease_in_out(seg(t, 3.4, 4.2)))
            if a > 0:
                self._paste_add(canvas, spr, cx, cy, 0.9 * a)
                self._paste_add(canvas, spr.filter(ImageFilter.GaussianBlur(12 * s)),
                                cx, cy, 0.7 * a)
            # faisceau horizontal
            bp = ease_in_out(seg(t, T_BEAM, 3.9))
            if bp > 0:
                beam = Image.new("RGB", (W, H), (0, 0, 0))
                bd = ImageDraw.Draw(beam)
                half = W * 0.32 * bp
                y0 = H / 2
                bd.line([(cx - half, y0), (cx + half, y0)], fill=GOLD, width=max(2, int(2.4 * s)))
                fade = 1 - ease_in_out(seg(t, 3.7, 4.3))
                self._glow_layer(canvas, beam, 0.7 * fade if t > 3.6 else 0.7,
                                 0.4 * fade if t > 3.6 else 0.4)

        # ---------- SCÈNE 2 : le tracé de la rosace (4 → 10 s) ----------
        rosette_alpha = ease_in_out(seg(t, 4.0, 4.6)) * (1 - ease_in_out(seg(t, 10.2, 11.0)))
        if rosette_alpha > 0.001:
            prog = ease_in_out(seg(t, T_ROSETTE[0] + 0.2, T_ROSETTE[1] - 0.4))
            grow = 0.92 + 0.10 * ease_in_out(seg(t, 4.0, 10.0))
            rot = -0.05 * seg(t, 4.0, 10.0)
            radius = H * 0.30 * grow * s / s  # rayon maître
            layer = Image.new("RGB", (W, H), (0, 0, 0))
            d = ImageDraw.Draw(layer)
            pen = draw_rosette(d, cx, cy, H * 0.30 * grow, prog, rot, GOLD,
                               max(3, int(3.2 * s)))
            self._glow_layer(canvas, layer, 0.65 * rosette_alpha, 0.4 * rosette_alpha)
            if pen is not None and t < T_ROSETTE[1] - 0.2 and prog < 1.0:
                self._paste_add(canvas, self.pen, pen[0], pen[1], 1.1 * rosette_alpha)
                self._paste_add(canvas, self.pen.filter(ImageFilter.GaussianBlur(8 * s)),
                                pen[0], pen[1], 0.8 * rosette_alpha)

        # ---------- SCÈNE 3 : la tessellation (10 → shatter) ----------
        if t > T_TESS[0]:
            tfade = 1 - ease_in_out(seg(t, 16.5, 17.3))     # claquage à l'implosion
            ghost = 0.07 * ease_in_out(seg(t, 21.5, 23.0))  # mémoire fantôme au générique
            gain = max(tfade, ghost)
            if gain > 0.001:
                reveal_r = ease_out_expo(seg(t, 10.0, 13.6)) * self.maxd * 1.15
                mask = ease_in_out_arr((reveal_r - self.dist) / (140 * s))
                wavev = 0.72 + 0.28 * np.sin(self.dist * 0.02 / s - (t - 10.0) * 2.4)
                field = mask * np.clip(wavev, 0.45, 1.0) * gain
                add = self.tess_rgb * field[..., None]
                canvas += add
                # respiration globale de la trame avant l'implosion
                canvas += add * (0.10 * math.sin(t * 3.0)
                                 * ease_in_out(seg(t, 15.0, 16.5)))
                # rosace maîtresse réduite par-dessus la trame
                shrink = 1 - 0.55 * ease_in_out(seg(t, 10.0, 12.5))
                if shrink > 0.2 and tfade > 0.01:
                    layer = Image.new("RGB", (W, H), (0, 0, 0))
                    d = ImageDraw.Draw(layer)
                    draw_rosette(d, cx, cy, H * 0.30 * shrink, 1.0, -0.05, GOLD_HI,
                                 max(3, int(3.2 * s)))
                    self._glow_layer(canvas, layer, 0.6 * (1 - shrink + 0.3), 0.35)

        # ---------- SCÈNE 4 : l'implosion (16.5 → 20.5 s) ----------
        sp = seg(t, T_SHATTER[0], T_SHATTER[1])
        if 0 < sp < 1:
            # flash de rupture : la trame claque une fois puis se brise
            flash = max(0, 1 - abs(t - T_SHATTER[0]) * 9)
            if flash > 0:
                canvas += self.tess_rgb * (flash * 0.9)
            hold = ease_in_cubic(seg(t, T_SHATTER[0] + 0.12, T_SHATTER[1]))
            ang = (1 - hold) * 0.0
            swirl = 2.6 * ease_in_out(hold)
            dx = self.home - self.center
            r0v = np.linalg.norm(dx, axis=1)
            th0 = np.arctan2(dx[:, 1], dx[:, 0])
            th = th0 + swirl * (0.4 + r0v / self.maxd)
            rv = r0v * (1 - ease_in_out(hold)) + 4 * s
            pts = np.stack([self.center[:, 0] + rv * np.cos(th),
                            self.center[:, 1] + rv * np.sin(th)], axis=1)
            self._particles(canvas, pts, alpha=1.2)

        # ---------- SCÈNE 5 : la signature (20.5 → 26 s) ----------
        mp = seg(t, T_MARK[0], DUR)
        if mp > 0:
            conv = ease_in_out(seg(t, 20.5, 22.0))
            pts = self.center + (self.target - self.center) * conv
            pts = pts.astype(np.float32)
            pts += self.rng.normal(0, 1.1 * s * (1 - conv * 0.8), pts.shape).astype(np.float32)
            p_alpha = 1 - ease_in_out(seg(t, 22.0, 23.2))
            self._particles(canvas, pts, alpha=0.9 * p_alpha + 0.1)
            # mot-signature net : surexposition brève puis pose
            ap = ease_in_out(seg(t, 21.55, 22.25))
            over = 1.0 + 1.6 * max(0, 1 - abs(t - 22.05) * 5.5)
            canvas += self.mark_rgb * (ap * over * 0.98)
            canvas += self.mark_halo * (ap * 0.35)

        # ---------- finition : grain, barres ciné, normalization ----------
        grain = self.rng.standard_normal((H, W), dtype=np.float32) * 2.4
        canvas += grain[..., None]
        canvas *= self.bar_mask[..., None]
        return np.clip(canvas, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# ASSEMBLAGE FFMPEG
# --------------------------------------------------------------------------

def render_video(film, path, fps=FPS):
    exe = ffmpeg_exe()
    cmd = [exe, "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
           "-s", f"{film.W}x{film.H}", "-pix_fmt", "rgb24", "-r", str(fps),
           "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium",
           "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
           str(path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    nframes = int(DUR * fps)
    for i in range(nframes):
        t = i / fps
        arr = film.frame(t, i)
        proc.stdin.write(arr.tobytes())
        if i % 30 == 0:
            print(f"[render] frame {i:4d}/{nframes}  t={t:5.2f}s", flush=True)
    proc.stdin.close()
    err = proc.stderr.read()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg a échoué:\n{err.decode()[-2000:]}")
    print(f"[render] vidéo -> {path}")


def mix_final(video, sfx, out_path):
    exe = ffmpeg_exe()
    vos = sorted(list(VO_DIR.glob("vo*.mp3")) + list(VO_DIR.glob("vo*.wav")))
    cmd = [exe, "-y", "-i", str(video), "-i", str(sfx)]
    for v in vos:
        cmd += ["-i", str(v)]
    fc = ["[1:a]volume=0.95[sfx]"]
    maps = ["[sfx]"]
    for k, v in enumerate(vos):
        delay_ms = int(VO_DELAYS[k] * 1000) if k < len(VO_DELAYS) else 1000
        fc.append(f"[{k + 2}:a]adelay={delay_ms}|{delay_ms},volume=1.5[v{k}]")
        maps.append(f"[v{k}]")
    fc.append("".join(maps) + f"amix=inputs={len(maps)}:duration=first:normalize=0[aout]")
    cmd += ["-filter_complex", ";".join(fc),
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(out_path)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"mixage ffmpeg a échoué:\n{r.stderr.decode()[-2000:]}")
    print(f"[final] {out_path}")


# --------------------------------------------------------------------------

def main():
    global ROSETTE_SEGS
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=int, default=W_FULL, help="largeur cible (1920/1280)")
    ap.add_argument("--frames-only", action="store_true", help="exporte une séquence PNG")
    args = ap.parse_args()

    ROSETTE_SEGS = rosette_segments()
    OUT.mkdir(exist_ok=True)
    VO_DIR.mkdir(exist_ok=True)

    W = args.res
    H = int(W * H_FULL / W_FULL) // 2 * 2
    print(f"[init] {W}x{H} @ {FPS} fps — {DUR}s — film 'ODIA / NŪR'")
    film = Film(W, H)

    if args.frames_only:
        seq = OUT / "frames"
        seq.mkdir(exist_ok=True)
        for i in range(int(DUR * FPS)):
            Image.fromarray(film.frame(i / FPS, i)).save(seq / f"odia_{i:04d}.png")
        print(f"[frames] séquence PNG -> {seq}  (compositing AE / Nuke / Runway img2vid)")
        return

    video = OUT / "ODIA_NUR_video_only.mp4"
    render_video(film, video)

    sfx = OUT / "ODIA_NUR_sounddesign.wav"
    synth_sounddesign(sfx, scale=H / H_FULL)

    if not list(VO_DIR.glob("vo*")):
        print("[vo] aucune voix off dans ./vo/ — le film sera mixé sound design seul.")
    final = OUT / "ODIA_NUR_FINAL.mp4"
    mix_final(video, sfx, final)
    print("DONE")


if __name__ == "__main__":
    main()
