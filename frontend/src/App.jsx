import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = '/api'
const CELL_SIZE = 16
const BRUSH_RADIUS = 2

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const toCellKey = (x, y) => `${x},${y}`

function App() {
  const canvasRef = useRef(null)
  const wrapperRef = useRef(null)
  const imageRef = useRef(null)
  const dragStateRef = useRef(null)
  const paintedCellsRef = useRef(new Set())

  const [centerX, setCenterX] = useState(0)
  const [centerZ, setCenterZ] = useState(0)
  const [color, setColor] = useState('#e63946')
  const [drawMode, setDrawMode] = useState(false)
  const [adminMode, setAdminMode] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zones, setZones] = useState({})
  const [mapVersion, setMapVersion] = useState(null)
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const mapImageUrl = useMemo(() => (mapVersion ? `${API_BASE}/map-image?v=${mapVersion}` : null), [mapVersion])

  const drawMap = useCallback(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas) {
      return
    }

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!image) {
      ctx.fillStyle = '#161616'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#f0f0f0'
      ctx.font = '18px sans-serif'
      ctx.fillText('Upload eerst een Unmined kaart als admin.', 30, 50)
      return
    }

    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(zoom, zoom)
    ctx.drawImage(image, 0, 0)

    Object.entries(zones).forEach(([key, zone]) => {
      const [x, y] = key.split(',').map(Number)
      ctx.fillStyle = zone.color
      ctx.globalAlpha = 0.45
      ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      ctx.globalAlpha = 1
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)

      if (zone.claimedBy) {
        ctx.fillStyle = '#ffffff'
        ctx.font = '10px sans-serif'
        ctx.fillText(zone.claimedBy.slice(0, 8), x * CELL_SIZE + 2, y * CELL_SIZE + 11)
      }
    })

    ctx.restore()
  }, [offset.x, offset.y, zoom, zones])

  const applyServerState = useCallback((state) => {
    setCenterX(state.centerX ?? 0)
    setCenterZ(state.centerZ ?? 0)
    setZones(state.zones ?? {})
    setMapVersion(state.mapVersion)
  }, [])

  const refreshState = useCallback(async () => {
    const response = await fetch(`${API_BASE}/state`)
    const state = await response.json()
    applyServerState(state)
  }, [applyServerState])

  useEffect(() => {
    let ignore = false

    const fetchState = async () => {
      try {
        const response = await fetch(`${API_BASE}/state`)
        const state = await response.json()

        if (!ignore) {
          applyServerState(state)
        }
      } catch {
        if (!ignore) {
          setMessage('Kon de serverstatus niet laden.')
        }
      }
    }

    fetchState()

    return () => {
      ignore = true
    }
  }, [applyServerState])

  useEffect(() => {
    const wrapper = wrapperRef.current
    const canvas = canvasRef.current
    if (!wrapper || !canvas) {
      return
    }

    const resize = () => {
      canvas.width = wrapper.clientWidth
      canvas.height = wrapper.clientHeight
      drawMap()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrapper)

    return () => observer.disconnect()
  }, [drawMap])

  useEffect(() => {
    if (!mapImageUrl) {
      imageRef.current = null
      drawMap()
      return
    }

    const image = new Image()
    image.onload = () => {
      imageRef.current = image
      drawMap()
    }
    image.src = mapImageUrl
  }, [drawMap, mapImageUrl])

  useEffect(() => {
    drawMap()
  }, [drawMap])

  const pointerToMapCell = (clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas || !imageRef.current) {
      return null
    }

    const rect = canvas.getBoundingClientRect()
    const mapX = (clientX - rect.left - offset.x) / zoom
    const mapY = (clientY - rect.top - offset.y) / zoom

    if (mapX < 0 || mapY < 0 || mapX > imageRef.current.width || mapY > imageRef.current.height) {
      return null
    }

    return {
      x: Math.floor(mapX / CELL_SIZE),
      y: Math.floor(mapY / CELL_SIZE),
      pixelX: mapX,
      pixelY: mapY,
    }
  }

  const paintAt = useCallback((cx, cy) => {
    const nextZones = { ...zones }

    for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx += 1) {
      for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy += 1) {
        if (dx * dx + dy * dy > BRUSH_RADIUS * BRUSH_RADIUS) {
          continue
        }

        const x = cx + dx
        const y = cy + dy
        const key = toCellKey(x, y)

        nextZones[key] = {
          color,
          claimedBy: nextZones[key]?.claimedBy ?? null,
        }
        paintedCellsRef.current.add(key)
      }
    }

    setZones(nextZones)
  }, [color, zones])

  const flushPaint = useCallback(async () => {
    const keys = Array.from(paintedCellsRef.current)
    if (!keys.length) {
      return
    }

    paintedCellsRef.current.clear()
    setIsSaving(true)

    try {
      await fetch(`${API_BASE}/zones/paint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cells: keys.map((key) => {
            const [x, y] = key.split(',').map(Number)
            return { x, y, color: zones[key]?.color || color }
          }),
        }),
      })
      setMessage('Zone opgeslagen.')
    } catch {
      setMessage('Opslaan van zone mislukt.')
    } finally {
      setIsSaving(false)
    }
  }, [color, zones])

  const handlePointerDown = (event) => {
    if (!imageRef.current) {
      return
    }

    if (adminMode && drawMode) {
      const cell = pointerToMapCell(event.clientX, event.clientY)
      if (!cell) {
        return
      }
      paintAt(cell.x, cell.y)
      dragStateRef.current = { mode: 'paint' }
      return
    }

    dragStateRef.current = {
      mode: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      baseOffsetX: offset.x,
      baseOffsetY: offset.y,
    }
  }

  const handlePointerMove = (event) => {
    const drag = dragStateRef.current
    if (!drag) {
      return
    }

    if (drag.mode === 'pan') {
      setOffset({
        x: drag.baseOffsetX + (event.clientX - drag.startX),
        y: drag.baseOffsetY + (event.clientY - drag.startY),
      })
      return
    }

    const cell = pointerToMapCell(event.clientX, event.clientY)
    if (cell) {
      paintAt(cell.x, cell.y)
    }
  }

  const handlePointerUp = () => {
    const mode = dragStateRef.current?.mode
    dragStateRef.current = null

    if (mode === 'paint') {
      flushPaint()
    }
  }

  const handleWheel = (event) => {
    event.preventDefault()

    const rect = canvasRef.current.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top

    setZoom((currentZoom) => {
      const nextZoom = clamp(currentZoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.25, 8)
      setOffset((currentOffset) => {
        const scale = nextZoom / currentZoom
        return {
          x: pointerX - (pointerX - currentOffset.x) * scale,
          y: pointerY - (pointerY - currentOffset.y) * scale,
        }
      })
      return nextZoom
    })
  }

  const saveConfig = async () => {
    setMessage('')
    await fetch(`${API_BASE}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ centerX, centerZ }),
    })
    setMessage('Coördinaten opgeslagen.')
  }

  const uploadMap = async (event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const data = new FormData()
    data.append('mapImage', file)

    await fetch(`${API_BASE}/map`, {
      method: 'POST',
      body: data,
    })

    await refreshState()
    setMessage('Kaart geüpload.')
  }

  const claimCell = async (event) => {
    if (adminMode || drawMode) {
      return
    }

    const cell = pointerToMapCell(event.clientX, event.clientY)
    if (!cell) {
      return
    }

    const key = toCellKey(cell.x, cell.y)
    const zone = zones[key]

    if (!zone || zone.claimedBy) {
      return
    }

    const name = window.prompt('Typ je naam om deze zone te claimen:')
    if (!name) {
      return
    }

    const response = await fetch(`${API_BASE}/zones/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: cell.x, y: cell.y, name }),
    })

    if (!response.ok) {
      setMessage('Claimen mislukt: mogelijk al geclaimd.')
      await refreshState()
      return
    }

    await refreshState()
    setMessage('Zone geclaimd!')
  }

  return (
    <main className="app">
      <h1>Minecraft Territory Planner</h1>
      <p className="subtitle">Upload je Unmined kaart, teken zones en laat spelers chunks claimen.</p>

      <section className="panel">
        <label className="checkbox">
          <input type="checkbox" checked={adminMode} onChange={(event) => setAdminMode(event.target.checked)} />
          Admin modus
        </label>

        <div className="row">
          <label>
            Midden X
            <input type="number" value={centerX} onChange={(event) => setCenterX(Number(event.target.value))} />
          </label>
          <label>
            Midden Z
            <input type="number" value={centerZ} onChange={(event) => setCenterZ(Number(event.target.value))} />
          </label>
          <button type="button" onClick={saveConfig}>Opslaan</button>
        </div>

        <div className="row">
          <label>
            Kaart uploaden
            <input type="file" accept="image/*" onChange={uploadMap} disabled={!adminMode} />
          </label>

          <label>
            Kleur
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={!adminMode} />
          </label>

          <button type="button" onClick={() => setDrawMode((value) => !value)} disabled={!adminMode || !mapVersion}>
            {drawMode ? 'Stop tekenen' : 'Teken modus'}
          </button>
        </div>
      </section>

      <section className="map-wrapper" ref={wrapperRef}>
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onClick={claimCell}
          onWheel={handleWheel}
        />
      </section>

      <p className="status">
        Zoom: {zoom.toFixed(2)}x · {isSaving ? 'Opslaan...' : message || 'Klaar.'}
      </p>
    </main>
  )
}

export default App
