# TennisFriends design foundation

This is a **tokens-only** design system: color tokens, typography, and a small
set of brand utility classes. There are no React components to import — you
build UI yourself, but style it with the vocabulary below so every design is
on-brand. The product is a social app for tennis players; the palette evokes a
tennis court (deep green), the ball (lime/yellow), and clay.

## Setup

Designs receive `styles.css` (which `@import`s `_ds_bundle.css`). Once it loads,
all tokens and utility classes below are available globally — no provider, no
wrapper, no JS. Fonts (Playfair Display, DM Sans) load via a Google Fonts
`@import` already inside the stylesheet; you don't add font links yourself.

## The styling idiom

Style with **CSS custom properties** and the **brand utility classes** — NOT
Tailwind color utilities. Classes like `bg-court-green` or `text-ball-yellow`
do **not** resolve here (no Tailwind runtime ships). Use `var(--color-*)` in
inline styles or your own CSS instead.

### Color tokens (CSS variables)

| Family | Variables | Use |
|---|---|---|
| Court green (primary) | `--color-court-green`, `--color-court-green-light`, `--color-court-green-soft`, `--color-court-green-pale` | primary actions, headings, focus rings, borders |
| Ball yellow (accent) | `--color-ball-yellow`, `--color-ball-glow`, `--color-ball-pale` | energetic highlights, tinted backgrounds |
| Clay (warm accent) | `--color-clay`, `--color-clay-light` | secondary accents |
| Club purple (club chats) | `--color-club-purple`, `--color-club-purple-deep`, `--color-club-purple-soft`, `--color-club-purple-tint`, `--color-club-purple-wash` | club surfaces; `deep`=text, `tint`/`wash`=row bgs |
| Circle lime (circle chats) | `--color-circle-lime`, `--color-circle-lime-deep`, `--color-circle-lime-soft`, `--color-circle-lime-tint`, `--color-circle-lime-wash` | circle surfaces; same roles as club purple |
| Neutrals & surfaces | `--color-net-white` (cards), `--color-surface` (app bg), `--color-surface-warm`, `--color-ink` (body text) | backgrounds, cards, text |

### Typography

- `--font-display` — Playfair Display (serif): headings, hero text.
- `--font-body` — DM Sans (sans): body and UI text. `<body>` defaults to this.

### Brand utility classes

- Buttons: `.btn-primary`, `.btn-secondary`, `.btn-danger`, plus `.btn-sm` modifier.
- `.card-hover` — lift + shadow on hover for cards.
- `.skeleton` — shimmering loading placeholder.
- Textures: `.court-pattern`, `.net-texture` — subtle background patterns.
- Motion: `.animate-fade-in-up`, `.animate-slide-in-right`, `.animate-slideup`,
  `.animate-ball-bounce`; stagger entrance with `.stagger-1` … `.stagger-5`.

## Where the truth lives

`_ds/<folder>/_ds_bundle.css` is the foundation — read it for the exact token
values, class rules, and keyframes. `styles.css` is the entry that pulls it in.

## Idiomatic snippet

```jsx
<div style={{ background: 'var(--color-net-white)', borderRadius: '0.75rem', padding: '1.25rem' }}
     className="card-hover">
  <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--color-court-green)' }}>
    Saturday Doubles
  </h2>
  <p style={{ color: 'var(--color-ink)' }}>Lower Woodland Park · 2:00 PM</p>
  <button className="btn-primary">RSVP</button>
</div>
```
