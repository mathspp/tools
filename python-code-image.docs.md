Create PNG images of Python code with live syntax highlighting and a macOS-style window frame. Choose GitHub dark or GitHub light, edit the window filename, adjust font size, outer padding and background colour (or keep the default transparent background), and optionally include line numbers. Images automatically fit the code without wrapping and export at 2× resolution. Code stays in your browser.

Syntax highlighting uses highlight.js 11.12.0 for both the editor and PNG renderer, including Python template strings and the sentinel and frozendict built-ins. GitHub dark and light colours come from the official github-dark.min.css and github.min.css themes. CodeMirror 6 provides editing and keyboard shortcuts; dependencies load from pinned CDNs.

The area around the editor frame is transparent by default. A preview-only checkerboard indicates transparency; the editor frame keeps its theme background. Uncheck Transparent background to use a solid background colour.
