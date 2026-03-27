# AGENTS.md - Coding Guidelines for Hyperliquid Bar Extension

## Project Overview
GNOME Shell extension displaying Hyperliquid cryptocurrency prices in the top panel. Written in JavaScript using GJS (GObject Introspection).

## Build/Test/Lint Commands

**No build system is configured.** GNOME Shell extensions run directly without compilation.

**Manual Testing:**
```bash
# Install extension locally for testing
ln -s ~/.local/share/gnome-shell/extensions/hyperliquid-bar@hyperbare ~/.local/share/gnome-shell/extensions/

# Restart GNOME Shell (Alt+F2, type 'r', press Enter) - or on Wayland:
killall -SIGTERM gnome-shell

# View logs
journalctl -f -o cat /usr/bin/gnome-shell | grep -E "(HL|hyperliquid)"
```

**Linting:**
- No linter configured. Follow style guidelines below.

**Testing:**
- No automated tests. Test manually by installing and restarting GNOME Shell.

## Code Style Guidelines

### Language & Runtime
- **JavaScript ES2020+** with GJS bindings
- GNOME Shell 45+ uses ES6 modules (import/export)
- GObject Introspection for GTK/Shell APIs

### Imports
```javascript
// GIR modules (GObject Introspection)
import St from 'gi://St';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Cairo from 'gi://cairo';
import GObject from 'gi://GObject';

// GNOME Shell UI modules
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Local modules
import { WsManager } from './wsManager.js';
import { IndicatorBar } from './indicator.js';
```

### Naming Conventions
- **Classes**: PascalCase (e.g., `HyperliquidExtension`, `WsManager`)
- **Methods/Variables**: camelCase (e.g., `initUI`, `sortedTickers`)
- **Private members**: Prefix with underscore (e.g., `this._ws`, `this._onData()`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DESIRED_TICKERS`, `MAX_HISTORY`)
- **GObject classes**: Use `GObject.registerClass()`

### Formatting
- **Indentation**: 4 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Omit optional semicolons
- **Line length**: ~100 characters max
- **Trailing commas**: Use in multi-line objects/arrays

### Error Handling
- Use try-catch for JSON parsing and WebSocket operations
- Log errors with `logError(error, context)`
- Silent fail for non-critical parse errors
- Always cleanup resources in `disable()`

### Memory Management
- Store references to created objects (prefix with `_`)
- Remove GLib sources before re-adding: `GLib.source_remove(id)`
- Destroy UI elements in `disable()`: `this._indicator?.destroy()`
- Set references to `null` after cleanup

### Extension Structure
```javascript
export default class MyExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._indicator = null;
    }
    
    enable() {
        // Create UI, connect signals, start services
    }
    
    disable() {
        // Stop services, destroy UI, cleanup
    }
}
```

### CSS Styling
- Use `style_class` for reusable styles (defined in `stylesheet.css`)
- Use inline `style` for dynamic/one-off styling
- CSS classes follow BEM-like naming: `.hl-component-element`

### Comments
- French comments acceptable (existing convention)
- Explain "why" not "what"
- Document workarounds and magic numbers

### Git Workflow
- No commits without explicit user request
- Follow conventional commits if committing

## Dependencies
- GNOME Shell 45, 46, 47, 48, 49 (declared in `metadata.json`)
- GJS with GObject Introspection
- Native modules: St, GLib, Soup, Cairo, GObject

## File Organization
```
extension.js        # Main extension entry point
metadata.json       # Extension metadata
stylesheet.css      # Styling
wsManager.js        # WebSocket connection manager
indicator.js        # Top panel indicator UI
panelView.js        # Dropdown menu UI with sparklines
```
