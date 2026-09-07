# ZDocs Reader

一个聚合多个项目 Markdown 文档的本地阅读和编辑工具。

## 下载安装

[下载 ZDocs v0.1.6（macOS Apple Silicon）](https://github.com/zdpeazy/zdocs-reader/releases/download/v0.1.6/ZDocs_0.1.6_aarch64.dmg)

也可以前往 [Releases 页面](https://github.com/zdpeazy/zdocs-reader/releases) 查看所有版本。

> 当前安装包适用于 Apple Silicon Mac。由于尚未经过 Apple Developer 公证，如果首次打开被 macOS 阻止，请前往“系统设置 → 隐私与安全性”，点击“仍要打开”。

## 开发

```bash
npm install
npm run dev
```

使用 Chrome 或 Edge 打开页面，点击左上角 `+`，选择项目目录。浏览器只会在本地读写用户授权的文件，不会上传文档。

## macOS 桌面端

桌面端基于 Tauri，可直接读取用户选择的项目目录，不依赖 Chrome 插件，也不受浏览器目录授权失效影响。

```bash
# 桌面开发模式
npm run desktop:dev

# 构建 .app 和 .dmg 安装包
npm run desktop:build
```

构建产物位于 `src-tauri/target/release/bundle/`。首次打开未签名版本时，如果 macOS 阻止运行，可在“系统设置 → 隐私与安全性”中选择仍要打开。

## 飞书文档连接

飞书功能通过本机的 `lark-cli` 运行，登录凭据不会进入浏览器代码。首次使用前在终端完成：

```bash
lark-cli config init
lark-cli auth login
```

浏览器开发模式直接运行 `npm run dev`；浏览器生产模式运行：

```bash
npm start
```

点击左上角云朵按钮，可以：

- 粘贴飞书文档或 Wiki 链接，导入为项目内 Markdown
- 将当前 Markdown 创建为新的飞书文档
- 再次发布时更新已经绑定的飞书文档
- 打开已绑定的飞书文档

更新飞书文档前会先读取线上版本，更新后再次读取验证。该版本不启用自动双向同步。

## 当前功能

- 多项目全部 Markdown 聚合与真实层级文件树
- Markdown 源码、渲染预览、分屏模式
- 源码编辑、未保存提示与 `⌘S` 保存
- CodeMirror 语法高亮、行号、折叠和查找替换
- 全文搜索、最近访问、收藏与项目重新扫描
- 相对图片、Markdown 文档链接、KaTeX 数学公式和 Mermaid 图表
- 分屏比例调整与编辑/预览滚动同步
- 外部文件修改检测与冲突处理
- 亮色/暗色主题和快捷键面板
- 飞书文档导入、创建、更新和本地绑定
- 当前文档标题大纲
- 文件名/路径搜索与 `⌘K` 快捷键
- 项目目录授权、上次文档、视图模式和侧栏宽度本地记忆
- macOS 原生目录选择、持久化访问和 `.app` / `.dmg` 打包
