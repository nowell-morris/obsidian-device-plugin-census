'use strict';
// Device Census: writes <folder>/<device>.md listing this device's plugins.
// One note per device, so devices never edit the same file through Sync.
const { Plugin, PluginSettingTab, Setting, Notice, Platform, TFile, Modal, requestUrl, normalizePath, apiVersion } = require('obsidian');

const DEFAULTS = { folder: 'syncd-plugins/devices', staleHours: 6 };
const NAME_KEY = 'device-census:device-name';      // per device, never synced
const REPOS_KEY = 'device-census:repos';
const OLD_KEY = 'device-census:old-config-dir';   // per device: folder we moved away from
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

module.exports = class DeviceCensus extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    // Optional <configDir>/device-census-name.txt names a device that has no other
    // way to set it (e.g. Obsidian in Docker, where the hostname is random).
    try { this.fileName = slug((await this.app.vault.adapter.read(normalizePath(this.app.vault.configDir + '/device-census-name.txt'))).trim()); }
    catch (e) { this.fileName = ''; }
    this.addSettingTab(new CensusSettings(this.app, this));
    this.addCommand({ id: 'update-now', name: 'Update this device now', callback: () => this.run(true) });
    this.addCommand({ id: 'move-config-folder', name: 'Move config folder to .obsidian-<device name> and restart', callback: () => this.moveConfig() });
    this.addCommand({ id: 'remove-old-config-folder', name: 'Delete the old config folder (after a move)', callback: () => this.removeOldConfig(false) });
    this.app.workspace.onLayoutReady(() => {
      // Give other plugins time to finish loading before reading the enabled list.
      window.setTimeout(() => this.run(false), 15000);
      this.registerInterval(window.setInterval(() => this.run(false), 15 * 60 * 1000));
    });
  }

  defaultName() {
    const m = this.app.vault.configDir.match(/^\.obsidian-(.+)$/);
    if (m) return slug(m[1]);
    if (this.fileName) return this.fileName;
    if (Platform.isDesktopApp) {
      try { return slug(require('os').hostname().split('.')[0]); } catch (e) { /* ignore */ }
    }
    return '';
  }
  deviceName() { return slug(this.app.loadLocalStorage(NAME_KEY)) || this.defaultName(); }
  setDeviceName(v) { this.app.saveLocalStorage(NAME_KEY, slug(v) || null); }

  targetConfigDir() { const n = this.deviceName(); return n ? '.obsidian-' + n : ''; }

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
    if (!target) { new Notice('Device Census: set a device name first (Settings → Device Census).', 10000); return; }
    if (cur === target) { new Notice(`Device Census: already using ${target}.`); return; }
    if (await a.exists(target)) { new Notice(`Device Census: ${target} already exists, so nothing was copied. Delete it or choose another device name.`, 15000); return; }
    new Notice(`Device Census: copying ${cur} to ${target}…`, 8000);
    try { await this.copyDir(cur, target); }
    catch (e) { new Notice('Device Census: copy failed, nothing was switched. ' + e, 15000); return; }
    this.app.saveLocalStorage(OLD_KEY, cur);
    window.localStorage.setItem(this.app.appId + '-config', target);
    new Notice(`Device Census: restarting with ${target}. The old ${cur} is kept until you delete it.`, 8000);
    window.setTimeout(() => window.location.reload(), 2500);
  }

  async removeOldConfig(skipConfirm) {
    const a = this.app.vault.adapter, cur = this.app.vault.configDir;
    const old = this.app.loadLocalStorage(OLD_KEY) || '.obsidian';
    if (old === cur || !/^\.obsidian/.test(old)) { new Notice(`Device Census: ${cur} is in use; nothing to delete.`); return; }
    if (!(await a.exists(old))) { new Notice(`Device Census: ${old} is already gone.`); this.app.saveLocalStorage(OLD_KEY, null); return; }
    const go = async () => { await a.rmdir(old, true); this.app.saveLocalStorage(OLD_KEY, null); new Notice(`Device Census: deleted ${old}.`); };
    if (skipConfirm) return go();
    new ConfirmModal(this.app, `Delete ${old}?`, `This device now uses ${cur}. Check your plugins and theme look right first. ${old} will be deleted from this device only.`, go).open();
  }

  async repoMap() {
    let cache = null;
    try { cache = JSON.parse(this.app.loadLocalStorage(REPOS_KEY) || 'null'); } catch (e) { cache = null; }
    if (cache && Date.now() - cache.t < REPOS_MAX_AGE) return cache.m;
    try {
      const list = (await requestUrl({ url: REPOS_URL })).json;
      const m = {};
      for (const p of list) if (p.id && p.repo) m[p.id] = 'https://github.com/' + p.repo;
      this.app.saveLocalStorage(REPOS_KEY, JSON.stringify({ t: Date.now(), m }));
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
      const list = (JSON.parse(raw).pluginList || []);
      for (const r of list) { const name = String(r).split('/').pop(); out[name] = 'https://github.com/' + r; }
    } catch (e) { /* BRAT not installed */ }
    return out;
  }

  async run(manual) {
    const device = this.deviceName();
    if (!device) {
      new Notice('Device Census: set a device name in its settings (Settings → Device Census).', 10000);
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
      url: repos[m.id] || brat[m.id] || m.authorUrl || '',
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
      '  - obsidian/plugins',
      '  - device-census',
      'plugins:',
      ...plugins.map(p => '  - ' + JSON.stringify(p)),
    ];
    const table = ps => ['| Plugin | Summary | Version | GitHub |', '|---|---|---|---|',
      ...ps.map(p => `| ${cell(p.name)} | ${cell(p.summary)} | ${cell(p.version)} | ${p.url ? `[link](${p.url})` : ''} |`)].join('\n');
    const body = [
      `# ${device}`, '',
      `Written automatically by the Device Census plugin on this device. Don't edit by hand: it's rewritten when something changes.`, '',
      `## Enabled (${on.length})`, '', table(on), '',
      `## Installed but off (${off.length})`, '', off.length ? table(off) : '_None._', '',
    ].join('\n');

    const path = normalizePath(`${this.settings.folder}/${device}.md`);
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const content = (last) => [...fm, 'last_seen: ' + last, '---', '', body].join('\n');

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const old = await this.app.vault.read(existing);
      const m = old.match(/^last_seen: (.+)$/m);
      const last = m ? m[1].trim() : '';
      const unchanged = last && old === content(last);
      const fresh = last && (Date.now() - Date.parse(last)) < this.settings.staleHours * 3600 * 1000;
      if (unchanged && fresh && !manual) return;   // avoid Sync churn
      await this.app.vault.modify(existing, content(stamp));
    } else {
      const folder = normalizePath(this.settings.folder);
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        try { await this.app.vault.createFolder(folder); } catch (e) { /* exists */ }
      }
      await this.app.vault.create(path, content(stamp));
    }
    if (manual) new Notice(`Device Census: updated ${path}`);
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

class CensusSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('Device name')
      .setDesc(`Stored on this device only. Default comes from the config folder (.obsidian-<name>), a device-census-name.txt file in it, or the computer's hostname. Current config folder: ${this.app.vault.configDir}`)
      .addText(t => t.setPlaceholder(this.plugin.defaultName() || 'e.g. pixel9pro')
        .setValue(this.app.loadLocalStorage(NAME_KEY) || '')
        .onChange(v => this.plugin.setDeviceName(v)));
    new Setting(containerEl)
      .setName('Folder for device notes')
      .addText(t => t.setValue(this.plugin.settings.folder).onChange(async v => {
        this.plugin.settings.folder = v.trim() || DEFAULTS.folder; await this.plugin.saveData(this.plugin.settings);
      }));
    const target = this.plugin.targetConfigDir();
    new Setting(containerEl)
      .setName('Config folder')
      .setDesc(this.app.vault.configDir === target
        ? `Using ${target}.`
        : `Using ${this.app.vault.configDir}. Move copies it to ${target || '.obsidian-<device name>'}, switches Obsidian to the copy and restarts. The old folder stays until you delete it.`)
      .addButton(b => b.setButtonText('Move and restart').setDisabled(!target || this.app.vault.configDir === target).onClick(() => this.plugin.moveConfig()))
      .addButton(b => b.setButtonText('Delete old folder').onClick(() => this.plugin.removeOldConfig(false)));
    new Setting(containerEl)
      .setName('Update now')
      .setDesc(`Writes ${this.plugin.settings.folder}/${this.plugin.deviceName() || '<device>'}.md`)
      .addButton(b => b.setButtonText('Update').onClick(() => this.plugin.run(true)));
  }
}
