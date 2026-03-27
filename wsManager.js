import Soup from 'gi://Soup';
import GLib from 'gi://GLib';

// Tickers standards (DEX par défaut)
const STANDARD_TICKERS = ['BTC', 'ETH', 'SOL', 'HYPE'];

// Tickers HIP-3 (DEX xyz)
const XYZ_TICKERS = ['xyz:CL', 'xyz:XYZ100', 'xyz:GOLD'];

// Tous les tickers à surveiller
const ALL_TICKERS = [...STANDARD_TICKERS, ...XYZ_TICKERS];

// Mapping des noms API vers noms d'affichage
const DISPLAY_NAMES = {
    'BTC': 'BTC',
    'ETH': 'ETH',
    'SOL': 'SOL',
    'HYPE': 'HYPE',
    'xyz:CL': 'BRENT',
    'xyz:XYZ100': 'XYZ100',
    'xyz:GOLD': 'GOLD'
};

export class WsManager {
    constructor(callback) {
        this._callback = callback;
        this._data = {};
        this._connections = new Map();
        
        // Initialiser les données pour tous les tickers
        ALL_TICKERS.forEach(t => {
            this._data[t] = { price: 0, pct: 0, funding: 0 };
        });
    }

    start() {
        // Connexion pour les tickers standards
        this._initWS('default', STANDARD_TICKERS);
        
        // Connexion pour les tickers xyz (HIP-3)
        this._initWS('xyz', XYZ_TICKERS);
    }

    stop() {
        // Arrêter toutes les connexions
        for (const [dex, conn] of this._connections) {
            if (conn.reconnectId) {
                GLib.source_remove(conn.reconnectId);
            }
            if (conn.ws) {
                try { conn.ws.close(0, ""); } catch(e) {}
            }
            if (conn.session) {
                try { conn.session.abort(); } catch(e) {}
            }
        }
        this._connections.clear();
    }

    _scheduleReconnect(dex, tickers) {
        const conn = this._connections.get(dex);
        if (!conn) return;
        
        if (conn.reconnectId) {
            GLib.source_remove(conn.reconnectId);
        }
        
        conn.reconnectId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
            this._initWS(dex, tickers);
            return GLib.SOURCE_REMOVE;
        });
    }

    _initWS(dex, tickers) {
        // Nettoyer l'ancienne connexion si elle existe
        const existingConn = this._connections.get(dex);
        if (existingConn) {
            if (existingConn.ws) {
                try { existingConn.ws.close(0, ""); } catch(e) {}
            }
            if (existingConn.session) {
                try { existingConn.session.abort(); } catch(e) {}
            }
            if (existingConn.reconnectId) {
                GLib.source_remove(existingConn.reconnectId);
            }
        }
        
        // Créer une nouvelle connexion
        const conn = {
            session: new Soup.Session(),
            ws: null,
            reconnectId: null
        };
        this._connections.set(dex, conn);
        
        let msg = new Soup.Message({
            method: 'GET',
            uri: GLib.Uri.parse('wss://api.hyperliquid.xyz/ws', GLib.UriFlags.NONE)
        });

        conn.session.websocket_connect_async(msg, null, null, null, null, (sess, res) => {
            try {
                conn.ws = sess.websocket_connect_finish(res);
                
                // Supprimer le timer de reconnexion si la connexion réussit
                if (conn.reconnectId) {
                    GLib.source_remove(conn.reconnectId);
                    conn.reconnectId = null;
                }

                conn.ws.connect('closed', () => this._scheduleReconnect(dex, tickers));
                conn.ws.connect('error', () => this._scheduleReconnect(dex, tickers));
                conn.ws.connect('message', (connection, type, data) => {
                    if (type === Soup.WebsocketDataType.TEXT) {
                        let str = new TextDecoder().decode(data.get_data());
                        this._onMessage(str);
                    }
                });

                // Souscrire aux tickers
                tickers.forEach(ticker => {
                    let subscription = { type: "activeAssetCtx", coin: ticker };
                    
                    // Pour les actifs HIP-3, ajouter le paramètre dex
                    if (dex !== 'default') {
                        subscription.dex = dex;
                    }
                    
                    let sub = JSON.stringify({ 
                        method: "subscribe", 
                        subscription: subscription
                    });
                    
                    try {
                        conn.ws.send_text(sub);
                    } catch(e) {}
                });
            } catch (e) {
                this._scheduleReconnect(dex, tickers);
            }
        });
    }

    _onMessage(str) {
        try {
            let json = JSON.parse(str);
            if (json.channel === "activeAssetCtx" && json.data && json.data.ctx) {
                let coin = json.data.coin;
                let ctx = json.data.ctx;
                
                // Le coin peut être avec ou sans préfixe selon la réponse
                // Essayer de trouver dans nos données
                let dataKey = coin;
                if (!this._data[dataKey]) {
                    // Essayer avec préfixe xyz: si ce n'est pas déjà le cas
                    if (!coin.startsWith('xyz:')) {
                        dataKey = 'xyz:' + coin;
                    }
                }
                
                if (this._data[dataKey]) {
                    let p = parseFloat(ctx.markPx) || parseFloat(ctx.midPx) || 0;
                    let prev = parseFloat(ctx.prevDayPx) || p;
                    let pct = prev > 0 ? ((p - prev) / prev) * 100 : 0;
                    let fundingVal = parseFloat(ctx.funding) || 0;

                    this._data[dataKey] = {
                        price: p,
                        pct: pct,
                        funding: fundingVal
                    };

                    // Appeler le callback avec le nom d'affichage
                    const displayName = DISPLAY_NAMES[dataKey] || dataKey;
                    if (this._callback) this._callback(displayName, this._data[dataKey]);
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    }
}
