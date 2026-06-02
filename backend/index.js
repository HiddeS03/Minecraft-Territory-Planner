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

const getDefaultState = () => ({
  centerX: 0,
  centerZ: 0,
  mapImageUploaded: false,
  zones: {},
});

const readState = () => {
  if (!fs.existsSync(STATE_PATH)) {
    return getDefaultState();
  }

  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
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
  const centerX = Number(req.body?.centerX);
  const centerZ = Number(req.body?.centerZ);

  if (!Number.isFinite(centerX) || !Number.isFinite(centerZ)) {
    return res.status(400).json({ error: 'centerX and centerZ must be numbers.' });
  }

  const state = readState();
  state.centerX = centerX;
  state.centerZ = centerZ;
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

app.post('/api/zones/paint', paintRateLimiter, (req, res) => {
  const { cells } = req.body || {};
  if (!Array.isArray(cells)) {
    return res.status(400).json({ error: 'cells must be an array.' });
  }

  const state = readState();

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
    state.zones[key] = { color, claimedBy: existing.claimedBy || null };
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

  if (zone.claimedBy) {
    return res.status(409).json({ error: 'This zone is already claimed.' });
  }

  zone.claimedBy = name;
  state.zones[key] = zone;
  writeState(state);

  return res.json({ success: true, zone });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${PORT}`);
});
