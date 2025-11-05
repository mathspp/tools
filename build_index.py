#!/usr/bin/env python3
"""Generate index.html from README.md with recent additions and updates."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Sequence

try:
    import markdown
except ModuleNotFoundError as exc:  # pragma: no cover - dependency should be installed
    raise SystemExit(
        "The 'markdown' package is required to build index.html. "
        "Install it with 'pip install markdown'."
    ) from exc

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
<section class="surface recent-highlights">
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

    # Inject the recent section between the comment markers
    start_marker = '<!-- recently starts -->'
    end_marker = '<!-- recently stops -->'
    if start_marker in body_html and end_marker in body_html:
        # Replace content between markers
        start_idx = body_html.find(start_marker)
        end_idx = body_html.find(end_marker)
        if start_idx < end_idx:
            body_html = (
                body_html[:start_idx + len(start_marker)] +
                '\n' + recent_section_html +
                body_html[end_idx:]
            )
    else:
        raise RuntimeError("Markers not found.")

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>tools.mathspp.com</title>
    <link rel="stylesheet" href="styles.css">
    <style>
        body {{
            margin: 0;
            padding: 0;
        }}
        main.page-shell {{
            max-width: 960px;
            margin: 0 auto;
            padding: 32px 20px 56px;
            display: grid;
            gap: 2rem;
        }}
        .recent-highlights {{
            padding: clamp(1.5rem, 3vw, 2.25rem);
        }}
        .recent-grid {{
            display: grid;
            gap: 1.5rem;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        }}
        .recent-card {{
            display: grid;
            gap: 0.75rem;
        }}
        .recent-list {{
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            gap: 0.6rem;
        }}
        .recent-list a {{
            font-weight: 600;
        }}
        .recent-date {{
            font-size: 0.9rem;
            color: var(--tx-2);
        }}
        .recent-empty {{
            color: var(--tx-2);
        }}
        @media (max-width: 720px) {{
            main.page-shell {{
                padding: 24px 16px 40px;
            }}
        }}
    </style>
</head>
<body>
    <main class="page-shell">
{body_html}
    </main>
</body>
</html>
"""

    OUTPUT_PATH.write_text(full_html, "utf-8")
    print("index.html created successfully")


if __name__ == "__main__":
    build_index()
