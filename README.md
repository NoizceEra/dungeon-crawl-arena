# Dungeon Crawl Arena

A lightweight multiplayer 2D dungeon crawler inspired by MapleStory. Play with 2–4 players, fight waves of enemies, level up, and loot gear.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. Use multiple tabs/browsers to test multiplayer.

## How to Play

1. Enter your name on the menu
2. Create a room or join one with a 4-letter code
3. Select your class (Warrior / Mage / Archer) in the lobby
4. Press "Start" when the host is ready
5. Move with **WASD** or **Arrow keys**, jump with **W/Up**, attack with **J/Z**, use ability with **K/X**

## Classes

| Class | HP | ATK | Style |
|-------|-----|-----|-------|
| Warrior | 120 | 15 | Melee (60px range) |
| Mage | 80 | 20 | Ranged projectile |
| Archer | 90 | 12 | Long-range arrow |

## Deployment (Railway)

Railway is **required** — this game uses WebSockets which Vercel does not support.

### Steps

1. Push to GitHub
2. Connect repo to Railway
3. Railway auto-detects Node.js — set start command to `npm start`
4. Deploy — your app gets a `*.railway.app` URL

> **Note:** For local multiplayer with Railway, both clients must connect to the same deployment URL, not `localhost`.

## Architecture

```
dungeon-crawl-arena/
├── server.js          # Express + Socket.IO backend
├── package.json
├── public/
│   └── index.html      # Canvas frontend (single file)
├── SPEC.md
└── README.md
```

- **Backend:** Node.js + Express serves static files; Socket.IO handles real-time game state
- **Frontend:** Single HTML file with Canvas 2D renderer + Socket.IO client
- **State:** Server-authoritative; all positions, HP, combat resolved server-side
- **Networking:** Game loop runs at 30fps, broadcasting positions and state changes

## Socket Events Reference

See `SPEC.md` Section 9 for full event table.

### Key Events

| Direction | Event | Purpose |
|-----------|-------|---------|
| C→S | `create_room` | Create new room |
| C→S | `join_room` | Join with code |
| C→S | `player_input` | Send input state |
| C→S | `chat_message` | Send chat |
| S→C | `room_update` | Full state sync |
| S→C | `player_move` | Position update |
| S→C | `enemy_spawn` / `enemy_death` | Combat events |
| S→C | `wave_start` / `wave_end` | Wave progression |
| S→C | `game_over` | Dungeon end |

## Tech Stack

- **Runtime:** Node.js 18+
- **Server:** Express 4 + Socket.IO 4
- **Client:** Vanilla JS + HTML5 Canvas
- **No database** — all state in-memory
- **No external assets** — colored shapes only