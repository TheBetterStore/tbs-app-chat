"""Inventory service - queries The Better Store product catalog API."""

import os
import time
import logging
from urllib.parse import urlencode
from urllib.request import urlopen, Request
from urllib.error import URLError
import json

logger = logging.getLogger(__name__)

PRODUCTS_API_BASE_URL = os.environ.get("PRODUCTS_API_BASE_URL", "")
CACHE_TTL_MS = 30000
FETCH_TIMEOUT_S = 5

_cache: dict | None = None


def lookup_inventory(
    product_name: str | None = None,
    brand_id: str | None = None,
    category: str | None = None,
) -> list[dict]:
    """Look up inventory from the products API with optional filters."""
    global _cache

    params = {}
    if category:
        params["category"] = category
    if brand_id:
        params["brandId"] = brand_id
    if product_name:
        params["productName"] = product_name

    query = urlencode(params)
    url = f"{PRODUCTS_API_BASE_URL}/products{'?' + query if query else ''}"

    now = time.time() * 1000  # ms
    if _cache and _cache["key"] == url and now < _cache["expiry"]:
        return _cache["data"]

    try:
        req = Request(url)
        with urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
            products = json.loads(resp.read().decode())
        _cache = {"key": url, "data": products, "expiry": now + CACHE_TTL_MS}
        return products
    except (URLError, TimeoutError, json.JSONDecodeError) as err:
        logger.error("lookupInventory failed: %s", err)
        return []
