import St from 'gi://St'
import GLib from 'gi://GLib'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

import { ApiManager } from './apiManager.js'
import { WsManager } from './wsManager.js'
import { IndicatorBar } from './indicator.js'
import { PanelView } from './panelView.js'
import { loadConfig, monitorConfig } from './config.js'

const DATA_STALE_THRESHOLD_MS = 30000
const UI_UPDATE_THROTTLE_MS = 200
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
        this._data = {}
        this._lastUpdate = {}
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

        loadConfig(config => {
            if (!this._indicator) return
            this._config = config

            this._configMonitor = monitorConfig(() => this._onConfigChanged())

            this._startInit()
            this._staleCheckId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, 5,
                () => this._checkStaleData()
            )
        })
    }

    _startInit(onDone = null) {
        if (this._initIdleId) {
            GLib.source_remove(this._initIdleId)
        }
        this._initIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._fetchMetadataAndInit(onDone)
            this._initIdleId = null
            return GLib.SOURCE_REMOVE
        })
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
        if (!this._config) return

        loadConfig(newConfig => {
            if (!this._indicator || !this._config) return

            const tickersChanged =
                newConfig.tickers.join(',') !== this._config.tickers.join(',')
            this._config = newConfig

            if (this._reinitializing) return

            if (!tickersChanged) {
                this._rebuildUI()
                return
            }

            this._reinitializing = true

            if (this._ws) {
                this._ws.stop()
                this._ws = null
            }

            this._startInit(() => {
                this._reinitializing = false
            })
        })
    }

    _rebuildUI() {
        const allDisplayNames = [...new Set(Object.values(this._displayNames))]
        this._bar.createUI(allDisplayNames)
        this._view.initUI(allDisplayNames)

        for (const coin of allDisplayNames) {
            const data = this._data[coin]
            if (data) {
                this._bar.update(coin, data, false)
                this._view.updateData(coin, data, false)
            }
        }
    }

    _fetchMetadataAndInit(onDone = null) {
        this._api = new ApiManager()
        let perpsResult = null
        let spotResult = null
        let dexsResult = null
        let perpsDone = false
        let spotDone = false
        let dexsDone = false

        const onComplete = () => {
            if (perpsDone && spotDone && dexsDone) {
                this._resolveMetas(perpsResult, spotResult, dexsResult, () => {
                    if (this._api) {
                        this._api.destroy()
                        this._api = null
                    }
                    if (onDone) onDone()
                })
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

        // Dex builders HIP-3 (xyz, etc.) : chaque dex a son propre univers
        this._api.fetchPerpDexs((err, data) => {
            if (err) {
                logError(err, 'Failed to fetch perp dexs')
            } else {
                dexsResult = data
            }
            dexsDone = true
            onComplete()
        })
    }

    _resolveMetas(perpsMeta, spotMeta, perpDexs, onDone) {
        if (perpsMeta === null && spotMeta === null && perpDexs === null) {
            this._initWithDefaults()
            onDone()
            return
        }

        const dexNames = (perpDexs || [])
            .filter(d => d && d.name)
            .map(d => d.name)

        if (dexNames.length === 0) {
            this._initWithMetadataDone(perpsMeta, spotMeta, [])
            onDone()
            return
        }

        // Récupère l'univers de chaque dex builder, en parallèle
        const dexMetas = []
        let pending = dexNames.length
        for (const dex of dexNames) {
            this._api.fetchPerpsMeta((err, data) => {
                if (err) {
                    logError(err, `Failed to fetch metadata for dex ${dex}`)
                } else {
                    dexMetas.push({ dex: dex, universe: data.universe || [] })
                }
                if (--pending === 0) {
                    this._initWithMetadataDone(perpsMeta, spotMeta, dexMetas)
                    onDone()
                }
            }, dex)
        }
    }

    _initWithMetadataDone(perpsMeta, spotMeta, dexMetas) {
        const { tickersByDex, displayNames } = this._buildAssetList(
            perpsMeta || { universe: [] },
            spotMeta || { universe: [], tokens: [] },
            dexMetas
        )
        this._setupTickers(tickersByDex, displayNames)
    }

    _initWithDefaults() {
        this._setupTickers(DEFAULT_TICKERS_BY_DEX, DEFAULT_DISPLAY_NAMES)
    }

    _buildAssetList(perpsMeta, spotMeta, dexMetas) {
        const tickersByDex = { default: [] }
        const displayNames = {}
        const desired = this._config.tickers
        const added = new Set()

        // 1. Perps du dex principal (BTC, ETH…)
        const perpNames = new Set((perpsMeta.universe || []).map(u => u.name))
        for (const ticker of desired) {
            if (perpNames.has(ticker)) {
                tickersByDex.default.push(ticker)
                displayNames[ticker] = ticker
                added.add(ticker)
            }
        }

        // 2. Dex builders HIP-3 : les noms d'univers sont préfixés (xyz:CL).
        // Un même nom peut exister dans plusieurs dex (GOLD…) : premier dex
        // trouvé gagne, l'ordre de perpDexs fait foi
        for (const { dex, universe } of dexMetas) {
            tickersByDex[dex] = []
            for (const entry of universe) {
                const name = entry.name
                const prefix = dex + ':'
                if (!name.startsWith(prefix)) continue
                const bareName = name.slice(prefix.length)
                const displayName = SPOT_DISPLAY_OVERRIDES[bareName] || bareName
                if (added.has(bareName) || added.has(displayName)) continue
                // L'utilisateur peut avoir configuré le nom préfixé, le nom
                // nu ou le nom d'affichage (ex: BRENT pour xyz:CL)
                if (desired.includes(name) || desired.includes(bareName) ||
                    desired.includes(displayName)) {
                    tickersByDex[dex].push(name)
                    displayNames[name] = displayName
                    added.add(bareName)
                    added.add(displayName)
                }
            }
        }

        // 3. Tokens spot (universe xyz distinct des perps HIP-3)
        const spotUniverse = spotMeta.universe || []
        for (const spotName of spotUniverse.map(u => u.name)) {
            const displayName = SPOT_DISPLAY_OVERRIDES[spotName] || spotName
            if (!added.has(spotName) && !added.has(displayName) &&
                (desired.includes(displayName) || desired.includes(spotName))) {
                const subKey = 'xyz:' + spotName
                if (!tickersByDex.xyz) tickersByDex.xyz = []
                tickersByDex.xyz.push(subKey)
                displayNames[subKey] = displayName
                added.add(spotName)
                added.add(displayName)
            }
        }

        // 4. Dernier recours : ticker inconnu → perps du dex principal
        for (const ticker of desired) {
            if (!added.has(ticker)) {
                tickersByDex.default.push(ticker)
                displayNames[ticker] = ticker
            }
        }

        return { tickersByDex, displayNames }
    }

    _setupTickers(tickersByDex, displayNames) {
        this._displayNames = displayNames

        const allDisplayNames = [...new Set(Object.values(displayNames))]

        this._bar.createUI(allDisplayNames)
        this._view.initUI(allDisplayNames)

        if (this._ws) {
            this._ws.stop()
            this._ws = null
        }

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
        this._displayNames = {}
        this._pendingUpdates.clear()
    }
}
