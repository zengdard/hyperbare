import St from 'gi://St'
import Clutter from 'gi://Clutter'
import GLib from 'gi://GLib'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

import { ApiManager } from './apiManager.js'
import { WsManager } from './wsManager.js'
import { IndicatorBar } from './indicator.js'
import { PanelView } from './panelView.js'
import { loadConfig, monitorConfig, DEFAULT_TICKERS } from './config.js'

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

// Table de repli utilisée si toutes les métadonnées réseau échouent.
// Elle permet de respecter la configuration de l'utilisateur au lieu de
// réafficher des tickers codés en dur.
const DEFAULT_KEY_BY_TICKER = new Map()
for (const [dex, keys] of Object.entries(DEFAULT_TICKERS_BY_DEX)) {
    for (const key of keys) {
        DEFAULT_KEY_BY_TICKER.set(key, { dex, key })
        const displayName = DEFAULT_DISPLAY_NAMES[key]
        if (displayName) DEFAULT_KEY_BY_TICKER.set(displayName, { dex, key })
        const colon = key.indexOf(':')
        if (colon !== -1) DEFAULT_KEY_BY_TICKER.set(key.slice(colon + 1), { dex, key })
    }
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
        this._configDirty = false
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
            orientation: Clutter.Orientation.VERTICAL,
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

            if (!tickersChanged) {
                this._rebuildUI()
                return
            }

            if (this._reinitializing) {
                // Une réinitialisation est en cours : on la relancera à la fin.
                this._configDirty = true
                return
            }

            this._reinitializing = true

            if (this._ws) {
                this._ws.stop()
                this._ws = null
            }

            this._startInit(() => {
                this._reinitializing = false
                if (this._configDirty) {
                    this._configDirty = false
                    this._applyConfigChange()
                }
            })
        })
    }

    _rebuildUI() {
        if (!this._bar || !this._view) return

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
        if (!this._indicator) return

        // Annule une éventuelle initialisation précédente encore en cours.
        if (this._api) {
            this._api.destroy()
            this._api = null
        }

        const api = new ApiManager()
        this._api = api
        let perpsResult = null
        let spotResult = null
        let dexsResult = null
        let perpsDone = false
        let spotDone = false
        let dexsDone = false

        const onComplete = () => {
            if (this._api !== api) return
            if (perpsDone && spotDone && dexsDone) {
                this._resolveMetas(perpsResult, spotResult, dexsResult, api, () => {
                    if (this._api === api) {
                        api.destroy()
                        this._api = null
                    }
                    if (onDone) onDone()
                })
            }
        }

        api.fetchPerpsMeta((err, data) => {
            if (this._api !== api) return
            if (err) {
                logError(err, 'Failed to fetch perps metadata')
            } else {
                perpsResult = data
            }
            perpsDone = true
            onComplete()
        })

        api.fetchSpotMeta((err, data) => {
            if (this._api !== api) return
            if (err) {
                logError(err, 'Failed to fetch spot metadata')
            } else {
                spotResult = data
            }
            spotDone = true
            onComplete()
        })

        // Dex builders HIP-3 (xyz, etc.) : chaque dex a son propre univers
        api.fetchPerpDexs((err, data) => {
            if (this._api !== api) return
            if (err) {
                logError(err, 'Failed to fetch perp dexs')
            } else {
                dexsResult = data
            }
            dexsDone = true
            onComplete()
        })
    }

    _resolveMetas(perpsMeta, spotMeta, perpDexs, api, onDone) {
        if (this._api !== api) {
            if (onDone) onDone()
            return
        }

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

        const dexMetas = []
        let pending = dexNames.length
        for (const dex of dexNames) {
            api.fetchPerpsMeta((err, data) => {
                if (this._api !== api) return
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
        if (!this._indicator) return

        const { tickersByDex, displayNames } = this._buildAssetList(
            perpsMeta || { universe: [] },
            spotMeta || { universe: [], tokens: [] },
            dexMetas
        )
        this._setupTickers(tickersByDex, displayNames)
    }

    _initWithDefaults() {
        const desired = this._config?.tickers ?? DEFAULT_TICKERS
        const tickersByDex = { default: [] }
        const displayNames = {}

        for (const ticker of desired) {
            const resolved = DEFAULT_KEY_BY_TICKER.get(ticker) ||
                { dex: 'default', key: ticker }
            if (displayNames[resolved.key]) continue

            if (!tickersByDex[resolved.dex]) tickersByDex[resolved.dex] = []
            tickersByDex[resolved.dex].push(resolved.key)
            displayNames[resolved.key] =
                DEFAULT_DISPLAY_NAMES[resolved.key] || ticker
        }

        this._setupTickers(tickersByDex, displayNames)
    }

    _buildAssetList(perpsMeta, _spotMeta, dexMetas) {
        const tickersByDex = { default: [] }
        const displayNames = {}
        const desired = this._config.tickers
        const added = new Set()
        // ticker demandé -> { dex, key, displayName }
        const resolved = new Map()

        const perpNames = new Set((perpsMeta.universe || []).map(u => u.name))
        for (const ticker of desired) {
            if (!perpNames.has(ticker) || resolved.has(ticker)) continue
            tickersByDex.default.push(ticker)
            displayNames[ticker] = ticker
            resolved.set(ticker, { dex: 'default', key: ticker, displayName: ticker })
            added.add(ticker)
        }

        // Les noms d'univers des dex builders HIP-3 sont préfixés (xyz:CL).
        // Un même nom peut exister dans plusieurs dex (GOLD…) : premier dex
        // trouvé gagne.
        for (const { dex, universe } of dexMetas) {
            if (!tickersByDex[dex]) tickersByDex[dex] = []
            for (const entry of universe) {
                const name = entry.name
                const prefix = dex + ':'
                if (!name.startsWith(prefix)) continue
                const bareName = name.slice(prefix.length)
                const displayName = SPOT_DISPLAY_OVERRIDES[bareName] || bareName
                if (added.has(bareName) || added.has(displayName)) continue

                // L'utilisateur peut avoir configuré le nom préfixé, le nom
                // nu ou le nom d'affichage (ex: BRENT pour xyz:CL).
                let wanted = null
                if (desired.includes(name)) wanted = name
                else if (desired.includes(bareName)) wanted = bareName
                else if (desired.includes(displayName)) wanted = displayName
                if (!wanted) continue

                tickersByDex[dex].push(name)
                displayNames[name] = displayName
                resolved.set(wanted, { dex, key: name, displayName })
                added.add(bareName)
                added.add(displayName)
            }
        }

        // Le support des actifs spot n'est pas implémenté ici : les entrées de
        // spotMeta.universe sont des paires (PURR/USDC, @1), pas des tokens.
        // Les abonnements « xyz:<paire> » de l'ancien code étaient invalides.

        // Dernier recours : ticker inconnu → perps du dex principal
        for (const ticker of desired) {
            if (resolved.has(ticker) || added.has(ticker)) continue
            tickersByDex.default.push(ticker)
            displayNames[ticker] = ticker
            resolved.set(ticker, { dex: 'default', key: ticker, displayName: ticker })
        }

        // Reconstruit l'ordre d'affichage selon la configuration utilisateur,
        // y compris pour les tickers de dex (BRENT, XYZ100, GOLD…).
        const orderedDisplayNames = {}
        for (const ticker of desired) {
            const item = resolved.get(ticker)
            if (!item) continue
            if (!(item.key in orderedDisplayNames))
                orderedDisplayNames[item.key] = item.displayName
        }

        return { tickersByDex, displayNames: orderedDisplayNames }
    }

    _setupTickers(tickersByDex, displayNames) {
        if (!this._indicator || !this._bar || !this._view) return

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
        if (!this._indicator) return

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
        this._reinitializing = false
        this._configDirty = false
    }
}
