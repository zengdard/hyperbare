import St from 'gi://St';

const MAX_VISIBLE_TICKERS = 3;

export class IndicatorBar {
    constructor() {
        this.actor = null;
        this._labels = {};
    }

    createUI(tickers) {
        if (!this.actor) {
            this.actor = new St.BoxLayout({
                style: 'spacing: 5px;'
            });
        }
        this.actor.destroy_all_children();
        this._labels = {};
        
        // Afficher seulement les 3 premiers tickers
        const visibleTickers = tickers.slice(0, MAX_VISIBLE_TICKERS);
        
        visibleTickers.forEach(ticker => {
            let itemBox = new St.BoxLayout({ 
                style_class: 'hl-ticker-box', 
                style: 'spacing: 4px;'
            });
            
            let nameLabel = new St.Label({ 
                text: `${ticker} `, 
                y_align: 2, 
                style: 'font-weight: bold;' 
            });
            let priceLabel = new St.Label({ 
                text: '—', 
                y_align: 2,
                style: 'color: #888;'
            });
            let pctLabel = new St.Label({ 
                text: '', 
                y_align: 2 
            });

            itemBox.add_child(nameLabel);
            itemBox.add_child(priceLabel);
            itemBox.add_child(pctLabel);
            
            this.actor.add_child(itemBox);
            
            this._labels[ticker] = { 
                price: priceLabel, 
                pct: pctLabel, 
                container: itemBox
            };
        });
    }

    update(coin, data, isStale = false) {
        const labels = this._labels[coin];
        if (!labels) return;
        
        if (isStale) {
            labels.container.style = 'spacing: 4px; opacity: 0.4;';
            labels.price.set_text('—');
            labels.pct.set_text('');
            return;
        }
        
        labels.container.style = 'spacing: 4px; opacity: 1.0;';

        let p = data.price;
        let priceText = p >= 1000 ? `${p.toFixed(0)} USDC` : `${p.toFixed(2)} USDC`;
        labels.price.set_text(priceText);
        labels.price.style = 'color: #fff;';

        let arrow = data.pct >= 0 ? "▲" : "▼";
        labels.pct.set_text(`${arrow}${Math.abs(data.pct).toFixed(1)}%`);
        let color = data.pct > 0 ? '#00ff00' : (data.pct < 0 ? '#ff3333' : '#888888');
        labels.pct.style = `color: ${color};`;
    }
}
