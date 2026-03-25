# Windows 签名与打包说明

## 当前状态
- 仓库已经支持生成 `zip` 便携版、旧式单文件 portable 和 `NSIS` 安装版
- 打包时会自动读取 `build/icon.ico` 作为 Windows 应用图标
- 如果构建环境里存在可用的签名参数，`electron-builder` 会自动尝试签名

## 常用脚本
- `npm run icon:generate`
  生成 `build/icon.ico`、`build/icon.png` 以及安装器相关图标资源
- `npm run package:portable`
  打包推荐的 Windows 便携目录版，并自动压成 `zip`
- `npm run package:portable:single`
  打包旧式单文件 portable
- `npm run package:nsis`
  打包 Windows 安装版
- `npm run package:win`
  顺序生成推荐的便携版和安装版
- `npm run sign:report`
  检查当前环境里是否存在可用的签名材料

## 自动签名所需环境变量
Windows 下常见的是下面两组中的任意一组：

1. 文件证书方式
- `CSC_LINK`
- `CSC_KEY_PASSWORD`

2. Windows 专用命名方式
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

可选：
- `CSC_NAME`

## 当前机器通常缺什么
如果本机没有配置以下任意一种，就只能产出未签名安装包：
- `.pfx` / `.p12` 文件加对应密码
- 已安装到本机证书库、且构建进程可访问的代码签名证书

这意味着：
- 可以正常打包
- 但生成的产物默认仍然是未签名状态

## 真正启用签名时要做什么
只需要补齐其中一种：

1. 提供 `.pfx` / `.p12` 文件，并配置上述环境变量
2. 在构建机安装可用的代码签名证书，并确认打包环境能访问到它

完成后重新运行：

```powershell
npm run package:win
```
