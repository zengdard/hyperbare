import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

export const DEFAULT_TICKERS = ['BTC', 'ETH', 'SOL', 'HYPE', 'BRENT', 'XYZ100', 'GOLD']

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'hyperliquid-bar'])
const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'config.json'])

export const CONFIG_FILE_PATH = CONFIG_PATH

export function loadConfig() {
    const config = { tickers: [...DEFAULT_TICKERS], showLogos: true }

    try {
        const [ok, contents] = GLib.file_get_contents(CONFIG_PATH)
        if (ok) {
            const parsed = JSON.parse(new TextDecoder().decode(contents))
            if (Array.isArray(parsed.tickers)) {
                const names = parsed.tickers
                    .filter(t => typeof t === 'string' && t.trim().length > 0)
                    .map(t => t.trim().toUpperCase())
                if (names.length > 0) config.tickers = [...new Set(names)]
            }
            if (typeof parsed.showLogos === 'boolean') {
                config.showLogos = parsed.showLogos
            }
        }
    } catch (e) {
        if (e instanceof GLib.Error && e.matches(GLib.FileError, GLib.FileError.NOENT)) {
            // Première utilisation : on garde les défauts
        } else {
            logError(e, 'Failed to read config, using defaults')
        }
    }

    return config
}

export function saveConfig(config) {
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755)
    const json = JSON.stringify(
        { tickers: config.tickers, showLogos: config.showLogos },
        null,
        4
    )
    GLib.file_set_contents(CONFIG_PATH, json)
}

// Surveille le fichier de config ; callback appelé (avec anti-rebond déjà géré
// côté appelant) à chaque écriture. Retourne le Gio.FileMonitor à détruire.
export function monitorConfig(callback) {
    const file = Gio.File.new_for_path(CONFIG_PATH)
    if (!file.query_exists(null)) {
        // Le monitor ne fonctionne pas sur un fichier inexistant
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755)
        saveConfig(loadConfig())
    }
    const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null)
    monitor.connect('changed', (mon, changedFile, otherFile, eventType) => {
        if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
            eventType === Gio.FileMonitorEvent.ATTRIBUTE_CHANGED) {
            return
        }
        callback()
    })
    return monitor
}
