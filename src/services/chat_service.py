"""Chat service - implements the agentic loop using Strands Agents SDK."""

import json
import logging
from urllib.parse import quote_plus
from urllib.request import urlopen, Request

from strands import Agent, tool
from strands.models import BedrockModel

from services.inventory_service import lookup_inventory

logger = logging.getLogger(__name__)

TOOL_TIMEOUT_S = 5


# --- Tool definitions ---

@tool
def lookup_inventory_tool(
    product_name: str = "",
    brand_id: str = "",
    category: str = "",
) -> dict:
    """Search The Better Store product catalog. Returns products with name, category, price, description, and details.

    Args:
        product_name: Optional product name to filter by
        brand_id: Optional brand name to filter by (e.g. ASUS, Dell, Apple, Lenovo, HP, Samsung, Microsoft, Acer, Razer, MSI, Penguin Books, HarperCollins, Bloomsbury)
        category: Optional product category to filter by (BOOKS, COMPUTERS, or MOBILE)
    """
    products = lookup_inventory(
        product_name=product_name or None,
        brand_id=brand_id or None,
        category=category or None,
    )
    return {"products": products}


def _create_get_computer_reviews(brave_api_key: str):
    """Factory to create the get_computer_reviews tool with the API key bound."""

    @tool
    def get_computer_reviews(query: str) -> dict:
        """Search for reviews and opinions about a specific computer or laptop. Use when the user asks about reviews for a computer product.

        Args:
            query: Computer or laptop name/model to search reviews for
        """
        try:
            search_query = quote_plus(query + " review")
            url = f"https://api.search.brave.com/res/v1/web/search?q={search_query}&count=5"
            req = Request(url, headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": brave_api_key,
            })
            with urlopen(req, timeout=TOOL_TIMEOUT_S) as resp:
                if resp.status != 200:
                    return {"error": f"Review service unavailable (HTTP {resp.status}). Unable to fetch reviews at this time."}
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
            logger.error("get_computer_reviews failed: %s", err)
            return {"error": "Review search timed out or failed. Please try again."}

    return get_computer_reviews


@tool
def get_book_info(query: str) -> dict:
    """Search for book information including ratings and reviews from Open Library. Use when the user asks about a book.

    Args:
        query: Book title or author to search for
    """
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
        logger.error("get_book_info failed: %s", err)
        return {"error": "Book search timed out or failed. Please try again."}


# --- Chat Service ---

class ChatService:
    """Uses Strands Agents SDK to manage the agentic loop."""

    def __init__(
        self,
        bedrock_model: str,
        max_tokens: str,
        system_prompt: str,
        brave_api_key: str,
    ):
        self._bedrock_model_id = bedrock_model
        self._max_tokens = int(max_tokens) if max_tokens else 1024
        self._system_prompt = system_prompt

        # Create the Brave reviews tool with the API key bound
        get_computer_reviews = _create_get_computer_reviews(brave_api_key)

        # Configure the Bedrock model provider
        model = BedrockModel(
            model_id=bedrock_model,
            region_name="ap-southeast-2",
            max_tokens=self._max_tokens,
        )

        # Create the Strands agent — handles the agentic loop internally
        self._agent = Agent(
            model=model,
            system_prompt=system_prompt,
            tools=[lookup_inventory_tool, get_computer_reviews, get_book_info],
        )

    def query(self, messages: list[dict]) -> dict:
        """Invoke the Strands agent with conversation messages."""
        logger.info("querying against model: %s", self._bedrock_model_id)

        # Pass conversation history and invoke the agent with the last user message
        # Strands Agent accepts messages for conversation context
        self._agent.messages = messages

        # Extract the last user message text to invoke the agent
        last_user_text = self._extract_last_user_text(messages)

        result = self._agent(last_user_text)

        logger.info("response stop_reason: %s", result.stop_reason)

        # Return the response in a format compatible with the existing API contract
        return {
            "output": {
                "message": {
                    "role": "assistant",
                    "content": [{"text": result.message["content"][-1]["text"] if result.message.get("content") else str(result)}],
                }
            },
            "stopReason": result.stop_reason,
            "metrics": {},
        }

    @staticmethod
    def _extract_last_user_text(messages: list[dict]) -> str:
        """Extract the text from the last user message."""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                content = msg.get("content", [])
                if isinstance(content, str):
                    return content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and "text" in block:
                            return block["text"]
                        if isinstance(block, str):
                            return block
        return ""
