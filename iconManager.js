import Soup from 'gi://Soup'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'

const CG_SEARCH_URL = 'https://api.coingecko.com/api/v3/search?query='

// L'endpoint app.hyperliquid.xyz sert du HTML pour les inconnues : on
// valide donc toujours les octets de l'image avant de l'afficher
const ICON_SOURCES = [
    name => `https://app.hyperliquid.xyz/icon/${encodeURIComponent(name)}`,
    // ~250 cryptos majeures, fichiers minuscules
    name => `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${encodeURIComponent(name.toLowerCase())}.png`,
    // CoinGecko : nécessite une résolution symbole -> id via son API search
    null,
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

        if (ICON_SOURCES[sourceIndex] === null) {
            this._fetchCoinGecko(displayName, name, stored => {
                if (stored) {
                    callback(this._icons[displayName])
                    return
                }
                this._fetchChain(displayName, names, callback, nameIndex, sourceIndex + 1)
            })
            return
        }

        const url = ICON_SOURCES[sourceIndex](name)
        this._downloadImage(url, bytes => {
            if (this._store(displayName, bytes)) {
                callback(this._icons[displayName])
                return
            }
            this._fetchChain(displayName, names, callback, nameIndex, sourceIndex + 1)
        })
    }

    _nextSource(displayName, names, callback, nameIndex, sourceIndex) {
        this._fetchChain(displayName, names, callback, nameIndex, sourceIndex + 1)
    }

    // Résout un symbole en logo via l'API search de CoinGecko, puis
    // télécharge l'image correspondante. onDone() est toujours appelé.
    _fetchCoinGecko(displayName, symbol, onDone) {
        if (!this._session) {
            onDone()
            return
        }
        const url = CG_SEARCH_URL + encodeURIComponent(symbol)
        const msg = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        })
        // CoinGecko refuse les requêtes sans User-Agent (403)
        msg.request_headers.append('User-Agent', 'HyperliquidBar/2 (GNOME Shell extension)')

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            let logoUrl = null
            try {
                const json = JSON.parse(
                    new TextDecoder().decode(sess.send_and_read_finish(res).get_data())
                )
                const coins = json.coins || []
                // Correspondance exacte du symbole, sinon premier résultat
                const match = coins.find(c => c.symbol === symbol) || coins[0]
                if (match) {
                    logoUrl = match.large || match.thumb
                }
            } catch (e) {
                logError(e, `CoinGecko search failed for ${symbol}`)
            }

            if (!logoUrl) {
                onDone()
                return
            }

            this._downloadImage(logoUrl, bytes => {
                onDone(this._store(displayName, bytes))
            })
        })
    }

    _downloadImage(url, onBytes) {
        const msg = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse(url, GLib.UriFlags.NONE),
        })

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            let bytes = null
            try {
                bytes = sess.send_and_read_finish(res)
            } catch (e) {
                logError(e, `Icon download failed for ${url}`)
            }
            onBytes(bytes && bytes.get_size() > 0 && isImageData(bytes) ? bytes : null)
        })
    }

    // Écrit les octets dans le cache et mémorise le gicon.
    // Retourne true si une image valide a été stockée.
    _store(displayName, bytes) {
        if (!bytes) return false
        const path = this._cachePath(displayName)
        if (!GLib.file_set_contents(path, bytes.get_data())) return false
        this._icons[displayName] = Gio.FileIcon.new(Gio.File.new_for_path(path))
        return true
    }

    destroy() {
        this._session.abort()
        this._session = null
        this._icons = {}
    }
}
