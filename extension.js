import St from 'gi://St'
import GLib from 'gi://GLib'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

import { ApiManager } from './apiManager.js'
import { WsManager } from './wsManager.js'
import { IndicatorBar } from './indicator.js'
import { PanelView } from './panelView.js'
import { IconManager } from './iconManager.js'
import { loadConfig, monitorConfig } from './config.js'

const DATA_STALE_THRESHOLD_MS = 30000
const UI_UPDATE_THROTTLE_MS = 200
const MAX_HISTORY = 240
const CONFIG_DEBOUNCE_MS = 500

const DEFAULT_TICKERS_BY_DEX = {
    default: ['BTC', 'ETH', 'SOL', 'HYPE'],
    xyz: ['xyz:CL', 'xyz:XYZ100', 'xyz:GOLD'],
}

const DEFAULT_DISPLAY_NAMES = {
    'BTC': 'BTC',
    'ETH': 'ETH',
    'SOL': 'SOL',
    'HYPE': 'HYPE',
    'xyz:CL': 'BRENT',
    'xyz:XYZ100': 'XYZ100',
    'xyz:GOLD': 'GOLD',
}

const SPOT_DISPLAY_OVERRIDES = {
    'CL': 'BRENT',
}

export default class HyperliquidExtension extends Extension {
    constructor(metadata) {
        super(metadata)
        this._indicator = null
        this._ws = null
        this._bar = null
        this._view = null
        this._api = null
        this._icons = null
        this._data = {}
        this._lastUpdate = {}
        this._history = {}
        this._displayNames = {}
        this._config = null
        this._configMonitor = null
        this._configDebounceId = null
        this._reinitializing = false
        this._staleCheckId = null
        this._initIdleId = null
        this._pendingUpdates = new Set()
        this._updateThrottleId = null
        this._barBox = null
        this._viewBox = null
    }

    enable() {
        this._config = loadConfig()
        this._icons = new IconManager()

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false)

        this._bar = new IndicatorBar()
        this._barBox = new St.BoxLayout({ style: 'spacing: 5px;' })
        this._bar.actor = this._barBox
        this._indicator.add_child(this._barBox)

        this._view = new PanelView()
        this._viewBox = new St.BoxLayout({
            vertical: true,
            style: 'padding: 15px; spacing: 12px;',
        })
        this._view.box = this._viewBox
        this._view.setMenu(this._indicator.menu)
        this._indicator.menu.box.add_child(this._viewBox)

        Main.panel.addToStatusArea(this.uuid, this._indicator)

        this._configMonitor = monitorConfig(() => this._onConfigChanged())

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

    _onConfigChanged() {
        // Le monitor peut émettre plusieurs fois pour une seule écriture
        if (this._configDebounceId) {
            GLib.source_remove(this._configDebounceId)
        }
        this._configDebounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, CONFIG_DEBOUNCE_MS,
            () => {
                this._configDebounceId = null
                this._applyConfigChange()
                return GLib.SOURCE_REMOVE
            }
        )
    }

    _applyConfigChange() {
        const newConfig = loadConfig()
        const tickersChanged =
            newConfig.tickers.join(',') !== this._config.tickers.join(',')

        this._config = newConfig

        if (this._reinitializing || !this._indicator) return

        if (!tickersChanged) {
            // Seul l'affichage des logos a changé : on reconstruit l'UI avec
            // les données existantes, sans toucher au WebSocket
            this._rebuildUI()
            return
        }

        this._reinitializing = true

        if (this._ws) {
            this._ws.stop()
            this._ws = null
        }

        this._initIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._initIdleId = null
            this._fetchMetadataAndInit(() => {
                this._reinitializing = false
            })
            return GLib.SOURCE_REMOVE
        })
    }

    _rebuildUI() {
        const allDisplayNames = [...new Set(Object.values(this._displayNames))]
        this._bar.createUI(allDisplayNames, this._config.showLogos)
        this._view.initUI(allDisplayNames, this._config.showLogos)

        for (const coin of allDisplayNames) {
            this._applyIcon(coin)
            const data = this._data[coin]
            if (data) {
                this._bar.update(coin, data, false)
                this._view.updateData(coin, data, false)
            }
            if (this._history[coin]) {
                this._view.updateSparkline(coin, this._history[coin])
            }
        }
    }

    _fetchMetadataAndInit(onDone = null) {
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
                if (onDone) onDone()
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
        const desired = this._config.tickers

        const perpNames = new Set((perpsMeta.universe || []).map(u => u.name))
        const spotUniverse = spotMeta.universe || []
        const spotTokenNames = new Set(spotUniverse.map(u => u.name))

        for (const ticker of desired) {
            if (perpNames.has(ticker)) {
                tickersByDex.default.push(ticker)
                displayNames[ticker] = ticker
            }
        }

        for (const spotName of spotTokenNames) {
            const displayName = SPOT_DISPLAY_OVERRIDES[spotName] || spotName
            if (desired.includes(displayName)) {
                const subKey = 'xyz:' + spotName
                tickersByDex.xyz.push(subKey)
                displayNames[subKey] = displayName
            }
        }

        for (const ticker of desired) {
            const alreadyAdded = Object.values(displayNames).includes(ticker)
            if (!alreadyAdded) {
                tickersByDex.default.push(ticker)
                displayNames[ticker] = ticker
            }
        }

        return { tickersByDex, displayNames }
    }

    _setupTickers(tickersByDex, displayNames) {
        this._displayNames = displayNames

        const allDisplayNames = [...new Set(Object.values(displayNames))]

        this._bar.createUI(allDisplayNames, this._config.showLogos)
        this._view.initUI(allDisplayNames, this._config.showLogos)

        for (const coin of allDisplayNames) {
            this._applyIcon(coin)
        }

        if (this._ws) {
            this._ws.stop()
            this._ws = null
        }

        this._ws = new WsManager((coin, data) => {
            this._onData(coin, data)
        })
        this._ws.start(tickersByDex, displayNames)
    }

    _applyIcon(coin) {
        if (!this._config.showLogos || !this._icons) return

        // Candidats de nom pour l'URL d'icône : nom affiché, clé complet
        // (ex 'xyz:CL') puis symbole de base ('CL')
        const iconNames = new Set([coin])
        for (const [key, dn] of Object.entries(this._displayNames)) {
            if (dn !== coin) continue
            iconNames.add(key)
            if (key.startsWith('xyz:')) {
                iconNames.add(key.slice(4))
            }
        }

        this._icons.getIcon(coin, [...iconNames], gicon => {
            if (!gicon) return
            this._bar.setIcon(coin, gicon)
            this._view.setIcon(coin, gicon)
        })
    }

    _onData(coin, data) {
        this._data[coin] = data
        this._lastUpdate[coin] = Date.now()

        if (data.price > 0) {
            let history = this._history[coin]
            if (!history || history.length === 0 ||
                history[history.length - 1] !== data.price) {
                if (!history) {
                    history = []
                    this._history[coin] = history
                }
                history.push(data.price)
                if (history.length > MAX_HISTORY) {
                    history.shift()
                }
            }
        }

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
            this._view.updateSparkline(coin, this._history[coin])
        }

        this._pendingUpdates.clear()
        this._updateThrottleId = null
        return GLib.SOURCE_REMOVE
    }

    _checkStaleData() {
        if (!this._bar || !this._view) return GLib.SOURCE_REMOVE

        const now = Date.now()

        for (const coin of Object.keys(this._data)) {
            const lastUpdate = this._lastUpdate[coin]
            const isStale = !lastUpdate || (now - lastUpdate) > DATA_STALE_THRESHOLD_MS

            if (isStale) {
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

        if (this._configDebounceId) {
            GLib.source_remove(this._configDebounceId)
            this._configDebounceId = null
        }

        if (this._configMonitor) {
            this._configMonitor.cancel()
            this._configMonitor = null
        }

        if (this._ws) {
            this._ws.stop()
            this._ws = null
        }

        if (this._api) {
            this._api.destroy()
            this._api = null
        }

        if (this._icons) {
            this._icons.destroy()
            this._icons = null
        }

        if (this._bar) {
            this._barBox.destroy()
            this._barBox = null
            this._bar = null
        }

        if (this._view) {
            this._viewBox.destroy()
            this._viewBox = null
            this._view = null
        }

        if (this._indicator) {
            this._indicator.destroy()
            this._indicator = null
        }

        this._data = {}
        this._lastUpdate = {}
        this._history = {}
        this._displayNames = {}
        this._pendingUpdates.clear()
    }
}
