// Formatage commun aux prix du panneau et du menu déroulant.
export function formatPrice(price) {
    if (!Number.isFinite(price) || price <= 0) return '—'

    if (price >= 1000) {
        const rounded = String(Math.round(price))
        return `${rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} USDC`
    }
    if (price >= 1) return `${price.toFixed(2)} USDC`
    if (price >= 0.01) return `${price.toFixed(4)} USDC`

    // Prix très faibles (kPEPE…) : 4 chiffres significatifs sans zéros inutiles.
    return `${parseFloat(price.toPrecision(4))} USDC`
}
