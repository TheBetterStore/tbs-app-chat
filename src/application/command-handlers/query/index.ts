import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {IChatService} from "../../../domain/interfaces/chat-service.interface";
import 'reflect-metadata';
import TYPES from '../../../infrastructure/types';
import container, {initContainer} from './container';
import {HttpUtils} from "../../../infrastructure/http-utils";
import {IClaims} from "../../../domain/models/claims.interface";

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

console.info('Lambda is cold-starting.');
const containerReady = initContainer();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    await containerReady;
    console.info('Entered handler');
    console.debug(JSON.stringify(event));

    if (!event.requestContext || !event.requestContext.authorizer) {
        return HttpUtils.buildJsonResponse(400, {message: 'Missing authorizer'}, event?.headers?.origin + '');
    }

    const userClaims: IClaims = event.requestContext.authorizer.claims;
    console.debug('Received userClaims:', userClaims);

    if((userClaims["cognito:username"] || '') != 'brycepc@hotmail.com') {
        return HttpUtils.buildJsonResponse(401, {message: 'Unauthorized'}, event?.headers?.origin + '');
    }

    const messages = event.body ? JSON.parse(event.body) : {};

    const svc = container.get<IChatService>(TYPES.IChatService);

    const res = await svc.query(messages);
    return HttpUtils.buildJsonResponse(200, res, event?.headers?.origin + '');

};

import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

export const wsHandler = async (event: any) => {
    const { routeKey, requestContext } = event;
    const connectionId = requestContext.connectionId;

    if (routeKey === '$connect' || routeKey === '$disconnect') {
        return { statusCode: 200 };
    }

    await containerReady;

    const endpoint = `https://${requestContext.domainName}/${requestContext.stage}`;
    const apigw = new ApiGatewayManagementApiClient({ endpoint });
    const send = (data: object) =>
        apigw.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify(data)),
        }));

    try {
        const body = JSON.parse(event.body);
        const svc = container.get<IChatService>(TYPES.IChatService);

        await svc.queryStream(body, async (text: string) => {
            await send({ text });
        });

        await send({ done: true });
    } catch (err) {
        console.error('WebSocket stream error:', err);
        await send({ error: 'Internal error' });
    }

    return { statusCode: 200 };
};
