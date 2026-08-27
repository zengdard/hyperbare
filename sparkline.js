import St from 'gi://St'
import Cairo from 'gi://cairo'
import GObject from 'gi://GObject'

const LINE_UP = [0.0, 1.0, 0.0, 1.0]
const LINE_DOWN = [1.0, 0.2, 0.2, 1.0]
const FILL_UP = [0.0, 1.0, 0.0, 0.15]
const FILL_DOWN = [1.0, 0.2, 0.2, 0.15]
const LINE_WIDTH = 1.5
const VERTICAL_PAD = 3

export const Sparkline = GObject.registerClass(
    class Sparkline extends St.DrawingArea {
        _init(params = {}) {
            super._init({
                width: 110,
                height: 26,
                ...params,
            })
            this._history = []
        }

        setHistory(points) {
            this._history = points || []
            this.queue_repaint()
        }

        vfunc_snapshot(snapshot) {
            super.vfunc_snapshot(snapshot)

            if (this._history.length < 2) return

            const box = this.get_allocation_box()
            const width = box.x2 - box.x1
            const height = box.y2 - box.y1
            if (width <= 0 || height <= 0) return

            let min = Infinity
            let max = -Infinity
            for (const p of this._history) {
                if (p < min) min = p
                if (p > max) max = p
            }
            // Évite une division par zéro quand le prix est resté constant
            if (max - min < 1e-12) {
                max += 1e-12
            }

            const points = this._history
            const stepX = width / (points.length - 1)
            const drawH = height - 2 * VERTICAL_PAD
            const toY = price =>
                VERTICAL_PAD + drawH * (1 - (price - min) / (max - min))

            const cr = snapshot.cairo_context()
            const up = points[points.length - 1] >= points[0]
            const line = up ? LINE_UP : LINE_DOWN
            const fill = up ? FILL_UP : FILL_DOWN

            cr.setSourceRGBA(...line)
            cr.setLineWidth(LINE_WIDTH)
            cr.setLineJoin(Cairo.LineJoin.ROUND)
            cr.setLineCap(Cairo.LineCap.ROUND)

            cr.moveTo(0, toY(points[0]))
            for (let i = 1; i < points.length; i++) {
                cr.lineTo(i * stepX, toY(points[i]))
            }
            cr.stroke()

            // Remplissage dégradé sous la courbe
            const lastX = (points.length - 1) * stepX
            cr.lineTo(lastX, height)
            cr.lineTo(0, height)
            cr.closePath()

            const gradient = new Cairo.LinearGradient(0, VERTICAL_PAD, 0, height)
            gradient.addColorStopRGBA(0, ...fill)
            gradient.addColorStopRGBA(1, 0, 0, 0, 0)
            cr.setSource(gradient)
            cr.fill()
        }
    }
)
