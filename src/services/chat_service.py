"""Chat service - implements the agentic loop using Bedrock Converse API."""

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlencode, quote_plus
from urllib.request import urlopen, Request
from urllib.error import URLError

import boto3

from services.inventory_service import lookup_inventory

logger = logging.getLogger(__name__)

TOOL_TIMEOUT_S = 5

TOOLS = [
    {
        "toolSpec": {
            "name": "lookup_inventory",
            "description": (
                "Search The Better Store product catalog. Returns products with "
                "name, category, price, description, and details."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "productName": {
                            "type": "string",
                            "description": "Optional product name to filter by",
                        },
                        "brandId": {
                            "type": "string",
                            "description": (
                                "Optional brand name to filter by (e.g. ASUS, Dell, Apple, "
                                "Lenovo, HP, Samsung, Microsoft, Acer, Razer, MSI, "
                                "Penguin Books, HarperCollins, Bloomsbury)"
                            ),
                        },
                        "category": {
                            "type": "string",
                            "description": "Optional product category to filter by",
                            "enum": ["BOOKS", "COMPUTERS", "MOBILE"],
                        },
                    },
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_computer_reviews",
            "description": (
                "Search for reviews and opinions about a specific computer or laptop. "
                "Use when the user asks about reviews for a computer product."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Computer or laptop name/model to search reviews for",
                        }
                    },
                    "required": ["query"],
                }
            },
        }
    },
    {
        "toolSpec": {
            "name": "get_book_info",
            "description": (
                "Search for book information including ratings and reviews from Open Library. "
                "Use when the user asks about a book."
            ),
            "inputSchema": {
                "json": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Book title or author to search for",
                        }
                    },
                    "required": ["query"],
                }
            },
        }
    },
]


class ChatService:
    """Implements agentic loop with Bedrock Converse API and tool execution."""

    def __init__(
            self,
            bedrock_model: str,
            max_tokens: str,
            system_prompt: str,
            brave_api_key: str,
    ):
        self._bedrock_model = bedrock_model
        self._max_tokens = int(max_tokens) if max_tokens else 1024
        self._system_prompt = system_prompt
        self._brave_api_key = brave_api_key
        self._client = boto3.client("bedrock-runtime", region_name="ap-southeast-2")

    @property
    def _converse_params(self) -> dict:
        return {
            "modelId": self._bedrock_model,
            "system": [{"text": self._system_prompt}],
            "toolConfig": {"tools": TOOLS},
        }

    def query(self, messages: list[dict]) -> dict:
        """Synchronous agentic loop - call Bedrock Converse, handle tool use."""
        logger.info("querying against model: %s", self._bedrock_model)

        def converse():
            return self._client.converse(
                **self._converse_params,
                messages=messages,
            )

        response = converse()
        iterations = 0

        while response.get("stopReason") == "tool_use" and iterations < 5:
            iterations += 1
            assistant_msg = response["output"]["message"]
            messages.append(assistant_msg)
            logger.debug("assistant msg: %s", json.dumps(assistant_msg))

            tool_results = self._execute_tool_calls(assistant_msg.get("content", []))
            messages.append({"role": "user", "content": tool_results})
            response = converse()

        logger.info("response: %s", json.dumps(response, default=str))
        return response

    def _execute_tool_calls(self, content_blocks: list[dict]) -> list[dict]:
        """Execute tool calls in parallel and return tool results."""
        tool_blocks = [b for b in content_blocks if "toolUse" in b]

        def execute_single(block: dict) -> dict:
            tool_use = block["toolUse"]
            tool_input = tool_use.get("input", {})
            name = tool_use["name"]

            if name == "get_book_info":
                result = self._get_book_info(tool_input["query"])
            elif name == "get_computer_reviews":
                result = self._get_computer_reviews(tool_input["query"])
            else:
                result = {
                    "products": lookup_inventory(
                        product_name=tool_input.get("productName"),
                        brand_id=tool_input.get("brandId"),
                        category=tool_input.get("category"),
                    )
                }

            return {
                "toolResult": {
                    "toolUseId": tool_use["toolUseId"],
                    "content": [{"json": result}],
                }
            }

        # Execute in parallel using threads
        results = []
        with ThreadPoolExecutor(max_workers=len(tool_blocks)) as executor:
            futures = {executor.submit(execute_single, b): i for i, b in enumerate(tool_blocks)}
            # Collect in original order
            ordered = [None] * len(tool_blocks)
            for future in as_completed(futures):
                idx = futures[future]
                ordered[idx] = future.result()
            results = ordered

        return results

    def _get_computer_reviews(self, query: str) -> dict:
        """Search for computer reviews via Brave Search API."""
        try:
            search_query = quote_plus(query + " review")
            url = f"https://api.search.brave.com/res/v1/web/search?q={search_query}&count=5"
            req = Request(url, headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": self._brave_api_key,
            })
            with urlopen(req, timeout=TOOL_TIMEOUT_S) as resp:
                if resp.status != 200:
                    return {
                        "error": f"Review service unavailable (HTTP {resp.status}). Unable to fetch reviews at this time."}
                data = json.loads(resp.read().decode())
            return {
                "results": [
                    {
                        "title": r.get("title"),
                        "url": r.get("url"),
                        "description": r.get("description"),
                    }
                    for r in data.get("web", {}).get("results", [])
                ]
            }
        except Exception as err:
            logger.error("getComputerReviews failed: %s", err)
            return {"error": "Review search timed out or failed. Please try again."}

    def _get_book_info(self, query: str) -> dict:
        """Search for book info via Open Library API."""
        try:
            search_query = quote_plus(query)
            url = (
                f"https://openlibrary.org/search.json?q={search_query}"
                "&limit=3&fields=title,author_name,first_publish_year,ratings_average,ratings_count,subject"
            )
            req = Request(url)
            with urlopen(req, timeout=TOOL_TIMEOUT_S) as resp:
                data = json.loads(resp.read().decode())
            return {
                "results": [
                    {
                        "title": doc.get("title"),
                        "authors": doc.get("author_name"),
                        "year": doc.get("first_publish_year"),
                        "avgRating": doc.get("ratings_average"),
                        "ratingsCount": doc.get("ratings_count"),
                        "subjects": (doc.get("subject") or [])[:5],
                    }
                    for doc in data.get("docs", [])
                ]
            }
        except Exception as err:
            logger.error("getBookInfo failed: %s", err)
            return {"error": "Book search timed out or failed. Please try again."}
