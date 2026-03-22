# Windows 发布与签名

## 当前状态
- 仓库已经支持生成 `portable` 便携版和 `NSIS` 安装版。
- 构建时会自动读取 `build/icon.ico` 作为 Windows 应用图标。
- 如果环境里存在可用签名变量，`electron-builder` 会自动尝试签名。

## 可用脚本
- `npm run icon:generate`
  生成 `build/icon.ico`、`build/icon.png` 和安装器图标资源。
- `npm run package:portable`
  打包 Windows 便携版。
- `npm run package:nsis`
  打包 Windows 安装版。
- `npm run package:win`
  顺序打包便携版和安装版。
- `npm run sign:report`
  检查当前环境里是否有可用签名材料。

## 自动签名所需环境变量
Windows 下常用的是下面两组之一：

1. 文件证书
- `CSC_LINK`
- `CSC_KEY_PASSWORD`

2. Windows 专用命名
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

可选：
- `CSC_NAME`

## 当前机器未满足的条件
- 当前工作机环境里没有检测到 `CSC_LINK` / `WIN_CSC_LINK`
- 当前用户证书库里也没有可直接用于代码签名的证书

所以：
- 可以正常打包
- 但当前产物默认仍是未签名状态

## 后续要真正完成签名
只需要补其中一种：

1. 提供 `.pfx` / `.p12` 文件并设置上述环境变量
2. 在当前机器安装可用的代码签名证书，并让构建环境能访问到它

完成后重新运行：

```powershell
npm run package:win
```
