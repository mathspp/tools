#!/usr/bin/env python3
import json
from datetime import datetime
import html
from pathlib import Path
try:
    import markdown
except ModuleNotFoundError as exc:  # pragma: no cover - dependency should be installed
    raise SystemExit(
        "The 'markdown' package is required to build colophon.html. "
        "Install it with 'pip install markdown'."
    ) from exc


def format_commit_message(message):
    """Render commit message as HTML with Markdown support."""

    escaped = html.escape(message)
    extensions = ["extra", "sane_lists", "nl2br"]

    try:
        md = markdown.Markdown(
            extensions=extensions + ["linkify"],
            output_format="html5",
        )
    except ModuleNotFoundError:
        md = markdown.Markdown(extensions=extensions, output_format="html5")

    formatted = md.convert(escaped)
    md.reset()
    return formatted


def build_colophon():
    try:
        with open("gathered_links.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print("Error: gathered_links.json not found. Run gather_links.py first.")
        return

    pages = data.get("pages", {})
    if not pages:
        print("No pages found in gathered_links.json")
        return

    def get_most_recent_date(page_data):
        commits = page_data.get("commits", [])
        if not commits:
            return "0000-00-00T00:00:00"
        dates = [commit.get("date", "0000-00-00T00:00:00") for commit in commits]
        return max(dates) if dates else "0000-00-00T00:00:00"

    sorted_pages = sorted(
        pages.items(), key=lambda item: get_most_recent_date(item[1]), reverse=True
    )

    tool_count = len(sorted_pages)

    html_content = f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
    <meta charset=\"UTF-8\">
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
    <title>tools.mathspp.com colophon</title>
    <link rel=\"stylesheet\" href=\"styles.css\">
</head>
<body>
    <header class=\"page-shell content-flow\">
        <h1>tools.mathspp.com colophon</h1>
        <p>The tools on <a href=\"https://tools.mathspp.com/\">tools.mathspp.com</a> were mostly built using AI-assisted programming. This page lists {tool_count} tools and their development history.</p>
        <p>This page lists the commit messages for each tool.</p>
    </header>
    <main class=\"page-shell content-flow\">
        <section class=\"tool-list\">
"""

    for page_name, page_data in sorted_pages:
        tool_url = f"https://tools.mathspp.com/{page_name.replace('.html', '')}"
        github_url = f"https://github.com/mathspp/tools/blob/main/{page_name}"
        commits = list(reversed(page_data.get("commits", [])))
        commit_count = len(commits)

        display_name = html.escape(page_name.replace(".html", ""))
        page_id = html.escape(page_name)
        tool_href = html.escape(tool_url)
        code_href = html.escape(github_url)

        html_content += f"""
            <article class=\"surface tool-entry\" id=\"{page_id}\">
                <header class=\"tool-entry-header\">
                    <a class=\"tool-entry-anchor\" href=\"#{page_id}\" aria-label=\"Permalink to {display_name}\">#</a>
                    <h2 class=\"tool-entry-title\"><a href=\"{tool_href}\">{display_name}</a></h2>
                    <div class=\"tool-entry-links\">
                        <a href=\"{code_href}\">View code</a>
                    </div>
                </header>
"""

        docs_file = page_name.replace(".html", ".docs.md")
        if Path(docs_file).exists():
            try:
                with open(docs_file, "r", encoding="utf-8") as f:
                    docs_content = f.read()
                docs_html = markdown.markdown(docs_content)
                html_content += '<div class="tool-entry-docs">' + docs_html + "</div>"
            except Exception as exc:  # pragma: no cover - informational only
                print(f"Error reading {docs_file}: {exc}")

        html_content += f"""
                <details>
                    <summary>Development history ({commit_count} commit{'s' if commit_count > 1 else ''})</summary>
"""

        for commit in commits:
            commit_hash = commit.get("hash", "")
            short_hash = commit_hash[:7] if commit_hash else "unknown"
            commit_date = commit.get("date", "")

            formatted_date = ""
            if commit_date:
                try:
                    dt = datetime.fromisoformat(commit_date)
                    formatted_date = dt.strftime("%B %d, %Y %H:%M")
                except ValueError:
                    formatted_date = commit_date

            commit_message = commit.get("message", "")
            formatted_message = format_commit_message(commit_message)
            commit_url = f"https://github.com/mathspp/tools/commit/{commit_hash}"
            safe_commit_url = html.escape(commit_url)

            html_content += f"""
                    <div class=\"commit\" id=\"commit-{short_hash}\">
                        <div>
                            <a href=\"{safe_commit_url}\" class=\"commit-hash\">{short_hash}</a>
                            <span class=\"commit-date\">{formatted_date}</span>
                        </div>
                        <div class=\"commit-message\">{formatted_message}</div>
                    </div>
"""

        html_content += """
                </details>
            </article>
"""

    html_content += """
        </section>
    </main>
    <script>
    document.addEventListener('DOMContentLoaded', () => {
        const hash = window.location.hash.slice(1);
        if (hash) {
            const element = document.getElementById(hash);
            if (element) {
                const details = element.querySelector('details');
                if (details) {
                    details.open = true;
                }
            }
        }
    });
    </script>
</body>
</html>
"""

    with open("colophon.html", "w", encoding="utf-8") as f:
        f.write(html_content)

    print("Colophon page built successfully as colophon.html")


if __name__ == "__main__":
    build_colophon()
