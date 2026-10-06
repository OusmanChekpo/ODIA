#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NICHOLSON — « GENÈSE ORBITALE » — Animation de logo Ousman CHEKPO
=================================================================
Concept : le monde est noir. Une comète de lumière trace l'orbite (l'anneau du logo),
une éclipse glisse à l'intérieur et, à l'instant précis où elle se referme, l'univers
s'allume en bleu royal. Un rayon balaie ensuite l'espace et les lettres naissent de sa
lumière : « Ousman » monte, « CHEKPO » descend. Le logo exhale alors des particules de
lumière, un reflet de verre le traverse, puis il respire, immobile et net.

Le logo fourni est utilisé TEL QUEL (aucun redessin) : il est découpé en calques
(anneau, éclipse, 12 lettres) puis animé par masques.

Son : AUCUNE musique. Silence, drone grave, texture de lumière, claquements de verre,
souffles, impact sub-grave — tout est synthétisé par le script.

Installation :   pip install numpy pillow imageio imageio-ffmpeg
Usage :
    python nicholson_logo_chekpo.py --logo logo_Ousman_fond_blanc_sur_bleu.png
    python nicholson_logo_chekpo.py --logo logo.png --format 9:16     # vertical (logo empilé)
    python nicholson_logo_chekpo.py --logo logo.png --preview         # test rapide
    python nicholson_logo_chekpo.py --prompts                         # prompts IA seulement
"""
import argparse, json, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageFilter

# ───────────────────────────── TIMELINE (s) ───────────────────────────────
FPS, DUR, SR = 30, 9.5, 44100
T_SPARK = 0.35            # naissance du point de lumière
T_RING  = (0.9, 2.7)      # la comète trace l'orbite
T_ECL   = (2.75, 3.45)    # l'éclipse glisse
T_IGN   = 3.45            # ignition de l'univers (onde de choc 1)
T_BAR   = (3.5, 4.9)      # rayon de lumière qui fait naître les lettres
T_LOCK  = 5.9             # verrouillage : bloom + exhalaison + onde de choc 2
T_SHINE = (6.2, 7.6)      # reflet de verre
LETTER_DUR = 0.85

WHITE = np.array([250, 252, 255], np.float32)
NAVY  = np.array([6, 12, 36], np.float32)
ICE   = np.array([150, 195, 255], np.float32)
TINT  = np.array([.38, .62, 1.0], np.float32)
BG_C  = np.array([21, 72, 200], np.float32)       # cœur de la lumière
BG_E  = np.array([3, 12, 52], np.float32)         # bords profonds

# ───────────────── PROMPTS IA (image-to-video : logo en 1re/dernière image) ──────────────
STYLE = ("Premium brand-reveal, deep royal blue (#113FB6) universe, pure white light, razor-sharp vector-clean logo, "
         "anamorphic lens streaks, volumetric glow, fine film grain, 24fps, macro cinematography. "
         "Negative: no extra text, no distorted or re-drawn letters, no watermark, no people, no music.")
PROMPTS = [
 {"shot": 1, "dur": "1.5s", "prompt": "Total darkness with a faint deep-blue haze. A single point of white light ignites at the top of an invisible circle and pulses like a star. Slow macro push-in, floating dust bokeh. " + STYLE},
 {"shot": 2, "dur": "2s", "prompt": "A comet of white light races around a perfect circle, leaving a luminous trail that solidifies into the thick white open-ring symbol of the reference logo. Anamorphic horizontal streak follows the comet head, sparks shed along the orbit. " + STYLE},
 {"shot": 3, "dur": "1s", "prompt": "A dark navy crescent glides along the inner edge of the white ring like an eclipse. The instant it closes, a soft shockwave ripples outward and the whole frame ignites from black to rich royal blue. Subtle chromatic aberration pulse. " + STYLE},
 {"shot": 4, "dur": "2s", "prompt": "A vertical beam of white light sweeps left to right beside the ring symbol; in its wake the letters of 'Ousman' rise from below with motion blur resolving to sharp, and the letters of 'CHEKPO' descend from above and tighten their tracking. Bold rounded sans-serif exactly as in the reference logo. " + STYLE},
 {"shot": 5, "dur": "1.5s", "prompt": "The complete logo locks into place with a bloom of light; thousands of luminous particles exhale outward from the letters and ring, then a diagonal glass-like specular sweep glides across the logo. Micro camera punch-in on the lock. " + STYLE},
 {"shot": 6, "dur": "2s", "prompt": "Clean final hold on the logo, perfectly legible, with a slow dolly-in and a gentle breathing glow. Dust motes drift in the blue light. " + STYLE},
]

# ───────────────────────────── OUTILS MATHS ──────────────────────────────
def smooth(x):
    x = np.clip(x, 0, 1); return x*x*(3-2*x)

def ease(x):
    x = np.clip(x, 0, 1)
    return 4*x**3 if x < .5 else 1 - (-2*x+2)**3/2

def groups(mask1d, off=0):
    g, s = [], None
    for i, v in enumerate(mask1d):
        if v and s is None: s = i
        if not v and s is not None: g.append((s+off, i-1+off)); s = None
    if s is not None: g.append((s+off, len(mask1d)-1+off))
    return g

# ───────────────────────── ANALYSE & CALQUES DU LOGO ─────────────────────
def analyse(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    bg = im[3, 3]
    aw = np.clip((im[..., 0]-bg[0])/(255-bg[0]), 0, 1)              # lumière blanche
    ad = np.clip((bg[2]-im[..., 2])/(bg[2]-38), 0, 1)               # éclipse sombre
    wh = (im[..., 0] > 110) & (im[..., 1] > 110)
    colg = groups(wh.any(0))
    sx0, sx1 = colg[0]                                              # 1er bloc = symbole
    tx0 = colg[1][0]; tx1 = colg[-1][1]
    sy = np.nonzero(wh[:, sx0:sx1+1].any(1))[0]; sy0, sy1 = sy.min(), sy.max()
    bands = groups(wh[:, tx0:tx1+1].any(1))
    bands = [b for b in bands if b[1]-b[0] > 20][:2]
    letters = []
    for r, (y0, y1) in enumerate(bands):
        for (x0, x1) in groups(wh[y0:y1+1, tx0:tx1+1].any(0), tx0):
            letters.append(dict(row=r, box=(x0, y0, x1, y1)))
    return dict(aw=aw, ad=ad, sym=(sx0, sy0, sx1, sy1), letters=letters, txt=(tx0, bands[0][0], tx1, bands[-1][1]))

def scaled(a, box, s, pad=3):
    x0, y0, x1, y1 = box; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
    crop = Image.fromarray(a[y0:y1+1, x0:x1+1].astype(np.float32))
    nw, nh = max(1, int(round(crop.width*s))), max(1, int(round(crop.height*s)))
    return np.clip(np.asarray(crop.resize((nw, nh), Image.BICUBIC)), 0, 1).astype(np.float32), (x0, y0)

def build(W, H, layout, logo):
    L = analyse(logo); sc = min(W, H)/1080
    sx0, sy0, sx1, sy1 = L["sym"]; tx0, ty0, tx1, ty1 = L["txt"]
    scx, scy = (sx0+sx1)/2, (sy0+sy1)/2; rr = (sx1-sx0)/2
    ux0, uy0, ux1, uy1 = sx0, sy0, tx1, max(sy1, ty1)
    if layout == "stacked":
        s1 = W*.42/(sx1-sx0); s2 = W*.74/(tx1-tx0)
        h_sym = (sy1-sy0)*s1; h_txt = (ty1-ty0)*s2; gap = 70*sc
        top = H/2 - (h_sym+gap+h_txt)/2
        ycs = top + h_sym/2; yct = top + h_sym + gap + h_txt/2
        o1 = (W/2 - scx*s1, ycs - scy*s1); o2 = (W/2 - (tx0+tx1)/2*s2, yct - (ty0+ty1)/2*s2)
    else:
        frac = .50 if W > H else .80
        s1 = s2 = W*frac/(ux1-ux0)
        cx, cy = (ux0+ux1)/2, (uy0+uy1)/2
        o1 = o2 = (W/2 - cx*s1, H/2 - cy*s1)
    # symbole
    aw, (bx, by) = scaled(L["aw"], L["sym"], s1)
    ad, _ = scaled(L["ad"], L["sym"], s1)
    sym = dict(aw=aw, ad=ad, x=int(round(o1[0]+bx*s1)), y=int(round(o1[1]+by*s1)))
    ccx, ccy = o1[0]+scx*s1, o1[1]+scy*s1
    hh, ww = aw.shape
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
    px, py = sym["x"]+xx, sym["y"]+yy
    sym["t01"] = (((np.arctan2(py-ccy, px-ccx)+np.pi/2) % (2*np.pi))/(2*np.pi)).astype(np.float32)
    sym.update(cx=ccx, cy=ccy, R=rr*s1, s=s1)
    # lettres
    lets = []
    for d in L["letters"]:
        a, (lx, ly) = scaled(L["aw"], d["box"], s2)
        x0, y0, x1, y1 = d["box"]
        lets.append(dict(a=a, x=o2[0]+lx*s2, y=o2[1]+ly*s2, row=d["row"], cx=o2[0]+(x0+x1)/2*s2, s=s2))
    bx0 = min(l["cx"] for l in lets); bx1 = max(l["cx"] for l in lets); bcx = (bx0+bx1)/2
    ytop = o2[1]+ty0*s2; ybot = o2[1]+ty1*s2
    for l in lets: l["dx"] = (l["cx"]-bcx)*.20
    return dict(sym=sym, lets=lets, bar=(bx0-40*sc, bx1+60*sc), ytxt=(ytop, ybot), sc=sc)

# ────────────────────────────── PARTICULES ───────────────────────────────
class Sparks:
    def __init__(self, rng):
        self.rng = rng; self.p = np.zeros((0, 2), np.float32); self.v = np.zeros((0, 2), np.float32)
        self.l = np.zeros(0, np.float32); self.m = np.ones(0, np.float32); self.drag = np.zeros(0, np.float32)
    def emit(self, pos, vel, life, drag=.97):
        n = len(pos)
        self.p = np.vstack([self.p, pos.astype(np.float32)]); self.v = np.vstack([self.v, vel.astype(np.float32)])
        self.l = np.concatenate([self.l, life.astype(np.float32)]); self.m = np.concatenate([self.m, life.astype(np.float32)])
        self.drag = np.concatenate([self.drag, np.full(n, drag, np.float32)])
    def step(self, dt):
        if not len(self.l): return
        self.p += self.v*dt; self.v *= self.drag[:, None]; self.v[:, 1] -= 12*dt; self.l -= dt
        k = self.l > 0
        self.p, self.v, self.l, self.m, self.drag = self.p[k], self.v[k], self.l[k], self.m[k], self.drag[k]
    def amp(self): return (np.clip(self.l/self.m, 0, 1)**1.4).astype(np.float32)

def add_patch(fr, cx, cy, sx, sy, color, amp):
    H, W, _ = fr.shape
    x0, x1 = int(max(0, cx-4*sx)), int(min(W, cx+4*sx+1)); y0, y1 = int(max(0, cy-4*sy)), int(min(H, cy+4*sy+1))
    if x1 <= x0 or y1 <= y0 or amp <= 0: return
    gx = np.exp(-.5*((np.arange(x0, x1, dtype=np.float32)-cx)/sx)**2)
    gy = np.exp(-.5*((np.arange(y0, y1, dtype=np.float32)-cy)/sy)**2)
    fr[y0:y1, x0:x1] += np.outer(gy, gx)[..., None]*color*amp

def blur_up(lr, r, W, H):
    im = Image.fromarray(np.clip(lr/1.5*255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))
    return np.asarray(im.resize((W, H), Image.BILINEAR)).astype(np.float32)/255*1.5

# ──────────────────────────────── SON ────────────────────────────────────
def lpn(n, k): return np.convolve(np.random.randn(n), np.ones(k)/k, "same").astype(np.float32)

def build_sound(letter_times, T):
    out = np.zeros(int(T*SR), np.float32); t = np.arange(len(out))/SR
    def put(x, at):
        i = int(at*SR)
        if i < len(out): j = min(len(out), i+len(x)); out[i:j] += x[:j-i]
    drone = (np.sin(2*np.pi*46*t)*.5 + np.sin(2*np.pi*69.3*t)*.22)*(1+.12*np.sin(2*np.pi*.18*t))
    out += (drone*smooth(t/3.5)*np.clip((T-t)/1.4, 0, 1)*.30).astype(np.float32)
    out += lpn(len(out), 300)*.05*np.clip((T-t)/1.0, 0, 1)                       # souffle d'air
    # texture de lumière : bruit aigu montant + glissando fin pendant le tracé de l'orbite
    n = int((T_RING[1]-T_RING[0]+.3)*SR); u = np.linspace(0, 1, n)
    hp = np.random.randn(n).astype(np.float32); hp -= lpn(n, 18)
    f = 600*(2800/600)**u; ph = np.cumsum(2*np.pi*f/SR)
    put((hp*u**2*.10 + np.sin(ph)*u**3*.05).astype(np.float32), T_RING[0]-.1)
    def thump(at, g=.6):
        n = int(.9*SR); tt = np.arange(n)/SR
        put((np.sin(2*np.pi*(55+45*np.exp(-tt*18))*tt)*np.exp(-tt*5)*g).astype(np.float32), at)
    def glass(at, g=.14):
        n = int(.9*SR); tt = np.arange(n)/SR
        put(((np.sin(2*np.pi*3200*tt)+.6*np.sin(2*np.pi*4870*tt))*np.exp(-tt*22)*g).astype(np.float32), at)
    def whoosh(at, dur, g=.30):
        n = int(dur*SR); u = np.linspace(0, 1, n)
        put((lpn(n, 10)*np.sin(np.pi*u)**2*g).astype(np.float32), at)
    thump(T_IGN-.02, .7); glass(T_IGN); whoosh(T_ECL[0], .9, .22)
    whoosh(T_BAR[0]-.2, 1.9, .34)
    for lt in letter_times:                                                     # claquements doux
        n = int(.035*SR); tt = np.arange(n)/SR
        put((lpn(n, 4)*np.exp(-tt*120)*.45).astype(np.float32), lt+.18)
    # impact de verrouillage : chute sub-grave + souffle
    n = int(2.2*SR); tt = np.arange(n)/SR; f = 38+60*np.exp(-tt*9); ph = np.cumsum(2*np.pi*f/SR)
    put((np.sin(ph)*np.exp(-tt*1.6)*.9).astype(np.float32), T_LOCK-.03)
    put((lpn(n, 6)*np.exp(-tt*2.2)*.35).astype(np.float32), T_LOCK-.03); glass(T_LOCK, .16)
    whoosh(T_SHINE[0]-.1, 1.4, .16)
    out = np.tanh(out*1.25); return out/np.max(np.abs(out))*.85

def write_wav(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x*32767).astype(np.int16).tobytes())

# ───────────────────────────── RENDU ─────────────────────────────
def render(fmt, logo, preview, out_dir):
    import imageio.v2 as iio, imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    base = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)}[fmt]
    k = .333 if preview else 1.0
    W, H = (int(base[0]*k)//8)*8, (int(base[1]*k)//8)*8
    fps = 15 if preview else FPS
    layout = "stacked" if fmt == "9:16" else "horizontal"
    Ly = build(W, H, layout, logo); sc = Ly["sc"]; S, LET = Ly["sym"], Ly["lets"]
    rng = np.random.default_rng(11); np.random.seed(11)
    w4, h4 = W//4, H//4

    # fond précalculé
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r2 = ((xx-W/2)/(W/2))**2 + ((yy-H/2)/(H/2))**2
    base_bg = BG_E + (BG_C-BG_E)*np.exp(-r2*1.5)[..., None]
    vig = np.clip(1-.42*r2/2, .5, 1)[..., None].astype(np.float32)
    y8, x8 = np.mgrid[0:H//8, 0:W//8].astype(np.float32)
    ys4, xs4 = np.mgrid[0:h4, 0:w4].astype(np.float32)
    dist4 = np.sqrt((xs4*4-S["cx"])**2 + (ys4*4-S["cy"])**2)
    cxl, cyl = W/2, H/2
    nd = 520 if not preview else 200
    dust = np.column_stack([rng.random(nd)*W, rng.random(nd)*H, .2+rng.random(nd)*.8]).astype(np.float32)
    bok = np.column_stack([rng.random(40)*W, rng.random(40)*H, .3+rng.random(40)*.7]).astype(np.float32)

    # démarrage des lettres : quand le rayon les croise
    b0, b1 = Ly["bar"]; ylo, yhi = Ly["ytxt"]
    starts = []
    for l in LET:
        ts = T_BAR[0] + (l["cx"]-30*sc-b0)/(b1-b0)*(T_BAR[1]-T_BAR[0]) + (.12 if l["row"] else 0)
        starts.append(ts)
    # masque global du logo final (pour l'exhalaison de particules)
    full = np.zeros((H, W), np.float32)
    def blit(dst, a, x, y, mode="max"):
        h, w = a.shape; x, y = int(round(x)), int(round(y))
        x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x+w), min(H, y+h)
        if x1 <= x0 or y1 <= y0: return
        sub = a[y0-y:y1-y, x0-x:x1-x]
        dst[y0:y1, x0:x1] = np.maximum(dst[y0:y1, x0:x1], sub)
    blit(full, S["aw"], S["x"], S["y"]); [blit(full, l["a"], l["x"], l["y"]) for l in LET]
    iy, ix = np.nonzero(full > .8)

    sparks = Sparks(rng); burst_done = False
    nf = int(DUR*fps); tmp = os.path.join(out_dir, f"_tmp_{fmt.replace(':','x')}.mp4")
    wr = iio.get_writer(tmp, fps=fps, codec="libx264", macro_block_size=2,
                        ffmpeg_params=["-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p"])
    still = None
    for fi in range(nf):
        t = fi/fps; dt = 1/fps
        # ── fond : l'univers s'allume à l'éclipse ──
        ign = smooth((t-T_ECL[0])/(T_IGN-T_ECL[0]+.5))
        bgs = .10 + .90*ign
        au = (np.sin(x8*.045+t*.5)*np.sin(y8*.05-t*.35) + np.sin((x8+y8)*.03+t*.4))*.25+.5
        aur = np.asarray(Image.fromarray((np.clip(au, 0, 1)*255).astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32)/255
        fr = base_bg*bgs + aur[..., None]*np.array([6, 26, 70], np.float32)*ign
        # ── calques du logo ──
        Aw = np.zeros((H, W), np.float32); Ad = np.zeros((H, W), np.float32)
        p = ease((t-T_RING[0])/(T_RING[1]-T_RING[0])) if t > T_RING[0] else 0.0
        m = np.clip((p*1.04 - S["t01"])/.05, 0, 1)*(p > 0)
        blit(Aw, S["aw"]*m, S["x"], S["y"])
        u2 = ease((t-T_ECL[0])/(T_ECL[1]-T_ECL[0])) if t > T_ECL[0] else 0.0
        m2 = np.clip((u2*1.1 - (1-S["t01"]))/.1, 0, 1)*(u2 > 0)
        blit(Ad, S["ad"]*m2, S["x"], S["y"])
        for l, ts in zip(LET, starts):
            q = (t-ts)/LETTER_DUR
            if q <= 0: continue
            e = ease(q); a = l["a"]
            dy = (1-e)*(50*sc)*(1 if l["row"] == 0 else -1); dx = (1-e)*l["dx"]
            if q < 1:
                im = Image.fromarray((a*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(float(max(.1, (1-e)*9*sc))))
                a = np.asarray(im).astype(np.float32)/255*e
            blit(Aw, a, l["x"]+dx, l["y"]+dy)
        fr = fr*(1-Aw[..., None]) + WHITE*Aw[..., None]
        fr = fr*(1-Ad[..., None]) + NAVY*Ad[..., None]

        # ── émission basse résolution (bloom) ──
        Aw4 = Aw[:h4*4, :w4*4].reshape(h4, 4, w4, 4).mean((1, 3))
        breath = .12*np.sin(2*np.pi*(t-T_LOCK)/2.4)*smooth(t-T_LOCK) if t > T_LOCK else 0
        klog = .30 + .95*np.exp(-((t-T_LOCK-.1)/.5)**2) + .35*smooth((t-T_RING[0])/1.8)*(t < T_IGN+1) + breath
        E = Aw4[..., None]*TINT*klog
        ang = -np.pi/2 + 2*np.pi*p
        hx, hy = S["cx"]+S["R"]*.80*np.cos(ang), S["cy"]+S["R"]*.80*np.sin(ang)
        # point de lumière + comète
        spark_a = smooth((t-T_SPARK)/.5)*(1 if t < T_RING[1]+.15 else np.exp(-(t-T_RING[1]-.15)*6))
        if spark_a > 0.01:
            hx0, hy0 = (hx, hy) if p > 0 else (S["cx"], S["cy"]-S["R"]*.80)
            pul = 1+.25*np.sin(t*18)
            add_patch(fr, hx0, hy0, 7*sc, 7*sc, np.array([255, 255, 255], np.float32), .9*spark_a*pul)
            add_patch(fr, hx0, hy0, W*.16, 2.2*sc, np.array([120, 175, 255], np.float32), .55*spark_a)    # strie anamorphique
            ex, ey = int(hx0/4), int(hy0/4)
            if 0 <= ex < w4 and 0 <= ey < h4: E[max(0, ey-2):ey+3, max(0, ex-2):ex+3] += 1.2*spark_a
            for kk in range(1, 16):                                                                 # traîne
                a2 = ang - kk*.07
                if p > 0:
                    add_patch(fr, S["cx"]+S["R"]*.80*np.cos(a2), S["cy"]+S["R"]*.80*np.sin(a2), 5*sc, 5*sc,
                              ICE, .5*np.exp(-kk*.26)*spark_a)
            if p > 0 and t < T_RING[1]+.05:
                n = 26; sp = rng.normal(0, 1, (n, 2))
                tang = np.array([-np.sin(ang), np.cos(ang)])
                sparks.emit(np.tile([hx, hy], (n, 1))+sp*3*sc, (tang*40*sc*rng.random((n, 1))+sp*55*sc), .5+rng.random(n)*.9, .95)
        # rayon de lumière (balayage vertical)
        if T_BAR[0]-.1 <= t <= T_BAR[1]+.3:
            bx = b0 + (t-T_BAR[0])/(T_BAR[1]-T_BAR[0])*(b1-b0); ba = smooth((t-T_BAR[0]+.1)/.2)*smooth((T_BAR[1]+.3-t)/.3)
            ya, yb = ylo-40*sc, yhi+40*sc
            xs_ = np.arange(int(max(0, bx-30*sc)), int(min(W, bx+30*sc)))
            if len(xs_):
                prof = np.exp(-.5*((xs_-bx)/(4*sc))**2)
                ys_ = np.arange(int(max(0, ya)), int(min(H, yb)))
                vf = np.clip(1-np.abs((ys_-(ya+yb)/2)/((yb-ya)/2))**3, 0, 1)
                if len(ys_): fr[ys_[0]:ys_[-1]+1, xs_[0]:xs_[-1]+1] += np.outer(vf, prof)[..., None]*np.array([200, 225, 255], np.float32)*.9*ba
            add_patch(fr, bx, (ya+yb)/2, W*.12, 2.5*sc, np.array([130, 180, 255], np.float32), .35*ba)
            ex, ey = int(bx/4), int(((ya+yb)/2)/4)
            E[max(0, int(ya/4)):int(yb/4), max(0, ex-3):ex+4] += .6*ba
            n = 18; sparks.emit(np.column_stack([np.full(n, bx), rng.uniform(ya, yb, n)]) + rng.normal(0, 3*sc, (n, 2)),
                                np.column_stack([rng.normal(-20, 40, n), rng.normal(-25, 30, n)])*sc, .6+rng.random(n)*.8, .95)
        # exhalaison du logo au verrouillage
        if t >= T_LOCK and not burst_done:
            burst_done = True; n = 1500 if not preview else 500; j = rng.integers(0, len(ix), n)
            pos = np.column_stack([ix[j], iy[j]]).astype(np.float32)
            dirv = pos - np.array([W/2, H/2], np.float32); dirv /= (np.linalg.norm(dirv, axis=1, keepdims=True)+1e-3)
            vel = dirv*rng.uniform(25, 190, (n, 1))*sc + rng.normal(0, 25, (n, 2))*sc
            sparks.emit(pos, vel, 1.0+rng.random(n)*1.4, .94)
        sparks.step(dt)
        if len(sparks.l):
            a = sparks.amp(); xi = np.clip((sparks.p[:, 0]/4).astype(int), 0, w4-1); yi = np.clip((sparks.p[:, 1]/4).astype(int), 0, h4-1)
            np.add.at(E, (yi, xi), (TINT*a[:, None])*.9)
            fx = np.clip(sparks.p[:, 0].astype(int), 0, W-1); fy = np.clip(sparks.p[:, 1].astype(int), 0, H-1)
            np.add.at(fr, (fy, fx), (np.array([220, 235, 255], np.float32)*a[:, None])*.8)
        # ondes de choc
        for t0, st, rmax in ((T_IGN, .9, .62), (T_LOCK, 1.2, .85)):
            if 0 <= t-t0 < 1.3:
                rad = ease((t-t0)/1.3)*rmax*W; amp = st*np.exp(-(t-t0)*2.6)
                E += (np.exp(-((dist4-rad/1.0)/(max(2.0, 5*sc)))**2)*amp*.8)[..., None]*TINT
        # poussière / bokeh
        d = dust.copy(); d[:, 1] = (d[:, 1] - t*d[:, 2]*22*sc) % H; d[:, 0] = (d[:, 0] + np.sin(t*.4+d[:, 2]*9)*8*sc) % W
        tw = (.5+.5*np.sin(t*2+d[:, 2]*20))*d[:, 2]*(.25+.75*ign)
        np.add.at(fr, (d[:, 1].astype(int) % H, d[:, 0].astype(int) % W), (ICE*tw[:, None])*.9)
        bpos = bok.copy(); bpos[:, 1] = (bpos[:, 1] - t*bpos[:, 2]*14*sc) % H
        for q in range(len(bpos)):
            ex, ey = int(bpos[q, 0]/4) % w4, int(bpos[q, 1]/4) % h4
            E[max(0, ey-1):ey+2, max(0, ex-1):ex+2] += TINT*bpos[q, 2]*.35*ign
        # bloom
        g = blur_up(E, 3, W, H)*.6 + blur_up(E, 10, W, H)*.95
        fr += g*TINT*255*.55
        # reflet de verre
        if T_SHINE[0] <= t <= T_SHINE[1]:
            u = ease((t-T_SHINE[0])/(T_SHINE[1]-T_SHINE[0])); pos = -.3*W + u*1.6*W
            band = np.exp(-(((xx+.35*yy)-pos)/(.045*W))**2)
            fr += (band*Aw)[..., None]*np.array([170, 200, 255], np.float32)*.95
        # aberration chromatique sur les impacts
        ca = int(round(4*sc*(np.exp(-((t-T_IGN)/.09)**2) + 1.3*np.exp(-((t-T_LOCK-.03)/.1)**2))))
        if ca:
            fr[..., 0] = np.roll(fr[..., 0], ca, 1); fr[..., 2] = np.roll(fr[..., 2], -ca, 1)
        # caméra : push-in lent + coup de caméra au verrouillage
        z = 1 + .05*smooth(t/DUR) + .016*np.exp(-((t-T_LOCK-.05)/.14)**2)
        im = Image.fromarray(np.clip(fr, 0, 255).astype(np.uint8))
        bw, bh = W/z, H/z; box = ((W-bw)/2, (H-bh)/2, (W+bw)/2, (H+bh)/2)
        fr = np.asarray(im.resize((W, H), Image.BICUBIC, box=box)).astype(np.float32)
        fr = fr*vig + np.random.randn(H, W, 1).astype(np.float32)*1.4
        fr *= min(1, t/.5)
        out8 = np.clip(fr, 0, 255).astype(np.uint8); wr.append_data(out8); still = out8
        if fi % (fps) == 0: print(f"  [{fmt}] {fi}/{nf}", end="\r")
    wr.close(); print()
    Image.fromarray(still).save(os.path.join(out_dir, f"logo_final_{fmt.replace(':','x')}.png"))

    wav = os.path.join(out_dir, "_son.wav"); write_wav(wav, build_sound(starts, DUR))
    outp = os.path.join(out_dir, f"logo_chekpo_{fmt.replace(':','x')}.mp4")
    subprocess.run([ff, "-y", "-i", tmp, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
                    "-b:a", "192k", "-ac", "2", "-shortest", outp], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(tmp); os.remove(wav); print(f"✔ {outp}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--logo", default="logo_Ousman_fond_blanc_sur_bleu.png")
    ap.add_argument("--format", choices=["16:9", "9:16", "1:1", "all"], default="all")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--prompts", action="store_true")
    ap.add_argument("--out", default="output_logo")
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "prompts_logo.json"), "w", encoding="utf-8") as f:
        json.dump(PROMPTS, f, ensure_ascii=False, indent=2)
    print("✔ prompts_logo.json exporté (Veo / Runway / Sora / Luma / Kling — logo en image de référence)")
    if a.prompts: return
    if not os.path.exists(a.logo): print(f"Logo introuvable : {a.logo}"); sys.exit(1)
    for fmt in (["16:9", "9:16"] if a.format == "all" else [a.format]): render(fmt, a.logo, a.preview, a.out)

if __name__ == "__main__":
    main()
