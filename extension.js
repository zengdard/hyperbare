import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { WsManager } from './wsManager.js';
import { IndicatorBar } from './indicator.js';
import { PanelView } from './panelView.js';

const DESIRED_TICKERS = ['BTC', 'ETH', 'SOL', 'HYPE', 'BRENT', 'XYZ100', 'GOLD'];
const DATA_STALE_THRESHOLD_MS = 30000; // 30 secondes
const UI_UPDATE_THROTTLE_MS = 200; // Max 5 mises à jour par seconde

export default class HyperliquidExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
        this._ws = null;
        this._bar = null;
        this._view = null;
        this._data = {};
        this._lastUpdate = {};
        this._staleCheckId = null;
        this._pendingUpdates = new Set();
        this._updateThrottleId = null;
    }

    enable() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        
        // Barre supérieure (3 premiers tickers)
        this._bar = new IndicatorBar();
        this._indicator.add_child(this._bar.actor);

        // Menu Déroulant
        this._view = new PanelView();
        this._view.initUI(DESIRED_TICKERS);
        this._view.setMenu(this._indicator.menu);
        this._indicator.menu.box.add_child(this._view.box);

        // Initialisation WebSocket
        this._ws = new WsManager((coin, data) => {
            this._onData(coin, data);
        });
        
        this._bar.createUI(DESIRED_TICKERS);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        
        // Démarrage asynchrone du WebSocket
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._ws.start();
            return GLib.SOURCE_REMOVE;
        });
        
        // Timer de vérification des données obsolètes
        this._staleCheckId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 
            5, 
            () => this._checkStaleData()
        );
    }

    _onData(coin, data) {
        log(`[Hyperliquid] _onData received for ${coin}: ${JSON.stringify(data)}`);
        this._data[coin] = data;
        this._lastUpdate[coin] = Date.now();

        // Ajouter à la liste des mises à jour en attente
        this._pendingUpdates.add(coin);

        // Throttle les mises à jour UI
        if (!this._updateThrottleId) {
            this._updateThrottleId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                UI_UPDATE_THROTTLE_MS,
                () => this._processPendingUpdates()
            );
        }
    }

    _processPendingUpdates() {
        // Vérifier que les objets existent toujours
        if (!this._bar || !this._view) {
            this._pendingUpdates.clear();
            this._updateThrottleId = null;
            return GLib.SOURCE_REMOVE;
        }
        
        const now = Date.now();
        
        for (const coin of this._pendingUpdates) {
            const data = this._data[coin];
            const lastUpdate = this._lastUpdate[coin];
            const isStale = !lastUpdate || (now - lastUpdate) > DATA_STALE_THRESHOLD_MS;
            
            this._bar.update(coin, data, isStale);
            this._view.updateData(coin, data, isStale);
        }
        
        this._pendingUpdates.clear();
        this._updateThrottleId = null;
        return GLib.SOURCE_REMOVE;
    }

    _checkStaleData() {
        // Vérifier que les objets existent toujours
        if (!this._bar || !this._view) return GLib.SOURCE_REMOVE;
        
        const now = Date.now();
        
        for (const coin of DESIRED_TICKERS) {
            const lastUpdate = this._lastUpdate[coin];
            const isStale = !lastUpdate || (now - lastUpdate) > DATA_STALE_THRESHOLD_MS;
            
            if (isStale && this._data[coin]) {
                this._bar.update(coin, this._data[coin], true);
                this._view.updateData(coin, this._data[coin], true);
            }
        }
        
        return GLib.SOURCE_CONTINUE;
    }

    disable() {
        if (this._staleCheckId) {
            GLib.source_remove(this._staleCheckId);
            this._staleCheckId = null;
        }
        
        if (this._updateThrottleId) {
            GLib.source_remove(this._updateThrottleId);
            this._updateThrottleId = null;
        }
        
        if (this._ws) this._ws.stop();
        this._indicator?.destroy();
        this._indicator = null;
        this._ws = null;
        this._bar = null;
        this._view = null;
        this._data = {};
        this._lastUpdate = {};
        this._pendingUpdates.clear();
    }
}
