# Tennis Friends - Claude Code Implementation Guide

## Project Overview

**Tennis Friends** is a social platform for Seattle-area tennis players to connect, play, and improve together. Think "Meetup meets Strava for tennis" — combining partner discovery, match scheduling, skill tracking, and community features in one app.

**Tech Stack:**

- Next.js 14 (App Router)
- React 19
- TypeScript
- Prisma ORM with SQLite (dev) / PostgreSQL (prod)
- NextAuth.js for authentication
- Tailwind CSS
- Playwright for court availability scraping

------

## 🎯 Core Features

| Feature                     | Description                                                | Priority |
| --------------------------- | ---------------------------------------------------------- | -------- |
| 🎾 **Partner Matching**      | Find players by skill level (NTRP), location, availability | P0       |
| 📅 **Session Scheduling**    | Create & join tennis sessions, RSVP system                 | P0       |
| 👥 **Groups & Clubs**        | Create/join tennis communities, group chat                 | P1       |
| 📊 **Skill Tracking**        | NTRP ratings, match history, stats                         | P1       |
| 💬 **Messaging**             | Direct messages between players                            | P1       |
| 🏆 **Leagues & Tournaments** | Organize competitive play, brackets, standings             | P2       |
| 🏟️ **Court Finder**          | Browse venues, real-time availability via ActiveNet        | P1       |

------

## 📁 Project Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── onboarding/page.tsx        # NTRP, availability setup
│   ├── (main)/
│   │   ├── dashboard/page.tsx          # Home feed, upcoming sessions
│   │   ├── players/
│   │   │   ├── page.tsx                # Browse/search players
│   │   │   └── [id]/page.tsx           # Player profile
│   │   ├── sessions/
│   │   │   ├── page.tsx                # Browse open sessions
│   │   │   ├── new/page.tsx            # Create session
│   │   │   └── [id]/page.tsx           # Session details
│   │   ├── groups/
│   │   │   ├── page.tsx                # Browse groups
│   │   │   ├── new/page.tsx            # Create group
│   │   │   └── [id]/page.tsx           # Group details
│   │   ├── courts/
│   │   │   ├── page.tsx                # Venue browser
│   │   │   ├── [id]/page.tsx           # Venue details
│   │   │   └── availability/page.tsx   # Real-time availability search
│   │   ├── messages/
│   │   │   ├── page.tsx                # Inbox
│   │   │   └── [conversationId]/page.tsx
│   │   ├── leagues/
│   │   │   ├── page.tsx                # Browse leagues
│   │   │   └── [id]/page.tsx           # League details, standings
│   │   └── profile/
│   │       ├── page.tsx                # My profile
│   │       └── settings/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── players/route.ts
│   │   ├── sessions/route.ts
│   │   ├── groups/route.ts
│   │   ├── messages/route.ts
│   │   ├── matches/route.ts            # Record match results
│   │   └── scrape/
│   │       └── availability/route.ts   # ActiveNet scraper
│   └── layout.tsx
├── components/
│   ├── ui/                             # Base components
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Avatar.tsx
│   │   ├── Badge.tsx
│   │   ├── Card.tsx
│   │   └── LoadingSpinner.tsx
│   ├── players/
│   │   ├── PlayerCard.tsx
│   │   ├── PlayerSearch.tsx
│   │   ├── NTRPBadge.tsx
│   │   └── AvailabilityDisplay.tsx
│   ├── sessions/
│   │   ├── SessionCard.tsx
│   │   ├── SessionForm.tsx
│   │   ├── RSVPButton.tsx
│   │   └── SessionCalendar.tsx
│   ├── groups/
│   │   ├── GroupCard.tsx
│   │   ├── GroupForm.tsx
│   │   └── MemberList.tsx
│   ├── courts/
│   │   ├── VenueCard.tsx
│   │   ├── VenueMap.tsx
│   │   ├── AvailabilityGrid.tsx
│   │   ├── CredentialsModal.tsx
│   │   └── PrivacyNotice.tsx
│   ├── messages/
│   │   ├── ConversationList.tsx
│   │   ├── MessageThread.tsx
│   │   └── MessageInput.tsx
│   ├── leagues/
│   │   ├── LeagueCard.tsx
│   │   ├── StandingsTable.tsx
│   │   └── BracketView.tsx
│   └── layout/
│       ├── Navbar.tsx
│       ├── Sidebar.tsx
│       ├── MobileNav.tsx
│       └── Footer.tsx
├── lib/
│   ├── auth.ts                         # NextAuth config
│   ├── prisma.ts                       # Prisma client
│   ├── utils.ts                        # Utility functions
│   ├── validators.ts                   # Zod schemas
│   ├── venues.ts                       # Seattle venue data
│   └── scraper/
│       ├── activenet-scraper.ts        # Playwright automation
│       ├── session-cache.ts            # Session token cache
│       └── types.ts
└── types/
    └── index.ts                        # Global TypeScript types
```

------

## 🗃️ Database Schema (Prisma)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"  // Switch to "postgresql" for prod
  url      = env("DATABASE_URL")
}

// ============== USERS & PROFILES ==============

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  name          String
  avatar        String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  profile       Profile?
  sessions      Session[]           // Tennis sessions created
  rsvps         SessionRSVP[]
  sentMessages  Message[]           @relation("SentMessages")
  receivedMessages Message[]        @relation("ReceivedMessages")
  groupMemberships GroupMember[]
  matchesAsPlayer1 Match[]          @relation("Player1Matches")
  matchesAsPlayer2 Match[]          @relation("Player2Matches")
  leagueParticipations LeagueParticipant[]
}

model Profile {
  id            String    @id @default(cuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Skill & Playing Style
  ntrpRating    Float?              // 2.5 - 7.0
  playingStyle  String?             // "baseline", "serve-volley", "all-court"
  preferredSurface String?          // "hard", "clay", "grass", "indoor"

  // Location & Availability
  zipCode       String?
  latitude      Float?
  longitude     Float?
  maxTravelMiles Int      @default(10)

  // Availability (JSON stored as string for SQLite)
  availability  String?             // JSON: { monday: ["morning", "evening"], ... }

  // Bio & Preferences
  bio           String?
  lookingFor    String?             // "casual", "competitive", "drilling", "lessons"
  ageRange      String?             // "18-25", "26-35", etc.

  // Stats
  totalMatches  Int       @default(0)
  wins          Int       @default(0)
  losses        Int       @default(0)

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

// ============== SESSIONS (OPEN PLAY) ==============

model Session {
  id            String    @id @default(cuid())
  creatorId     String
  creator       User      @relation(fields: [creatorId], references: [id])

  title         String
  description   String?
  sessionType   String              // "singles", "doubles", "hitting", "drilling", "lesson"
  skillMin      Float?              // Min NTRP
  skillMax      Float?              // Max NTRP

  // Location
  venueId       String?             // Reference to static venue data
  venueName     String
  address       String?
  courtNumber   String?

  // Timing
  date          DateTime
  startTime     String              // "14:00"
  endTime       String              // "16:00"
  
  // Capacity
  maxPlayers    Int       @default(4)
  spotsLeft     Int       @default(4)

  // Status
  status        String    @default("open")  // "open", "full", "cancelled", "completed"

  rsvps         SessionRSVP[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model SessionRSVP {
  id            String    @id @default(cuid())
  sessionId     String
  session       Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  status        String    @default("confirmed")  // "confirmed", "waitlist", "cancelled"
  createdAt     DateTime  @default(now())

  @@unique([sessionId, userId])
}

// ============== GROUPS & CLUBS ==============

model Group {
  id            String    @id @default(cuid())
  name          String
  description   String?
  type          String    @default("club")  // "club", "league", "casual"
  isPrivate     Boolean   @default(false)
  
  // Location focus
  city          String?
  zipCode       String?

  // Skill range
  skillMin      Float?
  skillMax      Float?

  avatar        String?
  coverImage    String?

  members       GroupMember[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model GroupMember {
  id            String    @id @default(cuid())
  groupId       String
  group         Group     @relation(fields: [groupId], references: [id], onDelete: Cascade)
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  role          String    @default("member")  // "admin", "moderator", "member"
  joinedAt      DateTime  @default(now())

  @@unique([groupId, userId])
}

// ============== MESSAGING ==============

model Message {
  id            String    @id @default(cuid())
  senderId      String
  sender        User      @relation("SentMessages", fields: [senderId], references: [id])
  receiverId    String
  receiver      User      @relation("ReceivedMessages", fields: [receiverId], references: [id])

  content       String
  read          Boolean   @default(false)

  createdAt     DateTime  @default(now())

  @@index([senderId, receiverId])
}

// ============== MATCH TRACKING ==============

model Match {
  id            String    @id @default(cuid())
  
  player1Id     String
  player1       User      @relation("Player1Matches", fields: [player1Id], references: [id])
  player2Id     String
  player2       User      @relation("Player2Matches", fields: [player2Id], references: [id])

  // Can be linked to a session
  sessionId     String?

  // Score (stored as JSON string)
  score         String?             // e.g., "6-4, 3-6, 7-5"
  winnerId      String?

  matchType     String    @default("singles")  // "singles", "doubles"
  playedAt      DateTime

  // Verification
  player1Confirmed Boolean @default(false)
  player2Confirmed Boolean @default(false)

  createdAt     DateTime  @default(now())
}

// ============== LEAGUES & TOURNAMENTS ==============

model League {
  id            String    @id @default(cuid())
  name          String
  description   String?
  type          String    @default("round-robin")  // "round-robin", "ladder", "knockout"
  
  // Skill restrictions
  skillMin      Float?
  skillMax      Float?

  // Timing
  startDate     DateTime
  endDate       DateTime?
  registrationDeadline DateTime?

  // Settings
  maxParticipants Int?
  matchesPerWeek Int       @default(1)

  status        String    @default("registration")  // "registration", "active", "completed"

  participants  LeagueParticipant[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model LeagueParticipant {
  id            String    @id @default(cuid())
  leagueId      String
  league        League    @relation(fields: [leagueId], references: [id], onDelete: Cascade)
  userId        String
  user          User      @relation(fields: [userId], references: [id])

  // Standings
  wins          Int       @default(0)
  losses        Int       @default(0)
  setsWon       Int       @default(0)
  setsLost      Int       @default(0)
  gamesWon      Int       @default(0)
  gamesLost     Int       @default(0)
  points        Int       @default(0)

  joinedAt      DateTime  @default(now())

  @@unique([leagueId, userId])
}
```

------

## 🎾 Feature Implementation Details

### 1. Partner Matching (`/players`)

**Search & Filter Criteria:**

- NTRP rating range (e.g., 3.5 - 4.0)
- Distance from user (using lat/lng)
- Availability overlap
- Playing style preference
- Looking for (casual/competitive/drilling)

```typescript
// src/app/api/players/route.ts
// GET /api/players?ntrpMin=3.5&ntrpMax=4.0&maxDistance=10&availability=weekends

interface PlayerSearchParams {
  ntrpMin?: number;
  ntrpMax?: number;
  maxDistance?: number;      // miles
  availability?: string[];   // ["monday_morning", "saturday_afternoon"]
  playingStyle?: string;
  lookingFor?: string;
}
```

**Matching Algorithm:**

1. Filter by NTRP range
2. Calculate distance using Haversine formula
3. Score availability overlap
4. Rank by compatibility score

### 2. Session Scheduling (`/sessions`)

**Session Types:**

- **Singles** - 2 players
- **Doubles** - 4 players
- **Hitting Session** - Casual rally practice
- **Drilling** - Focused practice
- **Lesson** - One player teaching

**RSVP Flow:**

1. User browses open sessions
2. Clicks "Join" → checks skill range compatibility
3. If within range → confirm RSVP
4. Creator notified
5. When full → status changes, waitlist available

### 3. Groups & Clubs (`/groups`)

**Group Types:**

- **Club** - Ongoing community (e.g., "Capitol Hill Tennis Club")
- **League** - Competitive with standings
- **Casual** - Informal meetup group

**Features:**

- Member directory
- Group-only sessions
- Announcements
- Group chat (future)

### 4. Skill Tracking (`/profile`)

**NTRP Ratings:**

| Rating | Description                               |
| ------ | ----------------------------------------- |
| 2.5    | Beginner - learning basics                |
| 3.0    | Can rally, developing consistency         |
| 3.5    | Consistent on medium shots, learning spin |
| 4.0    | Reliable strokes, good court coverage     |
| 4.5    | Strong all-around game, can vary play     |
| 5.0+   | Tournament/competitive level              |

**Self-Assessment Onboarding:**

- Guided questionnaire during signup
- Can be adjusted based on match results
- Peer verification option

### 5. Messaging (`/messages`)

**Features:**

- Direct messages between any two users
- Conversation threads
- Read receipts
- Link to create session from chat

### 6. Leagues & Tournaments (`/leagues`)

**League Types:**

- **Round Robin** - Everyone plays everyone
- **Ladder** - Challenge players above you
- **Knockout** - Single elimination tournament

**Standings Calculation:**

- Points: Win = 3, Loss = 0
- Tiebreaker: Set difference → Game difference → Head-to-head

------

## 🏟️ Court Finder & Availability (Feature Module)

This is a **supplementary feature** that helps users find and book courts for their sessions.

### Architecture: User-Authenticated Scraping

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER FLOW                                    │
├─────────────────────────────────────────────────────────────────────┤
│  1. User creates session OR browses courts                           │
│  2. Optionally clicks "Check Real-Time Availability"                 │
│  3. Modal: "Enter your Seattle Parks login"                          │
│  4. User enters ActiveNet email + password                           │
│  5. Backend Playwright automation:                                   │
│     - Opens headless browser                                         │
│     - Logs into ActiveNet with user's credentials                    │
│     - Scrapes available time slots                                   │
│     - Returns results                                                │
│  6. Credentials immediately discarded (NEVER stored)                 │
│  7. Session cookie cached for 30 min                                 │
│  8. User sees availability, can click to book on ActiveNet           │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SECURITY GUARANTEES                             │
├─────────────────────────────────────────────────────────────────────┤
│  ✅ Credentials transmitted over HTTPS only                          │
│  ✅ Credentials exist in server memory only during request           │
│  ✅ Credentials NEVER logged, stored, or persisted                   │
│  ✅ Session cookies cached (not passwords) for convenience           │
│  ✅ All browser automation runs in isolated containers               │
│  ✅ Clear privacy messaging to users                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Scraper Implementation

**File: `src/lib/scraper/activenet-scraper.ts`**

```typescript
/**
 * ActiveNet Scraper - Playwright-based automation for Seattle Parks
 * 
 * CRITICAL SECURITY REQUIREMENTS:
 * - NEVER log credentials
 * - NEVER persist credentials to disk
 * - Process credentials in memory only
 * - Immediately discard after use
 * - Use try/finally to ensure cleanup
 */

import { chromium, Browser, Page, BrowserContext } from 'playwright';

interface ScraperCredentials {
  email: string;
  password: string;
}

interface SearchParams {
  venueId: string;
  date: string;        // YYYY-MM-DD
  startTime?: string;  // HH:mm
  endTime?: string;    // HH:mm
}

interface TimeSlot {
  courtName: string;
  startTime: string;
  endTime: string;
  available: boolean;
  bookingUrl?: string;
}

interface ScraperResult {
  success: boolean;
  slots: TimeSlot[];
  error?: string;
  sessionToken?: string;
}

const ACTIVENET_BASE = 'https://anc.apm.activecommunities.com/seattle';
const LOGIN_URL = `${ACTIVENET_BASE}/signin`;
const FACILITY_SEARCH_URL = `${ACTIVENET_BASE}/reservation/search`;

export class ActiveNetScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async initialize(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async scrapeAvailability(
    credentials: ScraperCredentials,
    params: SearchParams,
    existingSessionToken?: string
  ): Promise<ScraperResult> {
    let page: Page | null = null;
    
    try {
      this.context = await this.browser!.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });
      
      if (existingSessionToken) {
        await this.restoreSession(existingSessionToken);
      }
      
      page = await this.context.newPage();
      
      const isLoggedIn = await this.checkLoginStatus(page);
      
      if (!isLoggedIn) {
        const loginSuccess = await this.performLogin(page, credentials);
        if (!loginSuccess) {
          return { success: false, slots: [], error: 'Login failed. Check credentials.' };
        }
      }
      
      const slots = await this.searchAvailability(page, params);
      const sessionToken = await this.extractSessionToken();
      
      return { success: true, slots, sessionToken };
      
    } catch (error) {
      console.error('Scraper error:', error);
      return { 
        success: false, 
        slots: [], 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    } finally {
      if (page) await page.close();
      if (this.context) await this.context.close();
    }
  }

  private async checkLoginStatus(page: Page): Promise<boolean> {
    await page.goto(ACTIVENET_BASE, { waitUntil: 'networkidle' });
    const accountMenu = await page.$('[data-testid="account-menu"], .user-menu, .logged-in');
    return accountMenu !== null;
  }

  private async performLogin(page: Page, credentials: ScraperCredentials): Promise<boolean> {
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 10000 });
    
    await page.fill('input[type="email"], input[name="email"], #email', credentials.email);
    await page.fill('input[type="password"], input[name="password"], #password', credentials.password);
    await page.click('button[type="submit"], input[type="submit"], .login-button');
    
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    
    const errorMessage = await page.$('.error-message, .alert-danger, [role="alert"]');
    if (errorMessage) return false;
    
    return await this.checkLoginStatus(page);
  }

  private async searchAvailability(page: Page, params: SearchParams): Promise<TimeSlot[]> {
    await page.goto(FACILITY_SEARCH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.facility-search-form, #reservationSearch', { timeout: 10000 });
    
    await page.selectOption('select[name="facility"], #facilitySelect', params.venueId);
    await page.fill('input[type="date"], input[name="date"], #searchDate', params.date);
    
    if (params.startTime) {
      await page.fill('input[name="startTime"], #startTime', params.startTime);
    }
    if (params.endTime) {
      await page.fill('input[name="endTime"], #endTime', params.endTime);
    }
    
    await page.click('button[type="submit"], .search-button, #searchBtn');
    await page.waitForSelector('.availability-results, .time-slots, .search-results', { timeout: 15000 });
    
    const slots = await page.$$eval('.time-slot, .availability-item, .court-slot', (elements) => {
      return elements.map(el => ({
        courtName: el.querySelector('.court-name, .facility-name')?.textContent?.trim() || 'Unknown Court',
        startTime: el.querySelector('.start-time, .time-start')?.textContent?.trim() || '',
        endTime: el.querySelector('.end-time, .time-end')?.textContent?.trim() || '',
        available: !el.classList.contains('unavailable') && !el.classList.contains('booked'),
        bookingUrl: el.querySelector('a')?.getAttribute('href') || undefined
      }));
    });
    
    return slots;
  }

  private async extractSessionToken(): Promise<string | undefined> {
    if (!this.context) return undefined;
    const cookies = await this.context.cookies();
    const sessionCookie = cookies.find(c => 
      c.name.toLowerCase().includes('session') || 
      c.name.toLowerCase().includes('auth')
    );
    if (sessionCookie) {
      return Buffer.from(JSON.stringify(cookies)).toString('base64');
    }
    return undefined;
  }

  private async restoreSession(token: string): Promise<void> {
    if (!this.context) return;
    try {
      const cookies = JSON.parse(Buffer.from(token, 'base64').toString());
      await this.context.addCookies(cookies);
    } catch {
      // Invalid token, will re-login
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

let scraperInstance: ActiveNetScraper | null = null;

export async function getScraper(): Promise<ActiveNetScraper> {
  if (!scraperInstance) {
    scraperInstance = new ActiveNetScraper();
    await scraperInstance.initialize();
  }
  return scraperInstance;
}
```

**File: `src/lib/scraper/session-cache.ts`**

```typescript
/**
 * In-Memory Session Cache
 * Caches ActiveNet session tokens (NOT passwords) for 30 minutes
 */

interface CachedSession {
  token: string;
  email: string;
  expiresAt: number;
}

const sessionCache = new Map<string, CachedSession>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function hashEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export function getCachedSession(email: string): string | null {
  const key = hashEmail(email);
  const cached = sessionCache.get(key);
  
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    sessionCache.delete(key);
    return null;
  }
  
  return cached.token;
}

export function cacheSession(email: string, token: string): void {
  const key = hashEmail(email);
  sessionCache.set(key, {
    token,
    email: key,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

export function clearSession(email: string): void {
  const key = hashEmail(email);
  sessionCache.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessionCache.entries()) {
    if (now > session.expiresAt) {
      sessionCache.delete(key);
    }
  }
}, 5 * 60 * 1000);
```

### Seattle Venues Data

**File: `src/lib/venues.ts`**

```typescript
export interface Venue {
  id: string;
  name: string;
  address: string;
  courts: number;
  surface: 'hard' | 'clay' | 'grass' | 'indoor';
  lights: boolean;
  amenities: string[];
  latitude: number;
  longitude: number;
  activeNetId: string;
}

export const SEATTLE_VENUES: Venue[] = [
  {
    id: 'amy-yee',
    name: 'Amy Yee Tennis Center',
    address: '2000 Martin Luther King Jr Way S, Seattle, WA 98144',
    courts: 10,
    surface: 'indoor',
    lights: true,
    amenities: ['Indoor courts', 'Pro shop', 'Lessons', 'Restrooms'],
    latitude: 47.5831,
    longitude: -122.2977,
    activeNetId: 'AYTC001'
  },
  {
    id: 'lower-woodland',
    name: 'Lower Woodland Park',
    address: 'W Green Lake Way N, Seattle, WA 98103',
    courts: 10,
    surface: 'hard',
    lights: true,
    amenities: ['Outdoor courts', 'Restrooms', 'Parking'],
    latitude: 47.6686,
    longitude: -122.3459,
    activeNetId: 'LWP001'
  },
  {
    id: 'magnuson',
    name: 'Magnuson Park Tennis Courts',
    address: '7400 Sand Point Way NE, Seattle, WA 98115',
    courts: 6,
    surface: 'hard',
    lights: true,
    amenities: ['Outdoor courts', 'Parking', 'Lake views'],
    latitude: 47.6853,
    longitude: -122.2568,
    activeNetId: 'MAG001'
  },
  {
    id: 'volunteer-park',
    name: 'Volunteer Park Tennis Courts',
    address: '1247 15th Ave E, Seattle, WA 98112',
    courts: 4,
    surface: 'hard',
    lights: false,
    amenities: ['Outdoor courts', 'Historic park setting'],
    latitude: 47.6308,
    longitude: -122.3151,
    activeNetId: 'VP001'
  },
  {
    id: 'gilman',
    name: 'Gilman Playground Tennis Courts',
    address: '923 NW 54th St, Seattle, WA 98107',
    courts: 4,
    surface: 'hard',
    lights: true,
    amenities: ['Outdoor courts', 'Playground nearby'],
    latitude: 47.6668,
    longitude: -122.3703,
    activeNetId: 'GIL001'
  },
  {
    id: 'jefferson-park',
    name: 'Jefferson Park Tennis Courts',
    address: '4101 Beacon Ave S, Seattle, WA 98108',
    courts: 6,
    surface: 'hard',
    lights: true,
    amenities: ['Outdoor courts', 'Golf course adjacent', 'City views'],
    latitude: 47.5706,
    longitude: -122.3093,
    activeNetId: 'JP001'
  },
  {
    id: 'rainier-playfield',
    name: 'Rainier Playfield Tennis Courts',
    address: '3700 S Alaska St, Seattle, WA 98118',
    courts: 4,
    surface: 'hard',
    lights: true,
    amenities: ['Outdoor courts', 'Community center nearby'],
    latitude: 47.5552,
    longitude: -122.2854,
    activeNetId: 'RP001'
  },
  {
    id: 'rogers-playground',
    name: 'Rogers Playground Tennis Courts',
    address: '2500 Eastlake Ave E, Seattle, WA 98102',
    courts: 2,
    surface: 'hard',
    lights: false,
    amenities: ['Outdoor courts', 'Lake Union views'],
    latitude: 47.6459,
    longitude: -122.3260,
    activeNetId: 'ROG001'
  }
];
```

------

## 🎨 UI Components

### Base Components (`src/components/ui/`)

**Button.tsx**

```tsx
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', disabled, children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
    
    const variants = {
      primary: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
      secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500',
      ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-500',
      danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500'
    };
    
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg'
    };
    
    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

**Input.tsx**

```tsx
import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s/g, '-');
    
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3 py-2 border rounded-lg shadow-sm
            focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500
            disabled:bg-gray-50 disabled:text-gray-500
            ${error ? 'border-red-300' : 'border-gray-300'}
            ${className}
          `}
          {...props}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
```

**Modal.tsx**

```tsx
'use client';

import { ReactNode, useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-md bg-white rounded-xl shadow-xl">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
```

**NTRPBadge.tsx**

```tsx
interface NTRPBadgeProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
}

export function NTRPBadge({ rating, size = 'md' }: NTRPBadgeProps) {
  const getColor = (r: number) => {
    if (r < 3.0) return 'bg-blue-100 text-blue-800';
    if (r < 3.5) return 'bg-green-100 text-green-800';
    if (r < 4.0) return 'bg-yellow-100 text-yellow-800';
    if (r < 4.5) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800';
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base'
  };

  return (
    <span className={`inline-flex items-center font-medium rounded-full ${getColor(rating)} ${sizes[size]}`}>
      NTRP {rating.toFixed(1)}
    </span>
  );
}
```

------

## 📦 Dependencies

```bash
# Core
npm install next@14 react@19 react-dom@19 typescript

# Database
npm install @prisma/client
npm install -D prisma

# Auth
npm install next-auth bcryptjs
npm install -D @types/bcryptjs

# Styling
npm install tailwindcss postcss autoprefixer

# Court Availability Scraper
npm install playwright
npx playwright install chromium

# Utilities
npm install zod                    # Validation
npm install date-fns               # Date handling
npm install clsx                   # Classname utility
```

------

## 🚀 Implementation Phases

### Phase 1: Foundation (Week 1)

- [x] Next.js setup
- [x] Prisma schema
- [x] NextAuth config
- [ ] Base UI components
- [ ] Layout (Navbar, Sidebar)
- [ ] Landing page

### Phase 2: Core Social (Week 2)

- [ ] User registration & onboarding (NTRP quiz)
- [ ] Profile pages
- [ ] Player search & browse
- [ ] Basic messaging

### Phase 3: Sessions (Week 3)

- [ ] Session creation form
- [ ] Session browse/search
- [ ] RSVP system
- [ ] Session calendar view

### Phase 4: Groups & Courts (Week 4)

- [ ] Group creation & management
- [ ] Group membership
- [ ] Venue browser
- [ ] ActiveNet scraper integration
- [ ] Availability display

### Phase 5: Competition (Week 5)

- [ ] Match logging
- [ ] Stats tracking
- [ ] League creation
- [ ] Standings & brackets

### Phase 6: Polish (Week 6)

- [ ] Notifications
- [ ] Mobile responsive
- [ ] Performance optimization
- [ ] Error handling
- [ ] Testing

------

## 🔒 Security Checklist

**Authentication:**

- [ ] Secure password hashing (bcrypt)
- [ ] Session management
- [ ] CSRF protection
- [ ] Rate limiting on auth endpoints

**Court Scraper:**

- [ ] HTTPS only
- [ ] No credential logging
- [ ] Session cache TTL
- [ ] Browser cleanup in finally blocks

**General:**

- [ ] Input validation (Zod)
- [ ] SQL injection prevention (Prisma)
- [ ] XSS prevention
- [ ] CORS configuration

------

## 📋 Commands Reference

```bash
# Development
npm run dev

# Database
npx prisma migrate dev --name init
npx prisma generate
npx prisma studio

# Build
npm run build
npm run start

# Playwright (for scraper testing)
npx playwright test
npx playwright codegen  # Record browser actions
```

------

## 🎉 Success Metrics

- **User engagement:** Sessions created per user per week
- **Matching quality:** % of RSVPs that lead to confirmed matches
- **Court feature usage:** % of sessions with venue attached
- **Retention:** Weekly active users
- **Community growth:** Groups created, members per group
