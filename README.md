# OVERBOOST — Car Football Arena

![OVERBOOST](public/menu-bg.jpg)

**Juega en el navegador:** https://overboost-kappa.vercel.app

Juego 3D original de fútbol con coches para navegador. Modo un jugador centrado en entrenamiento libre.

```bash
npm install
npm run dev      # http://localhost:5195
npm run build    # build de producción en dist/
```

**Stack:** React 18 + Vite + TypeScript · Three.js (render, PBR, bloom) · Rapier3D (física a 120 Hz con interpolación) · Zustand · Web Audio API (todo el audio es sintetizado) · Gamepad API.

## Contenido
- **2 coches originales modelados por código**: Car 1 · VÓRTICE (compacto, aéreo) y Car 2 · MAKO (cuña larga, pegada).
- **Balón** de paneles hexagonales/pentagonales generado por shader, con collider físico real.
- **Arena cerrada** con transiciones curvas suelo-pared-techo, porterías funcionales, gradas con público, focos, pantallas, fuegos artificiales y 34 pads de turbo.
- **Física del coche**: suspensión por raycast en 4 ruedas, agarre lateral, derrape, turbo, salto variable, doble salto, flips (frontal/trasero/lateral), air roll, control aéreo, conducción por paredes y techo con gravedad adaptativa.
- **Cámaras**: seguimiento y cámara balón, órbita con stick derecho / arrastre de ratón, colisión con la arena, FOV por velocidad, temblor.
- **Menús**: principal, entrenamiento libre (turbo infinito, cámara lenta, pases), garaje 3D con pinturas, ajustes (gráficos, audio, controles remapeables, cámara), pausa, HUD.

## Controles por defecto
| Acción | Teclado | DualSense |
|---|---|---|
| Acelerar / frenar | W / S | R2 / L2 (analógicos) |
| Girar / control aéreo | A / D (+ W/S cabeceo) | Stick izq. |
| Saltar / doble salto / flip | Espacio | ✕ |
| Turbo | Shift izq. | ○ |
| Derrape / air roll | Ctrl izq. | □ |
| **Free air roll en el aire** | Ctrl izq. | **L2** (stick ←→ rueda, ↑↓ cabeceo) |
| Air roll izquierda / derecha | Q / E | L1 / — |
| Cámara balón | C | △ |
| Menú de reinicio (entreno) | T | **R1** |
| Balón quieto delante del coche | F | **D-pad ↓** |
| Congelar balón / recargar turbo | G / V | (reasignable) |
| Reset coche / balón | R / B | Create / (menú R1) |
| Depuración de física | F3 | — |
| Pausa | Esc | Options |

## Física
- Configuración centralizada en `src/core/config.ts` (`STANDARD_PHYS` = referencia, `PHYS` = valores vivos, `PRESETS`).
- Paso fijo 120 Hz con interpolación de render (independiente de los FPS).
- Pruebas de calibración: en la consola del navegador `await __tests.run()` (24 escenarios: aceleración, frenada, giro, derrape, saltos, flips, flip cancel, free air roll, paredes, techo, balón, goles, flip reset, colocación del balón, guardar/volver).
