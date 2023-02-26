# VS Code scaffdog extension [![CI](https://github.com/scaffdog/vscode/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/scaffdog/vscode/actions/workflows/ci.yml)

![DEMO](./assets/demo.gif)

Integrates [scaffdog](https://scaff.dog) into VS Code.

Although scaffdog can be used as a CLI tool, this extension allows you to use scaffdog intuitively from the GUI :dog:

## Usage

The Explorer view is used as the starting point for the operation.

1. Right-click to select a directory.
1. Click `Run scaffdog in selected folder`.
1. Select document.
1. Answers a couple of questions.
1. The files will be generated :heart:

## Requirements

The following versions are required for scaffolding through the local module.

- scaffdog `v2.5.0+`

## Recommendations

The minimum versions that the extension will work with are listed below. Note, however, that there will be functional differences due to the use of scaffdog bundled with the extension.

- scaffdog `v2.0.0+`

## Commands

The following are VS Code commands.

### `scaffdog: Run scaffdog in selected folder`

Run scaffdog on the selected directory. It will appear in the command palette suggestions only if the directory is the focus in Explorer.

### `scaffdog: Open output channel`

Open the output channel where extension information is displayed. If `scaffdog.debug` is enabled, you will see a lot of information.

## Settings

The following are VS Code settings.

### `scaffdog.enable`

**default:** `true`

Enables and disables the scaffdog extension.

### `scaffdog.debug`

**default:** `true`

Enable debug logging.

### `scaffdog.project`

**default:** `.scaffdog`

The scaffdog project folder to be searched. To specify multiple folders, enter values separated by commas.

Example:

```
.scaffdog, .templates
```

### `scaffdog.force`

**default:** `false`

Forces overwriting of existing files without opening a confirmation dialog.

## CHANGELOG

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT © wadackel](./LICENSE)

![Thank you for reading!](https://github.com/scaffdog/artwork/raw/main/repo-footer.png)
