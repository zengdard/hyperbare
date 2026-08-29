import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

export const DEFAULT_TICKERS = ['BTC', 'ETH', 'SOL', 'HYPE', 'BRENT', 'XYZ100', 'GOLD']

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'hyperliquid-bar'])
const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'config.json'])

export const CONFIG_FILE_PATH = CONFIG_PATH

function parseConfig(contents) {
    const config = { tickers: [...DEFAULT_TICKERS] }
    try {
        const parsed = JSON.parse(new TextDecoder().decode(contents))
        if (Array.isArray(parsed.tickers)) {
            // Pas de mise en majuscules : les tickers Hyperliquid sont
            // sensibles à la casse ('kPEPE') et le préfixe dex 'xyz:' est
            // en minuscules
            const names = parsed.tickers
                .filter(t => typeof t === 'string' && t.trim().length > 0)
                .map(t => t.trim())
            if (names.length > 0) config.tickers = [...new Set(names)]
        }
    } catch (e) {
        logError(e, 'Failed to parse config, using defaults')
    }
    return config
}

// Lecture asynchrone (le code shell doit éviter les E/S de fichier
// synchrones). callback(config) est toujours invoqué, avec les défauts
// si le fichier est absent ou invalide.
export function loadConfig(callback) {
    const file = Gio.File.new_for_path(CONFIG_PATH)
    file.load_contents_async(null, (f, res) => {
        try {
            const [, contents] = f.load_contents_finish(res)
            callback(parseConfig(contents))
        } catch (e) {
            if (e instanceof GLib.Error && !e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_FOUND)) {
                logError(e, 'Failed to read config, using defaults')
            }
            callback({ tickers: [...DEFAULT_TICKERS] })
        }
    })
}

export function saveConfig(config) {
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755)
    GLib.file_set_contents(CONFIG_PATH, JSON.stringify({ tickers: config.tickers }, null, 4))
}

// Surveille le fichier de config ; callback appelé (anti-rebond géré côté
// appelant) à chaque écriture. Retourne le Gio.FileMonitor à détruire.
export function monitorConfig(callback) {
    const file = Gio.File.new_for_path(CONFIG_PATH)
    if (!file.query_exists(null)) {
        // Le monitor ne fonctionne pas sur un fichier inexistant
        GLib.mkdir_with_parents(CONFIG_DIR, 0o755)
        saveConfig({ tickers: [...DEFAULT_TICKERS] })
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
