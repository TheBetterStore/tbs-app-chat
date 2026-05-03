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
