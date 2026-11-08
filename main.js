'use strict';
// Device Plugin Census: each device writes <data folder>/<device>.md listing its
// plugins (one note per device, so devices never edit the same file through Sync).
// A dashboard note (Dataview) compares the devices. Optionally moves the config
// folder to .obsidian-<device>.
const { Plugin, PluginSettingTab, Setting, Notice, Platform, TFile, TFolder, Modal, requestUrl, normalizePath, apiVersion } = require('obsidian');

const DEFAULT_FOLDER = 'Device Plugin Census';
const DEFAULT_DASHBOARD = 'Device Plugin Census.md';
const STALE_HOURS = 6;
const PREFIX = 'device-plugin-census:';
const OLD_PREFIX = 'device-census:';               // keys from 1.x, read once
const NAME_KEY = 'device-name';                    // per device, never synced
const REPOS_KEY = 'repos';
const OLD_DIR_KEY = 'old-config-dir';              // per device: folder we moved away from
const SETUP_KEY = 'setup-done';                    // per device: user confirmed name and folder
const NAME_FILES = ['device-plugin-census-name.txt', 'device-census-name.txt'];
const REPOS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
const REPOS_MAX_AGE = 7 * 24 * 3600 * 1000;

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const cell = s => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function summarize(desc) {
  if (!desc) return '';
  let s = String(desc).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].replace(/[.!]$/, '');
  const w = s.split(' ');
  return w.length > 10 ? w.slice(0, 10).join(' ') + '…' : s;
}

function platformName() {
  if (Platform.isAndroidApp) return Platform.isTablet ? 'android-tablet' : 'android-phone';
  if (Platform.isIosApp) return Platform.isTablet ? 'ipad' : 'iphone';
  if (Platform.isMacOS) return 'macos';
  if (Platform.isWin) return 'windows';
  if (Platform.isLinux) return 'linux';
  return 'unknown';
}

// Dashboard note created by the "Create dashboard note" command. The queries ask
// the plugin for its data folder, so changing the folder later needs no edits here.
const DASHBOARD = `---
tags:
  - device-plugin-census
census_dashboard: true
want_everywhere: []
---
# Device Plugin Census

Every Obsidian plugin on every device. Each device running **Device Plugin Census** keeps its own note in the data folder; these tables (Dataview) compare them. Needs the **Dataview** plugin with JavaScript queries enabled.

✅ enabled · ⏸ installed but off · — not installed

## Devices

\`\`\`dataviewjs
const folder = app.plugins.plugins["device-plugin-census"]?.dataFolder?.() ?? "${DEFAULT_FOLDER}";
const devs = dv.pages(\`"\${folder}"\`).where(p => p.device && p.census_version).sort(p => p.device);
const ago = t => { if (!t) return ""; const h = (Date.now() - new Date(String(t)).getTime()) / 36e5;
  return h < 1 ? "< 1 h ago" : h < 48 ? Math.round(h) + " h ago" : Math.round(h / 24) + " days ago"; };
dv.table(["Device", "Platform", "Config folder", "Obsidian", "Last seen", "Enabled", "Installed"],
  devs.map(p => [p.file.link, p.platform, "\`" + p.config_dir + "\`", p.obsidian_api, ago(p.last_seen), p.enabled_count, p.installed_count]));
if (!devs.length) dv.paragraph("_No devices have reported yet._");
\`\`\`

## Wanted on every device

Add plugin ids to \`want_everywhere\` in this note's properties.

\`\`\`dataviewjs
const folder = app.plugins.plugins["device-plugin-census"]?.dataFolder?.() ?? "${DEFAULT_FOLDER}";
const devs = dv.pages(\`"\${folder}"\`).where(p => p.device && p.census_version).sort(p => p.device);
const want = dv.current().want_everywhere || [];
if (!want.length) dv.paragraph("_Nothing listed yet._");
else dv.table(["Plugin", ...devs.map(d => d.device), "Not enabled on"], want.map(id => {
  const st = devs.map(d => { const x = (d.plugins || []).find(p => p.id === id); return x ? (x.enabled ? "✅" : "⏸") : "—"; });
  const any = devs.flatMap(d => d.plugins || []).find(p => p.id === id);
  const missing = devs.filter((d, i) => st[i] !== "✅").map(d => d.device);
  return [any ? any.name : id, ...st, missing.length ? missing.join(", ") : "everywhere ✓"];
}));
\`\`\`

## Every plugin

\`\`\`dataviewjs
const folder = app.plugins.plugins["device-plugin-census"]?.dataFolder?.() ?? "${DEFAULT_FOLDER}";
const devs = dv.pages(\`"\${folder}"\`).where(p => p.device && p.census_version).sort(p => p.device);
const names = devs.map(d => d.device).array();
const all = new Map();
for (const d of devs) for (const p of (d.plugins || [])) {
  const e = all.get(p.id) || { name: p.name, summary: p.summary, url: p.url, st: {} };
  if (!e.url && p.url) e.url = p.url;
  if (!e.summary && p.summary) e.summary = p.summary;
  e.st[d.device] = p.enabled ? "✅" : "⏸";
  all.set(p.id, e);
}
const link = u => !u ? "" : u.includes("github.com/") ? \`[\${u.replace(/^https:\\/\\/github\\.com\\//, "")}](\${u})\` : \`[site](\${u})\`;
const rows = [...all.values()].sort((a, b) => a.name.localeCompare(b.name)).map(e => [
  e.name, link(e.url), e.summary || "", ...names.map(n => e.st[n] || "—"),
  \`\${names.filter(n => e.st[n] === "✅").length}/\${names.length}\`]);
dv.paragraph(\`**\${rows.length} plugins across \${names.length} devices**\`);
dv.table(["Plugin", "GitHub", "What it does", ...names, "On"], rows);
\`\`\`

## Adding a device

1. Install **BRAT** from Community plugins, then BRAT → *Add beta plugin* → \`nowell-morris/obsidian-device-plugin-census\`.
2. Enable **Device Plugin Census** and set the device name in its settings (phones and tablets need this once).
3. Optional: **Move and restart** in its settings gives the device its own config folder, \`.obsidian-<device name>\`. Afterwards **Delete old folder** removes the original.

The device shows up here within about 15 seconds of Obsidian starting.
`;

module.exports = class DevicePluginCensus extends Plugin {
  async onload() {
    this.settings = Object.assign({}, await this.loadData());   // only what the user set
    this.fileName = '';
    for (const f of NAME_FILES) {
      try { this.fileName = slug((await this.app.vault.adapter.read(normalizePath(this.app.vault.configDir + '/' + f))).trim()); }
      catch (e) { /* no file */ }
      if (this.fileName) break;
    }
    this.addSettingTab(new CensusSettings(this.app, this));
    this.addCommand({ id: 'update-now', name: 'Update this device now', callback: () => this.run(true) });
    this.addCommand({ id: 'create-dashboard', name: 'Create dashboard note', callback: () => this.createDashboard() });
    this.addCommand({ id: 'move-config-folder', name: 'Move config folder to .obsidian-<device name> and restart', callback: () => this.moveConfig() });
    this.addCommand({ id: 'remove-old-config-folder', name: 'Delete the old config folder (after a move)', callback: () => this.removeOldConfig(false) });
    this.app.workspace.onLayoutReady(() => {
      // Give other plugins time to finish loading before reading the enabled list.
      window.setTimeout(() => this.run(false), 15000);
      this.registerInterval(window.setInterval(() => this.run(false), 15 * 60 * 1000));
    });
  }

  // Per-device storage, with a one-time read of the 1.x key names.
  local(key) {
    const v = this.app.loadLocalStorage(PREFIX + key);
    if (v !== null && v !== undefined) return v;
    const old = this.app.loadLocalStorage(OLD_PREFIX + key);
    return old === undefined ? null : old;
  }
  setLocal(key, v) { this.app.saveLocalStorage(PREFIX + key, v); }

  // Data folder: the user's setting; else wherever other devices already write
  // (so a new device joins them without being told); else the default.
  dataFolder() {
    if (this.settings.folder) return normalizePath(this.settings.folder);
    const found = this.app.vault.getMarkdownFiles().find(f => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      return fm && fm.census_version && fm.device && Array.isArray(fm.plugins);
    });
    return found && found.parent ? found.parent.path : DEFAULT_FOLDER;
  }
  dashboardPath() {
    let p = (this.settings.dashboard || DEFAULT_DASHBOARD).trim();
    if (!p.endsWith('.md')) p += '.md';
    return normalizePath(p);
  }
  async saveSetting(key, value) {
    if (value) this.settings[key] = value; else delete this.settings[key];
    await this.saveData(this.settings);
  }

  defaultName() {
    const m = this.app.vault.configDir.match(/^\.obsidian-(.+)$/);
    if (m) return slug(m[1]);
    if (this.fileName) return this.fileName;
    if (Platform.isDesktopApp) {
      try { const h = slug(require('os').hostname().split('.')[0]); if (h) return h; } catch (e) { /* ignore */ }
    }
    const s = this.syncNames();
    return s.set || s.auto || '';
  }
  // Obsidian Sync's "Device name" setting (and its default, e.g. the phone model).
  syncNames() {
    try {
      const inst = this.app.internalPlugins?.getPluginById?.('sync')?.instance;
      if (!inst) return {};
      let auto = '';
      try { auto = slug(inst.getDefaultDeviceName?.()); } catch (e) { /* ignore */ }
      return { set: slug(inst.deviceName), auto };
    } catch (e) { return {}; }
  }
  syncEnabled() {
    try { return !!this.app.internalPlugins?.getPluginById?.('sync')?.enabled; } catch (e) { return false; }
  }

  // Everything the vault already holds from other devices.
  survey() {
    const notes = [], dashboards = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      if (fm.census_dashboard) dashboards.push(f.path);
      if (fm.census_version && fm.device && Array.isArray(fm.plugins))
        notes.push({ device: String(fm.device), platform: fm.platform || '', last: fm.last_seen || '', folder: f.parent ? f.parent.path : '', path: f.path });
    }
    notes.sort((a, b) => a.device.localeCompare(b.device));
    const folders = [...new Set(notes.map(n => n.folder))];
    return { notes, dashboards, folders };
  }
  // A device counts as set up once it confirmed, or once its own note exists.
  isSetUp() {
    if (this.local(SETUP_KEY)) return true;
    const n = this.deviceName();
    return !!(n && this.app.vault.getAbstractFileByPath(normalizePath(`${this.dataFolder()}/${n}.md`)));
  }
  openSetup() { new SetupModal(this.app, this).open(); }
  deviceName() { return slug(this.local(NAME_KEY)) || this.defaultName(); }
  setDeviceName(v) { this.setLocal(NAME_KEY, slug(v) || null); }
  targetConfigDir() { const n = this.deviceName(); return n ? '.obsidian-' + n : ''; }

  async ensureFolder(path) {
    const parts = normalizePath(path).split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (p && !this.app.vault.getAbstractFileByPath(p)) {
        try { await this.app.vault.createFolder(p); } catch (e) { /* exists */ }
      }
    }
  }

  // The dashboard is recognised by its census_dashboard property, wherever it is,
  // so renaming or moving it never leads to a second one.
  dashboardExists() {
    if (this.app.vault.getAbstractFileByPath(this.dashboardPath())) return true;
    return this.app.vault.getMarkdownFiles().some(f => this.app.metadataCache.getFileCache(f)?.frontmatter?.census_dashboard);
  }

  async autoDashboard(firstRun) {
    if (this.settings.autoDashboard === false || this.dashboardExists()) return;
    // Other devices already report: on this start, give Sync time to bring in their
    // dashboard before making one (the next check is 15 minutes later).
    const me = this.deviceName();
    const others = this.app.vault.getMarkdownFiles().some(f => {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      return fm && fm.census_version && fm.device && fm.device !== me;
    });
    if (firstRun && others) return;
    await this.createDashboard(false);
  }

  async createDashboard(open = true) {
    const path = this.dashboardPath();
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`Device Plugin Census: ${path} already exists, so it was left alone. Rename or delete it to create a fresh one.`, 12000);
      return;
    }
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) await this.ensureFolder(dir);
    const file = await this.app.vault.create(path, DASHBOARD);
    if (!open) { new Notice(`Device Plugin Census: created the dashboard, ${path}.`, 8000); return; }
    await this.app.workspace.getLeaf(true).openFile(file);
    if (!this.app.plugins.enabledPlugins.has('dataview')) {
      new Notice('Device Plugin Census: the dashboard needs the Dataview plugin, with JavaScript queries turned on.', 12000);
    }
  }

  async copyDir(src, dst) {
    const a = this.app.vault.adapter;
    if (!(await a.exists(dst))) await a.mkdir(dst);
    const { files, folders } = await a.list(src);
    for (const f of files) await a.writeBinary(dst + '/' + f.split('/').pop(), await a.readBinary(f));
    for (const d of folders) await this.copyDir(d, dst + '/' + d.split('/').pop());
  }

  // Copy the current config folder to .obsidian-<device>, point Obsidian at it
  // (the same setting as Settings > Files and links > Override config folder), restart.
  async moveConfig() {
    const a = this.app.vault.adapter, cur = this.app.vault.configDir, target = this.targetConfigDir();
    if (!target) { new Notice('Device Plugin Census: set a device name first (in its settings).', 10000); return; }
    if (cur === target) { new Notice(`Device Plugin Census: already using ${target}.`); return; }
    if (await a.exists(target)) { new Notice(`Device Plugin Census: ${target} already exists, so nothing was copied. Delete it or choose another device name.`, 15000); return; }
    new Notice(`Device Plugin Census: copying ${cur} to ${target}…`, 8000);
    try { await this.copyDir(cur, target); }
    catch (e) { new Notice('Device Plugin Census: copy failed, nothing was switched. ' + e, 15000); return; }
    this.setLocal(OLD_DIR_KEY, cur);
    window.localStorage.setItem(this.app.appId + '-config', target);
    new Notice(`Device Plugin Census: restarting with ${target}. The old ${cur} is kept until you delete it.`, 8000);
    window.setTimeout(() => window.location.reload(), 2500);
  }

  async removeOldConfig(skipConfirm) {
    const a = this.app.vault.adapter, cur = this.app.vault.configDir;
    const old = this.local(OLD_DIR_KEY) || '.obsidian';
    if (old === cur || !/^\.obsidian/.test(old)) { new Notice(`Device Plugin Census: ${cur} is in use; nothing to delete.`); return; }
    if (!(await a.exists(old))) { new Notice(`Device Plugin Census: ${old} is already gone.`); this.setLocal(OLD_DIR_KEY, null); return; }
    const go = async () => { await a.rmdir(old, true); this.setLocal(OLD_DIR_KEY, null); new Notice(`Device Plugin Census: deleted ${old}.`); };
    if (skipConfirm) return go();
    new ConfirmModal(this.app, `Delete ${old}?`, `This device now uses ${cur}. Check your plugins and theme look right first. ${old} will be deleted from this device only.`, go).open();
  }

  async repoMap() {
    let cache = null;
    try { cache = JSON.parse(this.local(REPOS_KEY) || 'null'); } catch (e) { cache = null; }
    if (cache && Date.now() - cache.t < REPOS_MAX_AGE) return cache.m;
    try {
      const list = (await requestUrl({ url: REPOS_URL })).json;
      const m = {};
      for (const p of list) if (p.id && p.repo) m[p.id] = 'https://github.com/' + p.repo;
      this.setLocal(REPOS_KEY, JSON.stringify({ t: Date.now(), m }));
      return m;
    } catch (e) {
      return cache ? cache.m : {};   // offline: use the old list, or none
    }
  }

  async bratRepos() {
    // BRAT (beta) plugins aren't in the community list; BRAT keeps "owner/repo" entries.
    const out = {};
    try {
      const raw = await this.app.vault.adapter.read(normalizePath(this.app.vault.configDir + '/plugins/obsidian42-brat/data.json'));
      for (const r of (JSON.parse(raw).pluginList || [])) out[String(r).split('/').pop()] = 'https://github.com/' + r;
    } catch (e) { /* BRAT not installed */ }
    return out;
  }

  async run(manual) {
    // A new device writes nothing until the user has seen what's already in the
    // vault and confirmed its name and folder.
    if (!this.isSetUp()) {
      if (manual || !this.setupShown) { this.setupShown = true; this.openSetup(); }
      return;
    }
    const device = this.deviceName();
    if (!device) {
      new Notice('Device Plugin Census: set a device name in its settings.', 10000);
      return;
    }
    const pm = this.app.plugins;
    const enabled = pm.enabledPlugins || new Set();
    const repos = await this.repoMap();
    const brat = await this.bratRepos();
    const plugins = Object.values(pm.manifests || {}).map(m => ({
      id: m.id,
      name: m.name || m.id,
      version: m.version || '',
      enabled: enabled.has(m.id),
      summary: summarize(m.description),
      url: repos[m.id] || brat[m.id] || brat[m.id.replace(/^obsidian-/, '')] || m.authorUrl || '',
    })).sort((a, b) => a.name.localeCompare(b.name));

    const on = plugins.filter(p => p.enabled), off = plugins.filter(p => !p.enabled);
    const fm = [
      '---',
      'device: ' + JSON.stringify(device),
      'platform: ' + platformName(),
      'config_dir: ' + JSON.stringify(this.app.vault.configDir),
      'obsidian_api: ' + JSON.stringify(apiVersion),
      'census_version: ' + JSON.stringify(this.manifest.version),
      'enabled_count: ' + on.length,
      'installed_count: ' + plugins.length,
      'tags:',
      '  - device-plugin-census',
      'plugins:',
      ...plugins.map(p => '  - ' + JSON.stringify(p)),
    ];
    const table = ps => ['| Plugin | Summary | Version | GitHub |', '|---|---|---|---|',
      ...ps.map(p => `| ${cell(p.name)} | ${cell(p.summary)} | ${cell(p.version)} | ${p.url ? `[link](${p.url})` : ''} |`)].join('\n');
    const body = [
      `# ${device}`, '',
      `Written automatically by Device Plugin Census on this device. Don't edit by hand: it's rewritten when something changes.`, '',
      `## Enabled (${on.length})`, '', table(on), '',
      `## Installed but off (${off.length})`, '', off.length ? table(off) : '_None._', '',
    ].join('\n');

    const folder = this.dataFolder();
    const path = normalizePath(`${folder}/${device}.md`);
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const content = (last) => [...fm, 'last_seen: ' + last, '---', '', body].join('\n');

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const old = await this.app.vault.read(existing);
      const m = old.match(/^last_seen: (.+)$/m);
      const last = m ? m[1].trim() : '';
      const unchanged = last && old === content(last);
      const fresh = last && (Date.now() - Date.parse(last)) < STALE_HOURS * 3600 * 1000;
      if (!(unchanged && fresh && !manual)) await this.app.vault.modify(existing, content(stamp));   // else: avoid Sync churn
    } else {
      await this.ensureFolder(folder);
      await this.app.vault.create(path, content(stamp));
    }
    if (manual) new Notice(`Device Plugin Census: updated ${path}`);
    const firstRun = !this.ranOnce && !manual;
    this.ranOnce = true;
    await this.autoDashboard(firstRun);
  }
};

class ConfirmModal extends Modal {
  constructor(app, title, text, onYes) { super(app); this.t = title; this.x = text; this.onYes = onYes; }
  onOpen() {
    this.titleEl.setText(this.t);
    this.contentEl.createEl('p', { text: this.x });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Delete').setWarning().onClick(async () => { this.close(); await this.onYes(); }));
  }
  onClose() { this.contentEl.empty(); }
}

class SetupModal extends Modal {
  constructor(app, plugin) { super(app); this.p = plugin; this.name = ''; this.folder = ''; }
  onOpen() { this.render(); }
  render() {
    const p = this.p, c = this.contentEl, s = p.survey();
    c.empty();
    this.titleEl.setText('Device Plugin Census: set up this device');
    c.createEl('p', { text: "Before writing anything, here is what's already in this vault." });

    if (s.notes.length) {
      c.createEl('p', { text: `Devices already reporting (${s.notes.length}):` });
      const ul = c.createEl('ul');
      for (const n of s.notes) ul.createEl('li', { text: `${n.device} (${n.platform || '?'}), last seen ${n.last || '?'}, in ${n.folder || '/'}` });
    } else {
      const w = c.createEl('p');
      w.createEl('strong', { text: 'No other devices found. ' });
      w.appendText(p.syncEnabled()
        ? "Obsidian Sync is on but may not have finished downloading. Wait until it's done, then press Check again."
        : 'If this vault is synced some other way, wait for it to finish, then press Check again. Otherwise this device starts a new census.');
    }
    c.createEl('p', { text: s.dashboards.length ? `Dashboard: ${s.dashboards.join(', ')}` : `Dashboard: none yet${p.settings.autoDashboard === false ? '' : ` (one will be created at ${p.dashboardPath()})`}.` });

    // Name: suggestions from what this device and the vault already know.
    if (!this.name) this.name = p.deviceName();
    const sn = p.syncNames();
    const sugg = [...new Set([p.deviceName(), p.defaultName(), p.fileName, sn.set, sn.auto, ...s.notes.map(n => n.device)].filter(Boolean))];
    const nameSet = new Setting(c).setName('Device name')
      .setDesc('Used for the note name and the config folder (.obsidian-<name>). Pick an existing device only if this is that device reinstalled.')
      .addText(t => t.setPlaceholder('e.g. pixel9pro').setValue(this.name).onChange(v => { this.name = slug(v); warn(); }));
    const sg = c.createDiv();
    for (const n of sugg) {
      const b = sg.createEl('button', { text: n });
      b.style.marginRight = '6px';
      b.onclick = () => { this.name = n; this.render(); };
    }
    const warnEl = c.createEl('p');
    const warn = () => {
      const taken = s.notes.find(n => n.device === this.name);
      warnEl.setText(taken ? `Note: ${this.name} already reports from ${taken.platform || 'another device'}; this device would take over its note.` : '');
    };
    warn();

    // Folder: the setting, else where others write, else the default.
    if (!this.folder) this.folder = p.settings.folder || s.folders[0] || DEFAULT_FOLDER;
    const opts = [...new Set([this.folder, ...s.folders, DEFAULT_FOLDER])];
    new Setting(c).setName('Data folder')
      .setDesc(s.folders.length > 1 ? 'Devices are writing to more than one folder; pick one.' : 'Where each device writes its note.')
      .addDropdown(d => { for (const o of opts) d.addOption(o, o); d.setValue(this.folder).onChange(v => { this.folder = v; }); });

    new Setting(c)
      .addButton(b => b.setButtonText('Check again').onClick(() => this.render()))
      .addButton(b => b.setButtonText('Not now').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Confirm and write').setCta().onClick(async () => {
        if (!this.name) { new Notice('Device Plugin Census: enter a device name.'); return; }
        if (this.name !== p.defaultName()) p.setDeviceName(this.name);
        await p.saveSetting('folder', this.folder);
        p.setLocal(SETUP_KEY, '1');
        this.close();
        await p.run(true);
      }));
  }
  onClose() { this.contentEl.empty(); }
}

class CensusSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this, p = this.plugin;
    containerEl.empty();
    if (!p.isSetUp()) new Setting(containerEl)
      .setName('Set up this device')
      .setDesc("This device hasn't written its note yet. Setup shows what's already in the vault before anything is written.")
      .addButton(b => b.setButtonText('Set up').setCta().onClick(() => p.openSetup()));
    new Setting(containerEl)
      .setName('Device name')
      .setDesc(`Stored on this device only. If empty, it comes from the config folder (.obsidian-<name>), a device-plugin-census-name.txt file in it, the computer's hostname, or Obsidian Sync's device name. Now: ${p.deviceName() || '(none, please set one)'}`)
      .addText(t => t.setPlaceholder(p.defaultName() || 'e.g. pixel9pro')
        .setValue(p.local(NAME_KEY) || '')
        .onChange(v => p.setDeviceName(v)));
    new Setting(containerEl)
      .setName('Data folder')
      .setDesc(`Where each device writes its note. If empty, a new device uses the folder other devices already write to, or "${DEFAULT_FOLDER}". Now: ${p.dataFolder()}`)
      .addText(t => t.setPlaceholder(p.dataFolder()).setValue(p.settings.folder || '')
        .onChange(v => p.saveSetting('folder', v.trim())));
    new Setting(containerEl)
      .setName('Dashboard note')
      .setDesc('Path of the dashboard note that compares devices (needs Dataview). Create makes it if it doesn\'t exist; an existing note is never overwritten.')
      .addText(t => t.setPlaceholder(DEFAULT_DASHBOARD).setValue(p.settings.dashboard || '')
        .onChange(v => p.saveSetting('dashboard', v.trim())))
      .addButton(b => b.setButtonText('Create').onClick(() => p.createDashboard()));
    new Setting(containerEl)
      .setName('Create the dashboard automatically')
      .setDesc('If no dashboard note exists anywhere in the vault, create one. It is recognised by its census_dashboard property, so renaming or moving it is fine.')
      .addToggle(t => t.setValue(p.settings.autoDashboard !== false)
        .onChange(async v => { p.settings.autoDashboard = v; await p.saveData(p.settings); }));
    const target = p.targetConfigDir();
    new Setting(containerEl)
      .setName('Config folder')
      .setDesc(this.app.vault.configDir === target
        ? `Using ${target}.`
        : `Using ${this.app.vault.configDir}. Move copies it to ${target || '.obsidian-<device name>'}, switches Obsidian to the copy and restarts. The old folder stays until you delete it.`)
      .addButton(b => b.setButtonText('Move and restart').setDisabled(!target || this.app.vault.configDir === target).onClick(() => p.moveConfig()))
      .addButton(b => b.setButtonText('Delete old folder').onClick(() => p.removeOldConfig(false)));
    new Setting(containerEl)
      .setName('Update now')
      .setDesc(`Writes ${p.dataFolder()}/${p.deviceName() || '<device>'}.md`)
      .addButton(b => b.setButtonText('Update').onClick(() => p.run(true)));
  }
}
