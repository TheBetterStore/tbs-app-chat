export environment=prod
export deployBucket=$MY_DEPLOY_BUCKET

export appName=tbs-app-chat
export kmsCFStackName="tbs-sec-kms-${environment}"
export stackName=$appName-$environment

#npm run build

export braveApiKeyParam="/${stackName}/BraveApi/Key"

internalKmsKeyId=$(aws cloudformation list-exports --query "Exports[?Name=='${kmsCFStackName}:InternalKmsKey:Id'].Value" --output text)
echo internalKmsKeyId=$internalKmsKeyId

aws ssm put-parameter \
  --name "${braveApiKeyParam}" \
  --value "TBA" \
  --type SecureString \
  --key-id "${internalKmsKeyId}" \
  --no-overwrite

# sam package --template-file ./template.yaml --output-template-file generated-template.yaml --s3-bucket $DEPLOY_BUCKET
echo "==> Building and pushing container..."
currentTime=$(date +"%Y%m%d%H%M%S")
shortGitHash=$(git rev-parse --short=7 HEAD)
export containerImageTag=${shortGitHash}-${currentTime}
./deploy-container.sh "${containerImageTag}"

sam deploy --template-file ./template.yaml --stack-name $stackName \
--s3-bucket $deployBucket --s3-prefix $appName \
--capabilities CAPABILITY_NAMED_IAM --region ap-southeast-2 --parameter-overrides Environment=$environment \
AppLoginCFName=tbs-app-login-$environment \
InfraBaseCFName=tbs-infra-$environment \
KmsCFStackName=$kmsCFStackName \
AllowedCorsDomains="http://localhost:4200,https://thebetterstore.net" \
BedrockModel="global.anthropic.claude-sonnet-4-5-20250929-v1:0" \
BraveApiKeyParam="${braveApiKeyParam}" \
ContainerImageTag="${containerImageTag}" \
--no-fail-on-empty-changeset \
--tags Environment=$environment StackName=$stackName TagProduct=$appName \
--profile thebetterstore

echo "==> Updating endpoint to latest runtime version..."
latestVersion=$(aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id tbs_app_chat_Runtime-G3j0S02kcw \
  --region ap-southeast-2 --profile thebetterstore \
  --query 'agentRuntimeVersion' --output text)
aws bedrock-agentcore-control update-agent-runtime-endpoint \
  --agent-runtime-id tbs_app_chat_Runtime-G3j0S02kcw \
  --endpoint-name tbs_app_chat_Endpoint \
  --agent-runtime-version "${latestVersion}" \
  --region ap-southeast-2 --profile thebetterstore
echo "==> Endpoint updating to version ${latestVersion}"

