import {Container} from 'inversify';
import TYPES from '../../infrastructure/types';
import { IInventoryService } from '../../domain/interfaces/inventory-service.interface';
import {InventoryService} from '../../domain/services/inventory-service';
import {ChatService} from '../../domain/services/chat-service';
import {IChatService} from '../../domain/interfaces/chat-service.interface';
import {SSMClient, GetParameterCommand} from '@aws-sdk/client-ssm';

const container = new Container();

container.bind<IChatService>(TYPES.IChatService).to(ChatService).inSingletonScope();
container.bind<IInventoryService>(TYPES.IInventoryService).to(InventoryService).inSingletonScope();
container.bind<string>(TYPES.BedrockModel).toConstantValue(process.env.BEDROCK_MODEL || '');
container.bind<string>(TYPES.MaxTokens).toConstantValue(process.env.MAX_TOKENS || '');
container.bind<string>(TYPES.SystemPrompt).toConstantValue(process.env.SYSTEM_PROMPT || '');

export const initContainer = async () => {
  const paramName = process.env.BRAVE_API_KEY_PARAM || '';
  const ssm = new SSMClient();
  const resp = await ssm.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
  container.bind<string>(TYPES.BraveApiKey).toConstantValue(resp.Parameter?.Value || '');
};

export default container;
