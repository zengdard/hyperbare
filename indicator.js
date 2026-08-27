import St from 'gi://St'
import Clutter from 'gi://Clutter'

const MAX_VISIBLE_TICKERS = 3

export class IndicatorBar {
    constructor() {
        this.actor = null
        this._labels = {}
    }

    createUI(tickers, showLogos = false) {
        if (!this.actor) {
            this.actor = new St.BoxLayout({
                style: 'spacing: 5px;',
            })
        }
        this.actor.destroy_all_children()
        this._labels = {}

        const visibleTickers = tickers.slice(0, MAX_VISIBLE_TICKERS)

        visibleTickers.forEach(ticker => {
            let itemBox = new St.BoxLayout({
                style_class: 'hl-ticker-box',
                style: 'spacing: 4px;',
            })

            let icon = showLogos
                ? new St.Icon({
                      icon_size: 16,
                      y_align: Clutter.ActorAlign.CENTER,
                  })
                : null
            if (icon) itemBox.add_child(icon)

            let nameLabel = new St.Label({
                text: `${ticker} `,
                y_align: 2,
                style: 'font-weight: bold;',
            })
            let priceLabel = new St.Label({
                text: '—',
                y_align: 2,
                style: 'color: #888;',
            })
            let pctLabel = new St.Label({
                text: '',
                y_align: 2,
            })

            itemBox.add_child(nameLabel)
            itemBox.add_child(priceLabel)
            itemBox.add_child(pctLabel)

            this.actor.add_child(itemBox)

            this._labels[ticker] = {
                icon: icon,
                price: priceLabel,
                pct: pctLabel,
                container: itemBox,
            }
        })
    }

    setIcon(ticker, gicon) {
        const item = this._labels[ticker]
        if (!item || !item.icon || !gicon) return
        item.icon.gicon = gicon
    }

    update(coin, data, isStale = false) {
        const labels = this._labels[coin]
        if (!labels) return

        if (isStale) {
            labels.container.style = 'spacing: 4px; opacity: 0.4;'
            labels.price.set_text('—')
            labels.pct.set_text('')
            return
        }

        labels.container.style = 'spacing: 4px; opacity: 1.0;'

        let p = data.price
        let priceText = p >= 1000 ? `${p.toFixed(0)} USDC` : `${p.toFixed(2)} USDC`
        labels.price.set_text(priceText)
        labels.price.style = 'color: #fff;'

        let arrow = data.pct >= 0 ? '▲' : '▼'
        labels.pct.set_text(`${arrow}${Math.abs(data.pct).toFixed(1)}%`)
        let color = data.pct > 0 ? '#00ff00' : (data.pct < 0 ? '#ff3333' : '#888888')
        labels.pct.style = `color: ${color};`
    }
}
