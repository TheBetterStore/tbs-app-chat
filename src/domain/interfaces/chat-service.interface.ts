import {Message} from "@aws-sdk/client-bedrock-runtime";

export interface IChatService {
  query(messages: Message[]): Promise<any>;
  queryStream(messages: Message[], onChunk: (text: string) => Promise<void> | void): Promise<void>;
}
