import type { ResolvedLocale } from './locales.js'

/** Flat message catalog keys used across the renderer. */
export type MessageKey =
  | 'locale.system'
  | 'locale.en'
  | 'locale.zhCN'
  | 'common.settings'
  | 'common.done'
  | 'common.cancel'
  | 'common.disconnect'
  | 'common.resetDefaults'
  | 'common.resetAll'
  | 'topbar.reconnecting'
  | 'topbar.commandPalette'
  | 'topbar.settings'
  | 'topbar.toggleToolSidebar'
  | 'topbar.hideSidebar'
  | 'topbar.showSidebar'
  | 'toolbar.pasteImage'
  | 'toolbar.orFileDropFind'
  | 'toolbar.terminalOnlyFind'
  | 'toolbar.unavailableReconnect'
  | 'toolbar.provider'
  | 'toolbar.interactiveRepl'
  | 'reconnect.banner'
  | 'reconnect.pasteDisabled'
  | 'reconnect.cancel'
  | 'sidebar.imageOff'
  | 'sidebar.enableFeaturesFirst'
  | 'status.dismissHint'
  | 'palette.hideToolSidebar'
  | 'palette.showToolSidebar'
  | 'palette.toggleToolSidebarHint'
  | 'rail.title'
  | 'rail.new'
  | 'rail.close'
  | 'rail.renamePrompt'
  | 'rail.renameHint'
  | 'rail.dragHint'
  | 'rail.unread'
  | 'palette.newSession'
  | 'palette.newSessionHint'
  | 'palette.switchSession'
  | 'drop.overlay'
  | 'drop.warnImage'
  | 'drop.pathError'
  | 'connect.title'
  | 'connect.hubTitle'
  | 'connect.hubSubtitle'
  | 'connect.localTitle'
  | 'connect.localDesc'
  | 'connect.sshTitle'
  | 'connect.sshDesc'
  | 'connect.localStarting'
  | 'connect.backToChooser'
  | 'settings.general.defaultSessionKind'
  | 'settings.general.defaultSessionKindHint'
  | 'settings.general.kindLocal'
  | 'settings.general.kindSsh'
  | 'settings.general.kindAsk'
  | 'connect.host'
  | 'connect.hostPlaceholder'
  | 'connect.user'
  | 'connect.port'
  | 'connect.password'
  | 'connect.privateKey'
  | 'connect.passphrase'
  | 'connect.agent'
  | 'connect.agentHint'
  | 'connect.browse'
  | 'connect.submit'
  | 'connect.connecting'
  | 'connect.fromConfig'
  | 'auth.password'
  | 'auth.key'
  | 'auth.agent'
  | 'settings.title'
  | 'settings.nav.general'
  | 'settings.nav.generalHint'
  | 'settings.nav.terminal'
  | 'settings.nav.terminalHint'
  | 'settings.nav.tmux'
  | 'settings.nav.tmuxHint'
  | 'settings.nav.image'
  | 'settings.nav.imageHint'
  | 'settings.nav.about'
  | 'settings.nav.aboutHint'
  | 'settings.general.lead'
  | 'settings.general.terminalOnly'
  | 'settings.general.terminalOnlyHint'
  | 'settings.general.autoUpdate'
  | 'settings.general.autoUpdateHint'
  | 'settings.general.confirmCache'
  | 'settings.general.confirmCacheHint'
  | 'settings.general.l2Note'
  | 'settings.general.imageBridge'
  | 'settings.general.portForwards'
  | 'settings.general.showToolSidebar'
  | 'settings.general.showToolSidebarHint'
  | 'settings.general.providerDetect'
  | 'settings.general.language'
  | 'settings.general.languageHint'
  | 'settings.terminal.lead'
  | 'settings.terminal.theme'
  | 'settings.terminal.font'
  | 'settings.terminal.fontSize'
  | 'settings.terminal.lineHeight'
  | 'settings.terminal.scrollback'
  | 'settings.terminal.copyOnSelect'
  | 'settings.terminal.copyOnSelectHint'
  | 'settings.terminal.webgl'
  | 'settings.terminal.webglHint'
  | 'settings.terminal.reset'
  | 'settings.tmux.lead'
  | 'settings.tmux.syncClipboard'
  | 'settings.tmux.syncClipboardHint'
  | 'settings.tmux.afterConnect'
  | 'settings.tmux.modeOff'
  | 'settings.tmux.modeAttach'
  | 'settings.tmux.modeAlways'
  | 'settings.tmux.sessionName'
  | 'settings.tmux.tips'
  | 'settings.tmux.tipDetach'
  | 'settings.tmux.tipReconnect'
  | 'settings.tmux.tipPalette'
  | 'settings.tmux.tipBuffer'
  | 'settings.image.lead'
  | 'settings.image.defaultPrompt'
  | 'settings.image.skipDialog'
  | 'settings.image.skipDialogHint'
  | 'settings.image.note'
  | 'settings.about.updates'
  | 'settings.about.check'
  | 'settings.about.install'
  | 'settings.about.dev'
  | 'settings.about.keyboard'
  | 'settings.about.workflow'
  | 'palette.pasteImage'
  | 'palette.pasteImageHint'
  | 'palette.uploadClipboard'
  | 'palette.uploadClipboardHint'
  | 'palette.uploadFile'
  | 'palette.uploadFileHint'
  | 'palette.detectProvider'
  | 'palette.detectProviderHint'
  | 'palette.clearCache'
  | 'palette.clearCacheHint'
  | 'palette.settings'
  | 'palette.settingsHint'
  | 'palette.terminalSettings'
  | 'palette.terminalSettingsHint'
  | 'palette.tmuxSettings'
  | 'palette.tmuxSettingsHint'
  | 'palette.tmuxEnter'
  | 'palette.tmuxEnterHint'
  | 'palette.tmuxList'
  | 'palette.tmuxListHint'
  | 'palette.tmuxNew'
  | 'palette.tmuxNewHint'
  | 'palette.checkUpdates'
  | 'palette.checkUpdatesHint'
  | 'palette.installUpdate'
  | 'palette.installUpdateHint'
  | 'palette.disconnect'
  | 'paste.titleClipboard'
  | 'paste.titleFile'
  | 'paste.hint'
  | 'paste.upload'
  | 'paste.defaultPrompt'
  | 'shelf.title'
  | 'shelf.empty'
  | 'shelf.pasteAgain'
  | 'shelf.copyPath'
  | 'shelf.file'
  | 'shelf.clear'
  | 'pf.title'
  | 'pf.add'
  | 'pf.empty'
  | 'pf.local'
  | 'pf.host'
  | 'pf.port'
  | 'status.connectFirst'
  | 'status.noClipboardImage'
  | 'status.imageBridgeOff'
  | 'status.clearCacheConfirm'
  | 'term.findPlaceholder'
  | 'term.copy'
  | 'term.paste'
  | 'term.pasteImage'
  | 'term.find'
  | 'update.idle'
  | 'update.checking'
  | 'update.available'
  | 'update.downloading'
  | 'update.ready'
  | 'update.upToDate'
  | 'update.error'
  | 'update.restart'

type Catalog = Record<MessageKey, string>

const en: Catalog = {
  'locale.system': 'System default',
  'locale.en': 'English',
  'locale.zhCN': '简体中文',
  'common.settings': 'Settings',
  'common.done': 'Done',
  'common.cancel': 'Cancel',
  'common.disconnect': 'Disconnect',
  'common.resetDefaults': 'Reset defaults',
  'common.resetAll': 'Reset all settings',
  'topbar.reconnecting': 'Reconnecting...',
  'topbar.commandPalette': 'Command palette  ·  ⌘⇧P',
  'topbar.settings': 'Settings  ·  ⌘,',
  'topbar.toggleToolSidebar': 'Toggle tool sidebar  ·  ⌘\\',
  'topbar.hideSidebar': 'Hide panel',
  'topbar.showSidebar': 'Show panel',
  'toolbar.pasteImage': 'Paste image',
  'toolbar.orFileDropFind': 'or File… / drop · ⌘F find',
  'toolbar.terminalOnlyFind': 'Terminal only · ⌘F find',
  'toolbar.unavailableReconnect': 'unavailable while reconnecting',
  'toolbar.provider': 'Provider:',
  'toolbar.interactiveRepl': ' · interactive REPL',
  'reconnect.banner': 'Connection lost. Reconnecting (attempt {attempt}/10)',
  'reconnect.pasteDisabled': 'Paste image disabled until reconnected.',
  'reconnect.cancel': 'Cancel',
  'sidebar.imageOff': 'Image shelf off',
  'sidebar.enableFeaturesFirst': 'Enable Image bridge or Port forwards in Settings first.',
  'status.dismissHint': 'Click to dismiss',
  'palette.hideToolSidebar': 'Hide tool sidebar',
  'palette.showToolSidebar': 'Show tool sidebar',
  'palette.toggleToolSidebarHint': 'Image shelf & port forwards  ·  ⌘\\',
  'rail.title': 'Sessions',
  'rail.new': 'New session',
  'rail.close': 'Close session',
  'rail.renamePrompt': 'Session title',
  'rail.renameHint': 'Double-click to rename',
  'rail.dragHint': 'Drag to reorder',
  'rail.unread': 'Unread output',
  'palette.newSession': 'New session',
  'palette.newSessionHint': 'Open a draft connection tab',
  'palette.switchSession': 'Switch to {title}',
  'drop.overlay': 'Drop image to upload',
  'drop.warnImage': 'Drop an image file.',
  'drop.pathError': 'Could not resolve dropped file path.',
  'connect.title': 'Connect to a host',
  'connect.hubTitle': 'Open a session',
  'connect.hubSubtitle': 'Use a local shell on this Mac, or SSH into a remote host.',
  'connect.localTitle': 'Local shell',
  'connect.localDesc': 'Open $SHELL here (zsh / bash). Good for local agents.',
  'connect.sshTitle': 'SSH host',
  'connect.sshDesc': 'Connect with password, key, or agent — image bridge to remote.',
  'connect.localStarting': 'Starting local shell…',
  'connect.backToChooser': 'Back',
  'settings.general.defaultSessionKind': 'Default new session',
  'settings.general.defaultSessionKindHint':
    'Cold start only: Local opens a shell immediately; SSH / Ask show the connect screen. “+” always shows the chooser.',
  'settings.general.kindLocal': 'Local shell',
  'settings.general.kindSsh': 'SSH form',
  'settings.general.kindAsk': 'Ask each time',
  'connect.host': 'Host',
  'connect.hostPlaceholder': 'hostname or SSH alias',
  'connect.user': 'User',
  'connect.port': 'Port',
  'connect.password': 'Password',
  'connect.privateKey': 'Private key path',
  'connect.passphrase': 'Passphrase (optional)',
  'connect.agent': 'SSH agent',
  'connect.agentHint': 'Uses SSH_AUTH_SOCK on this machine. No password or key file needed.',
  'connect.browse': 'Browse…',
  'connect.submit': 'Connect',
  'connect.connecting': 'Connecting…',
  'connect.fromConfig': 'from ~/.ssh/config',
  'auth.password': 'Password',
  'auth.key': 'Private key',
  'auth.agent': 'SSH agent',
  'settings.title': 'Settings',
  'settings.nav.general': 'General',
  'settings.nav.generalHint': 'App behavior',
  'settings.nav.terminal': 'Terminal',
  'settings.nav.terminalHint': 'Theme, font, WebGL',
  'settings.nav.tmux': 'tmux',
  'settings.nav.tmuxHint': 'Remote session reuse',
  'settings.nav.image': 'Image bridge',
  'settings.nav.imageHint': 'Paste & upload',
  'settings.nav.about': 'About',
  'settings.nav.aboutHint': 'Version & updates',
  'settings.general.lead':
    'Stability and app behavior. Preferences are stored on this device and synced to the main process for L2 feature isolation.',
  'settings.general.terminalOnly': 'Terminal only mode',
  'settings.general.terminalOnlyHint':
    'Disable image bridge, port forwards, and provider auto-detect. SSH terminal stays fully functional.',
  'settings.general.autoUpdate': 'Automatic update checks',
  'settings.general.autoUpdateHint': 'When off, Portico will not contact the update feed',
  'settings.general.confirmCache': 'Confirm before clearing remote image cache',
  'settings.general.confirmCacheHint': 'Ask once before deleting ~/.portico*/blobs',
  'settings.general.l2Note': 'Optional L2 capabilities (safe to disable):',
  'settings.general.imageBridge': 'Image paste / upload bridge',
  'settings.general.portForwards': 'Port forwarding',
  'settings.general.showToolSidebar': 'Show right tool sidebar',
  'settings.general.showToolSidebarHint':
    'Image shelf and port forwards panel. Hide for a wider terminal (⌘\\).',
  'settings.general.providerDetect': 'Auto-detect Claude / Codex from output',
  'settings.general.language': 'Language',
  'settings.general.languageHint': 'UI language for menus and dialogs',
  'settings.terminal.lead': 'Appearance and rendering for the SSH terminal session.',
  'settings.terminal.theme': 'Theme',
  'settings.terminal.font': 'Font',
  'settings.terminal.fontSize': 'Font size ({n}px)',
  'settings.terminal.lineHeight': 'Line height ({n})',
  'settings.terminal.scrollback': 'Scrollback lines',
  'settings.terminal.copyOnSelect': 'Copy on select',
  'settings.terminal.copyOnSelectHint': 'Automatically copy selected text to the clipboard',
  'settings.terminal.webgl': 'WebGL renderer',
  'settings.terminal.webglHint': 'Faster full-screen TUI; reconnect if the GPU context is lost',
  'settings.terminal.reset': 'Reset terminal defaults',
  'settings.tmux.lead':
    'Reuse remote sessions with tmux so SSH disconnects do not kill Claude or long jobs. Portico only shells out to the remote tmux CLI — it does not replace tmux.',
  'settings.tmux.syncClipboard': 'Sync remote copy to Mac clipboard',
  'settings.tmux.syncClipboardHint':
    'Accept OSC 52 from the remote, and on connect run tmux set-option -g set-clipboard on (no conf file edit). Then remote copy can be pasted with ⌘V.',
  'settings.tmux.afterConnect': 'After connect',
  'settings.tmux.modeOff': 'Off — plain shell',
  'settings.tmux.modeAttach': 'Attach if session exists',
  'settings.tmux.modeAlways': 'Always attach or create',
  'settings.tmux.sessionName': 'Default session name',
  'settings.tmux.tips': 'Tips',
  'settings.tmux.tipDetach':
    'Detach with tmux prefix (usually Ctrl-b then d) — Portico shortcuts use ⌘ and never steal the prefix.',
  'settings.tmux.tipReconnect':
    'After reconnect, auto-enter runs again so you land back in the same session when mode is not Off.',
  'settings.tmux.tipPalette':
    'Command palette: list sessions, attach, or create new. Requires tmux on the remote PATH.',
  'settings.tmux.tipBuffer':
    'If a tool only copies to the tmux buffer (not OSC 52), paste with prefix + ]. Clipboard sync needs the remote app to emit OSC 52.',
  'settings.image.lead':
    'How clipboard and file images are uploaded and injected into the remote AI.',
  'settings.image.defaultPrompt': 'Default paste prompt',
  'settings.image.skipDialog': 'Skip prompt dialog on paste',
  'settings.image.skipDialogHint': '⌘⇧V uploads immediately with the default prompt',
  'settings.image.note':
    'Images are uploaded to ~/.portico*/blobs on the remote host, then a path reference is injected into the terminal for Claude / Codex / shell.',
  'settings.about.updates': 'Updates',
  'settings.about.check': 'Check for updates',
  'settings.about.install': 'Restart to install',
  'settings.about.dev': 'Running in development (updates disabled).',
  'settings.about.keyboard':
    'Keyboard: ⌘V text paste · ⌘⇧V image bridge · ⌘, settings · ⌘⇧P palette · ⌘F find',
  'settings.about.workflow':
    'Recommended flow: Portico SSH → tmux session → Claude. Disconnect only drops SSH; tmux keeps remote work alive.',
  'palette.pasteImage': 'Paste Image to Remote AI',
  'palette.pasteImageHint': 'Upload clipboard image + inject provider prompt  ·  ⌘⇧V',
  'palette.uploadClipboard': 'Upload Clipboard Image',
  'palette.uploadClipboardHint': 'Upload without injecting into the terminal',
  'palette.uploadFile': 'Upload Image File…',
  'palette.uploadFileHint': 'Pick a local image and paste into the remote AI',
  'palette.detectProvider': 'Re-detect AI provider',
  'palette.detectProviderHint': 'Heuristically detect Claude / Codex / shell',
  'palette.clearCache': 'Clear Remote Portico Cache',
  'palette.clearCacheHint': 'Delete every blob in ~/.portico/blobs',
  'palette.settings': 'Settings…',
  'palette.settingsHint': 'General, terminal, image bridge, about  ·  ⌘,',
  'palette.terminalSettings': 'Terminal Settings…',
  'palette.terminalSettingsHint': 'Theme, font, WebGL, copy-on-select',
  'palette.tmuxSettings': 'tmux Settings…',
  'palette.tmuxSettingsHint': 'Auto-enter remote session after connect',
  'palette.tmuxEnter': 'tmux: Enter default session',
  'palette.tmuxEnterHint': 'Attach or create “{name}”',
  'palette.tmuxList': 'tmux: List sessions',
  'palette.tmuxListHint': 'Show remote tmux sessions in the status bar',
  'palette.tmuxNew': 'tmux: New default session',
  'palette.tmuxNewHint': 'tmux new -s {name}',
  'palette.checkUpdates': 'Check for Updates',
  'palette.checkUpdatesHint': 'Look for a new version on the update channel',
  'palette.installUpdate': 'Restart to Install Update',
  'palette.installUpdateHint': 'Quit and relaunch into the downloaded update',
  'palette.disconnect': 'Disconnect',
  'paste.titleClipboard': 'Paste clipboard image',
  'paste.titleFile': 'Upload image file',
  'paste.hint': 'Prompt injected with the remote image path. Edit before sending.',
  'paste.upload': 'Upload & paste',
  'paste.defaultPrompt': 'Analyze this image',
  'shelf.title': 'IMAGE SHELF',
  'shelf.empty': 'Paste ⌘⇧V, drop an image, or pick a file. Images upload to the remote host for AI CLIs.',
  'shelf.pasteAgain': 'Paste again',
  'shelf.copyPath': 'Copy path',
  'shelf.file': 'File…',
  'shelf.clear': 'Clear',
  'pf.title': 'Port Forwards',
  'pf.add': '+ Add',
  'pf.empty': 'No port forwards',
  'pf.local': 'Local',
  'pf.host': 'Host',
  'pf.port': 'Port',
  'status.connectFirst': 'Connect to a host before pasting an image.',
  'status.noClipboardImage': 'No image in clipboard. Copy a screenshot or image first, then ⌘⇧V.',
  'status.imageBridgeOff': 'Image bridge is disabled. Turn off Terminal only mode in Settings.',
  'status.clearCacheConfirm':
    'Delete every uploaded image blob on the remote host (~/.portico*/blobs)? This cannot be undone.',
  'term.findPlaceholder': 'Find in terminal…',
  'term.copy': 'Copy',
  'term.paste': 'Paste',
  'term.pasteImage': 'Paste image…',
  'term.find': 'Find…',
  'update.idle': 'Idle',
  'update.checking': 'Checking…',
  'update.available': 'Update available',
  'update.downloading': 'Downloading…',
  'update.ready': 'Update ready',
  'update.upToDate': 'Up to date',
  'update.error': 'Update error',
  'update.restart': 'Restart now'
}

const zhCN: Catalog = {
  ...en,
  'locale.system': '跟随系统',
  'locale.en': 'English',
  'locale.zhCN': '简体中文',
  'common.settings': '设置',
  'common.done': '完成',
  'common.cancel': '取消',
  'common.disconnect': '断开连接',
  'common.resetDefaults': '恢复默认',
  'common.resetAll': '重置全部设置',
  'topbar.reconnecting': '重连中…',
  'topbar.commandPalette': '命令面板  ·  ⌘⇧P',
  'topbar.settings': '设置  ·  ⌘,',
  'topbar.toggleToolSidebar': '切换右侧工具栏  ·  ⌘\\',
  'topbar.hideSidebar': '隐藏面板',
  'topbar.showSidebar': '显示面板',
  'toolbar.pasteImage': '粘贴图片',
  'toolbar.orFileDropFind': '或 文件… / 拖放 · ⌘F 查找',
  'toolbar.terminalOnlyFind': '仅终端 · ⌘F 查找',
  'toolbar.unavailableReconnect': '重连期间不可用',
  'toolbar.provider': '提供方：',
  'toolbar.interactiveRepl': ' · 交互 REPL',
  'reconnect.banner': '连接已断开。正在重连（第 {attempt}/10 次）',
  'reconnect.pasteDisabled': '重连完成前无法粘贴图片。',
  'reconnect.cancel': '取消',
  'sidebar.imageOff': '图片货架已关闭',
  'sidebar.enableFeaturesFirst': '请先在设置中启用图片桥或端口转发。',
  'status.dismissHint': '点击关闭',
  'palette.hideToolSidebar': '隐藏右侧工具栏',
  'palette.showToolSidebar': '显示右侧工具栏',
  'palette.toggleToolSidebarHint': '图片货架与端口转发  ·  ⌘\\',
  'rail.title': '会话',
  'rail.new': '新建会话',
  'rail.close': '关闭会话',
  'rail.renamePrompt': '会话标题',
  'rail.renameHint': '双击重命名',
  'rail.dragHint': '拖拽调整顺序',
  'rail.unread': '有新输出',
  'palette.newSession': '新建会话',
  'palette.newSessionHint': '打开一个待连接的会话标签',
  'palette.switchSession': '切换到 {title}',
  'drop.overlay': '拖放图片以上传',
  'drop.warnImage': '请拖放图片文件。',
  'drop.pathError': '无法解析拖放文件的路径。',
  'connect.title': '连接到主机',
  'connect.hubTitle': '打开会话',
  'connect.hubSubtitle': '使用本机 Shell，或通过 SSH 连接远端主机。',
  'connect.localTitle': '本机 Shell',
  'connect.localDesc': '在本机打开 $SHELL（zsh / bash），适合本地 Agent。',
  'connect.sshTitle': 'SSH 主机',
  'connect.sshDesc': '密码 / 私钥 / agent 连接远端，支持图片桥。',
  'connect.localStarting': '正在启动本机 Shell…',
  'connect.backToChooser': '返回',
  'settings.general.defaultSessionKind': '新建会话默认',
  'settings.general.defaultSessionKindHint':
    '仅影响冷启动：本机=直接开 Shell；SSH/询问=显示连接页。点「+」始终弹出本机/SSH 选择。',
  'settings.general.kindLocal': '本机 Shell',
  'settings.general.kindSsh': 'SSH 表单',
  'settings.general.kindAsk': '每次询问',
  'connect.host': '主机',
  'connect.hostPlaceholder': '主机名或 SSH 别名',
  'connect.user': '用户',
  'connect.port': '端口',
  'connect.password': '密码',
  'connect.privateKey': '私钥路径',
  'connect.passphrase': '私钥口令（可选）',
  'connect.agent': 'SSH agent',
  'connect.agentHint': '使用本机 SSH_AUTH_SOCK。无需密码或密钥文件。',
  'connect.browse': '浏览…',
  'connect.submit': '连接',
  'connect.connecting': '连接中…',
  'connect.fromConfig': '来自 ~/.ssh/config',
  'auth.password': '密码',
  'auth.key': '私钥',
  'auth.agent': 'SSH agent',
  'settings.title': '设置',
  'settings.nav.general': '通用',
  'settings.nav.generalHint': '应用行为',
  'settings.nav.terminal': '终端',
  'settings.nav.terminalHint': '主题、字体、WebGL',
  'settings.nav.tmux': 'tmux',
  'settings.nav.tmuxHint': '远端会话复用',
  'settings.nav.image': '图片桥接',
  'settings.nav.imageHint': '粘贴与上传',
  'settings.nav.about': '关于',
  'settings.nav.aboutHint': '版本与更新',
  'settings.general.lead':
    '稳定性与应用行为。偏好保存在本机，并同步到主进程以隔离 L2 功能。',
  'settings.general.terminalOnly': '仅终端模式',
  'settings.general.terminalOnlyHint':
    '关闭图片桥接、端口转发与提供方自动检测。SSH 终端仍完全可用。',
  'settings.general.autoUpdate': '自动检查更新',
  'settings.general.autoUpdateHint': '关闭后不会访问更新源',
  'settings.general.confirmCache': '清理远端图片缓存前确认',
  'settings.general.confirmCacheHint': '删除 ~/.portico*/blobs 前询问一次',
  'settings.general.l2Note': '可选 L2 能力（可安全关闭）：',
  'settings.general.imageBridge': '图片粘贴 / 上传桥接',
  'settings.general.portForwards': '端口转发',
  'settings.general.showToolSidebar': '显示右侧工具栏',
  'settings.general.showToolSidebarHint':
    '图片货架与端口转发面板。隐藏后终端更宽（⌘\\）。',
  'settings.general.providerDetect': '从输出自动检测 Claude / Codex',
  'settings.general.language': '界面语言',
  'settings.general.languageHint': '菜单与对话框的显示语言',
  'settings.terminal.lead': 'SSH 终端会话的外观与渲染。',
  'settings.terminal.theme': '主题',
  'settings.terminal.font': '字体',
  'settings.terminal.fontSize': '字号（{n}px）',
  'settings.terminal.lineHeight': '行高（{n}）',
  'settings.terminal.scrollback': '回滚行数',
  'settings.terminal.copyOnSelect': '选中即复制',
  'settings.terminal.copyOnSelectHint': '选中文本后自动复制到剪贴板',
  'settings.terminal.webgl': 'WebGL 渲染',
  'settings.terminal.webglHint': '全屏 TUI 更流畅；GPU 上下文丢失时请重连',
  'settings.terminal.reset': '恢复终端默认',
  'settings.tmux.lead':
    '用远端 tmux 复用会话，SSH 断开不会杀掉 Claude 或长任务。Portico 只调用远端 tmux CLI，并不替代 tmux。',
  'settings.tmux.syncClipboard': '将远端复制同步到 Mac 剪贴板',
  'settings.tmux.syncClipboardHint':
    '接收远端 OSC 52，并在连接后执行 tmux set-option -g set-clipboard on（不改配置文件）。之后远端复制可用 ⌘V 粘贴。',
  'settings.tmux.afterConnect': '连接后',
  'settings.tmux.modeOff': '关闭 — 普通 shell',
  'settings.tmux.modeAttach': '仅当会话存在时 attach',
  'settings.tmux.modeAlways': '总是 attach 或创建',
  'settings.tmux.sessionName': '默认会话名',
  'settings.tmux.tips': '提示',
  'settings.tmux.tipDetach':
    '用 tmux 前缀分离（通常是 Ctrl-b 再 d）— Portico 快捷键使用 ⌘，不会抢前缀。',
  'settings.tmux.tipReconnect':
    '重连后若模式非「关闭」，会再次自动进入同一会话。',
  'settings.tmux.tipPalette':
    '命令面板可列会话、attach 或新建。远端 PATH 中需有 tmux。',
  'settings.tmux.tipBuffer':
    '若工具只写入 tmux buffer（未发 OSC 52），请用前缀 + ] 粘贴。剪贴板同步需要远端发出 OSC 52。',
  'settings.image.lead': '剪贴板与文件图片如何上传并注入到远端 AI。',
  'settings.image.defaultPrompt': '默认粘贴提示词',
  'settings.image.skipDialog': '粘贴时跳过提示词对话框',
  'settings.image.skipDialogHint': '⌘⇧V 立即用默认提示词上传',
  'settings.image.note':
    '图片上传到远端 ~/.portico*/blobs，再把路径引用注入终端，供 Claude / Codex / shell 使用。',
  'settings.about.updates': '更新',
  'settings.about.check': '检查更新',
  'settings.about.install': '重启以安装',
  'settings.about.dev': '开发模式运行（更新已禁用）。',
  'settings.about.keyboard':
    '快捷键：⌘V 文字粘贴 · ⌘⇧V 图片桥 · ⌘, 设置 · ⌘⇧P 命令面板 · ⌘F 查找',
  'settings.about.workflow':
    '推荐流程：Portico SSH → tmux 会话 → Claude。断开只断 SSH；tmux 保持远端工作。',
  'palette.pasteImage': '粘贴图片到远端 AI',
  'palette.pasteImageHint': '上传剪贴板图片并注入提供方提示  ·  ⌘⇧V',
  'palette.uploadClipboard': '上传剪贴板图片',
  'palette.uploadClipboardHint': '上传但不注入终端',
  'palette.uploadFile': '上传图片文件…',
  'palette.uploadFileHint': '选择本地图片并粘贴到远端 AI',
  'palette.detectProvider': '重新检测 AI 提供方',
  'palette.detectProviderHint': '启发式检测 Claude / Codex / shell',
  'palette.clearCache': '清理远端 Portico 缓存',
  'palette.clearCacheHint': '删除 ~/.portico/blobs 中的全部 blob',
  'palette.settings': '设置…',
  'palette.settingsHint': '通用、终端、图片桥、关于  ·  ⌘,',
  'palette.terminalSettings': '终端设置…',
  'palette.terminalSettingsHint': '主题、字体、WebGL、选中复制',
  'palette.tmuxSettings': 'tmux 设置…',
  'palette.tmuxSettingsHint': '连接后自动进入远端会话',
  'palette.tmuxEnter': 'tmux：进入默认会话',
  'palette.tmuxEnterHint': 'Attach 或创建 “{name}”',
  'palette.tmuxList': 'tmux：列出会话',
  'palette.tmuxListHint': '在状态栏显示远端 tmux 会话',
  'palette.tmuxNew': 'tmux：新建默认会话',
  'palette.tmuxNewHint': 'tmux new -s {name}',
  'palette.checkUpdates': '检查更新',
  'palette.checkUpdatesHint': '在更新通道查找新版本',
  'palette.installUpdate': '重启以安装更新',
  'palette.installUpdateHint': '退出并重新启动到已下载的更新',
  'palette.disconnect': '断开连接',
  'paste.titleClipboard': '粘贴剪贴板图片',
  'paste.titleFile': '上传图片文件',
  'paste.hint': '提示词会与远端图片路径一起注入。发送前可编辑。',
  'paste.upload': '上传并粘贴',
  'paste.defaultPrompt': '分析这张图片',
  'shelf.title': '图片货架',
  'shelf.empty': '⌘⇧V 粘贴、拖放图片或选择文件。图片会上传到远端主机供 AI CLI 使用。',
  'shelf.pasteAgain': '再次粘贴',
  'shelf.copyPath': '复制路径',
  'shelf.file': '文件…',
  'shelf.clear': '清空',
  'pf.title': '端口转发',
  'pf.add': '+ 添加',
  'pf.empty': '暂无端口转发',
  'pf.local': '本地',
  'pf.host': '主机',
  'pf.port': '端口',
  'status.connectFirst': '请先连接到主机再粘贴图片。',
  'status.noClipboardImage': '剪贴板中没有图片。请先复制截图或图片，再按 ⌘⇧V。',
  'status.imageBridgeOff': '图片桥接已关闭。请在设置中关闭「仅终端模式」。',
  'status.clearCacheConfirm':
    '删除远端主机上所有已上传图片 blob（~/.portico*/blobs）？此操作不可撤销。',
  'term.findPlaceholder': '在终端中查找…',
  'term.copy': '复制',
  'term.paste': '粘贴',
  'term.pasteImage': '粘贴图片…',
  'term.find': '查找…',
  'update.idle': '空闲',
  'update.checking': '检查中…',
  'update.available': '有可用更新',
  'update.downloading': '下载中…',
  'update.ready': '更新已就绪',
  'update.upToDate': '已是最新',
  'update.error': '更新出错',
  'update.restart': '立即重启'
}

const CATALOGS: Record<ResolvedLocale, Catalog> = {
  en,
  'zh-CN': zhCN
}

export function getCatalog(locale: ResolvedLocale): Catalog {
  return CATALOGS[locale] ?? en
}

export type TranslateVars = Record<string, string | number>

/** Look up and interpolate `{name}` placeholders. */
export function translate(
  locale: ResolvedLocale,
  key: MessageKey,
  vars?: TranslateVars
): string {
  const catalog = getCatalog(locale)
  let s = catalog[key] ?? en[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}
