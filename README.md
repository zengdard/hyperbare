# Hyperliquid Gnome Extension

A GNOME Shell extension that displays real-time cryptocurrency prices from Hyperliquid in the top panel.

![GNOME Shell Version](https://img.shields.io/badge/GNOME-45%2B-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Real-time price updates** via WebSocket connection to Hyperliquid
- **Top 3 tickers** displayed directly in the top panel for quick glance
- **Expandable menu** - Click the indicator to see all available tickers with sparkline charts
- **Sparkline charts** - Visual price history for each cryptocurrency
- **Customizable** - Configure which tickers to display

## Installation

### From Source

1. Clone the repository:
```bash
git clone https://github.com/yourusername/hyperliquid-gnome-extension.git
cd hyperliquid-gnome-extension
```

2. Install the extension locally:
```bash
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/hyperliquid-bar@hyperbare
```

3. Restart GNOME Shell:
   - On X11: Press `Alt+F2`, type `r`, press Enter
   - On Wayland: Log out and log back in

4. Enable the extension:
   - Open GNOME Extensions app
   - Toggle "Hyperliquid Bar" on

### Requirements

- GNOME Shell 45, 46, 47, 48, or 49
- GJS (GObject Introspection)

## Usage

- **Top panel view**: See the top 3 cryptocurrencies by default
- **Click to expand**: Click the indicator to open the dropdown menu with all tickers and price charts
- **Sparklines**: Each ticker shows a mini price history chart

## Files

- `extension.js` - Main extension entry point
- `metadata.json` - Extension metadata
- `stylesheet.css` - Styling for the extension
- `wsManager.js` - WebSocket connection manager
- `indicator.js` - Top panel indicator UI
- `panelView.js` - Dropdown menu UI with sparklines

## Development

### Testing

```bash
# View logs
journalctl -f -o cat /usr/bin/gnome-shell | grep -E "(HL|hyperliquid)"
```

### Code Style

- JavaScript ES2020+ with GJS bindings
- 4 spaces indentation
- Single quotes for strings

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

- Data provided by [Hyperliquid](https://hyperliquid.xyz/)
- Built for GNOME Shell using GJS
