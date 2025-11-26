#!/usr/bin/env python3
"""Generate index.html from README.md with recent additions and updates."""

from __future__ import annotations

import html
import json
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Sequence

import markdown

README_PATH = Path("README.md")
TOOLS_JSON_PATH = Path("tools.json")
OUTPUT_PATH = Path("index.html")


def _ordinal(value: int) -> str:
    """Return the ordinal suffix for a day value."""
    if 10 <= value % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    return f"{value}{suffix}"


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except ValueError:
        return None


def _has_distinct_update(tool: dict) -> bool:
    """Return True if the tool has an update distinct from its creation."""

    updated = _parse_iso_datetime(tool.get("updated"))
    if updated is None:
        return False

    created = _parse_iso_datetime(tool.get("created"))
    if created is None:
        return True

    return updated > created


def _format_display_date(dt: datetime) -> str:
    return f"{_ordinal(dt.day)} {dt.strftime('%B %Y')}"


def _load_tools() -> List[dict]:
    if not TOOLS_JSON_PATH.exists():
        return []
    with TOOLS_JSON_PATH.open("r", encoding="utf-8") as fp:
        return json.load(fp)


def _select_recent(
    tools: Sequence[dict],
    *,
    key: str,
    limit: int,
    exclude_slugs: Iterable[str] | None = None,
) -> List[dict]:
    excluded = set(exclude_slugs or [])
    dated_tools = [
        (tool, _parse_iso_datetime(tool.get(key)))
        for tool in tools
        if tool.get(key)
    ]
    dated_tools = [item for item in dated_tools if item[1] is not None]
    dated_tools.sort(key=lambda item: item[1], reverse=True)

    selected: List[dict] = []
    for tool, parsed_date in dated_tools:
        if tool.get("slug") in excluded:
            continue
        entry = tool.copy()
        entry["parsed_date"] = parsed_date
        selected.append(entry)
        if len(selected) >= limit:
            break
    return selected


def _replace_between_markers(body_html: str, start_marker: str, end_marker: str, replacement: str) -> str:
    if start_marker not in body_html or end_marker not in body_html:
        raise RuntimeError(f"Markers '{start_marker}' or '{end_marker}' not found.")

    start_idx = body_html.find(start_marker)
    end_idx = body_html.find(end_marker, start_idx)

    if start_idx == -1 or end_idx == -1 or start_idx >= end_idx:
        raise RuntimeError("Invalid marker positions.")

    return (
        body_html[: start_idx + len(start_marker)]
        + "\n"
        + replacement
        + "\n"
        + body_html[end_idx:]
    )


def _render_recent_section(recently_added: Sequence[dict], recently_updated: Sequence[dict]) -> str:
    def render_list(tools: Sequence[dict]) -> str:
        if not tools:
            return "        <li class=\"recent-empty\">No entries available.</li>"
        items = []
        for tool in tools:
            slug = tool.get("slug", "")
            url = tool.get("url", "#")
            filename = tool.get("filename", "")
            parsed_date = tool.get("parsed_date")
            if isinstance(parsed_date, datetime):
                formatted_date = _format_display_date(parsed_date)
            else:
                formatted_date = ""

            # Create colophon link for the date
            colophon_url = f"https://tools.mathspp.com/colophon#{filename}" if filename else "#"
            date_html = (
                f'<span class="recent-date"> — <a href="{colophon_url}">{formatted_date}</a></span>'
                if formatted_date
                else ""
            )
            items.append(
                f"        <li><a href=\"{url}\">{slug}</a>{date_html}</li>"
            )
        return "\n".join(items)

    section_html = f"""
<section class="surface recent-highlights content-flow">
  <div class="recent-grid">
    <article class="recent-card">
      <h2>Recently added</h2>
      <ul class="recent-list">
{render_list(recently_added)}
      </ul>
    </article>
    <article class="recent-card">
      <h2>Recently updated</h2>
      <ul class="recent-list">
{render_list(recently_updated)}
      </ul>
    </article>
  </div>
</section>
"""
    return section_html


def _render_tools_index(tools: Sequence[dict]) -> str:
    filtered_tools = [tool for tool in tools if tool.get("slug") != "index"]
    sorted_tools = sorted(
        filtered_tools,
        key=lambda tool: (tool.get("title") or tool.get("slug") or "").casefold(),
    )

    if sorted_tools:
        items = []
        for tool in sorted_tools:
            title = tool.get("title") or tool.get("slug") or "Untitled tool"
            url = tool.get("url") or f"/{tool.get('slug', '')}"
            items.append(
                f"      <li><a href=\"{html.escape(url)}\">{html.escape(title)}</a></li>"
            )
        list_content = "\n".join(items)
    else:
        list_content = "      <li class=\"tools-directory-empty\">No tools available.</li>"

    section_html = f"""
<section class=\"surface tools-directory content-flow\">
  <h2>Tool Index</h2>
  <ul class=\"tools-directory-list\">
{list_content}
  </ul>
</section>
"""
    return section_html.strip()


def build_index() -> None:
    if not README_PATH.exists():
        raise FileNotFoundError("README.md not found")

    markdown_content = README_PATH.read_text("utf-8")
    md = markdown.Markdown(extensions=["extra"])
    body_html = md.convert(markdown_content)

    tools = _load_tools()
    recently_added = _select_recent(tools, key="created", limit=5)
    added_slugs = [tool.get("slug") for tool in recently_added]
    tools_with_updates = [tool for tool in tools if _has_distinct_update(tool)]
    recently_updated = _select_recent(
        tools_with_updates, key="updated", limit=5, exclude_slugs=added_slugs
    )

    recent_section_html = _render_recent_section(recently_added, recently_updated)
    body_html = _replace_between_markers(
        body_html,
        "<!-- recently starts -->",
        "<!-- recently stops -->",
        recent_section_html,
    )

    tools_directory_html = _render_tools_index(tools)
    body_html = _replace_between_markers(
        body_html,
        "<!-- tools index starts -->",
        "<!-- tools index stops -->",
        tools_directory_html,
    )

    wrapped_body = f"<article class=\"content-flow\">\n{body_html}\n</article>"

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>tools.mathspp.com</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <main class="page-shell content-flow">
{wrapped_body}
    </main>
    <footer class="page-footer">
        <p>Built with ❤️, 🤖, and 🐍, by <a href="https://mathspp.com/">Rodrigo Girão Serrão</a></p>
    </footer>
</body>
</html>
"""

    OUTPUT_PATH.write_text(full_html, "utf-8")
    print("index.html created successfully")


if __name__ == "__main__":
    build_index()
