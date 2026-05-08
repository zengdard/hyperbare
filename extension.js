import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ApiManager } from './apiManager.js';
import { WsManager } from './wsManager.js';
import { IndicatorBar } from './indicator.js';
import { PanelView } from './panelView.js';

const DESIRED_TICKERS = ['BTC', 'ETH', 'SOL', 'HYPE', 'BRENT', 'XYZ100', 'GOLD'];
const DATA_STALE_THRESHOLD_MS = 30000;
const UI_UPDATE_THROTTLE_MS = 200;

const DEFAULT_TICKERS_BY_DEX = {
    default: ['BTC', 'ETH', 'SOL', 'HYPE'],
    xyz: ['xyz:CL', 'xyz:XYZ100', 'xyz:GOLD']
}

const DEFAULT_DISPLAY_NAMES = {
    'BTC': 'BTC',
    'ETH': 'ETH',
    'SOL': 'SOL',
    'HYPE': 'HYPE',
    'xyz:CL': 'BRENT',
    'xyz:XYZ100': 'XYZ100',
    'xyz:GOLD': 'GOLD'
}

const SPOT_DISPLAY_OVERRIDES = {
    'CL': 'BRENT'
}

export default class HyperliquidExtension extends Extension {
    constructor(metadata) {
        super(metadata)
        this._indicator = null
        this._ws = null
        this._bar = null
        this._view = null
        this._api = null
        this._data = {}
        this._lastUpdate = {}
        this._staleCheckId = null
        this._initIdleId = null
        this._pendingUpdates = new Set()
        this._updateThrottleId = null
    }

    enable() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false)

        this._bar = new IndicatorBar()
        this._bar.actor = new St.BoxLayout({ style: 'spacing: 5px;' })
        this._indicator.add_child(this._bar.actor)

        this._view = new PanelView()
        this._view.box = new St.BoxLayout({
            vertical: true,
            style: 'padding: 15px; spacing: 12px;'
        })
        this._view.setMenu(this._indicator.menu)
        this._indicator.menu.box.add_child(this._view.box)

        Main.panel.addToStatusArea(this.uuid, this._indicator)

        this._initIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._fetchMetadataAndInit()
            this._initIdleId = null
            return GLib.SOURCE_REMOVE
        })

        this._staleCheckId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 5,
            () => this._checkStaleData()
        )
    }

    _fetchMetadataAndInit() {
        this._api = new ApiManager()
        let perpsResult = null
        let spotResult = null
        let perpsDone = false
        let spotDone = false

        const onComplete = () => {
            if (perpsDone && spotDone) {
                if (perpsResult === null && spotResult === null) {
                    this._initWithDefaults()
                } else {
                    this._initWithMetadata(perpsResult, spotResult)
                }
                if (this._api) {
                    this._api.destroy()
                    this._api = null
                }
            }
        }

        this._api.fetchPerpsMeta((err, data) => {
            if (err) {
                logError(err, 'Failed to fetch perps metadata')
            } else {
                perpsResult = data
            }
            perpsDone = true
            onComplete()
        })

        this._api.fetchSpotMeta((err, data) => {
            if (err) {
                logError(err, 'Failed to fetch spot metadata')
            } else {
                spotResult = data
            }
            spotDone = true
            onComplete()
        })
    }

    _initWithMetadata(perpsMeta, spotMeta) {
        const { tickersByDex, displayNames } = this._buildAssetList(
            perpsMeta || { universe: [] },
            spotMeta || { universe: [], tokens: [] }
        )
        this._setupTickers(tickersByDex, displayNames)
    }

    _initWithDefaults() {
        this._setupTickers(DEFAULT_TICKERS_BY_DEX, DEFAULT_DISPLAY_NAMES)
    }

    _buildAssetList(perpsMeta, spotMeta) {
        const tickersByDex = { default: [], xyz: [] }
        const displayNames = {}

        const perpNames = new Set((perpsMeta.universe || []).map(u => u.name))
        const spotUniverse = spotMeta.universe || []
        const spotTokenNames = new Set(spotUniverse.map(u => u.name))

        for (const ticker of DESIRED_TICKERS) {
            if (perpNames.has(ticker)) {
                tickersByDex.default.push(ticker)
                displayNames[ticker] = ticker
            }
        }

        for (const spotName of spotTokenNames) {
            const displayName = SPOT_DISPLAY_OVERRIDES[spotName] || spotName
            if (DESIRED_TICKERS.includes(displayName)) {
                const subKey = 'xyz:' + spotName
                tickersByDex.xyz.push(subKey)
                displayNames[subKey] = displayName
            }
        }

        for (const ticker of DESIRED_TICKERS) {
            const alreadyAdded = Object.values(displayNames).includes(ticker)
            if (!alreadyAdded) {
                tickersByDex.default.push(ticker)
                displayNames[ticker] = ticker
            }
        }

        return { tickersByDex, displayNames }
    }

    _setupTickers(tickersByDex, displayNames) {
        const allDisplayNames = [...new Set(Object.values(displayNames))]

        this._bar.createUI(allDisplayNames)
        this._view.initUI(allDisplayNames)

        this._ws = new WsManager((coin, data) => {
            this._onData(coin, data)
        })
        this._ws.start(tickersByDex, displayNames)
    }

    _onData(coin, data) {
        this._data[coin] = data
        this._lastUpdate[coin] = Date.now()

        this._pendingUpdates.add(coin)

        if (!this._updateThrottleId) {
            this._updateThrottleId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                UI_UPDATE_THROTTLE_MS,
                () => this._processPendingUpdates()
            )
        }
    }

    _processPendingUpdates() {
        if (!this._bar || !this._view) {
            this._pendingUpdates.clear()
            this._updateThrottleId = null
            return GLib.SOURCE_REMOVE
        }

        const now = Date.now()

        for (const coin of this._pendingUpdates) {
            const data = this._data[coin]
            const lastUpdate = this._lastUpdate[coin]
            const isStale = !lastUpdate || (now - lastUpdate) > DATA_STALE_THRESHOLD_MS

            this._bar.update(coin, data, isStale)
            this._view.updateData(coin, data, isStale)
        }

        this._pendingUpdates.clear()
        this._updateThrottleId = null
        return GLib.SOURCE_REMOVE
    }

    _checkStaleData() {
        if (!this._bar || !this._view) return GLib.SOURCE_REMOVE

        const now = Date.now()

        for (const coin of DESIRED_TICKERS) {
            const lastUpdate = this._lastUpdate[coin]
            const isStale = !lastUpdate || (now - lastUpdate) > DATA_STALE_THRESHOLD_MS

            if (isStale && this._data[coin]) {
                this._bar.update(coin, this._data[coin], true)
                this._view.updateData(coin, this._data[coin], true)
            }
        }

        return GLib.SOURCE_CONTINUE
    }

    disable() {
        if (this._initIdleId) {
            GLib.source_remove(this._initIdleId)
            this._initIdleId = null
        }

        if (this._staleCheckId) {
            GLib.source_remove(this._staleCheckId)
            this._staleCheckId = null
        }

        if (this._updateThrottleId) {
            GLib.source_remove(this._updateThrottleId)
            this._updateThrottleId = null
        }

        if (this._ws) {
            this._ws.stop()
            this._ws = null
        }

        if (this._api) {
            this._api.destroy()
            this._api = null
        }

        if (this._indicator) {
            this._indicator.destroy()
            this._indicator = null
        }

        if (this._bar) {
            if (this._bar.actor) {
                this._bar.actor.destroy()
            }
            this._bar = null
        }

        if (this._view) {
            if (this._view.box) {
                this._view.box.destroy()
            }
            this._view = null
        }

        this._data = {}
        this._lastUpdate = {}
        this._pendingUpdates.clear()
    }
}
