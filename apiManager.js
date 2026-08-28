import Soup from 'gi://Soup'
import GLib from 'gi://GLib'

const INFO_URL = 'https://api.hyperliquid.xyz/info'

export class ApiManager {
    constructor() {
        this._session = new Soup.Session()
    }

    fetchPerpsMeta(callback, dex = null) {
        const body = { type: 'meta' }
        if (dex) body.dex = dex
        this._post(body, callback)
    }

    fetchPerpDexs(callback) {
        this._post({ type: 'perpDexs' }, callback)
    }

    fetchSpotMeta(callback) {
        this._post({ type: 'spotMeta' }, callback)
    }

    _post(body, callback) {
        let msg = new Soup.Message({
            method: 'POST',
            uri: GLib.Uri.parse(INFO_URL, GLib.UriFlags.NONE),
        })
        msg.request_headers.append('Content-Type', 'application/json')
        let bodyStr = JSON.stringify(body)
        msg.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(bodyStr))
        )

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
                let bytes = sess.send_and_read_finish(res)
                let text = new TextDecoder().decode(bytes.get_data())
                callback(null, JSON.parse(text))
            } catch (e) {
                callback(e, null)
            }
        })
    }

    destroy() {
        this._session.abort()
        this._session = null
    }
}
