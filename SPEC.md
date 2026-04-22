# Dungeon Crawl Arena — Game Design Specification

## 1. Overview

**Type:** 2D side-scrolling multiplayer dungeon crawler (MapleStory-lite)
**Tech:** Node.js + Express + Socket.IO (backend), HTML5 Canvas (frontend)
**Players:** 2–4 per room, in-memory sessions, no persistence

---

## 2. Game Screen

- **Canvas size:** 960×540 pixels (16:9)
- **Physics:** Gravity-based platformer. Single floor + 2 platforms per room.
- **Camera:** Fixed viewport (no scrolling — room fits in screen)

---

## 3. Movement & Physics

| Parameter | Value |
|-----------|-------|
| Gravity | 0.5 px/frame² |
| Max fall speed | 12 px/frame |
| Walk speed | 4 px/frame |
| Jump velocity | -12 px/frame |
| Ground Y | 480 |
| Platform Y (upper) | 320 |
| Platform Y (lower) | 400 |
| Player size | 32×48 px (width × height) |

- Players can walk left/right and jump.
- Platforms have full collision (top only — can jump through from below).
- Players cannot leave canvas bounds (wall collision on left/right edges).

---

## 4. Classes

### Warrior
- **Color:** #E74C3C (red)
- **Base HP:** 120
- **Base Attack:** 15
- **Attack range:** 60px melee (horizontal slash)
- **Attack cooldown:** 600ms
- **Ability:** Shield Bash — stuns enemy for 500ms (3s cooldown)
- **Starting weapon:** Iron Sword (+5 ATK)

### Mage
- **Color:** #9B59B6 (purple)
- **Base HP:** 80
- **Base Attack:** 20
- **Attack range:** 200px (projectile)
- **Attack cooldown:** 1000ms
- **Ability:** Fireball — AoE 80px blast, 80 damage (5s cooldown)
- **Starting weapon:** Apprentice Staff (+8 ATK)

### Archer
- **Color:** #27AE60 (green)
- **Base HP:** 90
- **Base Attack:** 12
- **Attack range:** 280px (arrow)
- **Attack cooldown:** 800ms
- **Ability:** Power Shot — 2× damage arrow, pierces (4s cooldown)
- **Starting weapon:** Oak Bow (+4 ATK)

---

## 5. Leveling System

- XP gained from killing enemies
- XP required per level: `50 * level`
- Stats per level:
  - HP +10 (Warrior), +8 (Mage), +7 (Archer)
  - Attack +3 all classes
- Max level: 20

| Level | XP Needed | Cumulative XP |
|-------|-----------|---------------|
| 1→2 | 50 | 50 |
| 2→3 | 100 | 150 |
| 3→4 | 150 | 300 |
| ... | ... | ... |

---

## 6. Wave System

- 5 waves per room
- All enemies cleared → 3 second pause → next wave spawns
- Wave clears → all players heal 20 HP

### Wave Composition

| Wave | Enemy Type | Count | HP | ATK | Speed | XP per kill |
|------|------------|-------|-----|-----|-------|-------------|
| 1 | Slime (green circle) | 4 | 30 | 5 | 1.5 | 20 |
| 2 | Goblin (brown rect) | 5 | 45 | 8 | 2.0 | 30 |
| 3 | Skeleton (white rect) | 6 | 60 | 12 | 1.8 | 45 |
| 4 | Orc (dark green rect) | 4 | 100 | 18 | 1.2 | 70 |
| 5 | Boss Dragon (red, 2× size) | 1 | 500 | 30 | 0.8 | 300 |

- Enemies walk toward nearest player, attack on contact (1 attack per second).
- Enemies do not use abilities.

---

## 7. Room System

- Rooms identified by 4-character alphanumeric code (e.g., `A3K9`)
- Max 4 players per room
- Host can start the dungeon when ≥1 player is ready
- Players can join existing rooms or create new ones
- No password protection (simple code sharing)
- Room auto-deletes 60s after all players leave

### Room States
1. **Lobby** — players choose class, ready up
2. **Combat** — waves running, no join
3. **Cleared** — all 5 waves done, show results
4. **GameOver** — all players dead

---

## 8. Combat System

- Attacks are server-authoritative
- Hit detection: check distance between attacker and target each frame
- Damage formula: `baseATK + weaponATK + (level - 1) * 3`
- Attacks apply to all enemies in range (AOE for Mage ability)
- Players cannot damage other players
- Projectiles (Mage spell, Archer arrow): travel at 8px/frame, despawn after 300px or on hit

### Loot Drop Table

| Item | Type | ATK Bonus | HP Bonus | Drop Chance |
|------|------|-----------|----------|-------------|
| Iron Sword | Weapon | +5 | 0 | 30% |
| Steel Sword | Weapon | +12 | 0 | 15% |
| Apprentice Staff | Weapon | +8 | 0 | 30% |
| Arcane Wand | Weapon | +18 | 0 | 10% |
| Oak Bow | Weapon | +4 | 0 | 30% |
| Longbow | Weapon | +10 | 0 | 15% |
| Leather Armor | Armor | 0 | +20 | 25% |
| Chain Mail | Armor | 0 | +50 | 12% |
| Mage Robe | Armor | 0 | +15, +5 ATK | 12% |

- Loot drops at enemy death location
- Auto-pickup on player walk over (within 30px)
- Only drops from waves 2+

---

## 9. Socket Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `create_room` | `{ playerName }` | Create new room, receive code |
| `join_room` | `{ roomCode, playerName }` | Join existing room |
| `select_class` | `{ class: "warrior"\|"mage"\|"archer" }` | Choose class |
| `player_input` | `{ keys: { left, right, jump, attack, ability } }` | Input state |
| `chat_message` | `{ text }` | Send chat |
| `ready_toggle` | `{}` | Toggle ready in lobby |
| `start_dungeon` | `{}` | Host starts dungeon |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `room_joined` | `{ roomCode, players, isHost }` | Confirmed join |
| `room_update` | `{ players, wave, state }` | Full room state |
| `player_spawn` | `{ id, x, y, class, name }` | Player appears |
| `player_move` | `{ id, x, y, facing }` | Position broadcast |
| `enemy_spawn` | `{ id, type, x, y, hp, maxHp }` | Enemy appears |
| `enemy_move` | `{ id, x, y }` | Enemy position |
| `enemy_death` | `{ id, loot? }` | Enemy died |
| `player_hit` | `{ playerId, damage, hp, maxHp }` | Player took damage |
| `enemy_hit` | `{ enemyId, damage, hp }` | Enemy took damage |
| `player_death` | `{ playerId }` | Player died |
| `player_respawn` | `{ playerId, x, y, hp }` | Respawn |
| `xp_gain` | `{ playerId, xp, level, maxHp, maxAtk }` | Level up |
| `loot_pickup` | `{ playerId, item }` | Item acquired |
| `wave_start` | `{ wave, enemies }` | New wave begins |
| `wave_end` | `{ wave }` | Wave cleared |
| `game_over` | `{ won }` | Dungeon complete or wipe |
| `chat_broadcast` | `{ playerId, name, text }` | Chat message |
| `error` | `{ message }` | Error message |

---

## 10. Visuals

- **Background:** Dark stone (#1a1a2e) with subtle grid pattern
- **Floor:** Dark grey (#2d2d44) platform strip
- **Platforms:** Slightly lighter (#3d3d5c) with slight glow
- **Player shapes:** Rounded rectangles with class color
- **Health bars:** Red fill (#e74c3c) on black background, above player
- **Enemy shapes:** Circles (slime), rectangles (others) with red HP bar
- **Projectiles:** Small glowing shapes (yellow for arrows, purple for spells)
- **Loot:** Small glowing items with color coding
- **Chat box:** Bottom-left corner, semi-transparent dark background

---

## 11. Death & Respawn

- On death: player becomes grey, shows "DEAD" for 5s
- Respawn at room entrance (center-bottom) with 50% max HP
- Respawn timer: 5 seconds
- Players in "dead" state cannot move/attack (spectate only)
- All players dead → Game Over

---

## 12. UI Screens

### Menu Screen
- Title: "DUNGEON CRAWL ARENA"
- Name input field
- "Create Room" button
- "Join Room" button + code input

### Lobby Screen
- Room code display (large, copyable)
- Player list with class icons and ready status
- Class selection buttons
- Ready/Start button
- Party chat

### Game Screen
- Canvas (full room view)
- Top HUD: Wave number, Player count
- Bottom HUD: Health bar, XP bar, current weapon
- Ability cooldown indicator (bottom right)
- Kill feed (top-right, last 3 kills)

### Results Screen
- "VICTORY" or "DEFEAT"
- XP gained summary
- Items collected
- "Play Again" (recreate room) / "Exit" buttons