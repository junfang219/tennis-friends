<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## House rules

- **Server components by default.** Use `"use client"` only when interactivity requires it (event handlers, useState, useEffect, browser-only APIs).
- **Strict TypeScript.** No `any`. Use Zod for runtime validation of all external input (API requests, form submissions, env vars).
- **Database access in server code only.** Never import Prisma into client components or expose the Prisma client to the browser. Wrap all DB calls in server actions, API routes, or server components.
- **Mobile-first.** Design and test every page at 375px width before considering it done. Desktop layouts come second.
- **No new heavyweight dependencies without checking.** The repo already has Prisma, NextAuth, Tailwind, bcryptjs. Avoid adding Redux, MUI, Chakra, Mantine, Apollo, or other large libraries without explicit approval.
- **Read `data/SCHEMA.md` before touching court/facility code.** That file is the source of truth for the Facility data shape and the marker bucket / availability dashboard rules.
- **Accessibility matters.** Semantic HTML, labeled inputs, 4.5:1 contrast minimum.
- **Don't log sensitive data.** No passwords, no session cookies, no API keys — even in dev. Especially relevant for the ActiveNet scraper module.

## Project data files

The repo has a `data/` folder at the root containing:
- `tennis_courts.json` — 268 Seattle-area tennis venues (the canonical source)
- `tennis_courts.csv` — same data, flat format
- `SCHEMA.md` — field definitions, marker bucket rules, Prisma model shape

Read `data/SCHEMA.md` before any work involving facilities, courts, or the map.
