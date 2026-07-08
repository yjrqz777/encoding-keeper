# Encoding Keeper

Encoding Keeper is a VS Code extension for projects that contain files with mixed encodings. It remembers the preferred encoding for individual files or folders, restores that encoding when files are opened, and can convert files or folders to another encoding.

Encoding Keeper 是一个 VS Code 扩展，用于管理工作区内混合编码文件。它可以记录文件或文件夹的编码、打开时自动恢复编码，并支持一键转码。

## Features

- Record an encoding for a file or folder from the Explorer context menu.
- Store records in `.vscode/encoding-keeper.json` inside the workspace.
- Automatically reopen files with the remembered encoding.
- Prefer exact file records over folder records.
- Show the active file encoding in the status bar.
- Convert a file or folder to another encoding.
- Ask for confirmation before converting a folder.
- Skip dirty files during conversion to avoid overwriting unsaved changes.

## Supported Encodings

- UTF-8
- UTF-8 with BOM
- GB2312
- GBK
- GB18030
- Big5
- Shift JIS
- Windows 1252

## Usage

### Record an Encoding

Right-click a file or folder in Explorer, then choose:

```text
Encoding Keeper: 记录使用编码
```

Select the encoding to remember. Folder records apply to files inside that folder unless a file has its own exact record.

### Convert Encoding

Right-click a file or folder in Explorer, then choose:

```text
Encoding Keeper: 一键转码为
```

Select the target encoding. File conversion runs immediately. Folder conversion shows a confirmation dialog first, then processes files recursively.

When converting an open file, Encoding Keeper closes the editor tab before writing the converted bytes. If the file was active, it is reopened with the target encoding afterward.

If the source bytes are valid UTF-8, conversion decodes them as UTF-8 even when the file is currently displayed with the wrong encoding. This avoids saving already-garbled editor text when, for example, a UTF-8 file was opened as GB2312.

## Record File

Encoding records are stored at:

```text
.vscode/encoding-keeper.json
```

Example:

```json
{
  "version": 1,
  "files": {
    "legacy/gb2312.txt": "gb2312"
  },
  "folders": {
    "legacy": "gbk"
  }
}
```

Matching order:

1. Exact file record in `files`.
2. Nearest parent folder record in `folders`.
3. VS Code default encoding behavior.

## Commands

- `Encoding Keeper: 显示当前编码`
- `Encoding Keeper: 使用记录编码打开`
- `Encoding Keeper: 清除编码记录`
- `Encoding Keeper: 清除所有编码记录`
- `Encoding Keeper: 记录使用编码`
- `Encoding Keeper: 一键转码为`

## Notes and Limitations

- Encoding detection is conservative, not perfect. Some non-UTF-8 byte sequences can still be valid UTF-8.
- Pure ASCII files are treated as valid UTF-8, which is normally safe because ASCII bytes are shared by many encodings.
- Binary files with NUL bytes are skipped during conversion.
- Files with unsaved editor changes are skipped during conversion.

## Requirements

VS Code 1.100.0 or newer is required.

## Development

Install dependencies:

```bash
npm install
```

Compile and bundle:

```bash
npm run compile
```

Run tests:

```bash
npm test
```

Launch the extension locally by pressing `F5` in VS Code.

## Packaging and Publishing

Create a production bundle and package:

```bash
npm run package
npm run vsix
```

Install the generated package locally:

```bash
code --install-extension encoding-keeper-0.0.7.vsix
```

The package-only workflow is `.github/workflows/package.yml`. The Marketplace publishing workflow is `.github/workflows/release.yml`; it requires the `VSCE_PAT` repository secret.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).
