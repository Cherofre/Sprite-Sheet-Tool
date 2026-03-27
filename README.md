# Sprite Sheet Tool

面向游戏 VFX 制作流程的桌面序列图工具。

它的目标不是做一套完整的图像编辑器，而是把序列图导入、识别、拆分、预览、导出和临时修正这些高频动作做得更快、更稳。

## 主要功能
- 导入单张序列图、图片序列、文件夹和 GIF
- 自动识别常见规则网格，并允许手动改成列/行或帧宽/帧高
- 预览动画播放，支持 FPS、区间播放、缩放和背景切换
- 拆分序列图、合并帧、导出图片序列、导出 GIF
- 支持把当前帧交给 Photoshop 修改，再回到工具里继续处理
- Windows 安装版和便携版都支持检查更新

## 本地开发
```powershell
npm install
npm run dev
```

## 常用命令
```powershell
npm run typecheck
npm run lint
npm run build
```

```powershell
npm run package:portable
npm run package:nsis
npm run package:win
```

命令说明：
- `package:portable`
  生成推荐的便携版目录包，并自动压成 `zip`
- `package:nsis`
  生成 Windows 安装版
- `package:win`
  一次性生成推荐的 `zip` 便携版和安装版
- `package:portable:single`
  生成旧式单文件 portable，可作为兼容性较差的附加下载项
- `package:win:all`
  生成全部 Windows 产物，包括旧式单文件 portable

## 当前推荐分发方式
- 默认发布 `zip` 便携版和 `NSIS` 安装版
- 单文件 `portable exe` 只作为附加选项，不建议当主分发包
- `zip` 便携版会额外套一层版本文件夹，避免用户“解压到当前目录”时把一堆文件散到下载文件夹

原因和兼容性背景见：
- [Windows 发布兼容性说明](docs/WINDOWS_RELEASE_COMPAT.md)

## 发布策略
这个仓库当前采用“开发线”和“发布线”分离的方式：

- `master`
  用来做日常开发、测试、试验、素材验证和临时脚本
- `codex/sst_v1`
  作为 `v1` 正式发布线，只保留对外发版需要的内容

需要注意：
- 正式 release 的依据是 `tag`，不是分支名本身
- 分支负责整理和收口，`v1.0.3` 这类 `tag` 才是真正对应 GitHub Release 的版本点
- 如果发布线补了正式修复，记得把这些修复同步回 `master`
- GitHub Release 正文统一使用中文，并为每个版本单独准备 `docs/RELEASE_NOTES_v版本号.md`

完整步骤见：
- [发布流程说明](docs/RELEASE_WORKFLOW.md)
- [v1.0.4 Release Notes 草案](docs/RELEASE_NOTES_v1.0.4.md)
- [Windows 签名与打包说明](docs/RELEASE_SIGNING.md)

## GitHub Actions 发布
仓库内置了 Windows 发布工作流：
- [windows-release.yml](.github/workflows/windows-release.yml)

行为如下：
- 推送 `v1.0.3` 这类 tag 时，会自动构建并发布 GitHub Release
- 手动触发时，也可以额外勾选是否附带旧式单文件 portable

## 签名
如果构建环境提供了可用的 Windows 签名证书，`electron-builder` 会在打包时自动尝试签名。

常见环境变量：
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`
- `CSC_NAME`
