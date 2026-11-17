"""
Tracker workflows shared by the web app and the command line.

Layering: web / CLI → services → scrapers + matching → core.
Importing any module here must work on Render (no Playwright, OpenAI or
Lingua installed): those are imported inside the functions that need them.
"""
