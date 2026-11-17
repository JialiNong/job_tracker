"""Plain-text helpers shared by scrapers, API sources and the matcher."""
import html as html_module
import re


def strip_html(html_text: str) -> str:
    """
    Convert raw HTML to readable plain text.

    Removes style/script blocks and tags, decodes entities, and keeps
    paragraph/list breaks so the saved JD stays scannable.
    """
    if not html_text:
        return ""
    text = re.sub(
        r"<(style|script)[^>]*>.*?</\1>",
        "",
        html_text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    text = re.sub(r"<(br|p|li|h[1-6]|div|tr)[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_module.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line).strip()
