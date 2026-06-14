import { IChatService } from '../interfaces/chat-service.interface';
import { Message } from '@aws-sdk/client-bedrock-runtime';
import { Agent, tool, BedrockModel } from '@strands-agents/sdk';
import z from 'zod';
import { inject, injectable } from 'inversify';
import TYPES from '../../infrastructure/types';
import { IInventoryService } from '../interfaces/inventory-service.interface';

const TOOL_TIMEOUT_MS = 5000;

@injectable()
export class ChatService implements IChatService {
  private agent: Agent;

  constructor(
    @inject(TYPES.IInventoryService) private inventoryService: IInventoryService,
    @inject(TYPES.BedrockModel) private bedrockModel: string,
    @inject(TYPES.MaxTokens) private maxTokens: string,
    @inject(TYPES.SystemPrompt) private systemPrompt: string,
    @inject(TYPES.BraveApiKey) private braveApiKey: string,
  ) {
    const model = new BedrockModel({
      modelId: this.bedrockModel,
      region: 'ap-southeast-2',
    });

    const lookupInventory = tool({
      name: 'lookup_inventory',
      description:
        'Search The Better Store product catalog. Returns products with name, category, price, description, and details.',
      inputSchema: z.object({
        productName: z.string().optional().describe('Optional product name to filter by'),
        brandId: z.string().optional().describe('Optional brand name to filter by (e.g. ASUS, Dell, Apple, Lenovo, HP, Samsung, Microsoft, Acer, Razer, MSI, Penguin Books, HarperCollins, Bloomsbury)'),
        category: z.enum(['BOOKS', 'COMPUTERS', 'MOBILE']).optional().describe('Optional product category to filter by'),
      }),
      callback: async (input) => ({
        products: await this.inventoryService.lookupInventory(
          input.productName,
          input.brandId,
          input.category,
        ),
      }),
    });

    const getComputerReviews = tool({
      name: 'get_computer_reviews',
      description:
        'Search for reviews and opinions about a specific computer or laptop. Use when the user asks about reviews for a computer product.',
      inputSchema: z.object({
        query: z.string().describe('Computer or laptop name/model to search reviews for'),
      }),
      callback: async (input) => this.getComputerReviews(input.query),
    });

    const getBookInfo = tool({
      name: 'get_book_info',
      description:
        'Search for book information including ratings and reviews from Open Library. Use when the user asks about a book.',
      inputSchema: z.object({
        query: z.string().describe('Book title or author to search for'),
      }),
      callback: async (input) => this.getBookInfo(input.query),
    });

    this.agent = new Agent({
      model,
      tools: [lookupInventory, getComputerReviews, getBookInfo],
      systemPrompt: this.systemPrompt,
      printer: false,
    });
  }

  async query(messages: Message[]): Promise<any> {
    console.info('querying against model: ' + this.bedrockModel);
    const lastUserMsg = this.extractLastUserMessage(messages);
    this.agent.messages = this.convertMessages(messages.slice(0, -1));
    const result = await this.agent.invoke(lastUserMsg);
    return result;
  }

  async queryStream(messages: Message[], onChunk: (text: string) => Promise<void> | void): Promise<void> {
    console.info('streaming query against model: ' + this.bedrockModel);
    const lastUserMsg = this.extractLastUserMessage(messages);
    this.agent.messages = this.convertMessages(messages.slice(0, -1));

    for await (const event of this.agent.stream(lastUserMsg)) {
      if (
        event.type === 'modelStreamUpdateEvent' &&
        event.event.type === 'modelContentBlockDeltaEvent' &&
        (event.event as any).delta.type === 'textDelta'
      ) {
        await onChunk((event.event as any).delta.text);
      }
    }
  }

  private extractLastUserMessage(messages: Message[]): string {
    const last = messages[messages.length - 1];
    const textBlock = last?.content?.find((b: any) => b.text);
    return (textBlock as any)?.text || '';
  }

  private convertMessages(messages: Message[]): any[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  private async getComputerReviews(query: string): Promise<Record<string, any>> {
    try {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query + ' review')}&count=5`,
        {
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.braveApiKey,
          },
          signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        return { error: `Review service unavailable (HTTP ${res.status}). Unable to fetch reviews at this time.` };
      }
      const data = await res.json();
      return { results: (data.web?.results || []).map((result: any) => ({
        title: result.title,
        url: result.url,
        description: result.description,
      })) };
    } catch (err) {
      console.error('getComputerReviews failed:', err);
      return { error: 'Review search timed out or failed. Please try again.' };
    }
  }

  private async getBookInfo(query: string): Promise<Record<string, any>> {
    try {
      const res = await fetch(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=3&fields=title,author_name,first_publish_year,ratings_average,ratings_count,subject`,
        { signal: AbortSignal.timeout(TOOL_TIMEOUT_MS) },
      );
      const data = await res.json();
      return { results: data.docs.map((doc: any) => ({
        title: doc.title,
        authors: doc.author_name,
        year: doc.first_publish_year,
        avgRating: doc.ratings_average,
        ratingsCount: doc.ratings_count,
        subjects: doc.subject?.slice(0, 5),
      })) };
    } catch (err) {
      console.error('getBookInfo failed:', err);
      return { error: 'Book search timed out or failed. Please try again.' };
    }
  }
}
