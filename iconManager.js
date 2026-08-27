import Soup from 'gi://Soup'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

// L'endpoint app.hyperliquid.xyz sert du HTML pour les inconnues : on
// valide donc toujours les octets de l'image avant de l'afficher
const ICON_SOURCES = [
    name => `https://app.hyperliquid.xyz/icon/${encodeURIComponent(name)}`,
    // ~250 cryptos majeures, fichiers minuscules
    name => `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${encodeURIComponent(name.toLowerCase())}.png`,
]

function isImageData(bytes) {
    const d = bytes.get_data()
    if (d.length < 4) return false
    const isPng = d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47
    const isJpeg = d[0] === 0xff && d[1] === 0xd8
    const isGif = d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46
    return isPng || isJpeg || isGif
}

export class IconManager {
    constructor() {
        this._session = new Soup.Session()
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'hyperliquid-bar'])
        GLib.mkdir_with_parents(this._cacheDir, 0o755)
        // displayName -> gicon résolu
        this._icons = {}
    }

    // Résout l'icône d'un asset. `displayName` sert d'identifiant d'UI,
    // `iconNames` la liste des symboles à essayer (ex: ['BRENT', 'xyz:CL']).
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

    // Essaie chaque nom × chaque source ; s'arrête à la première image valide
    _fetchChain(displayName, names, callback, nameIndex = 0, sourceIndex = 0) {
        if (!this._session || nameIndex >= names.length) {
            callback(null)
            return
        }
        if (sourceIndex >= ICON_SOURCES.length) {
            this._fetchChain(displayName, names, callback, nameIndex + 1, 0)
            return
        }

        const name = names[nameIndex]
        const url = ICON_SOURCES[sourceIndex](name)
        const msg = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        })

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            let bytes = null
            try {
                bytes = sess.send_and_read_finish(res)
            } catch (e) {
                logError(e, `Icon download failed for ${name} (${url})`)
            }

            if (bytes && bytes.get_size() > 0 && isImageData(bytes)) {
                const path = this._cachePath(displayName)
                const ok = GLib.file_set_contents(path, bytes.get_data())
                if (ok) {
                    const gicon = Gio.FileIcon.new(Gio.File.new_for_path(path))
                    this._icons[displayName] = gicon
                    callback(gicon)
                    return
                }
            }

            this._fetchChain(displayName, names, callback, nameIndex, sourceIndex + 1)
        })
    }

    destroy() {
        this._session.abort()
        this._session = null
        this._icons = {}
    }
}
