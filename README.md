# markdown-viewer

`md` opens a Markdown file as a clean, GitHub-style page in Google Chrome (or your default browser if Chrome is not installed). It is a small command-line tool for macOS.

```sh
md README.md
```

## Install

With [Homebrew](https://brew.sh):

```sh
brew install hogiabao2601/tap/markdown-viewer
```

This installs Node.js too if you don't have it.

> **oh-my-zsh users:** oh-my-zsh defines `alias md='mkdir -p'`, which hides this command. Add this line to `~/.zshrc` **after** `source $ZSH/oh-my-zsh.sh`, then open a new terminal:
>
> ```sh
> unalias md 2>/dev/null
> ```

## Usage

```sh
md <file.md>                        # render and open
md --watch <file.md>                # live preview: reload the page on every save (Ctrl+C to stop)
md --raw <file.md>                  # open the raw Markdown source, ready to copy
md --theme dark <file.md>           # open in light | dark | system theme
md --watch --raw --theme dark notes.md   # flags combine
md --help                           # full usage guide
```

| Option | What it does |
| --- | --- |
| `-w`, `--watch` | Serves the page on `127.0.0.1` and reloads it every time you save the file. Runs until you press Ctrl+C. Editors that save by replacing the file are supported. |
| `--raw` | Opens the page in the **Raw** view: the Markdown source with syntax colors and a **Copy all** button that copies the whole file. |
| `--theme <mode>` | Opens in the `light`, `dark` or `system` theme (`system` follows macOS). Also written as `--theme=dark`. |
| `-h`, `--help` | Shows the full usage guide. |

### On the page

- **Rendered / Raw**: switch between the rendered page and the Markdown source. In Raw, **⧉ Copy all** copies the whole file to the clipboard.
- **☀ Light / ☾ Dark / ◐ System**: switch the color theme. The choice is remembered for later pages.
- **Contents**: the table of contents on the left highlights the section you are reading.
- **Copy**: hover a code block to copy just that block.

### Which view and theme open

The most specific choice wins:

1. A choice clicked in the current tab (kept across `--watch` reloads).
2. The `--raw` and `--theme` flags.
3. Theme only: the last theme clicked in any tab.
4. The macOS appearance setting, and the Rendered view.

## Features

- GitHub-flavored Markdown: tables, task lists, autolinks, strikethrough.
- Syntax-highlighted code blocks with a Copy button.
- [Mermaid](https://mermaid.js.org) diagrams (they follow the theme).
- Relative images and links resolved against the file; links to other `.md` files open rendered too.
- Eye-friendly light and dark palettes.
- Works offline: all JavaScript and CSS is bundled.
- Generated pages go to `~/Library/Caches/md-viewer/`, never next to your file.

## Install from source

Requires Node.js 18 or later.

```sh
git clone https://github.com/hogiabao2601/markdown-viewer.git
cd markdown-viewer
npm install
npm link            # puts `md` on your PATH
```

## Uninstall

```sh
brew uninstall markdown-viewer        # or, from source: npm unlink -g markdown-viewer
rm -rf ~/Library/Caches/md-viewer
```

## How it works

- `bin/md.js`: the CLI. Renders with [marked](https://marked.js.org) and [highlight.js](https://highlightjs.org), writes pages to the cache, and opens the browser. `--watch` runs a server that listens only on 127.0.0.1 and reloads the page with server-sent events.
- `static/viewer.css`, `static/viewer.js`: page styling, table of contents, copy buttons, Mermaid setup.
- `static/theme.js`: the theme and Rendered/Raw switches. Loaded in `<head>` so the page never flashes the wrong theme or view.

## License

[MIT](LICENSE)
