const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 960;
const CANVAS_H = 540;
const GRAVITY = 0.5;
const MAX_FALL = 12;
const WALK_SPEED = 4;
const JUMP_VEL = -12;
const GROUND_Y = 480;
const PLATFORM_Y = [320, 400];
const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;

const CLASSES = {
  warrior: { hp: 120, atk: 15, color: '#E74C3C', range: 60, cooldown: 600 },
  mage:    { hp: 80,  atk: 20, color: '#9B59B6', range: 200, cooldown: 1000 },
  archer:  { hp: 90,  atk: 12, color: '#27AE60', range: 280, cooldown: 800 }
};

const CLASS_WEAPONS = {
  warrior: { name: 'Iron Sword',   atk: 5,  hp: 0 },
  mage:    { name: 'Apprentice Staff', atk: 8, hp: 0 },
  archer:  { name: 'Oak Bow',      atk: 4,  hp: 0 }
};

const ABILITIES = {
  warrior: { name: 'Shield Bash',  cooldown: 3000, duration: 500 },
  mage:    { name: 'Fireball',     cooldown: 5000, aoe: 80, damage: 80 },
  archer:  { name: 'Power Shot',   cooldown: 4000, multiplier: 2, pierce: true }
};

const WAVES = [
  { type: 'slime',     count: 4, hp: 30,  atk: 5,  speed: 1.5, xp: 20,  size: 1 },
  { type: 'goblin',    count: 5, hp: 45,  atk: 8,  speed: 2.0, xp: 30,  size: 1 },
  { type: 'skeleton',  count: 6, hp: 60,  atk: 12, speed: 1.8, xp: 45,  size: 1 },
  { type: 'orc',       count: 4, hp: 100, atk: 18, speed: 1.2, xp: 70,  size: 1 },
  { type: 'dragon',    count: 1, hp: 500, atk: 30, speed: 0.8, xp: 300, size: 2 }
];

const ENEMY_COLORS = {
  slime: '#2ECC71',
  goblin: '#8B4513',
  skeleton: '#BDC3C7',
  orc: '#1E8449',
  dragon: '#E74C3C'
};

const LOOT_TABLE = [
  { name: 'Iron Sword',      atk: 5,  hp: 0,  chance: 0.30 },
  { name: 'Steel Sword',    atk: 12, hp: 0,  chance: 0.15 },
  { name: 'Apprentice Staff', atk: 8, hp: 0,  chance: 0.30 },
  { name: 'Arcane Wand',    atk: 18, hp: 0,  chance: 0.10 },
  { name: 'Oak Bow',        atk: 4,  hp: 0,  chance: 0.30 },
  { name: 'Longbow',        atk: 10, hp: 0,  chance: 0.15 },
  { name: 'Leather Armor',  atk: 0,  hp: 20, chance: 0.25 },
  { name: 'Chain Mail',     atk: 0,  hp: 50, chance: 0.12 },
  { name: 'Mage Robe',      atk: 5,  hp: 15, chance: 0.12 }
];

// ─── In-Memory State ──────────────────────────────────────────────────────────

const rooms = new Map();
let roomCounter = 0;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function xpForLevel(level) { return 50 * level; }
function cumulativeXp(level) {
  let total = 0;
  for (let i = 1; i < level; i++) total += xpForLevel(i);
  return total;
}

// ─── Room Class ────────────────────────────────────────────────────────────────

class Room {
  constructor(code) {
    this.code = code;
    this.state = 'lobby'; // lobby | combat | cleared | gameover
    this.players = new Map();
    this.enemies = new Map();
    this.loot = [];
    this.projectiles = [];
    this.wave = 0;
    this.waveTimer = 0;
    this.wavePause = false;
    this.nextEnemyId = 1;
    this.nextPlayerId = 1;
    this.hostId = null;
  }

  addPlayer(socketId, name) {
    const id = this.nextPlayerId++;
    const cls = 'warrior';
    const clsData = CLASSES[cls];
    const weapon = CLASS_WEAPONS[cls];
    const player = {
      id, socketId, name,
      class: cls,
      x: CANVAS_W / 2,
      y: GROUND_Y - 48,
      vx: 0, vy: 0,
      hp: clsData.hp,
      maxHp: clsData.hp,
      atk: clsData.atk,
      weaponAtk: weapon.atk,
      weaponHp: weapon.hp,
      level: 1,
      xp: 0,
      xpToLevel: xpForLevel(1),
      facing: 1,
      onGround: true,
      attacking: false,
      attackCooldown: 0,
      abilityCooldown: 0,
      dead: false,
      respawnTimer: 0,
      stunned: 0,
      ready: false,
      input: { left: false, right: false, jump: false, attack: false, ability: false }
    };
    this.players.set(socketId, player);
    if (!this.hostId) this.hostId = socketId;
    return player;
  }

  getPlayer(socketId) { return this.players.get(socketId); }
  getPlayerById(id) {
    for (const p of this.players.values()) if (p.id === id) return p;
    return null;
  }

  broadcast(event, data) {
    for (const [sid] of this.players) {
      io.to(sid).emit(event, data);
    }
  }

  allReady() {
    if (this.players.size < 1) return false;
    for (const p of this.players.values()) if (!p.ready && !p.dead) return false;
    return true;
  }

  startCombat() {
    this.state = 'combat';
    this.wave = 0;
    this.wavePause = false;
    this.enemies.clear();
    this.loot = [];
    this.projectiles = [];
    for (const p of this.players.values()) {
      p.dead = false;
      p.respawnTimer = 0;
      p.x = CANVAS_W / 2;
      p.y = GROUND_Y - 48;
      p.hp = p.maxHp;
      p.xp = 0;
      p.level = 1;
      p.xpToLevel = xpForLevel(1);
      p.atk = CLASSES[p.class].atk;
      p.weaponAtk = CLASS_WEAPONS[p.class].atk;
      p.weaponHp = CLASS_WEAPONS[p.class].hp;
    }
    this.spawnWave();
  }

  spawnWave() {
    this.wave++;
    this.wavePause = false;
    if (this.wave > 5) {
      this.state = 'cleared';
      this.broadcast('game_over', { won: true });
      return;
    }
    const waveData = WAVES[this.wave - 1];
    this.enemies.clear();
    for (let i = 0; i < waveData.count; i++) {
      const spawnX = 100 + Math.random() * (CANVAS_W - 200);
      const size = waveData.size;
      this.enemies.set(this.nextEnemyId++, {
        id: this.nextEnemyId - 1,
        type: waveData.type,
        x: spawnX,
        y: GROUND_Y - 48 * size,
        vx: 0, vy: 0,
        hp: waveData.hp,
        maxHp: waveData.hp,
        atk: waveData.atk,
        speed: waveData.speed,
        size,
        attackCooldown: 0,
        stunned: 0
      });
    }
    this.broadcast('wave_start', {
      wave: this.wave,
      enemies: [...this.enemies.values()].map(e => ({ id: e.id, type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, size: e.size }))
    });
  }

  handleCombatTick(dt) {
    // Player attacks & abilities
    for (const [sid, p] of this.players) {
      if (p.dead) continue;

      // Cooldowns
      if (p.attackCooldown > 0) p.attackCooldown -= dt;
      if (p.abilityCooldown > 0) p.abilityCooldown -= dt;
      if (p.stunned > 0) { p.stunned -= dt; continue; }

      const clsData = CLASSES[p.class];

      // Attack
      if (p.input.attack && p.attackCooldown <= 0) {
        p.attackCooldown = clsData.cooldown;
        const totalAtk = p.atk + p.weaponAtk + (p.level - 1) * 3;
        if (p.class === 'warrior') {
          // Melee hit enemies in front
          for (const [eid, e] of this.enemies) {
            if (e.stunned > 0) continue;
            const dist = Math.abs(e.x + 16 * e.size - (p.x + 16));
            const inFront = (e.x > p.x && p.facing === 1) || (e.x < p.x && p.facing === -1);
            if (dist < clsData.range && inFront) {
              this.damageEnemy(eid, totalAtk, p);
            }
          }
        } else if (p.class === 'mage') {
          // Ranged projectile
          this.projectiles.push({
            x: p.x + (p.facing === 1 ? 32 : 0),
            y: p.y + 16,
            vx: p.facing * 8,
            vy: 0,
            ownerId: p.id,
            class: 'mage',
            damage: totalAtk,
            distTraveled: 0,
            maxDist: 300
          });
        } else if (p.class === 'archer') {
          this.projectiles.push({
            x: p.x + (p.facing === 1 ? 32 : 0),
            y: p.y + 16,
            vx: p.facing * 10,
            vy: 0,
            ownerId: p.id,
            class: 'archer',
            damage: totalAtk,
            distTraveled: 0,
            maxDist: 320,
            pierce: false
          });
        }
      }

      // Ability
      if (p.input.ability && p.abilityCooldown <= 0) {
        p.abilityCooldown = ABILITIES[p.class].cooldown;
        if (p.class === 'warrior') {
          // Shield bash: stun all enemies in range
          for (const [eid, e] of this.enemies) {
            if (Math.abs(e.x - p.x) < 80) {
              e.stunned = ABILITIES.warrior.duration;
            }
          }
        } else if (p.class === 'mage') {
          const abl = ABILITIES.mage;
          // Fireball: AoE around mouse target - just blast in front
          const blastX = p.x + p.facing * 120;
          for (const [eid, e] of this.enemies) {
            if (Math.abs(e.x - blastX) < abl.aoe && Math.abs(e.y - p.y) < abl.aoe) {
              this.damageEnemy(eid, abl.damage, p);
            }
          }
        } else if (p.class === 'archer') {
          const abl = ABILITIES.archer;
          this.projectiles.push({
            x: p.x + (p.facing === 1 ? 32 : 0),
            y: p.y + 16,
            vx: p.facing * 14,
            vy: 0,
            ownerId: p.id,
            class: 'archer',
            damage: totalAtk * abl.multiplier,
            distTraveled: 0,
            maxDist: 400,
            pierce: true
          });
        }
      }
    }

    // Projectile movement
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.x += proj.vx;
      proj.y += proj.vy;
      proj.distTraveled += Math.abs(proj.vx);

      let hit = false;
      for (const [eid, e] of this.enemies) {
        if (e.stunned > 0) continue;
        const ex = e.x + 16 * e.size;
        const ey = e.y + 24 * e.size;
        if (Math.abs(proj.x - ex) < 30 && Math.abs(proj.y - ey) < 30) {
          this.damageEnemy(eid, proj.damage, this.getPlayerById(proj.ownerId));
          if (!proj.pierce) { hit = true; break; }
        }
      }

      if (hit || proj.distTraveled > proj.maxDist || proj.x < 0 || proj.x > CANVAS_W) {
        this.projectiles.splice(i, 1);
      }
    }

    // Enemy AI
    for (const [eid, e] of this.enemies) {
      if (e.stunned > 0) { e.stunned -= dt; continue; }
      if (e.attackCooldown > 0) e.attackCooldown -= dt;

      // Find nearest alive player
      let nearest = null, nearDist = Infinity;
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const d = Math.abs(p.x - e.x);
        if (d < nearDist) { nearDist = d; nearest = p; }
      }
      if (!nearest) continue;

      // Move toward player
      if (nearDist > 30) {
        e.vx = nearest.x < e.x ? -e.speed : e.speed;
        e.x += e.vx;
      }

      // Keep on platform
      if (e.y >= GROUND_Y - 48 * e.size) {
        e.y = GROUND_Y - 48 * e.size;
        e.vy = 0;
      } else {
        e.vy += GRAVITY;
        if (e.vy > MAX_FALL) e.vy = MAX_FALL;
        e.y += e.vy;
      }

      // Attack on contact
      if (nearDist < 40 && e.attackCooldown <= 0) {
        e.attackCooldown = 1000;
        this.damagePlayer(nearest.socketId, e.atk);
      }
    }

    // Check wave clear
    if (!this.wavePause && this.enemies.size === 0 && this.state === 'combat') {
      this.wavePause = true;
      this.waveTimer = 3000;
      // Heal players 20 HP
      for (const p of this.players.values()) {
        p.hp = Math.min(p.hp + 20, p.maxHp);
        this.broadcast('player_hit', { playerId: p.id, damage: -20, hp: p.hp, maxHp: p.maxHp });
      }
      this.broadcast('wave_end', { wave: this.wave });
    }

    if (this.wavePause) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.spawnWave();
    }

    // Check game over
    let allDead = true;
    for (const p of this.players.values()) {
      if (!p.dead) { allDead = false; break; }
    }
    if (allDead && this.state === 'combat') {
      this.state = 'gameover';
      this.broadcast('game_over', { won: false });
    }
  }

  damageEnemy(eid, damage, player) {
    const e = this.enemies.get(eid);
    if (!e) return;
    e.hp -= damage;
    this.broadcast('enemy_hit', { enemyId: eid, damage, hp: e.hp });
    if (e.hp <= 0) {
      // Determine loot if wave >= 2
      let loot = null;
      if (this.wave >= 2 && Math.random() < 0.5) {
        const roll = Math.random();
        let cum = 0;
        for (const item of LOOT_TABLE) {
          cum += item.chance;
          if (roll <= cum) { loot = item; break; }
        }
      }
      this.enemies.delete(eid);
      this.broadcast('enemy_death', { enemyId: eid, x: e.x, y: e.y, loot });
      if (loot) {
        this.loot.push({ x: e.x, y: e.y, item: loot, ttl: 15000 });
      }
      // XP for player
      if (player) {
        const xpGain = WAVES[this.wave - 1].xp;
        this.giveXp(player, xpGain);
      }
    }
  }

  damagePlayer(socketId, damage) {
    const p = this.players.get(socketId);
    if (!p || p.dead) return;
    p.hp -= damage;
    this.broadcast('player_hit', { playerId: p.id, damage, hp: p.hp, maxHp: p.maxHp });
    if (p.hp <= 0) {
      p.dead = true;
      p.respawnTimer = 5000;
      p.hp = 0;
      this.broadcast('player_death', { playerId: p.id });
    }
  }

  giveXp(player, amount) {
    player.xp += amount;
    const needed = player.xpToLevel;
    if (player.xp >= needed && player.level < 20) {
      player.level++;
      player.xp -= needed;
      player.xpToLevel = xpForLevel(player.level);
      const clsData = CLASSES[player.class];
      player.maxHp += player.class === 'warrior' ? 10 : player.class === 'mage' ? 8 : 7;
      player.atk += 3;
      player.hp = player.maxHp;
      this.broadcast('xp_gain', {
        playerId: player.id, xp: amount, level: player.level,
        maxHp: player.maxHp, maxAtk: player.atk + player.weaponAtk
      });
    } else {
      this.broadcast('xp_gain', { playerId: player.id, xp: amount, level: player.level, maxHp: player.maxHp, maxAtk: player.atk + player.weaponAtk });
    }
  }

  checkLootPickup(player) {
    const px = player.x + 16, py = player.y + 24;
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const loot = this.loot[i];
      if (Math.abs(px - loot.x) < 30 && Math.abs(py - loot.y) < 30) {
        // Apply loot
        if (loot.item.atk) player.weaponAtk = loot.item.atk;
        if (loot.item.hp) {
          player.maxHp += loot.item.hp;
          player.hp += loot.item.hp;
        }
        this.broadcast('loot_pickup', { playerId: player.id, item: loot.item });
        this.loot.splice(i, 1);
      }
    }
    // Clean expired loot
    for (let i = this.loot.length - 1; i >= 0; i--) {
      this.loot[i].ttl -= TICK_MS;
      if (this.loot[i].ttl <= 0) this.loot.splice(i, 1);
    }
  }
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

const roomTimers = new Map();

function startRoomLoop(room) {
  if (roomTimers.has(room.code)) clearInterval(roomTimers.get(room.code));
  const timer = setInterval(() => {
    if (room.state !== 'combat') return;
    room.handleCombatTick(TICK_MS);
    // Broadcast state
    const playerStates = [...room.players.values()].map(p => ({
      id: p.id, name: p.name, class: p.class,
      x: p.x, y: p.y, facing: p.facing,
      hp: p.hp, maxHp: p.maxHp,
      level: p.level, xp: p.xp, xpToLevel: p.xpToLevel,
      dead: p.dead,
      attackCooldown: p.attackCooldown,
      abilityCooldown: p.abilityCooldown,
      stunned: p.stunned
    }));
    const enemyStates = [...room.enemies.values()].map(e => ({
      id: e.id, type: e.type, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, size: e.size, stunned: e.stunned
    }));
    room.broadcast('room_update', {
      players: playerStates,
      enemies: enemyStates,
      projectiles: room.projectiles,
      loot: room.loot,
      wave: room.wave,
      state: room.state,
      wavePause: room.wavePause
    });
  }, TICK_MS);
  roomTimers.set(room.code, timer);
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerData = null;

  socket.on('create_room', ({ playerName }) => {
    let code;
    do { code = generateRoomCode(); } while (rooms.has(code));
    const room = new Room(code);
    rooms.set(code, room);
    playerData = room.addPlayer(socket.id, playerName || 'Hero');
    currentRoom = code;
    socket.join(code);
    socket.emit('room_joined', {
      roomCode: code, isHost: true,
      player: serializePlayer(playerData),
      players: [...room.players.values()].map(serializePlayer)
    });
    startRoomLoop(room);
  });

  socket.on('join_room', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.players.size >= 4) { socket.emit('error', { message: 'Room full' }); return; }
    if (room.state !== 'lobby') { socket.emit('error', { message: 'Game already in progress' }); return; }
    playerData = room.addPlayer(socket.id, playerName || 'Hero');
    currentRoom = roomCode.toUpperCase();
    socket.join(currentRoom);
    socket.emit('room_joined', {
      roomCode: currentRoom, isHost: false,
      player: serializePlayer(playerData),
      players: [...room.players.values()].map(serializePlayer)
    });
    room.broadcast('room_update', { players: [...room.players.values()].map(serializePlayer), state: room.state, wave: room.wave });
  });

  socket.on('select_class', ({ className }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.getPlayer(socket.id);
    if (!p) return;
    p.class = className;
    const clsData = CLASSES[className];
    const weapon = CLASS_WEAPONS[className];
    p.maxHp = clsData.hp + weapon.hp;
    p.hp = p.maxHp;
    p.atk = clsData.atk;
    p.weaponAtk = weapon.atk;
    p.weaponHp = weapon.hp;
    p.attackCooldown = 0;
    p.abilityCooldown = 0;
    room.broadcast('room_update', { players: [...room.players.values()].map(serializePlayer), state: room.state, wave: room.wave });
  });

  socket.on('ready_toggle', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.getPlayer(socket.id);
    if (!p) return;
    p.ready = !p.ready;
    room.broadcast('room_update', { players: [...room.players.values()].map(serializePlayer), state: room.state, wave: room.wave });
  });

  socket.on('start_dungeon', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (socket.id !== room.hostId) return;
    room.startCombat();
  });

  socket.on('player_input', (input) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.getPlayer(socket.id);
    if (!p || p.dead || p.stunned > 0) return;

    p.input = input;

    // Movement
    if (input.left) { p.vx = -WALK_SPEED; p.facing = -1; }
    else if (input.right) { p.vx = WALK_SPEED; p.facing = 1; }
    else p.vx = 0;

    // Jump
    if (input.jump && p.onGround) {
      p.vy = JUMP_VEL;
      p.onGround = false;
    }

    // Apply gravity
    p.vy += GRAVITY;
    if (p.vy > MAX_FALL) p.vy = MAX_FALL;

    // Move X
    p.x += p.vx;
    p.x = Math.max(16, Math.min(CANVAS_W - 48, p.x));

    // Move Y
    p.y += p.vy;

    // Ground collision
    if (p.y >= GROUND_Y - 48) {
      p.y = GROUND_Y - 48;
      p.vy = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }

    // Platform collision (top only)
    for (const py of PLATFORM_Y) {
      const platLeft = 200;
      const platRight = 760;
      if (p.vy > 0 && p.y + 48 > py && p.y + 48 < py + 20 &&
          p.x + 32 > platLeft && p.x < platRight) {
        p.y = py - 48;
        p.vy = 0;
        p.onGround = true;
      }
    }

    // Check loot pickup
    if (room.state === 'combat') room.checkLootPickup(p);
  });

  socket.on('chat_message', ({ text }) => {
    if (!currentRoom || !playerData) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const msg = text.trim().substring(0, 100);
    if (!msg) return;
    room.broadcast('chat_broadcast', { playerId: playerData.id, name: playerData.name, text: msg });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      if (roomTimers.has(room.code)) clearInterval(roomTimers.get(room.code));
      setTimeout(() => { if (rooms.has(room.code) && rooms.get(room.code).players.size === 0) rooms.delete(room.code); }, 60000);
    } else {
      // Reassign host
      if (socket.id === room.hostId) {
        room.hostId = room.players.keys().next().value;
      }
      room.broadcast('room_update', { players: [...room.players.values()].map(serializePlayer), state: room.state, wave: room.wave });
    }
  });
});

function serializePlayer(p) {
  return {
    id: p.id, name: p.name, class: p.class,
    x: p.x, y: p.y, facing: p.facing,
    hp: p.hp, maxHp: p.maxHp,
    level: p.level, xp: p.xp, xpToLevel: p.xpToLevel,
    atk: p.atk, weaponAtk: p.weaponAtk,
    dead: p.dead, ready: p.ready,
    attackCooldown: p.attackCooldown,
    abilityCooldown: p.abilityCooldown,
    stunned: p.stunned,
    weaponName: p.class === 'warrior' ? CLASS_WEAPONS.warrior.name :
                p.class === 'mage' ? CLASS_WEAPONS.mage.name : CLASS_WEAPONS.archer.name
  };
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Dungeon Crawl Arena running on port ${PORT}`));