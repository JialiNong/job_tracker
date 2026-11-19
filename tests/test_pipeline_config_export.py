"""The TypeScript pipeline's copy of the shared settings matches src/core/config.py."""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class PipelineConfigExportTest(unittest.TestCase):
    def test_generated_config_is_current(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts/tools/export_pipeline_config.py"), "--check"],
            env={"PYTHONPATH": str(ROOT / "src")}, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
