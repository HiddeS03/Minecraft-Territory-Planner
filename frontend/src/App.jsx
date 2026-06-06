import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = '/api'
const CELL_SIZE = 16
const LABEL_FONT_SIZE = 14 // Fixed label size in pixels

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const toCellKey = (x, y) => `${x},${y}`

function App() {
  const isAdminPage = window.location.pathname === '/admin' || window.location.pathname === '/admin/'

  const canvasRef = useRef(null)
  const wrapperRef = useRef(null)
  const imageRef = useRef(null)
  const dragStateRef = useRef(null)
  const paintedCellsRef = useRef(new Set())

  const [color, setColor] = useState('#e63946')
  const [colorPalette, setColorPalette] = useState(['#e63946', '#f77f00', '#06d6a0', '#118ab2', '#8338ec'])
  const [editingColorIndex, setEditingColorIndex] = useState(null)
  const [playerName, setPlayerName] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [players, setPlayers] = useState({})
  const [showPlayerSelect, setShowPlayerSelect] = useState(false)
  const [newPlayerName, setNewPlayerName] = useState('')
  const [drawMode, setDrawMode] = useState(false)
  const [eraseMode, setEraseMode] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedCells, setSelectedCells] = useState(new Set())
  const adminMode = isAdminPage
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zones, setZones] = useState({})
  const [savedZoom, setSavedZoom] = useState(1)
  const [savedOffset, setSavedOffset] = useState({ x: 0, y: 0 })
  const [hasAppliedInitialZoom, setHasAppliedInitialZoom] = useState(false)
  const [mapVersion, setMapVersion] = useState(null)
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false)
  const [showRegistrationModal, setShowRegistrationModal] = useState(false)
  const [showExistingPlayersModal, setShowExistingPlayersModal] = useState(false)
  const [showClaimConfirmModal, setShowClaimConfirmModal] = useState(false)
  const [showUnclaimConfirmModal, setShowUnclaimConfirmModal] = useState(false)
  const [pendingClaimCell, setPendingClaimCell] = useState(null)
  const [playerInitialized, setPlayerInitialized] = useState(false)
  const [showSwitchColorModal, setShowSwitchColorModal] = useState(false)
  const [pendingColorSwitch, setPendingColorSwitch] = useState(null)
  const [adminPlayers, setAdminPlayers] = useState([])
  const [showDeletePlayerModal, setShowDeletePlayerModal] = useState(false)
  const [pendingDeletePlayer, setPendingDeletePlayer] = useState(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

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
      
      // Highlight selected cells
      if (selectedCells.has(key)) {
        ctx.fillStyle = '#ffff00'
        ctx.globalAlpha = 0.6
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
        ctx.globalAlpha = 1
      } else {
        ctx.fillStyle = zone.color
        ctx.globalAlpha = 0.45
        ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
        ctx.globalAlpha = 1
      }
      
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
      ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
    })

    ctx.restore()

    // Draw labels in screen space (not scaled with map)
    ctx.save()
    const drawnLabels = new Set()
    Object.entries(zones).forEach(([key, zone]) => {
      if (zone.claimedBy) {
        const labelKey = `${zone.color}_${zone.claimedBy}`
        // Only draw one label per color+player combination
        if (!drawnLabels.has(labelKey)) {
          drawnLabels.add(labelKey)
          const [x, y] = key.split(',').map(Number)
          const screenX = x * CELL_SIZE * zoom + offset.x
          const screenY = y * CELL_SIZE * zoom + offset.y
          
          // Only draw if visible
          if (screenX > -CELL_SIZE * zoom && screenX < canvas.width &&
              screenY > -CELL_SIZE * zoom && screenY < canvas.height) {
            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = '#000000'
            ctx.lineWidth = 3
            ctx.font = `bold ${LABEL_FONT_SIZE}px sans-serif`
            const text = zone.claimedBy.slice(0, 10)
            ctx.strokeText(text, screenX + 2, screenY + LABEL_FONT_SIZE)
            ctx.fillText(text, screenX + 2, screenY + LABEL_FONT_SIZE)
          }
        }
      }
    })
    ctx.restore()
  }, [offset.x, offset.y, zoom, zones, selectedCells])

  const applyServerState = useCallback((state) => {
    setZones(state.zones ?? {})
    setMapVersion(state.mapVersion)
    setPlayers(state.players ?? {})
    
    // Store saved zoom and offset from server
    if (state.initialZoom) {
      setSavedZoom(state.initialZoom)
    }
    if (state.initialOffsetX !== undefined && state.initialOffsetY !== undefined) {
      setSavedOffset({ x: state.initialOffsetX, y: state.initialOffsetY })
    }
  }, [])

  const refreshState = useCallback(async () => {
    const response = await fetch(`${API_BASE}/state`)
    const state = await response.json()
    applyServerState(state)
  }, [applyServerState])

  const fetchPlayers = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/players`)
      const data = await response.json()
      setPlayers(data.players ?? {})
    } catch {
      setMessage('Kon spelers niet laden.')
    }
  }, [])

  useEffect(() => {
    let ignore = false

    const fetchState = async () => {
      try {
        const response = await fetch(`${API_BASE}/state`)
        const state = await response.json()

        if (!ignore) {
          applyServerState(state)
          
          // Show welcome modal on first load for non-admin if not yet initialized
          if (!isAdminPage && !playerInitialized) {
            setShowWelcomeModal(true)
          }
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
  }, [applyServerState, isAdminPage, playerInitialized])

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

    // Prevent scrolling when interacting with map
    const preventScroll = (e) => {
      if (wrapper.contains(e.target)) {
        e.preventDefault()
      }
    }

    // Prevent wheel scrolling on canvas
    wrapper.addEventListener('wheel', preventScroll, { passive: false })
    
    // Prevent touch scrolling on canvas
    wrapper.addEventListener('touchmove', preventScroll, { passive: false })

    return () => {
      observer.disconnect()
      wrapper.removeEventListener('wheel', preventScroll)
      wrapper.removeEventListener('touchmove', preventScroll)
    }
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
      
      // Apply saved zoom/offset automatically for non-admin users on first load
      if (!isAdminPage && !hasAppliedInitialZoom && savedZoom !== 1) {
        setZoom(savedZoom)
        setOffset(savedOffset)
        setHasAppliedInitialZoom(true)
      }
      
      drawMap()
    }
    image.src = mapImageUrl
  }, [drawMap, mapImageUrl, isAdminPage, hasAppliedInitialZoom, savedZoom, savedOffset])

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
    if (selectionMode) {
      // In selection mode, toggle cell selection
      setSelectedCells((prev) => {
        const next = new Set(prev)
        const key = toCellKey(cx, cy)
        if (next.has(key)) {
          next.delete(key)
        } else {
          next.add(key)
        }
        return next
      })
      return
    }

    const nextZones = { ...zones }
    const key = toCellKey(cx, cy)
    const existingZone = nextZones[key]

    if (eraseMode) {
      // In erase mode, if zone is claimed, remove all zones of that color
      if (existingZone && existingZone.claimedBy) {
        const colorToRemove = existingZone.color
        Object.keys(nextZones).forEach(k => {
          if (nextZones[k].color === colorToRemove) {
            delete nextZones[k]
          }
        })
        paintedCellsRef.current.add(key)
        setZones(nextZones)
        return
      }
      // Otherwise remove single zone
      delete nextZones[key]
    } else {
      // Don't allow painting over claimed zones
      if (existingZone && existingZone.claimedBy) {
        setMessage(`Deze zone is geclaimd door ${existingZone.claimedBy}.`)
        return
      }

      nextZones[key] = {
        color,
        claimedBy: existingZone?.claimedBy ?? null,
      }
    }
    paintedCellsRef.current.add(key)

    setZones(nextZones)
  }, [color, zones, eraseMode, selectionMode])

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
            return { x, y, color: zones[key]?.color || '' }
          }),
          playerName: selectedPlayer || playerName,
        }),
      })
      setMessage('Zone opgeslagen.')
    } catch {
      setMessage('Opslaan van zone mislukt.')
    } finally {
      setIsSaving(false)
    }
  }, [zones, selectedPlayer, playerName])

  const handlePointerDown = (event) => {
    if (!imageRef.current) {
      return
    }

    if (adminMode && (drawMode || selectionMode)) {
      const cell = pointerToMapCell(event.clientX, event.clientY)
      if (!cell) {
        return
      }
      paintAt(cell.x, cell.y)
      dragStateRef.current = { mode: selectionMode ? 'select' : 'paint' }
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
    // Update mouse position for display
    const canvas = canvasRef.current
    if (canvas && imageRef.current) {
      const rect = canvas.getBoundingClientRect()
      const mapX = (event.clientX - rect.left - offset.x) / zoom
      const mapY = (event.clientY - rect.top - offset.y) / zoom
      setMousePos({ x: Math.floor(mapX), y: Math.floor(mapY) })
    }

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

    if (drag.mode === 'paint' || drag.mode === 'select') {
      const cell = pointerToMapCell(event.clientX, event.clientY)
      if (cell) {
        paintAt(cell.x, cell.y)
      }
    }
  }

  const handlePointerUp = () => {
    const mode = dragStateRef.current?.mode
    dragStateRef.current = null

    if (mode === 'paint') {
      flushPaint()
    }
    // Selection mode doesn't need to flush
  }

  const handleWheel = (event) => {
    event.preventDefault()

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top

    // Calculate new zoom
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1
    const newZoom = clamp(zoom * zoomFactor, 0.25, 8)
    
    // Calculate new offset to zoom towards mouse position
    const scale = newZoom / zoom
    const newOffset = {
      x: mouseX - (mouseX - offset.x) * scale,
      y: mouseY - (mouseY - offset.y) * scale,
    }

    setZoom(newZoom)
    setOffset(newOffset)
  }

  const saveMapPosition = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initialZoom: zoom,
          initialOffsetX: offset.x,
          initialOffsetY: offset.y,
        }),
      })

      if (!response.ok) {
        setMessage('Positie opslaan mislukt.')
      } else {
        setSavedZoom(zoom)
        setSavedOffset({ ...offset })
        setMessage('Huidge positie opgeslagen!')
      }
    } catch {
      setMessage('Positie opslaan mislukt.')
    } finally {
      setIsSaving(false)
    }
  }

  const centerMap = () => {
    if (!imageRef.current) {
      return
    }
    const canvas = canvasRef.current
    const centerOffsetX = canvas.width / 2 - (imageRef.current.width * zoom) / 2
    const centerOffsetY = canvas.height / 2 - (imageRef.current.height * zoom) / 2
    setOffset({ x: centerOffsetX, y: centerOffsetY })
    setMessage('Kaart gecentreerd.')
  }

  const registerPlayer = async (name) => {
    try {
      const response = await fetch(`${API_BASE}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await response.json()
      if (data.player) {
        setSelectedPlayer(data.player.name)
        setColor(data.player.color)
        setPlayerName(data.player.name)
        setShowRegistrationModal(false)
        setShowWelcomeModal(false)
        setPlayerInitialized(true)
        await fetchPlayers()
        setMessage(`Welkom, ${data.player.name}!`)
      }
    } catch {
      setMessage('Registratie mislukt.')
    }
  }

  const selectExistingPlayer = (name) => {
    setSelectedPlayer(name)
    setColor(players[name])
    setPlayerName(name)
    setShowExistingPlayersModal(false)
    setShowWelcomeModal(false)
    setPlayerInitialized(true)
    setMessage(`Geselecteerd: ${name}`)
  }

  const unclaimCell = async () => {
    if (!selectedPlayer || !pendingClaimCell) {
      return
    }

    const cell = pendingClaimCell
    const key = toCellKey(cell.x, cell.y)
    const zone = zones[key]

    if (!zone || !zone.claimedBy) {
      setShowUnclaimConfirmModal(false)
      setPendingClaimCell(null)
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`${API_BASE}/zones/unclaim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: cell.x, y: cell.y, name: selectedPlayer }),
      })

      if (!response.ok) {
        const error = await response.json()
        setMessage(`Unclaimen mislukt: ${error.error || 'Onbekende fout'}`)
      } else {
        await refreshState()
        setMessage('Zone niet meer geclaimd!')
      }
    } catch {
      setMessage('Unclaimen mislukt.')
    } finally {
      setShowUnclaimConfirmModal(false)
      setPendingClaimCell(null)
      setIsSaving(false)
    }
  }

  const applySelectedToZones = async () => {
    if (selectedCells.size === 0) {
      setMessage('Geen cellen geselecteerd.')
      return
    }

    // Filter out claimed zones from selection
    const validCells = Array.from(selectedCells).filter((key) => {
      const zone = zones[key]
      return !zone || !zone.claimedBy
    }).map((key) => {
      const [x, y] = key.split(',').map(Number)
      return { x, y, color: eraseMode ? '' : color }
    })

    if (validCells.length === 0) {
      setMessage('Alle geselecteerde zones zijn geclaimd.')
      return
    }

    if (validCells.length < selectedCells.size) {
      setMessage(`${selectedCells.size - validCells.length} geclaimde zones overgeslagen.`)
    }

    setIsSaving(true)
    try {
      await fetch(`${API_BASE}/zones/paint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cells: validCells,
          playerName: selectedPlayer || playerName,
        }),
      })
      
      // Update local state
      const nextZones = { ...zones }
      validCells.forEach((cell) => {
        const key = toCellKey(cell.x, cell.y)
        if (eraseMode) {
          delete nextZones[key]
        } else {
          nextZones[key] = {
            color,
            claimedBy: nextZones[key]?.claimedBy ?? null,
          }
        }
      })
      setZones(nextZones)
      setSelectedCells(new Set())
      setMessage(`${cells.length} cellen ${eraseMode ? 'verwijderd' : 'toegevoegd'}.`)
    } catch {
      setMessage('Toepassen mislukt.')
    } finally {
      setIsSaving(false)
    }
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

  // Get the color that a player has already claimed
  const getPlayerClaimedColor = useCallback((playerName) => {
    for (const zone of Object.values(zones)) {
      if (zone.claimedBy === playerName) {
        return zone.color
      }
    }
    return null
  }, [zones])

  const getChunkCountByColor = useCallback((colorHex) => {
    let count = 0
    for (const zone of Object.values(zones)) {
      if (zone.color === colorHex) {
        count++
      }
    }
    return count
  }, [zones])

  const claimCell = async (event) => {
    if (adminMode || drawMode || selectionMode) {
      return
    }

    const currentPlayer = selectedPlayer || playerName.trim()
    if (!currentPlayer) {
      setShowWelcomeModal(true)
      setMessage('Registreer jezelf eerst.')
      return
    }

    const cell = pointerToMapCell(event.clientX, event.clientY)
    if (!cell) {
      return
    }

    const key = toCellKey(cell.x, cell.y)
    const zone = zones[key]

    if (!zone) {
      setMessage('Geen zone op deze locatie.')
      return
    }

    // Check if zone is already claimed by someone else
    if (zone.claimedBy && zone.claimedBy !== currentPlayer) {
      setMessage(`Zone al geclaimd door ${zone.claimedBy}.`)
      return
    }

    // Get the color the player wants to claim
    const newColor = zone.color

    // Get the color the player has already claimed
    const currentColor = getPlayerClaimedColor(currentPlayer)

    // If player already claimed a different color, show switch modal
    if (currentColor && currentColor !== newColor) {
      setPendingColorSwitch({ 
        oldColor: currentColor, 
        newColor: newColor,
        newColorZones: Object.keys(zones).filter(k => zones[k].color === newColor)
      })
      setShowSwitchColorModal(true)
      return
    }

    // If already claimed this color, nothing to do
    if (currentColor === newColor) {
      setMessage('Je hebt deze kleur al geclaimd.')
      return
    }

    // Show confirmation modal for new claim
    setPendingClaimCell(cell)
    setShowClaimConfirmModal(true)
  }

  const confirmClaim = async () => {
    if (!selectedPlayer || !pendingClaimCell) {
      return
    }

    const cell = pendingClaimCell
    const zone = zones[toCellKey(cell.x, cell.y)]
    if (!zone) {
      setMessage('Zone niet gevonden.')
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`${API_BASE}/zones/claim-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: zone.color, name: selectedPlayer }),
      })

      if (!response.ok) {
        const error = await response.json()
        setMessage(`Claimen mislukt: ${error.error || 'Onbekende fout'}`)
        await refreshState()
      } else {
        await refreshState()
        setMessage('Hele kleurgebied geclaimd!')
      }
    } catch {
      setMessage('Claimen mislukt.')
    } finally {
      setShowClaimConfirmModal(false)
      setPendingClaimCell(null)
      setIsSaving(false)
    }
  }

  const confirmSwitch = async () => {
    if (!selectedPlayer || !pendingColorSwitch) {
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`${API_BASE}/zones/switch-color`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: selectedPlayer,
          oldColor: pendingColorSwitch.oldColor,
          newColor: pendingColorSwitch.newColor 
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        setMessage(`Wisselen mislukt: ${error.error || 'Onbekende fout'}`)
        await refreshState()
      } else {
        await refreshState()
        setMessage('Naar nieuw kleurgebied gewisseld!')
      }
    } catch {
      setMessage('Wisselen mislukt.')
    } finally {
      setShowSwitchColorModal(false)
      setPendingColorSwitch(null)
      setIsSaving(false)
    }
  }

  const loadAdminPlayers = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/players`)
      const data = await response.json()
      setAdminPlayers(data.players || [])
    } catch {
      setMessage('Kon spelers niet laden.')
    }
  }, [])

  const confirmDeletePlayer = async () => {
    if (!pendingDeletePlayer) {
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`${API_BASE}/admin/players/${pendingDeletePlayer}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        setMessage(`Verwijderen mislukt: ${error.error || 'Onbekende fout'}`)
      } else {
        await refreshState()
        await loadAdminPlayers()
        setMessage('Speler verwijderd!')
      }
    } catch {
      setMessage('Verwijderen mislukt.')
    } finally {
      setShowDeletePlayerModal(false)
      setPendingDeletePlayer(null)
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (isAdminPage) {
      loadAdminPlayers()
    }
  }, [isAdminPage, loadAdminPlayers])

  return (
    <main className="app">
      <div className="app-header">
        <div>
          <h1>Minecraft Territory Planner</h1>
          <p className="subtitle">Upload je Unmined kaart, teken zones en laat spelers chunks claimen.</p>
        </div>
        {!isAdminPage && selectedPlayer && (
          <div className="header-player">
            <span className="header-player-name">{selectedPlayer}</span>
            <button 
              type="button"
              onClick={() => {
                setSelectedPlayer(null)
                setPlayerName('')
                setColor('#e63946')
                setShowWelcomeModal(true)
              }}
              className="logout-button"
            >
              Uitloggen
            </button>
          </div>
        )}
      </div>

      {/* Welcome Modal - Registreren of bestaande speler */}
      {showWelcomeModal && !isAdminPage && (
        <div className="modal-overlay" onClick={() => setShowWelcomeModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Welkom bij Territory Planner!</h2>
            <p>Ben je al geregistreerd of wil je een nieuwe account maken?</p>
            <div className="modal-buttons">
              <button 
                type="button"
                onClick={() => {
                  setShowWelcomeModal(false)
                  setShowRegistrationModal(true)
                }}
              >
                Nieuw account
              </button>
              <button 
                type="button"
                onClick={() => {
                  setShowWelcomeModal(false)
                  setShowExistingPlayersModal(true)
                }}
              >
                Al geregistreerd
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Registration Modal - Nieuwe speler */}
      {showRegistrationModal && !isAdminPage && (
        <div className="modal-overlay" onClick={() => {
          setShowRegistrationModal(false)
          setShowWelcomeModal(true)
        }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Maak een nieuw account</h2>
            <p>Voer je Minecraft-gebruikersnaam in:</p>
            <input
              type="text"
              value={newPlayerName}
              onChange={(event) => setNewPlayerName(event.target.value)}
              placeholder="Bijv. Steve"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newPlayerName.trim()) {
                  registerPlayer(newPlayerName.trim())
                  setNewPlayerName('')
                }
              }}
              autoFocus
            />
            <p style={{ fontSize: '0.85rem', color: '#b7b7b7', marginTop: '0.5rem' }}>
              Dit moet je exacte Minecraft-gebruikersnaam zijn zodat anderen je kunnen herkennen op de kaart.
            </p>
            <div className="modal-buttons">
              <button 
                type="button"
                onClick={() => {
                  if (newPlayerName.trim()) {
                    registerPlayer(newPlayerName.trim())
                    setNewPlayerName('')
                  }
                }}
                disabled={!newPlayerName.trim()}
              >
                Account aanmaken
              </button>
              <button 
                type="button"
                onClick={() => {
                  setShowRegistrationModal(false)
                  setShowWelcomeModal(true)
                  setNewPlayerName('')
                }}
              >
                Terug
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing Players Modal - Bestaande speler selecteren */}
      {showExistingPlayersModal && !isAdminPage && (
        <div className="modal-overlay" onClick={() => setShowExistingPlayersModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Selecteer je account</h2>
            {Object.keys(players).length > 0 ? (
              <>
                <p>Welke account is van jou?</p>
                <div className="player-grid">
                  {Object.entries(players).map(([name, playerColor]) => (
                    <button
                      key={name}
                      type="button"
                      className="player-option"
                      onClick={() => selectExistingPlayer(name)}
                      style={{ borderColor: playerColor }}
                    >
                      <div 
                        className="player-color-dot" 
                        style={{ backgroundColor: playerColor }}
                      />
                      {name}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p>Geen bestaande spelers gevonden. Maak een nieuw account.</p>
            )}
            <div className="modal-buttons">
              <button 
                type="button"
                onClick={() => {
                  setShowExistingPlayersModal(false)
                  setShowRegistrationModal(true)
                }}
              >
                Nieuw account
              </button>
              <button 
                type="button"
                onClick={() => setShowExistingPlayersModal(false)}
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claim Confirmation Modal */}
      {showClaimConfirmModal && !isAdminPage && (
        <div className="modal-overlay" onClick={() => setShowClaimConfirmModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Zone claimen</h2>
            <p>Weet je zeker dat je deze zone wil claimen?</p>
            <div className="modal-buttons">
              <button 
                type="button"
                onClick={confirmClaim}
                disabled={isSaving}
              >
                {isSaving ? 'Bezig...' : 'Ja, claimen'}
              </button>
              <button 
                type="button"
                onClick={() => {
                  setShowClaimConfirmModal(false)
                  setPendingClaimCell(null)
                }}
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Switch Color Confirmation Modal */}
      {showSwitchColorModal && !isAdminPage && pendingColorSwitch && (
        <div className="modal-overlay" onClick={() => setShowSwitchColorModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Kleurgebied wisselen?</h2>
            <p>Weet je zeker dat je wil switchen van <span style={{backgroundColor: pendingColorSwitch.oldColor, color: '#000', padding: '2px 6px', borderRadius: '3px'}}>kleur</span> gebied naar <span style={{backgroundColor: pendingColorSwitch.newColor, color: '#000', padding: '2px 6px', borderRadius: '3px'}}>kleur</span> gebied?</p>
            <div className="modal-buttons">
              <button 
                type="button"
                onClick={confirmSwitch}
                disabled={isSaving}
              >
                {isSaving ? 'Bezig...' : 'Ja, wisselen'}
              </button>
              <button 
                type="button"
                onClick={() => {
                  setShowSwitchColorModal(false)
                  setPendingColorSwitch(null)
                }}
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unclaim Confirmation Modal */}
      {showUnclaimConfirmModal && !isAdminPage && (
        <div className="modal-overlay" onClick={() => setShowUnclaimConfirmModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Zone niet meer claimen</h2>
            <p>Weet je zeker dat je deze zone niet meer wil claimen?</p>
            <div className="modal-buttons">
              <button 
                type="button"
                onClick={unclaimCell}
                disabled={isSaving}
              >
                {isSaving ? 'Bezig...' : 'Ja, unclaimen'}
              </button>
              <button 
                type="button"
                onClick={() => {
                  setShowUnclaimConfirmModal(false)
                  setPendingClaimCell(null)
                }}
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Player Modal */}
      {showDeletePlayerModal && isAdminPage && pendingDeletePlayer && (
        <div className="modal-overlay" onClick={() => setShowDeletePlayerModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Speler verwijderen</h2>
            <p>Weet je zeker dat je <strong>{pendingDeletePlayer}</strong> wil verwijderen? Hun geclaimde zones worden niet verwijderd, maar niet meer geclaimd.</p>
            <div className="modal-buttons">
              <button 
                type="button"
                onClick={confirmDeletePlayer}
                disabled={isSaving}
              >
                {isSaving ? 'Bezig...' : 'Ja, verwijderen'}
              </button>
              <button 
                type="button"
                onClick={() => {
                  setShowDeletePlayerModal(false)
                  setPendingDeletePlayer(null)
                }}
              >
                Annuleren
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdminPage && (
        <section className="panel">
          <h3>Admin Controls</h3>
          
          <div className="row">
            <label>
              Kaart uploaden
              <input type="file" accept="image/*" onChange={uploadMap} />
            </label>
          </div>

          <div className="row">
            <h4 style={{ width: '100%', marginBottom: '0.5rem' }}>Kleuren</h4>
            <div className="color-grid">
              {colorPalette.map((paletteColor, index) => (
                <div
                  key={index}
                  className={`color-item ${color === paletteColor ? 'selected' : ''}`}
                  onClick={() => setColor(paletteColor)}
                >
                  <div 
                    className="color-preview" 
                    style={{ backgroundColor: paletteColor }}
                  />
                  <div style={{ fontSize: '0.8rem', color: '#999' }}>
                    {getChunkCountByColor(paletteColor)} chunks
                  </div>
                  <div className="color-actions">
                    <button
                      type="button"
                      className="small-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingColorIndex(index)
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="small-button"
                      onClick={(e) => {
                        e.stopPropagation()
                        // Remove color from palette
                        const newPalette = colorPalette.filter((_, i) => i !== index)
                        setColorPalette(newPalette)
                        // Remove all zones with this color
                        const newZones = { ...zones }
                        Object.keys(newZones).forEach(key => {
                          if (newZones[key].color === paletteColor) {
                            delete newZones[key]
                          }
                        })
                        setZones(newZones)
                        // Switch to first color if current color is deleted
                        if (color === paletteColor && newPalette.length > 0) {
                          setColor(newPalette[0])
                        }
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="color-item add-color"
                onClick={() => {
                  const newColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
                  setColorPalette([...colorPalette, newColor])
                  setColor(newColor)
                }}
              >
                <span className="add-icon">+</span>
                <span className="add-text">Nieuwe kleur</span>
              </button>
            </div>
          </div>

          {editingColorIndex !== null && (
            <div className="row">
              <label>
                Kleur bewerken
                <input 
                  type="color" 
                  value={colorPalette[editingColorIndex]} 
                  onChange={(event) => {
                    const newPalette = [...colorPalette]
                    newPalette[editingColorIndex] = event.target.value
                    setColorPalette(newPalette)
                    if (color === colorPalette[editingColorIndex]) {
                      setColor(event.target.value)
                    }
                  }} 
                />
              </label>
              <button 
                type="button" 
                onClick={() => setEditingColorIndex(null)}
              >
                Klaar
              </button>
            </div>
          )}

          <div className="row">
            <h4 style={{ width: '100%', marginBottom: '0.5rem' }}>Spelers beheren</h4>
            <div style={{ width: '100%', maxHeight: '200px', overflowY: 'auto', border: '1px solid #444', borderRadius: '6px' }}>
              {adminPlayers.length === 0 ? (
                <p style={{ padding: '0.5rem', color: '#999' }}>Geen spelers geregistreerd</p>
              ) : (
                adminPlayers.map((player) => (
                  <div key={player.name} style={{ display: 'flex', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid #333' }}>
                    <div style={{ 
                      width: '16px', 
                      height: '16px', 
                      backgroundColor: player.color, 
                      borderRadius: '2px',
                      marginRight: '0.5rem'
                    }} />
                    <span style={{ flex: 1 }}>{player.name}</span>
                    <span style={{ fontSize: '0.8rem', color: '#999', marginRight: '0.5rem' }}>({player.zoneCount} zones)</span>
                    <button
                      type="button"
                      className="small-button"
                      onClick={() => {
                        setPendingDeletePlayer(player.name)
                        setShowDeletePlayerModal(true)
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="row">
            <button 
              type="button" 
              onClick={() => {
                setDrawMode((value) => !value)
                setEraseMode(false)
                setSelectionMode(false)
              }} 
              disabled={!mapVersion}
              className={drawMode ? 'active' : ''}
            >
              {drawMode ? 'Stop tekenen' : 'Teken modus'}
            </button>

            <button 
              type="button" 
              onClick={() => {
                setEraseMode((value) => !value)
                if (!eraseMode) {
                  setDrawMode(true)
                  setSelectionMode(false)
                }
              }} 
              disabled={!mapVersion}
              className={eraseMode ? 'active' : ''}
            >
              {eraseMode ? 'Stop gummen' : 'Gum modus'}
            </button>

            <button 
              type="button" 
              onClick={() => {
                setSelectionMode((value) => !value)
                setDrawMode(false)
                setEraseMode(false)
              }} 
              disabled={!mapVersion}
              className={selectionMode ? 'active' : ''}
            >
              {selectionMode ? 'Stop selectie' : 'Selectie modus'}
            </button>
          </div>

          {selectionMode && (
            <div className="row">
              <button 
                type="button" 
                onClick={applySelectedToZones} 
                disabled={selectedCells.size === 0}
              >
                Pas toe op {selectedCells.size} cellen
              </button>
              <button 
                type="button" 
                onClick={() => setSelectedCells(new Set())}
              >
                Wis selectie
              </button>
            </div>
          )}

          <div className="row">
            <button 
              type="button" 
              onClick={() => setShowWelcomeModal(true)}
              style={{ marginRight: '0.5rem' }}
            >
              Wissel account
            </button>
            <button 
              type="button" 
              onClick={() => {
                setZoom(savedZoom)
                setOffset(savedOffset)
              }}
              disabled={!mapVersion}
            >
              Ga naar begin positie kaart
            </button>
          </div>

          <div className="row">
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#999' }}>
                Huidge positie: Zoom {zoom.toFixed(2)}x · X: {offset.x.toFixed(0)} · Y: {offset.y.toFixed(0)}
              </p>
            </div>
            <button 
              type="button"
              onClick={saveMapPosition}
              disabled={isSaving || !mapVersion}
            >
              {isSaving ? 'Opslaan...' : 'Sla positie op'}
            </button>
          </div>
        </section>
      )}

      {!isAdminPage && !selectedPlayer && (
        <section className="panel">
          <p>Registreer je account om zones te claimen.</p>
          <button type="button" onClick={() => setShowWelcomeModal(true)}>
            Account
          </button>
        </section>
      )}

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
        Zoom: {zoom.toFixed(2)}x · X: {mousePos.x} · Y: {mousePos.y} · {isSaving ? 'Opslaan...' : message || 'Klaar.'}
        {selectedCells.size > 0 && ` · ${selectedCells.size} cellen geselecteerd`}
      </p>
    </main>
  )
}

export default App
