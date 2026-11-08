# Device Census for Obsidian

Keeps track of which plugins are installed and enabled on each of your devices, so you can compare them and see what's missing where. Works on desktop, Android and iOS.

## What it does

- **On every start** (and every 15 minutes while Obsidian is open), writes one note per device, by default `syncd-plugins/devices/<device>.md`. The note lists every installed plugin with its version, whether it's enabled, a short summary and its GitHub link.
- **One note per device**, so devices syncing the same vault never edit the same file. It only rewrites the note when something changed, or every 6 hours to refresh `last_seen`.
- The plugin list is in the note's properties (`plugins:`), ready for Dataview or Bases to build a dashboard across devices.
- **Move config folder** (optional): copies the current config folder to `.obsidian-<device>`, switches Obsidian to it (the same setting as *Files and links → Override config folder*) and restarts. A second command deletes the old folder after you've checked everything came across. Handy with Obsidian Sync when every device should keep its own settings.

## Device name

Stored on each device only (not synced). If you don't set one, it comes from:

1. the config folder name, if it's `.obsidian-<name>`;
2. a `device-census-name.txt` file in the config folder (for setups with no other way, e.g. Obsidian in Docker);
3. the computer's hostname (desktop only).

Phones and tablets need a name set once in *Settings → Device Census*.

## Install with BRAT

1. Install **BRAT** from Community plugins.
2. BRAT → *Add beta plugin* → `nowell-morris/obsidian-device-census`.
3. Enable **Device Census**, then set the device name in its settings.

## Network use

Once a week it downloads Obsidian's public plugin list (`obsidianmd/obsidian-releases`, `community-plugins.json`) to find each plugin's GitHub link. Nothing is sent anywhere.

## Example Dataview dashboard

```dataviewjs
const devs = dv.pages('"syncd-plugins/devices"').where(p => p.device).sort(p => p.device);
const all = new Map();
for (const d of devs) for (const p of (d.plugins || [])) {
  const e = all.get(p.id) || { name: p.name, summary: p.summary, st: {} };
  e.st[d.device] = p.enabled ? "✅" : "⏸";
  all.set(p.id, e);
}
dv.table(["Plugin", "What it does", ...devs.map(d => d.device)],
  [...all.values()].sort((a, b) => a.name.localeCompare(b.name))
    .map(e => [e.name, e.summary, ...devs.map(d => e.st[d.device] || "—")]));
```

## License

MIT
