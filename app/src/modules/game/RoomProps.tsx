import { useMemo } from 'react'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { arenaFrame, type ArenaConfig } from './arena'
import { roomFrame } from './DoorRoom'
import { PERKS, WEAPONS, type PerkId } from './weapons'
import { buildBackWall, type BackWallConfig } from './RoomBackWall'

/**
 * Crisp replacements for scanned props that splats can't hold up close: perk vending
 * machines, the trader sign, the price board, and a barricade across the kitchen arch.
 * Positions are room-local (photo camera at origin, looking down -z).
 */
export interface RoomPropsConfig {
  machines?: { perk: PerkId; at: [number, number, number]; rotY?: number }[]
  sign?: { at: [number, number, number]; size: [number, number]; rotY?: number }
  board?: { at: [number, number, number]; size: [number, number]; rotY?: number }
  arch?: { at: [number, number, number]; width: number; height: number; rotY: number }
  backWall?: BackWallConfig
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function machineTextures(perk: PerkId) {
  const p = PERKS[perk]
  const draw = (ctx: CanvasRenderingContext2D, glowOnly: boolean) => {
    const W = 512
    const H = 1180
    ctx.fillStyle = glowOnly ? '#000' : p.color
    ctx.fillRect(0, 0, W, H)
    if (!glowOnly) {
      // Worn paint + rust streaks.
      for (let i = 0; i < 220; i++) {
        ctx.fillStyle = `rgba(${40 + Math.random() * 40},${20 + Math.random() * 20},10,${Math.random() * 0.25})`
        ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 18, 2 + Math.random() * 40)
      }
    }
    // Neon name panel.
    ctx.fillStyle = glowOnly ? '#000' : '#1b0e0a'
    ctx.fillRect(30, 30, W - 60, 230)
    ctx.textAlign = 'center'
    ctx.shadowColor = p.label
    ctx.shadowBlur = 24
    ctx.fillStyle = p.label
    const words = p.name.split(' ')
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [p.name]
    ctx.font = `bold ${lines.length > 1 ? 62 : 78}px Georgia, serif`
    lines.forEach((l, i) => ctx.fillText(l, W / 2, (lines.length > 1 ? 120 : 160) + i * 78))
    ctx.font = 'italic 30px Georgia, serif'
    ctx.fillText('Cape Town · est. 1652', W / 2, 245)
    ctx.shadowBlur = 0
    // Lit bottle window.
    ctx.fillStyle = glowOnly ? '#3a2a10' : '#2a1c10'
    ctx.fillRect(70, 300, 300, 600)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 95 + col * 70
        const y = 330 + row * 145
        const grd = ctx.createLinearGradient(x, y, x, y + 110)
        grd.addColorStop(0, '#ffe1a0')
        grd.addColorStop(1, p.color)
        ctx.fillStyle = grd
        ctx.fillRect(x + 10, y + 30, 32, 80)
        ctx.fillRect(x + 20, y, 12, 34)
        ctx.fillStyle = p.label
        ctx.fillRect(x + 10, y + 60, 32, 18)
      }
    }
    // Coin slot / buttons / price.
    ctx.fillStyle = glowOnly ? '#000' : '#202020'
    ctx.fillRect(395, 320, 80, 260)
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = glowOnly ? '#553' : '#c9a227'
      ctx.beginPath()
      ctx.arc(435, 360 + i * 55, 16, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = glowOnly ? '#000' : '#f4efe6'
    ctx.fillRect(80, 950, 350, 110)
    ctx.fillStyle = glowOnly ? '#000' : '#1a1a1a'
    ctx.font = 'bold 54px monospace'
    ctx.fillText(`R${p.price.toLocaleString('en-ZA')}`, 255, 1025)
    ctx.fillStyle = glowOnly ? '#000' : '#111'
    ctx.fillRect(140, 1090, 230, 60)
  }
  return {
    map: canvasTex(512, 1180, (c) => draw(c, false)),
    emissive: canvasTex(512, 1180, (c) => draw(c, true)),
  }
}

function signTexture(w: number, h: number) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#3b2617'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.15})`
      ctx.fillRect(0, (i * h) / 9, w, 3)
    }
    // Table Mountain silhouette.
    ctx.fillStyle = 'rgba(230,215,190,0.85)'
    ctx.beginPath()
    ctx.moveTo(w * 0.28, h * 0.36)
    ctx.lineTo(w * 0.36, h * 0.16)
    ctx.lineTo(w * 0.64, h * 0.14)
    ctx.lineTo(w * 0.72, h * 0.36)
    ctx.closePath()
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#efe3cc'
    ctx.font = `bold ${h * 0.34}px Georgia, serif`
    ctx.fillText('SURVIVOR TRADER', w / 2, h * 0.7)
    ctx.font = `${h * 0.15}px Georgia, serif`
    ctx.fillText('WEAPONS  ·  AMMO  ·  SUPPLIES', w / 2, h * 0.9)
  })
}

function boardTexture(w: number, h: number) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#141414'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#5a4630'
    ctx.lineWidth = 18
    ctx.strokeRect(9, 9, w - 18, h - 18)
    ctx.fillStyle = '#f2f2f2'
    ctx.font = `bold ${h * 0.09}px monospace`
    ctx.fillText('SHOP', w * 0.12, h * 0.13)
    const rows: [string, string][] = [
      ...(['magnum', 'shotgun', 'mg', 'sniper'] as const).map((id) => [({ magnum: 'magnum', shotgun: 'shotgun', mg: 'AK-47', sniper: 'sniper' } as const)[id], `R${WEAPONS[id].price.toLocaleString('en-ZA')}`] as [string, string]),
      ['ammo', 'R250-350'],
      [PERKS.rooibos.name, `R${PERKS.rooibos.price.toLocaleString('en-ZA')}`],
      ['Mtn Tonic', `R${PERKS.tonic.price.toLocaleString('en-ZA')}`],
    ]
    ctx.font = `${Math.min(h * 0.055, w * 0.085)}px monospace`
    rows.forEach(([n, p], i) => {
      const y = h * (0.26 + i * 0.1)
      ctx.fillStyle = '#e8e8e8'
      ctx.textAlign = 'left'
      ctx.fillText(n, w * 0.08, y)
      ctx.textAlign = 'right'
      ctx.fillStyle = '#ffd27a'
      ctx.fillText(p, w * 0.92, y)
    })
  })
}

function archTexture(w: number, h: number) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = '#0d0b0a'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#c9a227'
    ctx.font = `bold ${h * 0.08}px Impact, sans-serif`
    ctx.textAlign = 'center'
    ctx.fillText('INFECTED · NO ENTRY', w / 2, h * 0.44)
    ctx.fillStyle = '#8a1010'
    ctx.font = `bold ${h * 0.05}px Impact, sans-serif`
    ctx.fillText('KITCHEN SEALED', w / 2, h * 0.52)
  })
}

export function RoomProps({ arena, props }: { arena: ArenaConfig; props: RoomPropsConfig }) {
  const room = useMemo(() => roomFrame(arenaFrame(arena)), [arena])
  const built = useMemo(() => {
    const g = new THREE.Group()
    const metal = new THREE.MeshStandardMaterial({ color: '#2b2b2b', metalness: 0.6, roughness: 0.5 })
    for (const m of props.machines ?? []) {
      const t = machineTextures(m.perk)
      const p = PERKS[m.perk]
      const machine = new THREE.Group()
      machine.position.set(...m.at)
      machine.rotation.y = m.rotY ?? 0
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.95, 0.72), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55, metalness: 0.25 }))
      body.position.y = 0.975
      const front = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 1.84),
        new THREE.MeshStandardMaterial({ map: t.map, emissiveMap: t.emissive, emissive: '#ffffff', emissiveIntensity: 1.8, roughness: 0.35 }),
      )
      front.position.set(0, 0.97, 0.362)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.76), metal)
      cap.position.y = 1.99
      const glow = new THREE.PointLight(p.color, 6, 3.5, 2)
      glow.position.set(0, 1.4, 0.6)
      machine.add(body, front, cap, glow)
      g.add(machine)
    }
    if (props.sign) {
      const [w, h] = props.sign.size
      const sign = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), [metal, metal, metal, metal,
        new THREE.MeshStandardMaterial({ map: signTexture(1024, Math.round((1024 * h) / w)), roughness: 0.8 }), metal])
      sign.position.set(...props.sign.at)
      sign.rotation.y = props.sign.rotY ?? 0
      g.add(sign)
    }
    if (props.board) {
      const [w, h] = props.board.size
      const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), [metal, metal, metal, metal,
        new THREE.MeshStandardMaterial({ map: boardTexture(600, Math.round((600 * h) / w)), emissive: '#222', roughness: 0.9 }), metal])
      board.position.set(...props.board.at)
      board.rotation.y = props.board.rotY ?? 0
      g.add(board)
    }
    if (props.arch) {
      // Local frame: opening centred on x = 0, floor at y = 0, room side is +z.
      const { at, width: w, height, rotY } = props.arch
      const arch = new THREE.Group()
      arch.position.set(...at)
      arch.rotation.y = rotY
      let seed = 7
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, height), new THREE.MeshStandardMaterial({ map: archTexture(1024, Math.round((1024 * height) / (w + 0.6))), roughness: 1 }))
      back.position.set(0, height / 2, -0.25)
      arch.add(back)
      const wood = ['#5a3d26', '#6b4a2e', '#4a3220', '#7a5634'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }))
      for (let i = 0; i < 9; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.18, 0.045), wood[i % 4])
        plank.position.set((rnd() - 0.5) * 0.15, 0.55 + (i / 8) * (height - 1.0), 0.02 + i * 0.004)
        plank.rotation.z = (rnd() - 0.5) * 0.5
        arch.add(plank)
      }
      const sack = new THREE.MeshStandardMaterial({ color: '#8b7a5a', roughness: 1 })
      const n = Math.floor(w / 0.55)
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < n - (row % 2); k++) {
          const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.36, 4, 8), sack)
          bag.rotation.z = Math.PI / 2
          bag.position.set(-((n - 1) * 0.55) / 2 + k * 0.55 + (row % 2) * 0.27, 0.16 + row * 0.28, 0.32)
          arch.add(bag)
        }
      }
      g.add(arch)
    }
    if (props.backWall) g.add(buildBackWall(props.backWall))
    g.traverse((o) => {
      o.raycast = () => {}
    })
    return g
  }, [props])

  return (
    <group position={room.center}>
      <primitive object={built} />
      <RigidBody type="fixed" colliders={false} userData={{ noDecal: true }}>
        {(props.machines ?? []).map((m, i) => (
          <CuboidCollider key={i} args={[0.43, 1, 0.36]} position={[m.at[0], m.at[1] + 1, m.at[2]]} rotation={[0, m.rotY ?? 0, 0]} />
        ))}
        {props.arch && (
          <CuboidCollider args={[props.arch.width / 2 + 0.3, props.arch.height / 2, 0.35]} rotation={[0, props.arch.rotY, 0]}
            position={[props.arch.at[0], props.arch.at[1] + props.arch.height / 2, props.arch.at[2]]} />
        )}
        {props.backWall && (
          <CuboidCollider args={[props.backWall.width / 2, props.backWall.height / 2, 0.15]} rotation={[0, props.backWall.rotY, 0]}
            position={[
              props.backWall.at[0] - Math.sin(props.backWall.rotY) * 0.1,
              props.backWall.at[1] + props.backWall.height / 2,
              props.backWall.at[2] - Math.cos(props.backWall.rotY) * 0.1,
            ]} />
        )}
      </RigidBody>
    </group>
  )
}
