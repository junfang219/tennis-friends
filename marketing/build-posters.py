#!/usr/bin/env python3
"""Build ordered poster variants from the single source poster.html.
Splits the <body> into labeled sections (by their HTML comments) and
re-emits them in a given order. Alternation is automatic (CSS nth-child),
so any order renders with correct light/dark + phone-side alternation."""
import re, sys, os

SRC = os.path.join(os.path.dirname(__file__), 'poster.html')
html = open(SRC, encoding='utf-8').read()

head, body = html.split('<body>', 1)
body, tail = body.split('</body>', 1)

# (key, exact comment marker that opens the section)
MARKERS = [
    ('hero',     '<!-- HERO -->'),
    ('feed',     '<!-- 1. FEED -->'),
    ('looking',  '<!-- 2. LOOKING FOR PLAYERS (broadcast) -->'),
    ('courts',   '<!-- 3. COURTS -->'),
    ('teams',    '<!-- 4. TEAMS -->'),
    ('captain',  '<!-- 4b. TEAM MANAGEMENT — captain spotlight -->'),
    ('calendar', '<!-- 5. CALENDAR -->'),
    ('profile',  '<!-- 6. PROFILE -->'),
    ('diff',     '<!-- WHAT MAKES IT DIFFERENT -->'),
    ('cta',      '<!-- FOOTER CTA -->'),
]
pos = []
for key, marker in MARKERS:
    i = body.find(marker)
    if i < 0:
        sys.exit(f'marker not found: {marker}')
    pos.append((key, i))
pos.sort(key=lambda kv: kv[1])
sections = {}
for n, (key, i) in enumerate(pos):
    end = pos[n + 1][1] if n + 1 < len(pos) else len(body)
    sections[key] = body[i:end].rstrip() + '\n'

ORDERS = {
    'poster-individual': ['hero','feed','looking','courts','calendar','profile','teams','captain','diff','cta'],
    'poster-captain':    ['hero','teams','captain','calendar','courts','feed','looking','profile','diff','cta'],
}

# Per-version section overrides (audience-tailored hero copy)
INDIVIDUAL_HERO = '''  <!-- HERO -->
  <section class="hero">
    <div class="court-lines"></div>
    <span class="badge"><span class="ball"></span> The social court for tennis</span>
    <h1 class="wordmark serif"><span class="t">Tennis</span><span class="f">Friends</span></h1>
    <p class="tagline serif">Find your <b>court companions</b> — and never play alone again.</p>
    <p class="subhead">Players, courts, schedules and your tennis story — all in one friendly app built for the people you actually play with.</p>
    <div class="hero-stats">
      <span class="chip"><span class="dot"></span> Meet players near you</span>
      <span class="chip"><span class="dot"></span> Find your courts</span>
      <span class="chip"><span class="dot"></span> Share every match</span>
    </div>
  </section>
'''

CAPTAIN_HERO = '''  <!-- HERO -->
  <section class="hero">
    <div class="court-lines"></div>
    <span class="badge"><span class="ball"></span> The team HQ for tennis captains</span>
    <h1 class="wordmark serif"><span class="t">Tennis</span><span class="f">Friends</span></h1>
    <p class="tagline serif">Run your team, <b>your way.</b></p>
    <p class="subhead">Import your USTA schedule, gather availability, set lineups and split costs — plus everything your players need to find courts and games.</p>
    <div class="hero-stats">
      <span class="chip"><span class="dot"></span> Import USTA matches</span>
      <span class="chip"><span class="dot"></span> Gather availability</span>
      <span class="chip"><span class="dot"></span> Set the lineup</span>
    </div>
  </section>
'''

OVERRIDES = {
    'poster-individual': {'hero': INDIVIDUAL_HERO},
    'poster-captain':    {'hero': CAPTAIN_HERO},
}

for name, order in ORDERS.items():
    assert set(order) == set(sections), f'{name}: order must list every section once'
    ov = OVERRIDES.get(name, {})
    parts = [(ov[k].rstrip() + '\n') if k in ov else sections[k] for k in order]
    out = head + '<body>\n\n' + '\n'.join(parts) + '\n</body>' + tail
    open(os.path.join(os.path.dirname(__file__), name + '.html'), 'w', encoding='utf-8').write(out)
    print('wrote', name + '.html', '(' + ' → '.join(order) + ')')
