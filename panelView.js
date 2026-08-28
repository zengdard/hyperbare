import St from 'gi://St'
import Clutter from 'gi://Clutter'

import { Sparkline } from './sparkline.js'

const NAME_W = 90
const PRICE_W = 100
const PCT_W = 70
const FUND_W = 90
const SPARK_W = 110
const SPARK_H = 26

export class PanelView {
    constructor() {
        this.box = null
        this._items = {}
        this._menu = null
    }

    setMenu(menu) {
        this._menu = menu
    }

    updateData(coin, data, isStale = false) {
        const item = this._items[coin]
        if (!item) return

        if (isStale) {
            item.row.style = 'spacing: 15px; align: center; opacity: 0.4;'
            item.priceLabel.set_text('—')
            item.pctLabel.set_text('')
            item.fundLabel.set_text('')
            return
        }

        item.row.style = 'spacing: 15px; align: center; opacity: 1.0;'

        let p = data.price
        let priceText = p >= 1000 ? `${p.toFixed(0)} USDC` : `${p.toFixed(2)} USDC`
        item.priceLabel.set_text(priceText)

        let arrow = data.pct >= 0 ? '▲' : '▼'
        item.pctLabel.set_text(`${arrow}${Math.abs(data.pct).toFixed(1)}%`)
        let color = data.pct > 0 ? '#00ff00' : (data.pct < 0 ? '#ff3333' : '#888888')
        item.pctLabel.style = `color: ${color}; font-weight: bold;`

        let f = data.funding
        let fundPct = f * 100
        let fundText = `[${fundPct >= 0 ? '+' : ''}${fundPct.toFixed(4)}%]`
        item.fundLabel.set_text(fundText)
        let fColor = fundPct >= 0 ? '#66ff66' : '#ff6666'
        item.fundLabel.style = `color: ${fColor}; font-size: 0.9em; font-family: monospace;`
    }

    updateSparkline(coin, history) {
        const item = this._items[coin]
        if (!item) return
        item.sparkline.setHistory(history || [])
    }

    setIcon(coin, gicon) {
        const item = this._items[coin]
        if (!item || !item.icon || !gicon) return
        item.icon.gicon = gicon
    }

    initUI(tickers, showLogos = false) {
        if (!this.box) {
            this.box = new St.BoxLayout({
                vertical: true,
                style: 'padding: 15px; spacing: 12px;',
            })
        }
        this.box.destroy_all_children()
        this._items = {}

        let headerRow = new St.BoxLayout({
            style: 'spacing: 15px; align: center; padding-bottom: 8px; border-bottom: 1px solid #444;',
        })

        headerRow.add_child(this._headerLabel('Asset', NAME_W))
        headerRow.add_child(this._headerLabel('Price', PRICE_W))
        headerRow.add_child(this._headerLabel('24h', PCT_W))
        headerRow.add_child(this._headerLabel('Funding', FUND_W))
        headerRow.add_child(this._headerLabel('Trend', SPARK_W))

        this.box.add_child(headerRow)

        let list = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding-top: 8px;' })

        tickers.forEach(coin => {
            let row = new St.BoxLayout({
                style: 'spacing: 15px; align: center; opacity: 0.4;',
            })

            let nameBox = new St.BoxLayout({
                style: `spacing: 6px; min-width: ${NAME_W}px;`,
            })
            let icon = showLogos ? new St.Icon({ icon_size: 16 }) : null
            if (icon) nameBox.add_child(icon)
            let name = new St.Label({
                text: coin,
                y_align: Clutter.ActorAlign.CENTER,
                style: `font-weight: bold; color: #fff; font-size: 13px;`,
            })
            nameBox.add_child(name)

            let priceL = new St.Label({
                text: '—',
                y_align: Clutter.ActorAlign.CENTER,
                style: `color: #ccc; font-size: 13px; font-family: monospace; min-width: ${PRICE_W}px;`,
            })
            let pctL = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
                style: `font-size: 13px; min-width: ${PCT_W}px;`,
            })
            let fundL = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
                style: `font-size: 12px; font-family: monospace; min-width: ${FUND_W}px;`,
            })
            let sparkline = new Sparkline({
                width: SPARK_W,
                height: SPARK_H,
            })

            row.add_child(nameBox)
            row.add_child(priceL)
            row.add_child(pctL)
            row.add_child(fundL)
            row.add_child(sparkline)

            list.add_child(row)
            this._items[coin] = {
                icon: icon,
                priceLabel: priceL,
                pctLabel: pctL,
                fundLabel: fundL,
                sparkline: sparkline,
                row: row,
            }
        })

        this.box.add_child(list)
    }

    _headerLabel(text, width) {
        return new St.Label({
            text,
            y_align: Clutter.ActorAlign.CENTER,
            style: `font-weight: bold; color: #aaa; font-size: 11px; min-width: ${width}px;`,
        })
    }
}
