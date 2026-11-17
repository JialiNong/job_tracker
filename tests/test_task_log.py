"""Per-thread log capture for background Tracker tasks (web.task_log)."""
from __future__ import annotations

import threading
import unittest

from web.task_log import capture_thread_output


class CaptureThreadOutputTests(unittest.TestCase):
    def test_collects_lines_and_drops_blank_ones(self):
        lines = []
        with capture_thread_output(lines):
            print("first")
            print("\n" + "=" * 3)
            print("a", "b", sep="-")
        self.assertEqual(lines, ["first", "===", "a-b"])

    def test_flushes_a_trailing_partial_line(self):
        lines = []
        with capture_thread_output(lines):
            print("no newline", end="")
        self.assertEqual(lines, ["no newline"])

    def test_stops_capturing_after_the_block(self):
        lines = []
        with capture_thread_output(lines):
            print("inside")
        print("outside")
        self.assertEqual(lines, ["inside"])

    def test_concurrent_threads_never_see_each_others_lines(self):
        logs = {"a": [], "b": []}
        barrier = threading.Barrier(2)

        def worker(name):
            with capture_thread_output(logs[name]):
                barrier.wait()
                for i in range(200):
                    print(f"{name}-{i}")

        threads = [threading.Thread(target=worker, args=(n,)) for n in logs]
        main_lines = []
        with capture_thread_output(main_lines):
            for t in threads:
                t.start()
            print("main thread line")
            for t in threads:
                t.join()

        self.assertEqual(logs["a"], [f"a-{i}" for i in range(200)])
        self.assertEqual(logs["b"], [f"b-{i}" for i in range(200)])
        self.assertEqual(main_lines, ["main thread line"])

    def test_nested_capture_restores_the_outer_sink(self):
        outer, inner = [], []
        with capture_thread_output(outer):
            print("outer 1")
            with capture_thread_output(inner):
                print("inner")
            print("outer 2")
        self.assertEqual(outer, ["outer 1", "outer 2"])
        self.assertEqual(inner, ["inner"])


if __name__ == "__main__":
    unittest.main()
