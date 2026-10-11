# Chrome Web Store Listing — 翻译娘MARI (MARI Translator)

> Last Updated: 2026-10-12
> 本项目是 KISS Translator 的 fork（GPLv3）。以下栏目用于准备本 fork 的商店上架；作者署名沿用上游，请勿改动。

## Store Listing

**Extension Name**
翻译娘MARI

**Short Description**
一个简约的双语对照翻译扩展，支持网页、划词、视频字幕翻译，支持多种翻译服务及 AI 翻译接口。

**Detailed Description**
把网页、划词与视频字幕翻译成你要的语言，双语对照显示，读起来不打断。

网页翻译：整页双语对照，原文与译文同屏；可随时切换显示样式。

划词翻译：选中文本即出译文，不打断阅读。

视频字幕翻译：为视频加译文字幕（已针对 YouTube 做适配）。

翻译服务：内置多种翻译服务与 AI 翻译接口，可自选；接口密钥只保存在本机。

自定义：丰富的选项，可针对不同站点设置各自的规则与样式。

用法：安装后在设置里选择翻译服务（必要时填 Key），打开页面用工具栏图标或快捷键（Alt+K / Alt+Q / Alt+S / Alt+D）翻译。

隐私：待翻译内容由浏览器直接发往你自行选择的翻译服务，用于生成译文。扩展不收集、不存储、不中转你的数据。

反馈与支持见下方链接。

**Category**
Productivity

**Single Purpose**
把网页、选中文本与视频字幕翻译成目标语言并双语对照显示。

**Primary Language**
中文（简体）

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `public/images/logo128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ✅ Ready | `screenshot-01.jpg` |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ✅ Ready | `screenshot-02.jpg` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ✅ Ready | `promo-440x280.png` |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
- 现有 `screenshot-01.jpg` / `screenshot-02.jpg` 直接可用；如需补充，建议加一张「划词翻译」与一张「选项页」。
- 尺寸须为 1280×800 或 640×400，直角满幅。

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | 保存翻译服务配置、接口密钥、站点规则与显示样式。 |
| `tts` | permissions | 朗读译文（文本转语音）。 |
| `contextMenus` | permissions | 在右键菜单提供翻译入口。 |
| `scripting` | permissions | 向页面注入翻译脚本与双语对照渲染。 |
| `declarativeNetRequest` | permissions | 处理请求层的翻译相关规则（如字幕注入所需的地址匹配）。 |
| `declarativeNetRequestWithHostAccess` | permissions | 同上，用于需要主机访问的请求规则。 |
| `clipboardRead` | optional_permissions | 可选：读取剪贴板内容以便翻译。仅在你授权后启用。 |
| `<all_urls>` | host_permissions | 翻译需在任意站点工作。 |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | Yes | Yes | 待翻译的网页文本 / 字幕 / 划词内容发往用户自行选择的翻译服务以生成译文 | 仅发往用户所选服务，不向其他方共享 |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
https://serena-sheng.github.io/chrome-ext-privacy/mari-translator.html

> 本扩展不收集、不存储、不传输任何用户个人信息。翻译所需内容由你的浏览器直接发往你在设置中自行选择的翻译服务，用于生成译文；扩展不保留这些内容，也不向任何其他第三方共享。接口密钥与配置仅保存在本机。

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**
serena-sheng

**Contact Email**
serenaamphistritesheng@outlook.com

**Support URL / Email**
https://github.com/serena-sheng/mari-translator/issues

**Homepage URL**
https://github.com/serena-sheng/mari-translator

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 2.1.0 | — | 当前版本（fork 基线） | Draft |

## Review Notes

### Known Issues / Limitations
- 本项目是 KISS Translator 的 fork，遵循 **GPLv3**；作者署名沿用上游（`Gabe<yugang2002@gmail.com>`），fork 不得移除上游许可与署名。
- `<all_urls>` + `declarativeNetRequest*` 属宽权限，会拉长审核；理由：翻译与字幕需覆盖任意站点。
- 无远程代码：逻辑全在包内，`declarativeNetRequest` 规则为声明式数据。

### Rejection History
| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| — | — | — | — |
