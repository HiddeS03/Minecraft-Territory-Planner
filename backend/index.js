const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_MAP_FILE_SIZE_BYTES = 40 * 1024 * 1024;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const MAP_PATH = path.join(DATA_DIR, 'map.png');

fs.mkdirSync(DATA_DIR, { recursive: true });

// Auto-generate distinct colors for players
const generatePlayerColor = (index) => {
  const hues = [0, 60, 120, 180, 240, 300];
  const hue = hues[index % hues.length];
  const saturation = 85 + (Math.floor(index / hues.length) % 2) * 15;
  const lightness = 45 + (Math.floor(index / (hues.length * 2)) % 2) * 5;
  
  // Convert HSL to hex
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  
  const hueToRgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1/3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1/3);
  }
  
  const toHex = (x) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const getDefaultState = () => ({
  mapImageUploaded: false,
  zones: {},
  players: {},
  initialZoom: 1,
  initialOffsetX: 0,
  initialOffsetY: 0,
});

const readState = () => {
  if (!fs.existsSync(STATE_PATH)) {
    return getDefaultState();
  }

  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    // Ensure players object exists for backward compatibility
    if (!state.players) state.players = {};
    if (!state.initialZoom) state.initialZoom = 1;
    if (state.initialOffsetX === undefined) state.initialOffsetX = 0;
    if (state.initialOffsetY === undefined) state.initialOffsetY = 0;
    return state;
  } catch (error) {
    return getDefaultState();
  }
};

const writeState = (state) => {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
};

if (!fs.existsSync(STATE_PATH)) {
  writeState(getDefaultState());
}


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MAP_FILE_SIZE_BYTES },
});

const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const paintRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/api', apiRateLimiter);

app.get('/api/state', (_req, res) => {
  const state = readState();
  const mapVersion = fs.existsSync(MAP_PATH) ? fs.statSync(MAP_PATH).mtimeMs : null;
  res.json({ ...state, mapVersion });
});

app.post('/api/config', (req, res) => {
  const initialZoom = req.body?.initialZoom !== undefined ? Number(req.body.initialZoom) : undefined;
  const initialOffsetX = req.body?.initialOffsetX !== undefined ? Number(req.body.initialOffsetX) : undefined;
  const initialOffsetY = req.body?.initialOffsetY !== undefined ? Number(req.body.initialOffsetY) : undefined;

  const state = readState();
  
  if (initialZoom !== undefined && Number.isFinite(initialZoom)) {
    state.initialZoom = initialZoom;
  }
  if (initialOffsetX !== undefined && Number.isFinite(initialOffsetX)) {
    state.initialOffsetX = initialOffsetX;
  }
  if (initialOffsetY !== undefined && Number.isFinite(initialOffsetY)) {
    state.initialOffsetY = initialOffsetY;
  }
  
  writeState(state);

  return res.json(state);
});

app.post('/api/map', upload.single('mapImage'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'mapImage is required.' });
  }

  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Only image uploads are allowed.' });
  }

  fs.writeFileSync(MAP_PATH, req.file.buffer);
  const state = readState();
  state.mapImageUploaded = true;
  writeState(state);

  return res.json({ success: true });
});

app.get('/api/map-image', (_req, res) => {
  if (!fs.existsSync(MAP_PATH)) {
    return res.status(404).json({ error: 'No map image uploaded yet.' });
  }

  return res.sendFile(MAP_PATH);
});

// Get all players
app.get('/api/players', (_req, res) => {
  const state = readState();
  return res.json({ players: state.players });
});

// Register or get a player (auto-assigns color)
app.post('/api/players', (req, res) => {
  const name = String(req.body?.name || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const state = readState();
  
  // Check if player already exists
  if (state.players[name]) {
    return res.json({ player: { name, color: state.players[name] } });
  }

  // Auto-generate color for new player
  const playerCount = Object.keys(state.players).length;
  const color = generatePlayerColor(playerCount);
  
  state.players[name] = color;
  writeState(state);

  return res.json({ player: { name, color } });
});

app.get('/api/players', (req, res) => {
  const state = readState();
  return res.json({ players: state.players });
});

app.post('/api/zones/paint', paintRateLimiter, (req, res) => {
  const { cells, playerName } = req.body || {};
  if (!Array.isArray(cells)) {
    return res.status(400).json({ error: 'cells must be an array.' });
  }

  const state = readState();
  const player = playerName ? String(playerName).trim() : null;

  for (const cell of cells) {
    const x = Number(cell?.x);
    const y = Number(cell?.y);
    const color = typeof cell?.color === 'string' ? cell.color : '';

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      continue;
    }

    const key = `${x},${y}`;

    if (!color) {
      delete state.zones[key];
      continue;
    }

    const existing = state.zones[key] || {};
    state.zones[key] = { 
      color, 
      claimedBy: existing.claimedBy || null,
      owner: player || existing.owner || null
    };
  }

  writeState(state);
  return res.json({ success: true });
});

app.post('/api/zones/claim', (req, res) => {
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  const name = String(req.body?.name || '').trim();

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({ error: 'x and y must be integers.' });
  }

  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const key = `${x},${y}`;
  const state = readState();
  const zone = state.zones[key];

  if (!zone) {
    return res.status(404).json({ error: 'No zone found at this location.' });
  }

  // Check if claimed by someone else
  if (zone.claimedBy && zone.claimedBy !== name) {
    return res.status(409).json({ error: 'This zone is already claimed by someone else.' });
  }

  // Get or create player
  let playerColor = state.players[name];
  if (!playerColor) {
    const playerCount = Object.keys(state.players).length;
    playerColor = generatePlayerColor(playerCount);
    state.players[name] = playerColor;
  }

  // Set zone color to player color and mark as claimed
  zone.color = playerColor;
  zone.claimedBy = name;
  state.zones[key] = zone;
  writeState(state);

  return res.json({ success: true, zone });
});

app.post('/api/zones/unclaim', (req, res) => {
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  const name = String(req.body?.name || '').trim();

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return res.status(400).json({ error: 'x and y must be integers.' });
  }

  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const key = `${x},${y}`;
  const state = readState();
  const zone = state.zones[key];

  if (!zone) {
    return res.status(404).json({ error: 'No zone found at this location.' });
  }

  // Check if claimed by this player
  if (zone.claimedBy !== name) {
    return res.status(409).json({ error: 'You can only unclaim zones you claimed.' });
  }

  zone.claimedBy = null;
  state.zones[key] = zone;
  writeState(state);

  return res.json({ success: true, zone });
});

// Claim all zones of a specific color for a player
app.post('/api/zones/claim-color', (req, res) => {
  const color = String(req.body?.color || '').trim();
  const name = String(req.body?.name || '').trim();

  if (!color) {
    return res.status(400).json({ error: 'color is required.' });
  }

  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const state = readState();

  // Get or create player
  let playerColor = state.players[name];
  if (!playerColor) {
    const playerCount = Object.keys(state.players).length;
    playerColor = generatePlayerColor(playerCount);
    state.players[name] = playerColor;
  }

  // Check if player already claimed a different color
  let playerCurrentColor = null;
  for (const zone of Object.values(state.zones)) {
    if (zone.claimedBy === name) {
      playerCurrentColor = zone.color;
      break;
    }
  }

  if (playerCurrentColor && playerCurrentColor !== color) {
    return res.status(409).json({ error: 'Player already claimed a different color.' });
  }

  // Claim all zones of this color
  let claimedCount = 0;
  for (const key in state.zones) {
    const zone = state.zones[key];
    if (zone.color === color) {
      zone.claimedBy = name;
      zone.color = playerColor;
      claimedCount++;
    }
  }

  writeState(state);
  return res.json({ success: true, claimedCount });
});

// Switch color claim from old color to new color
app.post('/api/zones/switch-color', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const oldColor = String(req.body?.oldColor || '').trim();
  const newColor = String(req.body?.newColor || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  if (!oldColor) {
    return res.status(400).json({ error: 'oldColor is required.' });
  }

  if (!newColor) {
    return res.status(400).json({ error: 'newColor is required.' });
  }

  const state = readState();

  // Get player color
  let playerColor = state.players[name];
  if (!playerColor) {
    const playerCount = Object.keys(state.players).length;
    playerColor = generatePlayerColor(playerCount);
    state.players[name] = playerColor;
  }

  // Unclaim all zones of old color
  let unclaimedCount = 0;
  for (const key in state.zones) {
    const zone = state.zones[key];
    if (zone.claimedBy === name && zone.color === playerColor) {
      zone.claimedBy = null;
      zone.color = oldColor;
      unclaimedCount++;
    }
  }

  // Claim all zones of new color
  let claimedCount = 0;
  for (const key in state.zones) {
    const zone = state.zones[key];
    if (zone.color === newColor) {
      zone.claimedBy = name;
      zone.color = playerColor;
      claimedCount++;
    }
  }

  writeState(state);
  return res.json({ success: true, unclaimedCount, claimedCount });
});

// Get all players with their claimed colors
app.get('/api/admin/players', (req, res) => {
  const state = readState();
  const playersList = Object.entries(state.players).map(([name, color]) => {
    // Count zones claimed by this player
    let zoneCount = 0;
    for (const zone of Object.values(state.zones)) {
      if (zone.claimedBy === name) {
        zoneCount++;
      }
    }
    return { name, color, zoneCount };
  });
  return res.json({ players: playersList });
});

// Delete a player and their claimed zones
app.delete('/api/admin/players/:name', (req, res) => {
  const name = String(req.params.name || '').trim();
  
  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const state = readState();

  // Remove all zones claimed by this player
  for (const key in state.zones) {
    const zone = state.zones[key];
    if (zone.claimedBy === name) {
      zone.claimedBy = null;
    }
  }

  // Remove player from players list
  delete state.players[name];

  writeState(state);
  return res.json({ success: true });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${PORT}`);
});
