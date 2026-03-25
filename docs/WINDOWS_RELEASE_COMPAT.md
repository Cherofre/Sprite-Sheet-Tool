# Windows 发布兼容性说明

## 问题背景
- `electron-builder --win portable` 生成的单文件 portable，并不是直接运行应用本体
- 它会先把内容解压到 `%TEMP%`，再从临时目录启动真正的 Electron 程序
- 在部分 Windows 环境里，尤其是安全策略更严格、临时目录执行受限、杀软拦截更激进的机器上，这一步可能会直接失败，表现成“点了没反应”

这个仓库已经复现过同一个现象：
- 同一套解包出来的应用，从普通目录启动是正常的
- 但从 portable 自解压出来的临时目录启动会崩或被拦截

## 当前推荐的发布产物
- `npm run package:portable`
  生成推荐的 `zip` 便携版。用户解压后直接运行 `Sprite Sheet Tool.exe`，这是当前最稳的免安装分发方式。
- `npm run package:nsis`
  生成 Windows 安装版。对大多数终端用户来说，这是支持成本最低的默认选择。
- `npm run package:win`
  一次生成推荐的 `zip` 便携版和安装版。
- `npm run package:portable:single`
  生成旧式单文件 portable。只建议作为附加下载项保留。
- `npm run package:win:all`
  生成全部 Windows 产物，包括旧式单文件 portable。

## 实际建议
- 想提供“免安装”下载时，优先发 `zip` 便携版
- 想尽量减少兼容性问题时，优先发 `NSIS` 安装版
- 单文件 portable 不要当默认主渠道
- 如果仍然保留单文件 portable，代码签名的重要性会明显提高

## 为什么还保留 `unpackDirName`
- 单文件 portable 在启动前一定会先解压
- 固定解压目录名有助于做环境白名单、排查日志和复现问题
- 它只能缓解排查成本，不能从根本上消除临时目录启动的兼容性风险
