import St from 'gi://St';

export class PanelView {
    constructor() {
        this.box = null;
        this._items = {};
        this._menu = null;
    }

    setMenu(menu) {
        this._menu = menu;
    }

    updateData(coin, data, isStale = false) {
        if (!this._items[coin]) return;

        const item = this._items[coin];
        
        try {
            if (!item.row || item.row.get_parent() === null) return;
            if (!item.priceLabel || item.priceLabel.get_parent() === null) return;
            if (!item.pctLabel || item.pctLabel.get_parent() === null) return;
            if (!item.fundLabel || item.fundLabel.get_parent() === null) return;
        } catch (e) {
            return;
        }
        
        if (isStale) {
            item.row.style = 'spacing: 15px; align: center; opacity: 0.4;';
            item.priceLabel.set_text('—');
            item.pctLabel.set_text('');
            item.fundLabel.set_text('');
            return;
        }
        
        item.row.style = 'spacing: 15px; align: center; opacity: 1.0;';

        let p = data.price;
        let priceText = p >= 1000 ? `${p.toFixed(0)} USDC` : `${p.toFixed(2)} USDC`;
        item.priceLabel.set_text(priceText);

        let arrow = data.pct >= 0 ? "▲" : "▼";
        item.pctLabel.set_text(`${arrow}${Math.abs(data.pct).toFixed(1)}%`);
        let color = data.pct > 0 ? '#00ff00' : (data.pct < 0 ? '#ff3333' : '#888888');
        item.pctLabel.style = `color: ${color}; font-weight: bold;`;

        // Funding
        let f = data.funding;
        let fundPct = f * 100;
        let fundText = `[${fundPct >= 0 ? '+' : ''}${fundPct.toFixed(4)}%]`;
        item.fundLabel.set_text(fundText);
        let fColor = fundPct >= 0 ? '#66ff66' : '#ff6666';
        item.fundLabel.style = `color: ${fColor}; font-size: 0.9em; font-family: monospace;`;
    }

    initUI(tickers) {
        if (!this.box) {
            this.box = new St.BoxLayout({
                vertical: true,
                style: 'padding: 15px; spacing: 12px;'
            });
        }
        this.box.destroy_all_children();
        this._items = {};
        
        // En-tête avec colonnes
        let headerRow = new St.BoxLayout({ 
            style: 'spacing: 15px; align: center; padding-bottom: 8px; border-bottom: 1px solid #444;'
        });
        
        let headerName = new St.Label({ 
            text: 'Asset', 
            width: 70,
            style: 'font-weight: bold; color: #aaa; font-size: 11px;'
        });
        let headerPrice = new St.Label({ 
            text: 'Price', 
            width: 100,
            style: 'font-weight: bold; color: #aaa; font-size: 11px;'
        });
        let headerPct = new St.Label({ 
            text: '24h', 
            width: 70,
            style: 'font-weight: bold; color: #aaa; font-size: 11px;'
        });
        let headerFund = new St.Label({ 
            text: 'Funding', 
            width: 90,
            style: 'font-weight: bold; color: #aaa; font-size: 11px;'
        });
        
        headerRow.add_child(headerName);
        headerRow.add_child(headerPrice);
        headerRow.add_child(headerPct);
        headerRow.add_child(headerFund);
        
        this.box.add_child(headerRow);

        let list = new St.BoxLayout({ vertical: true, style: 'spacing: 8px; padding-top: 8px;' });
        
        tickers.forEach(coin => {
            let row = new St.BoxLayout({ 
                style: 'spacing: 15px; align: center; opacity: 0.4;'
            });
            
            let name = new St.Label({ 
                text: coin, 
                width: 70,
                style: 'font-weight: bold; color: #fff; font-size: 13px;'
            });
            
            let priceL = new St.Label({ 
                text: '—', 
                width: 100,
                style: 'color: #ccc; font-size: 13px; font-family: monospace;'
            });
            
            let pctL = new St.Label({ 
                text: '', 
                width: 70,
                style: 'font-size: 13px;'
            });
            
            let fundL = new St.Label({ 
                text: '', 
                width: 90,
                style: 'font-size: 12px; font-family: monospace;'
            });

            row.add_child(name);
            row.add_child(priceL);
            row.add_child(pctL);
            row.add_child(fundL);
            
            list.add_child(row);
            this._items[coin] = { 
                priceLabel: priceL, 
                pctLabel: pctL,
                fundLabel: fundL,
                row: row
            };
        });

        this.box.add_child(list);
    }
}