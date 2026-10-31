# Jiye · 集页

[简体中文](README.md) · [English](README.en.md)

**Turn books, films, courses, assets and collections into an editable catalog you can share as a single HTML file.**

Maintain your content in the master editor, then export a read-only HTML catalog. Basic editing and browsing need no hosting, account or local helper. Online sources and share scanning are optional and disabled by default.

**The interface is currently primarily in Chinese.** This README explains the workflow in English; the screenshots show the actual interface.

![Jiye desktop catalog](docs/screenshots/catalog.jpg)

## Start in three steps

1. Extract a complete package and open **`空白母版.html`** (blank master). To explore the app first, open `目录表-母版.html`, which contains 48 fictional examples.
2. Add your own entries or import XLSX. Open **设置** (Settings) to customize field labels, version badges, themes and covers. Hide fields you do not use.
3. **保存母版** (Save master), then **导出分发版** (Export reader). Share the resulting read-only HTML. Keep the master, which contains your editing notes and configuration.

Published packages appear under [Releases](https://github.com/suifracti/jiye/releases). If no package has been published, use the source build instructions below. The current version is **v1.1.0**.

### Choose a mode

| Mode | Open | Use it for |
|---|---|---|
| File mode | Double-click a master HTML file | Offline editing, spreadsheets, preview and reader export. Saving writes back or downloads a new file, depending on the browser. |
| Local helper | Run `启动空白目录.bat` / `.command` | Direct saves, automatic backups and online tasks you explicitly enable. Keep the helper window open while working. |
| Read-only reader | Open an exported HTML catalog | Search, filters, favorites, personal marks, comparisons and browsing. No helper is required. |

`启动目录表` opens the demo master; `启动空白目录` opens the blank master. The complete Windows package includes portable Python. The macOS helper uses your installed Python 3.

## Features

- **Make the catalog your own:** configurable field labels and visibility, version badge names and colors, a top notice, announcements, a latest-catalog link and an optional stale-catalog reminder.
- **Maintain entries:** spreadsheet-style editing, batch changes, paste, undo/redo, tag cleanup, local filling of empty fields, a to-do view, collections, rankings and monthly lists.
- **Round-trip spreadsheets:** XLSX preserves stable IDs, collections and settings, with conflict handling when both the master and workbook change. CSV exchanges a single table.
- **Help readers find things:** identifier, alias, simplified/traditional Chinese and pinyin search; combined filters, sorting, favorites, personal marks, version comparison and update reminders for collected entries.
- **Choose a layout:** lists, compact rows, a cover wall, multiple themes, mobile bottom navigation, custom backgrounds and a blur fallback.
- **Handle images:** select, paste or drop images for compression; embed them, keep external URLs or include them in an offline reader export. Third-party image-host uploads are not included.

Renaming a field changes its display label while spreadsheet keys remain stable. Reader favorites, marks and notes stay in the current browser and can be backed up through the tools menu.

## Screenshots

These are actual v1.1.0 browser captures using fictional books and films with original geometric covers.

| Master editor | Cover wall |
|---|---|
| ![Master editor](docs/screenshots/editor.jpg) | ![Cover wall](docs/screenshots/covers.jpg) |

<p align="center"><img src="docs/screenshots/mobile.jpg" alt="Mobile catalog at a 375-pixel viewport" width="300"></p>

## Optional online modules

All are disabled by default, and the reference-site list starts empty. Enable only the modules you need and supply your own sources or shares.

| Module | What it does |
|---|---|
| Metadata sources | Optional Steam, Bangumi and custom adapters look up entries by title or ID. Manual content takes priority; failures retain existing data. |
| Reference sites | Add your own sites and search templates, preview candidate images and confirm what to save. |
| Quark share scanning | Read-only scanning of your own shares for folder matching, size totals, availability checks, cancellation/resume and rescanning after link changes. |
| Daily workflow | Run enabled tasks together or step by step, with progress, partial results and a failure summary. |

Online tasks require the local helper. External interfaces may change; live share scanning and all external providers have not been fully validated for this release. Jiye supplies no resources. Users maintain their own content and links and must have the necessary rights. See [source and media notes](docs/来源许可.md) in Chinese for details.

## Build from source

You need Python 3 and Node.js; Node.js is used for offline checks. Clone the repository and install the bundled Python dependencies:

```sh
git clone https://github.com/suifracti/jiye.git
cd jiye
python3 -m pip install --no-index tools/vendor/*.whl
python3 -I tools/make_demo.py
python3 -I tools/make_demo.py --blank --out demo/blank-data.json
python3 -I tools/check_release.py --build
```

The package is generated in `dist/集页/`, with `dist/jiye-v1.1.0.zip` alongside it. The check runs offline tests and verifies demo data, images, HTML and the ZIP. It does not fetch provider content unless you explicitly enable a source. A source build includes portable Python only when the corresponding runtime ZIP is available locally; otherwise the Windows helper requires an installed Python.

To rebuild just the application, run `python3 -I tools/build_package.py`. Product identity and version live in `src/shared/product.py`; application code is in `src/`, and build tools are in `tools/`.

## Upgrading and documentation

Extract a new package into a new folder, run **升级母版** (Upgrade master), and select your existing master. The upgrader leaves the old file intact and backs up the destination before migrating your data.

The detailed documentation is currently in Chinese:

- [User guide](docs/使用说明.md): editing, images, spreadsheets, exports and upgrades.
- [Feature map](docs/功能对照.md): feature entry points and implementation scope.
- [Verification notes](docs/验收记录.md): tested scope and limitations. Windows, physical phones and real shares have not completed device/live acceptance testing.
- [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/suifracti/jiye/issues)

## License

Project code is available under the [MIT License](LICENSE). Third-party licenses are in `LICENSES/`. The demo uses fictional entries and original geometric covers; it contains no real resources or third-party cover artwork.
