import Adw from 'gi://Adw'
import Gtk from 'gi://Gtk'
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'

import { loadConfig, saveConfig } from './config.js'

export default class HyperliquidPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Tout l'état est local à la fenêtre (pas de champs d'instance à
        // nettoyer au close-request)
        loadConfig(config => {
            const page = new Adw.PreferencesPage({
                title: 'General',
                icon_name: 'preferences-system-symbolic',
            })
            window.add(page)
            page.add(buildTickerGroup(window, config))
        })
    }
}

function buildTickerGroup(window, config) {
    const group = new Adw.PreferencesGroup({
        title: 'Tickers',
        description: 'Cryptos affichées dans la barre (symboles Hyperliquid)',
    })

    const rowsBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })
    group.add(rowsBox)

    function save() {
        try {
            saveConfig(config)
        } catch (e) {
            logError(e, 'Failed to save config')
        }
    }

    function addTicker(entry) {
        // Casse préservée : 'kPEPE', 'xyz:CL'… sont des identifiants exacts
        const name = entry.get_text().trim()
        if (name.length === 0 || config.tickers.includes(name)) {
            entry.set_text('')
            return
        }
        config.tickers.push(name)
        entry.set_text('')
        save()
        rebuildRows()
    }

    function removeTicker(name) {
        config.tickers = config.tickers.filter(t => t !== name)
        save()
        rebuildRows()
    }

    function rebuildRows() {
        for (const child of [...rowsBox]) {
            rowsBox.remove(child)
        }

        if (config.tickers.length === 0) {
            rowsBox.append(new Gtk.Label({
                label: 'Aucun ticker configuré.',
                halign: Gtk.Align.START,
            }))
            return
        }

        config.tickers.forEach((name, index) => {
            const row = new Adw.ActionRow({ title: name })

            const upButton = new Gtk.Button({
                icon_name: 'go-up-symbolic',
                valign: Gtk.Align.CENTER,
                sensitive: index > 0,
                tooltip_text: 'Monter',
            })
            upButton.connect('clicked', () => {
                const i = config.tickers.indexOf(name)
                if (i <= 0) return
                const prev = config.tickers[i - 1]
                config.tickers[i - 1] = config.tickers[i]
                config.tickers[i] = prev
                save()
                rebuildRows()
            })

            const downButton = new Gtk.Button({
                icon_name: 'go-down-symbolic',
                valign: Gtk.Align.CENTER,
                sensitive: index < config.tickers.length - 1,
                tooltip_text: 'Descendre',
            })
            downButton.connect('clicked', () => {
                const i = config.tickers.indexOf(name)
                if (i < 0 || i >= config.tickers.length - 1) return
                const next = config.tickers[i + 1]
                config.tickers[i + 1] = config.tickers[i]
                config.tickers[i] = next
                save()
                rebuildRows()
            })

            const removeButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Supprimer',
            })
            removeButton.connect('clicked', () => removeTicker(name))

            row.add_prefix(upButton)
            row.add_suffix(downButton)
            row.add_suffix(removeButton)
            rowsBox.append(row)
        })
    }

    const entry = new Gtk.Entry({
        hexpand: true,
        placeholder_text: 'Ex : BTC, HYPE, xyz:CL…',
    })
    entry.connect('activate', () => addTicker(entry))

    const addButton = new Gtk.Button({ label: 'Ajouter' })
    addButton.connect('clicked', () => addTicker(entry))

    const addBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 })
    addBox.append(entry)
    addBox.append(addButton)
    group.add(addBox)

    rebuildRows()
    return group
}
