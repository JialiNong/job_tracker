"""Load tests/contract/fixture.json into a Mongo database (current stack).

The replacement stack ships its own loader for the same file; the contract
runner calls it through --seed-cmd.

    python3 tests/contract/mongo_seed.py <mongo-uri> <db-name> [fixture.json]
"""
from __future__ import annotations

import sys
from pathlib import Path

from bson import json_util
from pymongo import MongoClient

FIXTURE = Path(__file__).resolve().parent / "fixture.json"


def read_fixture(path: Path = FIXTURE) -> dict:
    return json_util.loads(path.read_text(encoding="utf-8"))


def load_fixture(db, fixture: dict) -> None:
    """Drop every collection, then insert the fixture's documents."""
    for name in db.list_collection_names():
        db.drop_collection(name)
    for name, docs in fixture["collections"].items():
        if docs:
            db[name].insert_many(docs)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    uri, name = argv[1], argv[2]
    path = Path(argv[3]) if len(argv) > 3 else FIXTURE
    client = MongoClient(uri, serverSelectionTimeoutMS=3000)
    load_fixture(client[name], read_fixture(path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
