"""
Per-thread capture of printed output for background Tracker tasks.

The scrape / match code reports progress with print(). A background task
wraps its work in capture_thread_output(lines) and the UI polls `lines`.

How it stays thread-safe: sys.stdout is wrapped once, process-wide, in a
pass-through tee. Each write goes to the real stdout as usual and, only when
the *writing thread* has registered a sink, also to that sink. Other threads
(Flask requests, a second task) never land in someone else's log, and nothing
is swapped back and forth per task — unlike monkey-patching builtins.print.
"""
from __future__ import annotations

import sys
import threading
from contextlib import contextmanager

_local = threading.local()
_install_lock = threading.Lock()


class _LineSink:
    """Collects complete, non-blank lines into a caller-owned list."""

    def __init__(self, lines: list):
        self.lines = lines
        self._partial = ""

    def feed(self, text: str) -> None:
        self._partial += text
        *complete, self._partial = self._partial.split("\n")
        self.lines.extend(line for line in complete if line.strip())

    def close(self) -> None:
        if self._partial.strip():
            self.lines.append(self._partial)
        self._partial = ""


class _ThreadTee:
    """sys.stdout stand-in: always writes through, plus to this thread's sink."""

    def __init__(self, stream):
        self._stream = stream

    def write(self, text):
        sink = getattr(_local, "sink", None)
        if sink is not None:
            sink.feed(text)
        return self._stream.write(text)

    def flush(self):
        return self._stream.flush()

    def __getattr__(self, name):
        return getattr(self._stream, name)


def _install_tee() -> None:
    with _install_lock:
        if not isinstance(sys.stdout, _ThreadTee):
            sys.stdout = _ThreadTee(sys.stdout)


@contextmanager
def capture_thread_output(lines: list):
    """Append every line printed by the current thread to `lines` while active."""
    _install_tee()
    sink = _LineSink(lines)
    previous = getattr(_local, "sink", None)
    _local.sink = sink
    try:
        yield lines
    finally:
        sink.close()
        _local.sink = previous
