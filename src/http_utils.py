"""HTTP utility functions for building API Gateway responses."""

import json
import os
import logging

logger = logging.getLogger(__name__)

ALLOWED_CORS_DOMAINS = [
    d.strip()
    for d in os.environ.get("ALLOWED_CORS_DOMAINS", "").split(",")
    if d.strip()
]


def get_security_headers(origin_header: str) -> dict:
    """Return Content Security Policy and CORS headers."""
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Max-Age": "86400",
        "Strict-Transport-Security": "max-age=31536000; includeSubdomains; preload",
    }
    logger.debug("originHeader: %s", origin_header)
    logger.debug("ALLOWED_CORS_DOMAINS: %s", ALLOWED_CORS_DOMAINS)

    if origin_header in ALLOWED_CORS_DOMAINS:
        headers["Access-Control-Allow-Origin"] = origin_header

    return headers


def build_json_response(
    status_code: int,
    body: object,
    request_origin: str,
    headers: dict | None = None,
) -> dict:
    """Build and return a JSON response with CSP and CORS headers."""
    combined_headers = {**(headers or {}), **get_security_headers(request_origin)}

    return {
        "statusCode": status_code,
        "body": json.dumps(body, default=str),
        "headers": combined_headers,
        "isBase64Encoded": False,
    }
