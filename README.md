# Device Plugin Census for Obsidian

See which plugins are installed and enabled on each of your devices, side by side, and what's missing where. Works on desktop, Android and iOS, with any sync method (built for Obsidian Sync).

## How it works

- **A new device checks first.** Until a device has written its note, the plugin writes nothing. It opens a setup window listing the devices already reporting, the folder they use and the dashboard, suggests a name (from the config folder, hostname or Obsidian Sync's device name), and waits for you to confirm. If it finds nothing, it says so, so you can wait for sync to finish and press *Check again*. Devices that already have a note skip this.
- **Each device writes its own note** into a data folder (default `Device Plugin Census/`), named after the device: every installed plugin with its version, whether it's enabled, a short summary and its GitHub link. It runs on every start and every 15 minutes while Obsidian is open, and only rewrites the note when something changed (or every 6 hours to refresh `last_seen`). Devices never edit the same file, so sync never conflicts.
- **A dashboard note compares the devices.** The plugin creates it the first time it runs, at the path in settings (default `Device Plugin Census.md`): a devices table, a "wanted on every device" checklist, and a table of every plugin with one column per device. It needs the **Dataview** plugin with JavaScript queries enabled. It's recognised by its `census_dashboard` property, so you can rename, move and edit it freely; the plugin never overwrites it or makes a second one. (When other devices already report, a newly installed device waits 15 minutes before creating one, so sync can bring the existing dashboard in first.) *Create dashboard note* makes one on demand, and the automatic creation can be turned off.
- The plugin list is also in each device note's properties (`plugins:`), if you'd rather build your own views.

## Settings

| Setting | Stored | Default |
|---|---|---|
| Device name | on this device only | config folder `.obsidian-<name>`, a `device-plugin-census-name.txt` file in it, the hostname (desktop), or Obsidian Sync's device name |
| Data folder | plugin settings | the folder other devices already write to, else `Device Plugin Census` |
| Dashboard note | plugin settings | `Device Plugin Census.md` |

Phones and tablets confirm a device name once, in the setup window. A new device finds an existing data folder by itself, even if plugin settings don't sync.

## Per-device config folders (optional)

With Obsidian Sync every device can keep its own settings in its own config folder (*Files and links → Override config folder*). **Move and restart** does that safely: it copies the current config folder to `.obsidian-<device name>`, switches Obsidian to the copy and restarts. **Delete old folder** removes the original once you've checked everything came across. Also available as commands.

## Install with BRAT

1. Install **BRAT** from Community plugins.
2. BRAT → *Add beta plugin* → `nowell-morris/obsidian-device-plugin-census`.
3. Enable **Device Plugin Census**. After sync has finished, confirm the name and folder in the setup window (or Settings → Device Plugin Census → *Set up*).

## Network use

Once a week it downloads Obsidian's public plugin list (`obsidianmd/obsidian-releases`, `community-plugins.json`) to find each plugin's GitHub link. Nothing is sent anywhere.

## Upgrading from Device Census 1.x

The id changed from `device-census` to `device-plugin-census`. Install this one, then disable and remove the old one. Device names and the remembered old config folder carry over. Set *Data folder* if you used a custom one (1.x defaulted to `syncd-plugins/devices`); otherwise it's found from the existing notes.

## License

MIT
