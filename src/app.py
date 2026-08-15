"""Lambda handler for the /query REST endpoint."""

import json
import logging
import os

import boto3

from http_utils import build_json_response
from services.chat_service import ChatService

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

# Cold-start initialisation
logger.info("Lambda is cold-starting.")

_chat_service: ChatService | None = None


def _get_chat_service() -> ChatService:
    """Lazy-init the ChatService singleton (fetches Brave API key from SSM on first call)."""
    global _chat_service
    if _chat_service is None:
        param_name = os.environ.get("BRAVE_API_KEY_PARAM", "")
        ssm = boto3.client("ssm")
        resp = ssm.get_parameter(Name=param_name, WithDecryption=True)
        brave_api_key = resp["Parameter"]["Value"]

        _chat_service = ChatService(
            bedrock_model=os.environ.get("BEDROCK_MODEL", ""),
            max_tokens=os.environ.get("MAX_TOKENS", "1024"),
            system_prompt=os.environ.get("SYSTEM_PROMPT", ""),
            brave_api_key=brave_api_key,
        )
    return _chat_service


def handler(event, context):
    """REST API /query POST handler."""
    logger.info("Entered handler")
    logger.debug(json.dumps(event))

    request_context = event.get("requestContext", {})
    authorizer = request_context.get("authorizer")
    origin = (event.get("headers") or {}).get("origin", "")

    if not authorizer:
        return build_json_response(400, {"message": "Missing authorizer"}, origin)

    user_claims = authorizer.get("claims", {})
    logger.debug("Received userClaims: %s", user_claims)

    username = user_claims.get("cognito:username", "")
    if username != "brycepc@hotmail.com":
        return build_json_response(401, {"message": "Unauthorized"}, origin)

    messages = json.loads(event.get("body") or "[]")

    svc = _get_chat_service()
    result = svc.query(messages)

    return build_json_response(200, result, origin)
