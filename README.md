# Encoding Keeper

Encoding Keeper helps VS Code remember which encoding should be used for each file or folder in a workspace.
Encoding Keeper 帮助 VS Code 记住工作区中每个文件或文件夹应该使用的编码。

It is useful when a project contains mixed encodings, for example UTF-8 files alongside GB2312, GBK, or GB18030 legacy files.
当项目中同时存在多种编码时很有用，例如 UTF-8 文件与 GB2312、GBK 或 GB18030 等旧编码文件混合存在。

## Features

- Record an encoding for a file from the Explorer context menu.
- Record an encoding for a folder and apply it to files inside that folder.
- Save records in the workspace at `.vscode/encoding-keeper.json`.
- Automatically reopen files with the recorded encoding the next time they are opened.
- Prefer exact file records over folder records.
- Show the current file encoding in the status bar.

## Usage

Right-click a file or folder in Explorer, then choose:
在资源管理器中右键单击文件或文件夹，然后选择：

```text
Encoding Keeper: 记录使用编码
```

Choose one of the common encodings:

- UTF-8
- GB2312
- GBK
- UTF-8 with BOM
- GB18030
- Big5
- Shift JIS
- Windows 1252

When a recorded file is opened again, Encoding Keeper will try to reopen it with the remembered encoding automatically.

## Record File

Encoding records are stored in:

```text
.vscode/encoding-keeper.json
```

Example:

```json
{
  "version": 1,
  "files": {
    "gb2312.txt": "utf8",
    "12/gb2312.txt": "gb2312"
  },
  "folders": {
    "12": "utf8"
  }
}
```

Matching order:

1. Exact file record in `files`.
2. Nearest parent folder record in `folders`.
3. VS Code default encoding behavior.

For example, `12/gb2312.txt` uses `gb2312` because the exact file record wins over the folder record for `12`.

## Commands

- `Encoding Keeper: 显示当前编码`
- `Encoding Keeper: 使用记录编码打开`
- `Encoding Keeper: 清除编码记录`
- `Encoding Keeper: 清除所有编码记录`

## Requirements

VS Code 1.100.0 or newer is required. No external runtime dependency is required.

## Development

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run tests:

```bash
npm test
```

Press `F5` in VS Code to launch an Extension Development Host.

## Packaging and Publishing

Create a local `.vsix` package:

```bash
npm run package
npx @vscode/vsce package --no-dependencies
```

Install the generated package locally:

```bash
code --install-extension encoding-keeper-0.0.1.vsix
```

This repository includes a package-only GitHub Actions workflow at `.github/workflows/package.yml`. It builds the extension and uploads a `.vsix` artifact without requiring Marketplace credentials.

Push a version tag such as `v0.0.1` to run `Package VSIX`, create a GitHub Release, and attach the generated `.vsix`.

```bash
git tag v0.0.1
git push origin v0.0.1
```

You can also run `Package VSIX` manually and provide a release tag to create or update a GitHub Release.

The Marketplace publishing workflow is at `.github/workflows/release.yml`.

To publish to the VS Code Marketplace:

1. Create a VS Code Marketplace publisher. The current `publisher` in `package.json` is `yjrqz777`.
2. Create an Azure DevOps personal access token for Marketplace publishing.
3. Add the token to the GitHub repository secret named `VSCE_PAT`.
4. Run the `Package and Publish` workflow manually and set `publish` to `true`, or push a version tag such as `v0.0.1`.

## Release Notes

### 0.0.1

Initial release.
