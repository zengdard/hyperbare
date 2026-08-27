import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

import { loadConfig, saveConfig } from './config.js'

export default class HyperliquidPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._config = loadConfig()

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        })
        window.add(page)

        page.add(this._buildTickerGroup())
        page.add(this._buildDisplayGroup())
    }

    _buildTickerGroup() {
        const group = new Adw.PreferencesGroup({
            title: 'Tickers',
            description: 'Cryptos affichées dans la barre (symboles Hyperliquid)',
        })

        this._tickerRowsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })
        group.add(this._tickerRowsBox)

        const entry = new Gtk.Entry({
            hexpand: true,
            placeholder_text: 'Ex : BTC, HYPE, xyz:CL…',
        })
        entry.connect('activate', () => this._addTickerFromEntry(entry))

        const addButton = new Gtk.Button({ label: 'Ajouter' })
        addButton.connect('clicked', () => this._addTickerFromEntry(entry))

        const addBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 })
        addBox.append(entry)
        addBox.append(addButton)
        group.add(addBox)

        this._rebuildTickerRows()
        return group
    }

    _buildDisplayGroup() {
        const group = new Adw.PreferencesGroup({ title: 'Affichage' })

        const logosRow = new Adw.ActionRow({ title: 'Afficher les logos' })
        const logosSwitch = new Gtk.Switch({
            active: this._config.showLogos,
            valign: Gtk.Align.CENTER,
        })
        logosSwitch.connect('notify::active', sw => {
            this._config.showLogos = sw.get_active()
            this._save()
        })
        logosRow.add_suffix(logosSwitch)
        logosRow.activatable_widget = logosSwitch
        group.add(logosRow)

        return group
    }

    _addTickerFromEntry(entry) {
        // Casse préservée : 'kPEPE', 'xyz:CL'… sont des identifiants exacts
        const name = entry.get_text().trim()
        if (name.length === 0 || this._config.tickers.includes(name)) {
            entry.set_text('')
            return
        }
        this._config.tickers.push(name)
        entry.set_text('')
        this._save()
        this._rebuildTickerRows()
    }

    _removeTicker(name) {
        this._config.tickers = this._config.tickers.filter(t => t !== name)
        this._save()
        this._rebuildTickerRows()
    }

    _rebuildTickerRows() {
        for (const child of [...this._tickerRowsBox]) {
            this._tickerRowsBox.remove(child)
        }

        if (this._config.tickers.length === 0) {
            const empty = new Gtk.Label({
                label: 'Aucun ticker configuré.',
                halign: Gtk.Align.START,
            })
            this._tickerRowsBox.append(empty)
            return
        }

        this._config.tickers.forEach((name, index) => {
            const row = new Adw.ActionRow({ title: name })

            const upButton = new Gtk.Button({
                icon_name: 'go-up-symbolic',
                valign: Gtk.Align.CENTER,
                sensitive: index > 0,
                tooltip_text: 'Monter',
            })
            upButton.connect('clicked', () => {
                const i = this._config.tickers.indexOf(name)
                if (i <= 0) return
                const tickers = this._config.tickers
                const prev = tickers[i - 1]
                tickers[i - 1] = tickers[i]
                tickers[i] = prev
                this._save()
                this._rebuildTickerRows()
            })

            const downButton = new Gtk.Button({
                icon_name: 'go-down-symbolic',
                valign: Gtk.Align.CENTER,
                sensitive: index < this._config.tickers.length - 1,
                tooltip_text: 'Descendre',
            })
            downButton.connect('clicked', () => {
                const i = this._config.tickers.indexOf(name)
                if (i < 0 || i >= this._config.tickers.length - 1) return
                const tickers = this._config.tickers
                const next = tickers[i + 1]
                tickers[i + 1] = tickers[i]
                tickers[i] = next
                this._save()
                this._rebuildTickerRows()
            })

            const removeButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Supprimer',
            })
            removeButton.connect('clicked', () => this._removeTicker(name))

            row.add_prefix(upButton)
            row.add_suffix(downButton)
            row.add_suffix(removeButton)
            this._tickerRowsBox.append(row)
        })
    }

    _save() {
        try {
            saveConfig(this._config)
        } catch (e) {
            logError(e, 'Failed to save config')
        }
    }
}
