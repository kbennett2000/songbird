"""The /tiles mount must serve HTTP Range requests — the PMTiles client reads byte ranges, and
without 206 support the offline map would fail to load. This pins that contract."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from songbird.main import _mount_frontend


def _app_with_tiles(tmp_path: Path) -> TestClient:
    tiles = tmp_path / "tiles"
    tiles.mkdir()
    (tiles / "relief.pmtiles").write_bytes(bytes(range(256)) * 8)  # 2048 deterministic bytes
    (tiles / "bible-physical.geojson").write_text('{"type":"FeatureCollection","features":[]}')
    (tmp_path / "index.html").write_text("<!doctype html>")
    app = FastAPI()
    _mount_frontend(app, tmp_path)
    return TestClient(app)


def test_tiles_served_with_range_support(tmp_path: Path) -> None:
    client = _app_with_tiles(tmp_path)

    full = client.get("/tiles/relief.pmtiles")
    assert full.status_code == 200
    assert full.headers["accept-ranges"] == "bytes"
    assert len(full.content) == 2048

    ranged = client.get("/tiles/relief.pmtiles", headers={"Range": "bytes=0-15"})
    assert ranged.status_code == 206
    assert ranged.headers["content-range"] == "bytes 0-15/2048"
    assert ranged.content == bytes(range(16))


def test_tiles_served_with_honest_content_types(tmp_path: Path) -> None:
    # StaticFiles guesses content types from the mimetypes registry; songbird registers these
    # tile extensions so they aren't served as text/plain.
    client = _app_with_tiles(tmp_path)

    pmtiles = client.get("/tiles/relief.pmtiles")
    assert pmtiles.headers["content-type"] == "application/octet-stream"

    geojson = client.get("/tiles/bible-physical.geojson")
    assert geojson.headers["content-type"] == "application/geo+json"


def test_tiles_path_does_not_fall_through_to_spa(tmp_path: Path) -> None:
    # A missing tile must 404 from the tiles mount, not silently return index.html.
    client = _app_with_tiles(tmp_path)
    missing = client.get("/tiles/nope.pmtiles")
    assert missing.status_code == 404
