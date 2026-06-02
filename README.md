# Minecraft Territory Planner

Een simpele React + Node app om Unmined-kaarten te uploaden, zones te tekenen en claims per chunk op te slaan.

## Starten met Docker

Vereiste: Docker + Docker Compose.

```bash
docker compose up --build
```

Daarna:

- Frontend: http://localhost:8080
- Backend API: http://localhost:3001/api/state

De backend bewaart data (kaart, zones, claims) in een Docker volume: `territory_data`.

## Lokale development (optioneel)

```bash
cd frontend && npm install && npm run dev
cd backend && npm install && npm start
```

Frontend dev server draait op `5173` en proxiet `/api` naar backend op `3001`.
