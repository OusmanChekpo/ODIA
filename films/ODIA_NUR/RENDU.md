# ODIA — « NŪR / LA LUMIÈRE STRUCTURÉE »
### Film-manifeste · NICHOLSON Studio Motion · Direction du Motion Design

> **Format** 16:9 cinématique · 1920×1080 · 30 fps · 26 s
> **Contrat éthique** : public/client musulman → **zéro instrument de musique**,
> zéro figure humaine, zéro représentation non conforme à la pudeur.
> **Audio** : silence habité + sound design 100 % synthétisé + voix off pure.

---

## 1. ANALYSE & CONTEXTE CLIENT

- **Brief** : carte blanche (validation client), format 16:9 cinématique ~20-30 s,
  contraintes islamiques strictes.
- **Message clé** : ODIA n'est pas une marque qui *montre* — c'est une marque qui
  *structure*. La lumière comme matière première, la géométrie comme langage.
- **Lecture culturelle** : nous puisons dans le patrimoine visuel islamique
  (girih, zellige, khatam à 8 branches, aniconisme) sans jamais le pasticher :
  la géométrie sacrée devient **système génératif**. Aucune figure humaine,
  aucun instrument : le respect des valeurs n'est pas une limitation, c'est le
  concept.

## 2. DIRECTION ARTISTIQUE & INNOVATION UNIQUE

**L'idée de rupture** : le film est *tracé*, pas *filmé*. Un stylo de lumière
dessine en temps réel une rosace khatam à 8 branches — comme un artisan
zelligeur dont le geste aurait été confié à une machine générative. La rosace
se multiplie en tessellation infinie (l'unicité → la multitude, *tawhid* visuel),
puis la multitude s'effondre en une seule signature : **ODIA**.

- **Palette** : or `#E9BA54` / or clair `#FAE096` sur vide charbon bleuté
  `#06090B`, accents émeraude `#227662`, ivoire `#F5F0E7`.
- **Typo** : capitales ivoire très lettrées (tracking cinéma), filet or +
  losange (écho au motif), tagline « LA LUMIÈRE STRUCTURÉE ».
- **Grain & barres cinémascope** : matérialité pellicule, souffle vivant.
- **Rien de figuratif** : 100 % lumière, géométrie, particules → conformité
  totale et identité hors-norme.

## 3. PIPELINE TECHNIQUE & OUTILS (architecture hybride)

| Étape | Outil traditionnel | IA / procédural |
|---|---|---|
| Concept & key visual | DA, moodboards | `assets/key_visual.jpg` (génération image) |
| Rendu du film | compositing numpy/PIL = « After Effects virtuel » | `generate_odia_nur.py` (moteur procédural déterministe) |
| Voix off | direction de comédien (timing) | TTS neural (vo/vo1–vo5), ré-enregistrable |
| Sound design | mixage ffmpeg | synthèse numpy pure (vent, grains, sub-drop) — **aucun sample, aucun instrument** |
| Finition | étalonnage, grain, barres | intégré au moteur |
| Déclinaisons | — | `--res 1280` préviz, `--frames-only` séquence PNG pour AE/Nuke/Runway img2vid |

Le script est **portable** : `python3 generate_odia_nur.py` (numpy + Pillow +
ffmpeg, ou imageio-ffmpeg). Sortie : `out/ODIA_NUR_FINAL.mp4`.

## 4. AMBIANCE SONORE — SILENCE & MATIÈRE (aucune musique)

Conformité islamique + signature NICHOLSON : la bande-son est une **matière**,
pas une mélodie. Tout est synthétisé dans le script (section `synth_sounddesign`) :

1. **Vent profond** (bruit rose filtré 35–300 Hz, respiration lente) — le silence habité.
2. **Grains de sable scintillants** (2,6–7,2 kHz, panoramiques aléatoires) — la tessellation qui « crépite ».
3. **Riser d'air** avant l'implosion (SFX filtré montant, pas une note).
4. **Sub-drop** 52→27 Hz à l'implosion — pression physique, effet de salle.
5. **Whoosh** de retombée + **souffle** à l'apparition du mot-signature.
6. **Voix off pure** (voix grave, posée), placée au frame près (`VO_DELAYS`).

Aucun instrument, aucune mélodie, aucune voix féminine exposée : neutralité et
pudeur totales.

## 5. DÉCOUPAGE & SCÉNARISATION (26 s — chaque seconde compte)

| T (s) | Scène | Action | Audio |
|---|---|---|---|
| 0.0–2.6 | **Le souffle** | noir, poussières de lumière, point-or qui respire | vent + VO1 « Tout commence dans le silence. » |
| 2.6–4.0 | **Le faisceau** | un trait de lumière traverse l'écran, se contracte en point-stylo | riser discret |
| 4.0–10.0 | **Le tracé** | le stylo dessine la rosace khatam (étoile→octogone→rayons→étoile interne), rotation −3°, scale-in | VO2 « Une lumière trace la géométrie du monde. » |
| 10.0–16.5 | **La tessellation** | révélation radiale ease-out-expo, onde de luminosité, la trame zellige envahit le cadre, losanges émeraude ; la rosace maîtresse se réduit | grains de sable stéréo + VO3 « De l'infini naît la structure. » |
| 16.5–20.5 | **L'implosion** | flash de claquage, la trame se brise en 4 200 particules, spirale ease-in-cubic vers le centre | sub-drop + whoosh — **silence de voix** |
| 20.5–22.5 | **La condensation** | les particules convergent en points de lettrage (spline smoothstep + jitter décroissant) | souffle d'air |
| 22.5–26.0 | **La signature** | sur-exposition brève → pose du mot ODIA, filet or + losange, tagline ; trame fantôme à 7 % en mémoire | VO4 « Odia. » VO5 « La lumière structurée. » fade vent |

Transitions : fondu par la lumière elle-même (le glow), aucun cut sec sauf le
claquage d'implosion (seul « hard cut » du film, donc mémorable).

## 6. PROMPTS DE GÉNÉRATION VIDÉO (Veo 3 / Runway Gen-4 / Sora / Luma)

À utiliser pour les versions photoréalistes / campagnes dérivées. Chaque plan
reste aniconique et sans musique.

**SHOT 1 — THE BREATH (macro, 4 s)**
> Extreme macro shot on black charcoal void, a single warm golden ember of light
> breathing slowly at the center of frame, tiny golden dust particles drifting,
> anamorphic bokeh, volumetric darkness, subtle film grain, cinematic 2.39:1
> framing inside 16:9, no people, no objects, no text, slow push-in, photoreal
> light simulation. Negative: no music, no instruments, no human, no watermark.

**SHOT 2 — THE TRACING (plan moyen, 6 s)**
> A thin beam of liquid golden light draws an intricate eight-pointed Islamic
> khatam star rosette in mid-air, stroke by stroke like a luminous pen, dark
> charcoal blue-black space, soft golden bloom, emerald micro-accents at star
> intersections, camera locked-off with imperceptible drift, premium brand film
> aesthetic, octane render look, 1080p cinematic. Negative: no people, no hands,
> no instruments, no music, no text.

**SHOT 3 — THE TESSELLATION (traveling arrière, 6 s)**
> Camera pulls back in slow dolly-out as the golden star rosette multiplies into
> an infinite zellige tessellation spreading radially through darkness, fine
> luminous gold linework, gentle brightness wave crossing the pattern, tiny
> emerald diamonds between stars, sacred geometry, hypnotic symmetry, filmic
> grain, high-end motion design. Negative: no humans, no instruments, no audio
> melody, no text.

**SHOT 4 — THE IMPLOSION (6 s)**
> The entire golden geometric tessellation shatters into thousands of glowing
> gold particles spiraling violently inward toward the center, swirling vortex
> of light dust collapsing into a single bright core, motion blur, deep blacks,
> cinematic VFX shot, Houdini-style simulation look. Negative: no people, no
> explosion fire, no music.

**SHOT 5 — THE SIGNATURE (4 s)**
> The bright core of golden particles condenses and crystallizes into elegant
> ivory-white glowing letters spelling ODIA over near-black background, faint
> ghost of the star tessellation behind, thin golden rule and small diamond
> below, cinematic title reveal, soft bloom, film grain. Negative: no people,
> no instruments, no extra words, no logo other than ODIA.

## LIVRABLES

- `generate_odia_nur.py` — le « prompt Python » : moteur complet, portable,
  déterministe (vidéo + sound design + mixage).
- `out/ODIA_NUR_FINAL.mp4` — le film final 1080p mixé (VO + sound design).
- `assets/key_visual.jpg` — key visual de direction artistique.
- `vo/` — voix off (remplaçables par une prise studio, mêmes timings).
- `--frames-only` — séquence PNG pour compositing AE / Nuke ou img2vid Runway.

*NICHOLSON — nous ne faisons pas des vidéos. Nous structurons la lumière.*
