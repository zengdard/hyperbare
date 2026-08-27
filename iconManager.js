import Soup from 'gi://Soup'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

const ICON_URL = 'https://app.hyperliquid.xyz/icon/'

export class IconManager {
    constructor() {
        this._session = new Soup.Session()
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'hyperliquid-bar'])
        GLib.mkdir_with_parents(this._cacheDir, 0o755)
        // displayName -> gicon résolu
        this._icons = {}
    }

    // Résout l'icône d'un asset. `displayName` sert d'identifiant d'UI,
    // `iconNames` est la liste des symboles à essayer (ex: ['BRENT', 'xyz:CL']).
    // callback(gicon|null) est invoqué une seule fois.
    getIcon(displayName, iconNames, callback) {
        if (this._icons[displayName]) {
            callback(this._icons[displayName])
            return
        }

        const cached = this._loadCached(displayName)
        if (cached) {
            this._icons[displayName] = cached
            callback(cached)
            return
        }

        this._fetchChain(displayName, [...iconNames], callback)
    }

    _cachePath(displayName) {
        const safe = displayName.replace(/[^A-Za-z0-9_-]/g, '_')
        return GLib.build_filenamev([this._cacheDir, safe + '.png'])
    }

    _loadCached(displayName) {
        const path = this._cachePath(displayName)
        const file = Gio.File.new_for_path(path)
        if (!file.query_exists(null)) return null
        return Gio.FileIcon.new(file)
    }

    _fetchChain(displayName, remaining, callback) {
        if (remaining.length === 0 || !this._session) {
            callback(null)
            return
        }

        const name = remaining[0]
        const url = ICON_URL + encodeURIComponent(name)
        const msg = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        })

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            let bytes = null
            try {
                bytes = sess.send_and_read_finish(res)
            } catch (e) {
                logError(e, `Icon download failed for ${name}`)
            }

            if (!bytes || bytes.get_size() === 0) {
                this._fetchChain(displayName, remaining.slice(1), callback)
                return
            }

            const path = this._cachePath(displayName)
            const [ok] = GLib.file_set_contents(path, bytes.get_data())
            if (!ok) {
                callback(null)
                return
            }

            const gicon = Gio.FileIcon.new(Gio.File.new_for_path(path))
            this._icons[displayName] = gicon
            callback(gicon)
        })
    }

    destroy() {
        this._session.abort()
        this._session = null
        this._icons = {}
    }
}
