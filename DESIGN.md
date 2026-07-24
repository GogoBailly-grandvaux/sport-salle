# Sport Salle — Design System « Béton, Craie & Scoreboard »

Référence pour toute contribution UI. Source de vérité : les custom properties de `css/app.css`.

## Identité

- **Direction** : la matière d'une salle de sport — béton (fond clair), charbon (sombre), craie (grain), scoreboard (chiffres accent sur charbon), tape au sol (titres uppercase, ticks diagonaux).
- **Sombre = thème vitrine** (par défaut pour les nouveaux profils), façon Lyfta : noir profond, cartes flat, **CTA primaire en pilule blanche texte noir**. Le clair « béton » garde l'accent en CTA.
- **Social façon Instagram** : stories à anneau pour le live, triptyque de profil, badge ✓, double-tap 👊.

## Tokens (extraits de `:root`)

| Token | Clair (béton) | Sombre (Lyfta) |
|---|---|---|
| `--bg` | `#eceef0` | `#050506` |
| `--surface` / `--surface2` | `#ffffff` / `#eaecef` | `#17181c` / `#232428` |
| `--line` / `--line2` | `#dcdfe4` / `#c3c8d0` | `#232428` / `#3a3c42` |
| `--text` / `--text2` / `--muted` | `#14171d` / `#495160` / `#6b7381` | `#ffffff` / `#c7c9ce` / `#8a8d94` |
| `--danger` / `--good` | `#d1493a` / `#2f9e6b` | `#f06a5c` / `#3ddc97` |
| `--accent` | par utilisateur (`ACCENTS` : volt `#c7f24e`, ember, ice, rose, mint, grape) | idem |
| `--btn-primary-bg/fg` | dégradé accent / `--on-accent` | `#ffffff` / `#0b0b0d` |
| `--radius` / `--radius-sm` / `--radius-lg` | 14 / 11 / 20 px | idem |
| `--edge` | `0 2px 0 var(--line)` (arête de plaque) | `none` (flat) |
| `--tap` | 54 px (cible tactile mini) | idem |

Podiums : or `#e9b53f`, argent `#bcc3ce`, bronze `#cd8f60` (`.r1/.r2/.r3`). Scoreboard : fond `#14171d`, bord `#2a3040`, chiffres `var(--accent)`, labels `#8b93a4` — **identique dans les deux thèmes**.

## Typographie

- **Manrope variable** (200–800), self-hostée (`fonts/manrope-var.woff2`, précachée). Corps 450 ; `h1–h3` 800, tracking −0.025em.
- Titres de cartes `.card-t` : uppercase 0.74rem, tracking +0.09em (marquage au sol).
- Chiffres alignés : `font-variant-numeric: tabular-nums` partout où des nombres se comparent.

## Icônes

`icon(name)` dans `js/ui.js` — 65 tracés qualité Lucide (24 px, stroke 2, bouts ronds), stylés par `.ico` (couleur = `currentColor`). **Zéro emoji dans le chrome UI** ; les emojis restent du contenu (réactions `👊🔥💪👏`, avatars).

## Composants clés

- **Cartes** `.card` : bord 1px + `--edge` ; le flou `--shadow` est réservé au hero, FAB et bannières.
- **Boutons** `.btn` : pilules (radius 999) ; `.primary` piloté par tokens ; hauteur `--tap`.
- **Sheets** `sheet()` : grip + drag-to-dismiss + Échap ; `[hidden]{display:none!important}` garanti.
- **Stories live** `.story-ring` : anneau `conic-gradient(accent → danger)`, pulse 2.4 s (désactivé en `prefers-reduced-motion`).
- **Covers Explorer** `.exp-card/.exp-hero` : dégradé stable par objectif (`EXP_HUES`), texte blanc sur zone sombre du dégradé.
- **Heatmaps corps** : silhouettes wger + overlays (`.bm-overlay`), opacité ∝ intensité ; décoratives → `aria-hidden` quand l'info existe en texte.

## Accessibilité (WCAG 2.1 AA — engagements)

- Cibles tactiles ≥ 44 px (`--tap` 54) ; `:focus-visible` global ; contrastes vérifiés sur les deux thèmes.
- Toute animation décorative respecte `prefers-reduced-motion`.
- Badges/états non textuels nommés (`role="img"` + `aria-label`, `aria-pressed` sur segments et filtres).
- Les gestes (double-tap) doublent toujours un bouton accessible, jamais l'inverse.

## Voix & copy

Tutoiement, direct, chaleureux sans emphase. CTA = verbe + résultat (« Ajouter à mes programmes »). États vides = quoi + pourquoi + comment. Erreurs = fait + cause + action. FR d'abord, EN via `t('fr','en')`.
